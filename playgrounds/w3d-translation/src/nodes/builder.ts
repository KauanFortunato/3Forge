// playgrounds/w3d-translation/src/nodes/builder.ts
import {
  AlwaysStencilFunc, Color, DoubleSide, EqualStencilFunc, Group, KeepStencilOp,
  Mesh, MeshBasicMaterial, NotEqualStencilFunc, Object3D, PlaneGeometry,
  ReplaceStencilOp, SRGBColorSpace, Texture, TextureLoader,
} from "three";
import type { W3DGroupData, W3DNodeData, W3DQuadData, W3DTransform } from "./data";
import { resolveMaterial, displayColorToHex } from "./materialResolver";
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
 * Phase 2F — alphaTest threshold for textured mask writers (e.g. PHOTO_DUMMY_0X
 * which uses the player photo + VERTICAL_RAMP alphaMap as the mask shape).
 * Fragments with combined alpha (map.a × alphaMap.r) below this threshold are
 * discarded before stencil write, so the stencil contour follows the texture's
 * alpha silhouette instead of writing a solid Size.X × Size.Y rectangle.
 * Tune empirically: 0.5 = sharp silhouette; lower values include more of the
 * VERTICAL_RAMP feathered edge.
 */
const TEXTURED_MASK_ALPHA_TEST = 0.5;

export type BuildContext = {
  registry: W3DResourceRegistry;
  textureUrlsByFilename: Map<string, string>;
  textureCache: Map<string, Texture>;
  warnings: string[];
  /** Debug aid (off by default): paint PHOTO_MASK_0X red 50% so the mask shape is visible. */
  stencilDebugShowMask?: boolean;
  /** Populated automatically by buildNodeTree from the input roots. */
  photoMaskInfoByMaskId?: Map<string, PhotoMaskInfo>;
};

export function buildNodeTree(roots: W3DNodeData[], ctx?: BuildContext): Group {
  if (ctx && !ctx.photoMaskInfoByMaskId) {
    ctx.photoMaskInfoByMaskId = collectPhotoMaskInfo(roots, ctx.warnings);
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
  };
  // Phase 2B — pivot anchor. When NodeTransform/Pivot is non-zero, route
  // children through an inner Group offset by -pivot. The outer carries
  // T(position) × R × S; the inner carries T(-pivot). Net effect:
  // M = T(position) × R × S × T(-pivot), so the pivot point lands at
  // `position` and rotation/scale apply around the pivot (Maya-style).
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
 * Phase 2B — create an inner pivot-anchor Group when the transform has a
 * non-zero Pivot. Returns the host that should receive children:
 * `outer` when pivot is absent/zero, otherwise a freshly added inner Group
 * with `position = -pivot`. The inner is named "<outer.name> (pivot)" so the
 * Object3D tree stays readable.
 */
function applyPivotAnchor(outer: Group, t: W3DTransform): Group {
  if (!hasNonZeroPivot(t.pivot)) return outer;
  const p = t.pivot!;
  const inner = new Group();
  inner.name = `${outer.name} (pivot)`;
  inner.position.set(-p.x, -p.y, -p.z);
  outer.add(inner);
  return inner;
}

function hasNonZeroPivot(p?: W3DTransform["pivot"]): boolean {
  return !!p && (p.x !== 0 || p.y !== 0 || p.z !== 0);
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
    // isMask quads are stencil planes — hide the plane itself until Phase H
    mesh.visible = node.enable && !node.isMask;
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
  wrapper.userData.w3d = {
    id: node.id, name: node.name, kind: "Quad", hasChildren: true, maskIds: node.maskIds,
  };
  // Phase 2B — pivot anchor for Quad-with-children. Mesh and children both
  // sit inside the pivot host so they share the same anchor offset.
  const host = applyPivotAnchor(wrapper, node.transform);
  const mesh = makeQuadMesh(node, ctx);
  // Hide the mask plane itself even when wrapper is visible
  if (node.isMask) mesh.visible = false;
  host.add(mesh);
  const passToChildren = node.maskIds.length > 0 ? node.maskIds : inheritedMaskIds;
  for (const c of node.children) host.add(buildNode(c, ctx, passToChildren));
  return wrapper;
}

/**
 * Phase 2B — wrap a leaf Quad mesh in an outer Group so the Quad's pivot
 * anchor applies. The outer takes over the mesh's position/rotation/scale;
 * the mesh becomes a child at -pivot with identity local transform. The
 * mesh's visibility (set by buildQuad / applyPhotoMaskStencil) is preserved
 * so stencil + enable semantics still work.
 */
function wrapMeshWithPivot(mesh: Mesh, node: W3DQuadData): Group {
  const p = node.transform.pivot!;
  const outer = new Group();
  outer.name = `${node.name} (pivot wrapper)`;
  outer.position.copy(mesh.position);
  outer.rotation.copy(mesh.rotation);
  outer.scale.copy(mesh.scale);
  mesh.position.set(-p.x, -p.y, -p.z);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  outer.add(mesh);
  return outer;
}

function makeQuadMesh(node: W3DQuadData, ctx?: BuildContext): Mesh {
  const geometry = new PlaneGeometry(node.geometry.size.x, node.geometry.size.y);
  applyAlignment(geometry, node.geometry);

  let resolvedColor: string;
  let resolvedOpacity: number;
  let resolvedTransparent: boolean;
  let resolvedMapUrl: string | undefined;
  let resolvedAlphaMapUrl: string | undefined;
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
    material.map = loadCachedTexture(resolvedMapUrl, ctx.textureCache);
    material.needsUpdate = true;
  }
  if (resolvedAlphaMapUrl && ctx) {
    material.alphaMap = loadCachedTexture(resolvedAlphaMapUrl, ctx.textureCache);
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
function applyPhotoMaskStencil(
  mesh: Mesh,
  node: W3DQuadData,
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
    mesh.visible = node.enable; // override the "hide isMask" default in buildQuad

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
    let isInverted = false;
    let mixedOwner = false;
    for (const id of effectiveMaskIds) {
      const target = info.get(id);
      if (!target) continue;
      isInverted = target.isInverted;
      if (target.klass === "mask") {
        if (maskOwner === undefined) maskOwner = target.playerIndex;
        else if (maskOwner !== target.playerIndex) mixedOwner = true;
      } else {
        if (dummyOwner === undefined) dummyOwner = target.playerIndex;
        else if (dummyOwner !== target.playerIndex) mixedOwner = true;
      }
    }
    if (maskOwner === undefined && dummyOwner === undefined) return;
    if (mixedOwner) {
      ctx.warnings.push(`Quad "${node.name}": effective maskIds reference multiple owner player indices within the same class; skipping stencil setup to avoid cross-player leakage.`);
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
    mat.stencilWrite = true;
    mat.stencilFunc = isInverted ? EqualStencilFunc : NotEqualStencilFunc;
    mat.stencilRef = ref;
    mat.stencilFuncMask = funcMask;
    mat.stencilFail = KeepStencilOp;
    mat.stencilZFail = KeepStencilOp;
    mat.stencilZPass = KeepStencilOp;
    mat.depthWrite = false;
    mat.depthTest = false;
    mesh.renderOrder = photoCardRenderOrder(node.name);
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
