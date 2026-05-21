// playgrounds/w3d-translation/src/nodes/builder.ts
import {
  AlwaysStencilFunc, CanvasTexture, ClampToEdgeWrapping, Color, DoubleSide, EqualStencilFunc,
  Group, KeepStencilOp, Mesh, MeshBasicMaterial, NotEqualStencilFunc, Object3D, PlaneGeometry,
  ReplaceStencilOp, SRGBColorSpace, Texture, TextureLoader,
} from "three";
import type {
  W3DGroupData, W3DMaskProperties, W3DNodeData, W3DQuadData, W3DTextureTextData, W3DTransform,
} from "./data";
import { resolveMaterial, displayColorToHex, type UVTransform } from "./materialResolver";
import type { W3DResourceRegistry } from "./resources";

/**
 * Phase 1a + Patch A — stencil clipping for the photo card subtree.
 *
 * Writers:
 *   PHOTO_MASK_0X  → bit 0 (stencilRef = stencilWriteMask = 1)
 *   PHOTO_DUMMY_0X → bit 1 (stencilRef = stencilWriteMask = 2)
 * Both use ReplaceStencilOp masked to their own bit, so they coexist at the
 * same pixel without overwriting each other.
 *
 * Readers (quads with maskIds — own or inherited from a parent Group):
 *   stencilWrite=true with KeepStencilOp on all branches (buffer read-only).
 *   stencilFuncMask masks the comparison to the writer's bit.
 *   IsInvertedMask=True  → EqualStencilFunc    (visible inside mask shape)
 *   IsInvertedMask=False → NotEqualStencilFunc (visible outside mask shape)
 *
 * Out of scope (untouched): BASE_*, multi-mask intersection PHOTO_FILL_02..05
 * (uses only maskIds[0]; combining with a second mask is a later phase).
 */
/**
 * Phase 2J — owner-tagged stencil bitfields.
 *
 * Phase 2I (shared type bits + last-writer-wins player bits) still leaked
 * across players in MASK_M ∩ DUMMY_N overlap zones: a pixel ended up with
 * bit 0 set by MASK_M but player bits overwritten to N by DUMMY_N, making
 * PHOTO_N / PHOTO_FILL_N pass on what is physically MASK_M's slit.
 *
 * Phase 2J splits the stencil byte into two disjoint 3-bit owner fields,
 * one per writer class. Each writer touches ONLY its own field, so neither
 * writer can contaminate the other's owner identity:
 *
 *   bits 0-2:   PHOTO_MASK owner player (0 = no MASK wrote, 1..7 = which player's MASK)
 *   bits 3-5:   PHOTO_DUMMY owner player (0 = no DUMMY wrote, 1..7 = which player's DUMMY)
 *   bits 6-7:   reserved
 *
 * Readers test the involved field(s) for owner == N. At pixel MASK_M ∩
 * DUMMY_N (M ≠ N), bits 0-2 = M and bits 3-5 = N — PHOTO_N (mask field == N)
 * and FILL_N (both fields == N) both fail correctly.
 */
type PhotoMaskClass = "mask" | "dummy";

type PhotoMaskInfo = {
  /** Writer class — selects which owner field this writer occupies. */
  klass: PhotoMaskClass;
  /** Player index extracted from the mask writer name (1..7). */
  playerIndex: number;
  isInverted: boolean;
  name: string;
};

const STENCIL_MASK_OWNER_FIELD = 0b00000111;   // bits 0-2: PHOTO_MASK owner
const STENCIL_DUMMY_OWNER_FIELD = 0b00111000;  // bits 3-5: PHOTO_DUMMY owner
const STENCIL_DUMMY_SHIFT = 3;
const STENCIL_PLAYER_INDEX_MAX = 7;

/**
 * Phase 2D.3 — generic colored-mask owner field.
 *
 * Reserved bits 6-7 for non-PHOTO `IsMask=True IsColoredMask=True` writers
 * (e.g. BASE_MAIN, BASE_TEAM in LINEUP_LEFT). These masks RENDER VISIBLY
 * (their gradient texture shows) AND write a stencil silhouette for their
 * MaskId clients (e.g. TEXTURE_FULLFRAME_MAIN clipping inside BASE_MAIN).
 *
 * The field is disjoint from the Phase 2J PHOTO fields:
 *   STENCIL_GENERIC_OWNER_FIELD & (STENCIL_MASK_OWNER_FIELD | STENCIL_DUMMY_OWNER_FIELD) === 0
 *
 * Index 0 means "no generic mask wrote here", indices 1..3 identify the
 * first three referenced generic masks discovered in document order. LINEUP_LEFT
 * needs 2 (BASE_MAIN, BASE_TEAM); the 4th generic mask emits a warning.
 */
const STENCIL_GENERIC_OWNER_FIELD = 0b11000000; // bits 6-7
const STENCIL_GENERIC_SHIFT = 6;
const STENCIL_GENERIC_INDEX_MAX = 3;

/**
 * Phase 2F — alphaTest threshold for textured mask writers (e.g. PHOTO_DUMMY_0X
 * which uses the player photo + VERTICAL_RAMP alphaMap as the mask shape).
 * Fragments with combined alpha (map.a × alphaMap.r) below this threshold are
 * discarded before stencil write, so the stencil contour follows the texture's
 * alpha silhouette instead of writing a solid Size.X × Size.Y rectangle.
 * Tune empirically: 0.5 = sharp silhouette; lower values include more of the
 * VERTICAL_RAMP feathered edge.
 */
const TEXTURED_MASK_ALPHA_TEST = 0.5;

export type GenericMaskInfo = {
  /** Generic mask owner index (1..STENCIL_GENERIC_INDEX_MAX). */
  index: number;
  isInverted: boolean;
  name: string;
};

export type BuildContext = {
  registry: W3DResourceRegistry;
  textureUrlsByFilename: Map<string, string>;
  textureCache: Map<string, Texture>;
  warnings: string[];
  /** Debug aid (off by default): paint PHOTO_MASK_0X red 50% so the mask shape is visible. */
  stencilDebugShowMask?: boolean;
  /** Populated automatically by buildNodeTree from the input roots. */
  photoMaskInfoByMaskId?: Map<string, PhotoMaskInfo>;
  /** Phase 2D.3 — populated automatically by buildNodeTree. */
  genericMaskInfoByMaskId?: Map<string, GenericMaskInfo>;
};

export function buildNodeTree(roots: W3DNodeData[], ctx?: BuildContext): Group {
  if (ctx && !ctx.photoMaskInfoByMaskId) {
    ctx.photoMaskInfoByMaskId = collectPhotoMaskInfo(roots, ctx.warnings);
  }
  if (ctx && !ctx.genericMaskInfoByMaskId) {
    ctx.genericMaskInfoByMaskId = collectGenericMaskInfo(roots, ctx.warnings);
  }
  const top = new Group();
  top.name = "w3d-nodes-root";
  for (const r of roots) top.add(buildNode(r, ctx));
  return top;
}

const PHOTO_MASK_NAME_RE = /^PHOTO_MASK_(\d+)$/;
const PHOTO_DUMMY_NAME_RE = /^PHOTO_DUMMY_(\d+)$/;

function collectPhotoMaskInfo(
  roots: W3DNodeData[],
  warnings?: string[],
): Map<string, PhotoMaskInfo> {
  const out = new Map<string, PhotoMaskInfo>();
  const walk = (n: W3DNodeData): void => {
    if (n.kind === "Quad" && n.isMask) {
      const isInverted = !!n.maskProperties?.isInvertedMask;
      let m = PHOTO_MASK_NAME_RE.exec(n.name);
      let klass: PhotoMaskClass = "mask";
      if (!m) {
        m = PHOTO_DUMMY_NAME_RE.exec(n.name);
        klass = "dummy";
      }
      if (m) {
        const playerIndex = parseInt(m[1], 10);
        if (playerIndex < 1 || playerIndex > STENCIL_PLAYER_INDEX_MAX) {
          warnings?.push(`Mask "${n.name}" has player index ${playerIndex} outside the 1..${STENCIL_PLAYER_INDEX_MAX} stencil scope; skipping.`);
        } else {
          out.set(n.id, { klass, playerIndex, isInverted, name: n.name });
        }
      }
    }
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

/**
 * Phase 2D.3 — collect non-PHOTO `IsMask=True IsColoredMask=True` quads as
 * generic stencil writers. A candidate is registered only when at least one
 * other node references its GUID via `maskIds[]` (otherwise the index would
 * be wasted on an orphan mask). Document order determines the index 1..MAX;
 * the 4th candidate emits a warning and is skipped.
 */
function collectGenericMaskInfo(
  roots: W3DNodeData[],
  warnings?: string[],
): Map<string, GenericMaskInfo> {
  const candidates: W3DQuadData[] = [];
  const referencedIds = new Set<string>();
  const walk = (n: W3DNodeData): void => {
    for (const id of n.maskIds) referencedIds.add(id);
    if (
      n.kind === "Quad" &&
      n.isMask &&
      n.maskProperties?.isColoredMask === true &&
      !PHOTO_MASK_NAME_RE.test(n.name) &&
      !PHOTO_DUMMY_NAME_RE.test(n.name)
    ) {
      candidates.push(n);
    }
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);

  const out = new Map<string, GenericMaskInfo>();
  let next = 1;
  for (const cand of candidates) {
    if (!referencedIds.has(cand.id)) continue; // orphan — no client references it
    if (next > STENCIL_GENERIC_INDEX_MAX) {
      warnings?.push(`Generic colored mask "${cand.name}" exceeds the ${STENCIL_GENERIC_INDEX_MAX}-mask limit; skipping stencil setup.`);
      continue;
    }
    out.set(cand.id, {
      index: next,
      isInverted: !!cand.maskProperties?.isInvertedMask,
      name: cand.name,
    });
    next++;
  }
  return out;
}

const PHOTO_FILL_NAME_RE = /^PHOTO_FILL_(\d+)$/;

/**
 * Phase 2H — R3 photo-fill paired-mask fallback.
 *
 * Convention observed in LINEUP_LEFT and similar R3 scenes: a PHOTO_FILL_XX
 * group is supposed to be clipped by BOTH the photo dummy AND the photo mask
 * slit for that player, so the FILL is visible only inside the intersection.
 * Most scenes author the maskIds explicitly as [PHOTO_DUMMY_XX, PHOTO_MASK_XX]
 * (PLAYER_02..05 in LINEUP_LEFT), but PHOTO_FILL_01 in LINEUP_LEFT was
 * authored with only [PHOTO_DUMMY_01], which leaves the yellow PHOTO_COLOR
 * leaking around the player silhouette in the playground.
 *
 * Fallback: when a group's name matches PHOTO_FILL_XX and its maskIds is a
 * single entry resolving to PHOTO_DUMMY_XX, append PHOTO_MASK_XX (when one
 * exists in the registry) to the effective list passed to children. The
 * parsed XML is NOT mutated.
 *
 * Skip cases (return input unchanged):
 *  - group has 0 or 2+ maskIds (author already paired them)
 *  - single maskId is not a DUMMY for this index
 *  - matching PHOTO_MASK_XX does not exist in the registry
 *  - group name does not match PHOTO_FILL_XX
 */
function augmentPhotoFillMaskIds(
  groupName: string,
  ownMaskIds: string[],
  info: Map<string, PhotoMaskInfo>,
): string[] {
  const m = PHOTO_FILL_NAME_RE.exec(groupName);
  if (!m) return ownMaskIds;
  if (ownMaskIds.length !== 1) return ownMaskIds;
  const index = m[1];
  const expectedDummyName = `PHOTO_DUMMY_${index}`;
  const expectedMaskName = `PHOTO_MASK_${index}`;
  const dummyEntry = info.get(ownMaskIds[0]);
  if (!dummyEntry || dummyEntry.name !== expectedDummyName) return ownMaskIds;
  let maskGuid: string | undefined;
  for (const [guid, mi] of info) {
    if (mi.name === expectedMaskName) {
      maskGuid = guid;
      break;
    }
  }
  if (!maskGuid) return ownMaskIds;
  return [ownMaskIds[0], maskGuid];
}

export function buildNode(node: W3DNodeData, ctx?: BuildContext, inheritedMaskIds?: string[]): Object3D {
  if (node.kind === "Group") return buildGroup(node, ctx, inheritedMaskIds);
  if (node.kind === "TextureText") return buildTextureText(node, ctx, inheritedMaskIds);
  return buildQuad(node, ctx, inheritedMaskIds);
}

function buildGroup(node: W3DGroupData, ctx?: BuildContext, inheritedMaskIds?: string[]): Group {
  const g = new Group();
  g.name = node.name;
  applyTransform(g, node.transform);
  g.userData.w3d = {
    id: node.id,
    name: node.name,
    kind: "Group",
    maskIds: node.maskIds,
    transform: node.transform,
    // DEV-Inspector — expose FlowChildren info on the Group userData so the
    // inspector can show authored LeadingSpace (e.g. PLAYERS LeadingSpace=-1.26).
    ...(node.flow ? { flow: node.flow } : {}),
    ...(node.displayColor ? { displayColor: node.displayColor } : {}),
  };
  // Phase 2B — pivot anchor. When NodeTransform/Pivot is non-zero, route
  // children through an inner Group offset by -pivot AND shift outer.position
  // by +pivot. Net effect: M = T(position) × T(pivot) × R × S × T(-pivot),
  // which is the Maya-style rotate/scale-around-pivot transform.
  // Critically, T(pivot) × T(-pivot) collapses when R=I and S=I, so pivot
  // has ZERO visual effect at identity rotation+scale. With S close to 1
  // (e.g. PLAYER_0X has scale 0.95), the residual shift is (1-S) × pivot,
  // which is small — so PLAYER_02's Pivot X=1.29 does NOT translate content
  // by -1.22 (which would push it into PLAYER_01's FlowChildren slot).
  const host = applyPivotAnchor(g, node.transform);
  // Own maskIds override inherited (R3 semantics). Children with no maskIds of
  // their own pick up this group's maskIds as their effective stencil source.
  // Phase 2H — PHOTO_FILL_XX with only PHOTO_DUMMY_XX gets PHOTO_MASK_XX
  // inferred when available, so the FILL clips to the intersection like its
  // multi-mask siblings.
  let effectiveOwnMaskIds = node.maskIds;
  if (effectiveOwnMaskIds.length > 0 && ctx?.photoMaskInfoByMaskId) {
    effectiveOwnMaskIds = augmentPhotoFillMaskIds(node.name, effectiveOwnMaskIds, ctx.photoMaskInfoByMaskId);
  }
  const passToChildren = effectiveOwnMaskIds.length > 0 ? effectiveOwnMaskIds : inheritedMaskIds;
  for (const c of node.children) host.add(buildNode(c, ctx, passToChildren));
  applyFlowLayout(host, node);
  return g;
}

/**
 * Phase 2B — create a pivot anchor for non-zero Pivot transforms.
 * Implements M = T(position) × T(pivot) × R × S × T(-pivot) using two
 * Object3D layers:
 *
 *   - outer.position is shifted by +pivot (in addition to the W3D Position
 *     already set by applyTransform). outer also carries R and S.
 *   - inner.position = -pivot. Children of the host (the returned inner)
 *     get translated by -pivot before outer's R × S applies.
 *
 * Returns `outer` unchanged when pivot is absent/zero so the no-pivot path
 * stays a single-Object3D layer. When R=I and S=I, the +pivot on outer
 * cancels the -pivot on inner — pivot has zero visual effect.
 */
function applyPivotAnchor(outer: Group, t: W3DTransform): Group {
  if (!hasNonZeroPivot(t.pivot)) return outer;
  const p = t.pivot!;
  outer.position.x += p.x;
  outer.position.y += p.y;
  outer.position.z += p.z;
  const inner = new Group();
  inner.name = `${outer.name} (pivot)`;
  inner.position.set(-p.x, -p.y, -p.z);
  // DEV-Inspector — mark pivot helpers so the inspector resolves clicks
  // through them up to the real W3D node.
  inner.userData.w3d = {
    kind: "(pivot helper)",
    forNodeId: (outer.userData?.w3d?.id as string | undefined) ?? "",
  };
  outer.add(inner);
  return inner;
}

function hasNonZeroPivot(p?: W3DTransform["pivot"]): boolean {
  return !!p && (p.x !== 0 || p.y !== 0 || p.z !== 0);
}

/**
 * Phase 2D.1 — true when a Quad's MaskProperties marks it as a "colored mask"
 * (R3 IsColoredMask="True"). Such masks are BOTH clip sources AND visible
 * colored content (e.g. BASE_MAIN, BASE_TEAM). Pure stencil masks
 * (PHOTO_MASK_0X / PHOTO_DUMMY_0X) carry IsColoredMask="False" and stay hidden.
 */
function isColoredMask(node: W3DQuadData): boolean {
  return node.maskProperties?.isColoredMask === true;
}

/**
 * Phase 2A — R3 FlowChildren horizontal distribution for the PLAYERS group.
 *
 * Rollout guard: this is intentionally scoped by node name to PLAYERS only.
 * The W3D <GeometryOptions FlowChildren/LeadingSpace/Direction> is parsed
 * generically on every Group, but the runtime layout below is restricted to
 * PLAYERS until other axes (Direction="YMinus" used by BENCH_LIST) are
 * validated. Phase 2F removes this gate.
 *
 * Formula: child.position.x += (n - 1 - i) * leadingSpace, where i is the
 * child's index in document order. With negative LeadingSpace (-1.26 for
 * PLAYERS), the first child gets the most negative offset and the last child
 * sits at the group origin (offset 0) — matching the R3 visual order
 * left → right of PLAYER_01..PLAYER_05.
 *
 * Additive: any X already authored on the child is preserved.
 */
function applyFlowLayout(group: Group, node: W3DGroupData): void {
  if (node.name !== "PLAYERS") return; // TEMP gate — see Phase 2F
  if (!node.flow?.children) return;
  const spacing = node.flow.leadingSpace ?? 0;
  if (spacing === 0) return;
  const n = group.children.length;
  group.children.forEach((child, i) => {
    child.position.x += (n - 1 - i) * spacing;
  });
}

function buildQuad(node: W3DQuadData, ctx?: BuildContext, inheritedMaskIds?: string[]): Object3D {
  if (node.children.length === 0) {
    const mesh = makeQuadMesh(node, ctx);
    applyTransform(mesh, node.transform);
    // Phase 2D.1 — isMask quads default to hidden (stencil-only writers like
    // PHOTO_MASK_0X / PHOTO_DUMMY_0X have IsColoredMask=False). When a mask
    // carries IsColoredMask=True (e.g. BASE_MAIN / BASE_TEAM in R3), it is
    // BOTH a clip source AND visible colored content — keep it visible.
    // applyPhotoMaskStencil's writer branch overrides this again to
    // `mesh.visible = node.enable` for PHOTO_* writers, but that path is
    // gated by name (collectPhotoMaskInfo), so non-PHOTO colored masks pass
    // through this rule.
    mesh.visible = node.enable && (!node.isMask || isColoredMask(node));
    applyPhotoMaskStencil(mesh, node, ctx, inheritedMaskIds);
    // Phase 2B — leaf Quad with pivot: wrap mesh in an outer Group so the
    // pivot anchor applies under the Quad's own transform. Outer carries
    // T(position) × R × S; mesh becomes a child at -pivot with identity
    // local transform.
    if (hasNonZeroPivot(node.transform.pivot)) {
      return wrapMeshWithPivot(mesh, node);
    }
    return mesh;
  }
  const wrapper = new Group();
  wrapper.name = `${node.name} (wrapper)`;
  applyTransform(wrapper, node.transform);
  // Wrapper stays visible so children (text, other quads) render correctly
  wrapper.visible = node.enable;
  // DEV-Inspector — wrapper userData carries the same payload shape as the
  // leaf-Quad mesh so the inspector report is uniform regardless of whether
  // the Quad has children.
  {
    const { children: _wc, ...wrest } = node;
    wrapper.userData.w3d = {
      ...wrest,
      kind: "Quad",
      hasChildren: true,
    };
  }
  // Phase 2B — pivot anchor for Quad-with-children. Mesh and children both
  // sit inside the pivot host so they share the same anchor offset.
  const host = applyPivotAnchor(wrapper, node.transform);
  const mesh = makeQuadMesh(node, ctx);
  // Phase 2D.1 — same colored-mask rule as the leaf-Quad path. Pure stencil
  // masks (IsColoredMask=False) stay hidden; colored masks (IsColoredMask=True)
  // remain visible so the Quad-with-children carrier still renders its band.
  if (node.isMask && !isColoredMask(node)) mesh.visible = false;
  host.add(mesh);
  const passToChildren = node.maskIds.length > 0 ? node.maskIds : inheritedMaskIds;
  for (const c of node.children) host.add(buildNode(c, ctx, passToChildren));
  return wrapper;
}

/**
 * Phase 2B — wrap a leaf Quad mesh in an outer Group so the Quad's pivot
 * anchor applies. Implements the same M = T(position) × T(pivot) × R × S
 * × T(-pivot) decomposition as applyPivotAnchor: outer takes over the
 * mesh's position (shifted by +pivot), rotation and scale; the mesh
 * becomes a child at -pivot with identity local transform. The mesh's
 * visibility (set by buildQuad / applyPhotoMaskStencil) is preserved so
 * stencil + enable semantics still work.
 */
type PivotCandidate = { id: string; name: string; transform: W3DTransform };
function wrapMeshWithPivot(mesh: Mesh, node: PivotCandidate): Group {
  const p = node.transform.pivot!;
  const outer = new Group();
  outer.name = `${node.name} (pivot wrapper)`;
  outer.position.set(
    mesh.position.x + p.x,
    mesh.position.y + p.y,
    mesh.position.z + p.z,
  );
  outer.rotation.copy(mesh.rotation);
  outer.scale.copy(mesh.scale);
  mesh.position.set(-p.x, -p.y, -p.z);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  // DEV-Inspector — pivot wrapper carries no W3D semantics; mark it so the
  // inspector skips it and resolves to the inner mesh (which has the real
  // Quad userData).
  outer.userData.w3d = { kind: "(pivot helper)", forNodeId: node.id };
  outer.add(mesh);
  return outer;
}

// ---------------------------------------------------------------------------
// Phase TextureText — static rendering via canvas-to-texture.
// ---------------------------------------------------------------------------

/**
 * Build a TextureText node as a PlaneGeometry mesh with a CanvasTexture map.
 * The text content is baked into the texture; the mesh's MeshBasicMaterial
 * color stays white so the canvas color shows through unaltered.
 *
 * Reuses existing pipelines:
 *   - resolveMaterial (color from BaseMaterial.emissive/diffuse, alpha)
 *   - applyTransform (W3D Position/Rotation/Scale)
 *   - applyPhotoMaskStencil (stencil reader for MaskId → BASE_MAIN etc.)
 *   - wrapMeshWithPivot (when transform.pivot is non-zero)
 *   - applyAlignment (PlaneGeometry vertex translation for AlignmentX/Y)
 */
function buildTextureText(
  node: W3DTextureTextData,
  ctx?: BuildContext,
  inheritedMaskIds?: string[],
): Object3D {
  const geometry = new PlaneGeometry(
    Math.max(node.textBox.x, 0.001),
    Math.max(node.textBox.y, 0.001),
  );
  applyAlignment(geometry, {
    alignmentX: node.alignmentX,
    alignmentY: node.alignmentY,
    size: node.textBox,
  });

  // Resolve color from the assigned BaseMaterial. TextureLayer is always
  // "Standard" for TextureText — no map/alphaMap path runs.
  let textColor = "#ffffff";
  let opacity = node.alpha;
  if (ctx) {
    const warnings: string[] = [];
    const resolved = resolveMaterial(
      node.faceMapping?.materialId,
      node.faceMapping?.textureLayerId,
      node.displayColor,
      node.alpha,
      ctx,
      warnings,
    );
    ctx.warnings.push(...warnings);
    textColor = resolved.color;
    opacity = resolved.opacity;
  } else if (node.displayColor) {
    textColor = displayColorToHex(node.displayColor);
  }

  // Resolve font family / weight / style from the registry FontStyle entry.
  const fontStyle = ctx?.registry.fontStyles.get(node.fontStyleId ?? "");
  const family = fontStyle?.fontName?.trim() || "sans-serif";
  const { weight, style } = fontStyleTypeToCss(fontStyle?.type ?? "");

  const texture = renderTextToCanvas({
    text: node.text,
    family,
    weight,
    style,
    color: textColor,
    textBox: node.textBox,
    alignmentX: node.alignmentX ?? "Center",
    alignmentY: node.alignmentY ?? "Center",
    quality: node.textQuality,
  });

  const material = new MeshBasicMaterial({
    color: new Color(0xffffff),     // texture carries the color; keep white tint
    map: texture,
    transparent: true,
    opacity,
    alphaTest: 0.01,
    side: DoubleSide,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = node.name;
  mesh.visible = node.enable;
  const { children: _c, ...rest } = node;
  mesh.userData.w3d = {
    ...rest,
    kind: "TextureText",
    fontFamily: family,
    fontWeight: weight,
    fontStyleName: fontStyle?.name,
  };

  applyTransform(mesh, node.transform);
  applyPhotoMaskStencil(mesh, node, ctx, inheritedMaskIds);

  if (hasNonZeroPivot(node.transform.pivot)) {
    return wrapMeshWithPivot(mesh, node);
  }
  return mesh;
}

/**
 * Map a W3D FontStyle `Type` string (e.g. "Light", "Bold", "Italic",
 * "Black Italic") to CSS weight + style. Unknown values fall back to
 * normal-400 sans-serif.
 */
function fontStyleTypeToCss(type: string): { weight: string; style: string } {
  const t = type.toLowerCase();
  let weight = "400";
  let style = "normal";
  if (t.includes("thin")) weight = "100";
  else if (t.includes("light")) weight = "300";
  else if (t.includes("medium")) weight = "500";
  else if (t.includes("semi") || t.includes("semibold")) weight = "600";
  else if (t.includes("black")) weight = "900";
  else if (t.includes("bold")) weight = "700";
  if (t.includes("italic") || t.includes("oblique")) style = "italic";
  return { weight, style };
}

interface RenderTextOptions {
  text: string;
  family: string;
  weight: string;
  style: string;
  color: string;
  textBox: { x: number; y: number };
  alignmentX: "Left" | "Right" | "Center";
  alignmentY: "Top" | "Bottom" | "Center";
  quality: number;
}

/**
 * Rasterize `text` into a CanvasTexture sized roughly proportional to the
 * authored TextBoxSize × quality. In jsdom (test env) the 2D context is null;
 * the helper returns a valid empty CanvasTexture in that case so structural
 * tests can assert geometry/material without depending on font metrics.
 */
function renderTextToCanvas(opts: RenderTextOptions): CanvasTexture {
  const pxPerUnit = 200 * Math.max(opts.quality, 0.5);
  const w = Math.max(8, Math.round(opts.textBox.x * pxPerUnit));
  const h = Math.max(8, Math.round(opts.textBox.y * pxPerUnit));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c2d = canvas.getContext("2d");
  if (c2d) {
    c2d.clearRect(0, 0, w, h);
    // Font size: leave a small inset (~85% of canvas height) so descenders fit.
    const fontPx = Math.max(4, Math.floor(h * 0.85));
    c2d.font = `${opts.style} ${opts.weight} ${fontPx}px "${opts.family}", sans-serif`;
    c2d.fillStyle = opts.color;
    c2d.textAlign =
      opts.alignmentX === "Left" ? "left"
      : opts.alignmentX === "Right" ? "right"
      : "center";
    c2d.textBaseline =
      opts.alignmentY === "Top" ? "top"
      : opts.alignmentY === "Bottom" ? "bottom"
      : "middle";
    const tx =
      opts.alignmentX === "Left" ? 0
      : opts.alignmentX === "Right" ? w
      : w / 2;
    const ty =
      opts.alignmentY === "Top" ? 0
      : opts.alignmentY === "Bottom" ? h
      : h / 2;
    c2d.fillText(opts.text, tx, ty);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeQuadMesh(node: W3DQuadData, ctx?: BuildContext): Mesh {
  const geometry = new PlaneGeometry(node.geometry.size.x, node.geometry.size.y);
  applyAlignment(geometry, node.geometry);

  let resolvedColor: string;
  let resolvedOpacity: number;
  let resolvedTransparent: boolean;
  let resolvedMapUrl: string | undefined;
  let resolvedAlphaMapUrl: string | undefined;
  let resolvedMapTransform: UVTransform | undefined;
  let resolvedAlphaMapTransform: UVTransform | undefined;
  let hasMaterialResolved = false;
  let hasTextureLayerResolved = false;
  let materialName: string | undefined;
  let textureLayerName: string | undefined;
  let textureFilename: string | undefined;

  if (ctx) {
    const warnings: string[] = [];
    const resolved = resolveMaterial(
      node.faceMapping?.materialId,
      node.faceMapping?.textureLayerId,
      node.displayColor,
      node.alpha,
      ctx,
      warnings,
    );
    ctx.warnings.push(...warnings);
    resolvedColor = resolved.color;
    resolvedOpacity = resolved.opacity;
    resolvedTransparent = resolved.transparent;
    resolvedMapUrl = resolved.mapUrl;
    // Only use alphaMapUrl if it is different from mapUrl
    resolvedAlphaMapUrl = (resolved.alphaMapUrl && resolved.alphaMapUrl !== resolved.mapUrl)
      ? resolved.alphaMapUrl
      : undefined;
    resolvedMapTransform = resolved.mapTransform;
    resolvedAlphaMapTransform = resolvedAlphaMapUrl ? resolved.alphaMapTransform : undefined;
    hasMaterialResolved = resolved.hasMaterialResolved;
    hasTextureLayerResolved = resolved.hasTextureLayerResolved;
    materialName = resolved.materialName;
    textureLayerName = resolved.textureLayerName;
    textureFilename = resolved.textureFilename;
  } else {
    // Phase-F fallback: no BuildContext provided
    resolvedColor = displayColorToHex(node.displayColor);
    resolvedOpacity = node.alpha;
    resolvedTransparent = node.alpha < 1;
  }

  const material = new MeshBasicMaterial({
    color: new Color(resolvedColor),
    transparent: resolvedTransparent,
    opacity: resolvedOpacity,
    side: DoubleSide,
  });

  if (resolvedMapUrl && ctx) {
    material.map = acquireTexture(resolvedMapUrl, resolvedMapTransform, ctx.textureCache);
    material.needsUpdate = true;
  }
  if (resolvedAlphaMapUrl && ctx) {
    material.alphaMap = acquireTexture(resolvedAlphaMapUrl, resolvedAlphaMapTransform, ctx.textureCache);
    material.needsUpdate = true;
  }

  const mesh = new Mesh(geometry, material);
  mesh.name = node.name;
  const { children: _c, ...rest } = node;
  mesh.userData.w3d = {
    ...rest,
    kind: "Quad",
    hasMaterialResolved,
    hasTextureLayerResolved,
    materialName,
    textureLayerName,
    textureFilename,
    ...(resolvedMapUrl ? { mapUrl: resolvedMapUrl } : {}),
    ...(resolvedAlphaMapUrl ? { alphaMapUrl: resolvedAlphaMapUrl } : {}),
  };
  return mesh;
}

/**
 * Translate PlaneGeometry vertices in local-space so the geometry origin
 * matches the W3D AlignmentX / AlignmentY semantics:
 *   - Left   → X ∈ [0, width]
 *   - Right  → X ∈ [-width, 0]
 *   - Center → centered (default)
 *   - Bottom → Y ∈ [0, height]
 *   - Top    → Y ∈ [-height, 0]
 *   - Center → centered (default)
 *
 * mesh.position is untouched — that belongs to <NodeTransform><Position/>.
 */
function applyAlignment(geometry: PlaneGeometry, geo: W3DQuadData["geometry"]): void {
  const halfW = geo.size.x / 2;
  const halfH = geo.size.y / 2;
  let dx = 0;
  let dy = 0;
  if (geo.alignmentX === "Left") dx = +halfW;
  else if (geo.alignmentX === "Right") dx = -halfW;
  if (geo.alignmentY === "Top") dy = -halfH;
  else if (geo.alignmentY === "Bottom") dy = +halfH;
  if (dx !== 0 || dy !== 0) geometry.translate(dx, dy, 0);
}

/**
 * Apply Phase 1a + Patch A stencil clipping to a quad mesh.
 *
 * Writers (PHOTO_MASK_0X / PHOTO_DUMMY_0X):
 *   - isMask=true and name matches /^PHOTO_(MASK|DUMMY)_\d+$/
 *   - writes only its own bit via stencilWriteMask (so PHOTO_MASK and
 *     PHOTO_DUMMY don't overwrite each other at the same pixel)
 *
 * Readers:
 *   - quads with maskIds (own or inherited from a parent Group)
 *   - reads only the writer's bit via stencilFuncMask
 *   - stencilFunc derived from the writer's IsInvertedMask
 */
/**
 * Minimal shape that both W3DQuadData and W3DTextureTextData satisfy. Phase
 * TextureText reuses the stencil-reader path so text labels can be clipped by
 * BASE_MAIN / BASE_TEAM the same way Quad clients are.
 */
type StencilCandidate = {
  id: string;
  name: string;
  enable?: boolean;
  isMask?: boolean;
  maskIds: string[];
  maskProperties?: W3DMaskProperties;
};

function applyPhotoMaskStencil(
  mesh: Mesh,
  node: StencilCandidate,
  ctx?: BuildContext,
  inheritedMaskIds?: string[],
): void {
  if (!ctx) return;
  const info = ctx.photoMaskInfoByMaskId;
  if (!info) return;
  const mat = mesh.material as MeshBasicMaterial;

  // Writer: PHOTO_MASK_0X or PHOTO_DUMMY_0X
  if (node.isMask && info.has(node.id)) {
    const { klass, playerIndex } = info.get(node.id)!;
    // Phase 2J — write owner player index into this writer's own 3-bit field
    // only. MASK writers occupy bits 0-2, DUMMY writers occupy bits 3-5. The
    // two fields are disjoint, so a MASK writer can never overwrite a DUMMY
    // owner and vice-versa — cross-player leakage from MASK_M ∩ DUMMY_N is
    // structurally impossible.
    const writeMask = klass === "mask" ? STENCIL_MASK_OWNER_FIELD : STENCIL_DUMMY_OWNER_FIELD;
    const ref = klass === "mask" ? playerIndex : (playerIndex << STENCIL_DUMMY_SHIFT);
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.stencilWrite = true;
    mat.stencilWriteMask = writeMask;
    mat.stencilFunc = AlwaysStencilFunc;
    mat.stencilRef = ref;
    mat.stencilZPass = ReplaceStencilOp;
    mat.stencilFail = ReplaceStencilOp;
    mat.stencilZFail = ReplaceStencilOp;
    mesh.renderOrder = 10;
    mesh.visible = node.enable ?? true; // override the "hide isMask" default in buildQuad

    // Phase 2F — textured mask writers (e.g. PHOTO_DUMMY_0X with the player
    // layer carrying Player N.png + VERTICAL_RAMP) must use the texture alpha
    // as the stencil contour, not the geometric rectangle. The MaskProperties
    // attribute DisableBinaryAlpha="True" indicates this in the W3D source;
    // we translate it to a Three.js alphaTest threshold so fragments with
    // (map.a × alphaMap.r) below the cutoff are discarded before the stencil
    // write happens.
    //
    // Untextured masks (PHOTO_MASK_0X uses TextureLayer="Standard" — no map,
    // no alphaMap) fall through: there's nothing to alphaTest against, so the
    // stencil follows the full geometric quad.
    if (node.maskProperties?.disableBinaryAlpha === true && (mat.map || mat.alphaMap)) {
      mat.alphaTest = TEXTURED_MASK_ALPHA_TEST;
    }

    if (ctx.stencilDebugShowMask) {
      // Debug aid: paint the mask red 50% so its shape is visible
      mat.color = new Color("#ff0000");
      mat.opacity = 0.5;
      mat.transparent = true;
      mat.colorWrite = true;
      mat.map = null;
      mat.alphaMap = null;
      mat.alphaTest = 0; // drop the alpha cutoff so the debug rectangle is fully visible
      mat.needsUpdate = true;
    } else {
      mat.colorWrite = false;
    }
    return;
  }

  // Writer: generic colored mask (BASE_MAIN, BASE_TEAM, ...). Phase 2D.3.
  // Diverges from the PHOTO_* writer in TWO ways:
  //   - writes only to STENCIL_GENERIC_OWNER_FIELD (bits 6-7);
  //   - keeps colorWrite=true so the gradient texture renders as a visible
  //     band underneath its clipped clients (TEXTURE_FULLFRAME_*).
  const genericInfo = ctx.genericMaskInfoByMaskId;
  if (genericInfo && node.isMask && genericInfo.has(node.id)) {
    const { index } = genericInfo.get(node.id)!;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.stencilWrite = true;
    mat.stencilWriteMask = STENCIL_GENERIC_OWNER_FIELD;
    mat.stencilFunc = AlwaysStencilFunc;
    mat.stencilRef = index << STENCIL_GENERIC_SHIFT;
    mat.stencilZPass = ReplaceStencilOp;
    mat.stencilFail = ReplaceStencilOp;
    mat.stencilZFail = ReplaceStencilOp;
    mesh.renderOrder = RENDER_ORDER_GENERIC_WRITER;
    mesh.visible = node.enable ?? true;
    // colorWrite intentionally left at default (true) so the colored gradient
    // band paints into the framebuffer. This is the structural difference vs
    // PHOTO_* writers, which suppress color by setting colorWrite=false.
    return;
  }

  // Reader: own maskIds take precedence; otherwise inherit from parent Group.
  // Phase 2E + 2J — collect MASK and DUMMY owner player indices separately.
  // Each field is tested independently for owner == N:
  //   - PHOTO_N with [MASK_N]:                ref = N,                funcMask = 0b00000111
  //   - PHOTO_FILL_N with [DUMMY_N, MASK_N]:  ref = N | (N << 3),     funcMask = 0b00111111
  //   - PHOTO_FILL with only [DUMMY_N]:       ref = N << 3,           funcMask = 0b00111000
  //
  // Disjoint MASK / DUMMY fields make cross-player MASK_M ∩ DUMMY_N pixels
  // fail both PHOTO_N and FILL_N reads: bits 0-2 = M ≠ N for the mask field.
  //
  // If maskIds resolve to multiple distinct owner indices on the same class,
  // or MASK and DUMMY owners disagree, that's an authoring error — skip
  // stencil setup and record a warning.
  const effectiveMaskIds: string[] = node.maskIds.length > 0
    ? node.maskIds
    : (inheritedMaskIds ?? []);
  if (effectiveMaskIds.length > 0) {
    let maskOwner: number | undefined;
    let dummyOwner: number | undefined;
    let genericOwner: number | undefined;
    let isInverted = false;
    let mixedOwner = false;
    for (const id of effectiveMaskIds) {
      const target = info ? info.get(id) : undefined;
      if (target) {
        isInverted = target.isInverted;
        if (target.klass === "mask") {
          if (maskOwner === undefined) maskOwner = target.playerIndex;
          else if (maskOwner !== target.playerIndex) mixedOwner = true;
        } else {
          if (dummyOwner === undefined) dummyOwner = target.playerIndex;
          else if (dummyOwner !== target.playerIndex) mixedOwner = true;
        }
        continue;
      }
      // Phase 2D.3 — check the generic-mask map. Fields are disjoint from
      // PHOTO bits, so a reader can carry both a PHOTO owner and a generic
      // owner simultaneously; the combined ref/funcMask still tests each
      // pipeline independently.
      const genericTarget = genericInfo ? genericInfo.get(id) : undefined;
      if (genericTarget) {
        isInverted = genericTarget.isInverted;
        if (genericOwner === undefined) genericOwner = genericTarget.index;
        else if (genericOwner !== genericTarget.index) mixedOwner = true;
      }
    }
    if (maskOwner === undefined && dummyOwner === undefined && genericOwner === undefined) return;
    if (mixedOwner) {
      ctx.warnings.push(`Quad "${node.name}": effective maskIds reference multiple owner indices within the same field; skipping stencil setup to avoid cross-owner leakage.`);
      return;
    }
    if (maskOwner !== undefined && dummyOwner !== undefined && maskOwner !== dummyOwner) {
      ctx.warnings.push(`Quad "${node.name}": effective MASK owner (${maskOwner}) disagrees with DUMMY owner (${dummyOwner}); skipping stencil setup to avoid cross-player leakage.`);
      return;
    }
    let ref = 0;
    let funcMask = 0;
    if (maskOwner !== undefined) {
      ref |= maskOwner;
      funcMask |= STENCIL_MASK_OWNER_FIELD;
    }
    if (dummyOwner !== undefined) {
      ref |= (dummyOwner << STENCIL_DUMMY_SHIFT);
      funcMask |= STENCIL_DUMMY_OWNER_FIELD;
    }
    if (genericOwner !== undefined) {
      ref |= (genericOwner << STENCIL_GENERIC_SHIFT);
      funcMask |= STENCIL_GENERIC_OWNER_FIELD;
    }
    mat.stencilWrite = true;
    mat.stencilFunc = isInverted ? EqualStencilFunc : NotEqualStencilFunc;
    mat.stencilRef = ref;
    mat.stencilFuncMask = funcMask;
    mat.stencilFail = KeepStencilOp;
    mat.stencilZFail = KeepStencilOp;
    mat.stencilZPass = KeepStencilOp;
    mat.depthWrite = false;
    mat.depthTest = false;
    // Phase 2D.3 — generic-only readers (no PHOTO bits) get
    // RENDER_ORDER_GENERIC_CLIENT so they sit between BASE_MAIN/BASE_TEAM
    // (writer @ 15) and player photo cards (TEXTURE_PHOTO @ 18+).
    const isGenericOnly =
      maskOwner === undefined && dummyOwner === undefined && genericOwner !== undefined;
    mesh.renderOrder = isGenericOnly
      ? RENDER_ORDER_GENERIC_CLIENT
      : photoCardRenderOrder(node.name);
    // Patch D2 — force photo-card readers (PHOTO_0X, PHOTO_COLOR_0X,
    // TEXTURE_PHOTO_0X) into the transparent pass so Three.js sorts them
    // strictly by renderOrder. Without this, an opaque reader (PHOTO_COLOR_0X
    // with no texture and opacity=1) would land in the opaque pass and render
    // BEFORE transparent peers (TEXTURE_PHOTO_0X with PATTERN.png, PHOTO_0X
    // with Player N.png), inverting the intended back-to-front layering and
    // letting the diagonal PATTERN.png stripes appear on top of the yellow
    // PHOTO_COLOR block. Scoped to photo-card names only so future readers
    // (e.g. someone reusing PHOTO_MASK_0X stencil from outside the card)
    // keep their authored transparency.
    if (isPhotoCardClient(node.name)) {
      mat.transparent = true;
    }
  }
}

/**
 * Patch D2 — granular renderOrder for photo-card stencil readers.
 *
 * With depthTest=false on all clients (required for stencil to draw without
 * being culled by the masks' depth values) Three.js can't z-sort by depth.
 * The opaque vs transparent pass split would then place TEXTURE_PHOTO (PNG,
 * transparent pass) ON TOP of PHOTO_COLOR (no map, opaque pass), inverting
 * the R3 visual order. Forcing renderOrder per node-name role restores the
 * intended back-to-front: TEXTURE (pattern) → COLOR (yellow) → PHOTO (player).
 */
const RENDER_ORDER_GENERIC_WRITER = 15;   // Phase 2D.3 — between PHOTO writer (10) and PHOTO reader (18+)
const RENDER_ORDER_GENERIC_CLIENT = 16;   // Phase 2D.3 — generic readers (TEXTURE_FULLFRAME_*, etc.)
const RENDER_ORDER_TEXTURE_PHOTO = 18;
const RENDER_ORDER_PHOTO_COLOR = 19;
const RENDER_ORDER_DEFAULT_CLIENT = 20;

const PHOTO_CARD_CLIENT_RE = /^(TEXTURE_PHOTO_\d+|PHOTO_COLOR_\d+|PHOTO_\d+)$/;

function photoCardRenderOrder(name: string): number {
  if (/^TEXTURE_PHOTO_\d+$/.test(name)) return RENDER_ORDER_TEXTURE_PHOTO;
  if (/^PHOTO_COLOR_\d+$/.test(name)) return RENDER_ORDER_PHOTO_COLOR;
  return RENDER_ORDER_DEFAULT_CLIENT;
}

function isPhotoCardClient(name: string): boolean {
  return PHOTO_CARD_CLIENT_RE.test(name);
}

function loadCachedTexture(url: string, cache: Map<string, Texture>): Texture {
  const cached = cache.get(url);
  if (cached) return cached;
  const tex = new TextureLoader().load(url);
  tex.colorSpace = SRGBColorSpace;
  cache.set(url, tex);
  return tex;
}

/**
 * Phase 2C — acquire a Texture instance with an optional UV transform applied.
 *
 * The shared singleton from `loadCachedTexture` is never mutated. When the
 * transform is identity (or absent), the cached instance is returned as-is.
 * For any non-identity transform the cached base is cloned and the clone
 * receives the offset/repeat/rotation/wrap state. This isolates per-material
 * UV transforms from each other, even when two materials reference the same
 * underlying texture file.
 */
function acquireTexture(
  url: string,
  transform: UVTransform | undefined,
  cache: Map<string, Texture>,
): Texture {
  const base = loadCachedTexture(url, cache);
  if (!transform || isIdentityUVTransform(transform)) return base;
  const tex = base.clone();
  tex.offset.set(transform.offset.x, transform.offset.y);
  tex.repeat.set(transform.repeat.x, transform.repeat.y);
  tex.rotation = degToRad(transform.rotationDeg);
  tex.wrapS = transform.wrapS;
  tex.wrapT = transform.wrapT;
  tex.needsUpdate = true;
  return tex;
}

function isIdentityUVTransform(t: UVTransform): boolean {
  return (
    t.offset.x === 0 && t.offset.y === 0 &&
    t.repeat.x === 1 && t.repeat.y === 1 &&
    t.rotationDeg === 0 &&
    t.wrapS === ClampToEdgeWrapping &&
    t.wrapT === ClampToEdgeWrapping
  );
}

function applyTransform(obj: Object3D, t: W3DTransform): void {
  obj.position.set(t.position.x, t.position.y, t.position.z);
  obj.rotation.set(degToRad(t.rotationDeg.x), degToRad(t.rotationDeg.y), degToRad(t.rotationDeg.z));
  obj.scale.set(t.scale.x, t.scale.y, t.scale.z);
  // Pivot is applied by applyPivotAnchor / wrapMeshWithPivot (Phase 2B), not
  // here — those routines insert an inner offset under the transformed outer.
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
