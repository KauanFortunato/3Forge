// playgrounds/w3d-translation/src/nodes/builder.ts
import {
  AlwaysStencilFunc, Box3, CanvasTexture, ClampToEdgeWrapping, Color, DoubleSide,
  EqualStencilFunc, Group, KeepStencilOp, Mesh, MeshBasicMaterial,
  NotEqualStencilFunc, Object3D, PlaneGeometry, ReplaceStencilOp, SRGBColorSpace, Texture,
  TextureLoader, Vector3,
} from "three";
import type {
  W3DGroupData, W3DMaskProperties, W3DNodeData, W3DQuadData, W3DTextureTextData, W3DTransform,
} from "./data";
import { resolveMaterial, displayColorToHex, type UVTransform } from "./materialResolver";
import type { W3DResourceRegistry } from "./resources";
import {
  inkAnchorOffset, measureTextureText,
  type AlignmentX, type MetricsProvider, type MeasureResult,
} from "./textureTextMeasure";

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

/**
 * Phase 2K — design CONCENTRATION applied on top of the authored ScaleKey fade
 * height. The raw `1/ScaleKey` rate (this scene: 2 → fade over the bottom half)
 * reaches too far UP the card; the broadcast look keeps the player opaque and
 * fades only the lower portion. This gain multiplies the ScaleKey-derived rate
 * so the fade sits LOWER and more concentrated, while still SCALING with the
 * authored ScaleKey (a different scene's scale still drives its own height).
 * 1.5 ≈ fade over the bottom third for ScaleKey 0.5; the only knob if more/less
 * (higher = lower/tighter fade, lower = taller/stronger fade).
 */
const BASE_FADE_GAIN = 1.5;

/**
 * Phase 2K — the coloured FILL behind the photo reaches full transparency over
 * its bottom FILL_FADE_FOOT (in the matte's local UV.v). The fill uses the SAME
 * dummy ramp as the photo, just biased to vanish EARLIER: its gold/pattern must
 * be gone BEFORE the photo (still opaque above the fade) reveals that area, or it
 * shows as a gold "bar" in the fade region (NOT present in the R3 thumb, where
 * players are clean photos fading into the team panel). The fade transition then
 * sits behind the opaque photo, so no strip-fading is visible. Bias only; the
 * fade rate still comes from the dummy ramp (authored ScaleKey × gain).
 */
const FILL_FADE_FOOT = 0.5;

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
  /**
   * Phase H3 — set of "<family>|<weight>|<style>" keys that the playground
   * successfully registered via FontFace. The TextureText builder consults
   * this only to surface a per-node `fontLoaded` flag on userData (for the
   * DEV inspector); the actual canvas rendering still trusts the browser
   * to pick the registered face when present and fall back otherwise.
   */
  loadedFontIndex?: Set<string>;
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
  if (ctx) applySmoothMaskBaseFade(top);
  return top;
}

function collectPhotoMaskInfo(
  roots: W3DNodeData[],
  warnings?: string[],
): Map<string, PhotoMaskInfo> {
  const out = new Map<string, PhotoMaskInfo>();
  // Player slot = discovery order of the "player container" — the parent node that
  // holds the photo masks. A player's MASK and DUMMY are siblings under the same
  // container, so they SHARE a slot. This preserves the cross-player identity the
  // name's index used to carry (a reader that mixes player A's MASK with player
  // B's DUMMY still resolves to disagreeing owners and is skipped), WITHOUT
  // reading the name. On LINEUP each VERTICAL_REPOS_0X container → slot 1..5,
  // identical to the former PHOTO_MASK_0X → X mapping.
  const slotByParentId = new Map<string, number>();
  let nextSlot = 0;
  const walk = (n: W3DNodeData, parentId: string): void => {
    // Photo masks are the NON-coloured stencil writers. IsColoredMask=True is the
    // generic colored-mask path (BASE_*), handled by collectGenericMaskInfo.
    if (n.kind === "Quad" && n.isMask && n.maskProperties?.isColoredMask !== true) {
      let slot = slotByParentId.get(parentId);
      if (slot === undefined) {
        slot = ++nextSlot;
        slotByParentId.set(parentId, slot);
      }
      if (slot > STENCIL_PLAYER_INDEX_MAX) {
        warnings?.push(`Photo mask "${n.name}" is in player container #${slot}, exceeding the ${STENCIL_PLAYER_INDEX_MAX}-slot stencil scope; skipping.`);
      } else {
        // Class from DisableBinaryAlpha: textured silhouette (true) = "dummy",
        // geometric stencil shape (false) = "mask". Derived from attributes, not name.
        const klass: PhotoMaskClass = n.maskProperties?.disableBinaryAlpha ? "dummy" : "mask";
        out.set(n.id, { klass, playerIndex: slot, isInverted: !!n.maskProperties?.isInvertedMask, name: n.name });
      }
    }
    for (const c of n.children) walk(c, n.id);
  };
  for (const r of roots) walk(r, "__root__");
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
    // Generic colored masks are the visible IsColoredMask=True writers (BASE_*).
    // Photo masks (IsColoredMask=False) go to collectPhotoMaskInfo, so the
    // `isColoredMask === true` check alone separates the two paths — no name needed.
    if (n.kind === "Quad" && n.isMask && n.maskProperties?.isColoredMask === true) {
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

export function buildNode(
  node: W3DNodeData,
  ctx?: BuildContext,
  inheritedMaskIds?: string[],
  inheritedAlpha?: number,
): Object3D {
  if (node.kind === "Group") return buildGroup(node, ctx, inheritedMaskIds, inheritedAlpha);
  if (node.kind === "TextureText") return buildTextureText(node, ctx, inheritedMaskIds, inheritedAlpha);
  return buildQuad(node, ctx, inheritedMaskIds, inheritedAlpha);
}

/**
 * Phase P1 — cumulative parent-Group Alpha is multiplied into descendant
 * Quad/TextureText leaf opacity. `inheritedAlpha` defaults to 1 (no parent
 * contribution). A Group with `alpha=0.7` multiplies what it passes down
 * by 0.7, so a nested Group(0.5) > Group(0.5) > Quad(1) yields leaf
 * opacity 0.25. Authored static Group `Alpha` attribute is the only source;
 * timeline Alpha animation on Groups is not yet propagated here (Phase P1
 * scope keeps to the static authored value to match BENCH Alpha="0.7").
 */
function buildGroup(
  node: W3DGroupData,
  ctx?: BuildContext,
  inheritedMaskIds?: string[],
  inheritedAlpha?: number,
): Group {
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
  // Phase P1 — fold this Group's authored Alpha into the inherited alpha that
  // descendant leaves multiply into their material opacity. `node.alpha` is
  // undefined for Groups that did not author the attribute (the common case);
  // we treat undefined as 1, so the recursion is a no-op for those Groups.
  const incoming = inheritedAlpha ?? 1;
  const passAlpha = incoming * (node.alpha ?? 1);
  for (const c of node.children) host.add(buildNode(c, ctx, passToChildren, passAlpha));
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
  // Phase P7 — for PivotType="Absolute" axes whose authored Position comes
  // from a timeline `Transform.Position.{X|Y|Z}Prop` keyframe, R3 interprets
  // the animated value as the world-space LANDING POINT of the pivot. The
  // standard Maya decomposition `M = T(pos+piv) × R × S × T(-piv)` produces
  // `pos + (1-S)·piv` for a child at the local origin — it adds an unwanted
  // `+pivot` shift to `pos`. We DROP only the `+pivot` add on `outer` for
  // animated axes; the inner `T(-pivot)` layer is kept intact so the
  // pivot-around-scale behavior remains correct. Per-child origin world
  // value on an animated axis becomes `pos + S·(-(-pivot)) = pos + S·pivot`,
  // matching the R3 result.
  //
  // Static axes keep the legacy additive Maya path — preserves PLAYER_02
  // X-ordering (Pivot X=1.29 with STATIC Position X=0, X not in animated set
  // → still falls through to `outer.x += 1.29`, `inner.x = -1.29`,
  // `child_x = 1.29 + 0.95·(-1.29) = +0.065`, identical to pre-P7).
  const absolutePivot = t.pivotType === "Absolute";
  const animated = t.positionAnimatedAxes;
  const axisAnimated = (axis: "x" | "y" | "z"): boolean => {
    if (!absolutePivot || !animated) return false;
    return axis === "x" ? !!animated.x : axis === "y" ? !!animated.y : !!animated.z;
  };
  const outerPx = axisAnimated("x") ? 0 : p.x;
  const outerPy = axisAnimated("y") ? 0 : p.y;
  const outerPz = axisAnimated("z") ? 0 : p.z;
  outer.position.x += outerPx;
  outer.position.y += outerPy;
  outer.position.z += outerPz;
  const inner = new Group();
  inner.name = `${outer.name} (pivot)`;
  // Inner stays at the full -pivot regardless of animated-axis status — this
  // preserves the rotate/scale-around-pivot behavior and lets the
  // S·(-(-pivot)) term contribute on the animated axis.
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
 * Phase G — R3 FlowChildren distribution, generic over any Group.
 *
 * R3 lays flow children sequentially from the container origin along the main
 * axis: the FIRST child stays at the origin and each subsequent child advances
 * by the PREVIOUS child's MEASURED EXTENT along the main axis plus
 * LeadingSpace. LeadingSpace is a signed gap (negative = overlap), NOT the
 * whole stride:
 *
 *     stride_i = measuredMainExtent(child_i) + leadingSpace
 *     position_i = sum_{j<i} stride_j * sign(direction)
 *
 * Main axis and sign come from Direction:
 *   XPlus  (default) → main=x, sign=+1   (PLAYERS row, left→right)
 *   XMinus           → main=x, sign=-1
 *   YPlus            → main=y, sign=+1
 *   YMinus           → main=y, sign=-1   (BENCH_LIST stack, top→bottom)
 *
 * FlowChildrenAlignment (Leading / Center / Trailing): Phase P2 — applied as
 * a slot-level cross-axis shift relative to the widest sibling along the
 * cross axis. Direction picks main/cross axes:
 *   YPlus / YMinus → main=y, cross=x
 *   XPlus / XMinus → main=y, cross=y
 *
 * For each child, cross extent = Box3(child).max[cross] - .min[cross]; let
 * maxCross = max over siblings. Cross shift per child:
 *   Leading  : 0 (no shift)
 *   Center   : (maxCross - ownCross) / 2
 *   Trailing : (maxCross - ownCross)
 *
 * Shift direction is +cross (i.e. towards larger X for YMinus/YPlus stacks,
 * larger Y for XPlus/XMinus rows) — confirmed against the corpus's only flow
 * stacks (BENCH_LIST YMinus Trailing → bench names right-align; PERMANENT_CLOCK
 * Center → score-stack centers align). When all siblings share the same cross
 * extent, every shift is 0 — a no-op, preserving existing snapshot tests.
 *
 * Scope: slot-level (geometry). The text ink inside a TextureText slot still
 * obeys its authored AlignmentX/Y — flow alignment moves the slot's bounding
 * box, not how text is painted inside the box. P2.1 will revisit if ink
 * placement also needs to shift to match R3.
 *
 * Notes:
 *  - LeadingSpace, Direction, FlowChildrenAlignment are read as-authored and
 *    NEVER mutated. Only the built Object3D positions change.
 *  - Main-axis extent is measured from each child's built subtree as a
 *    world-space AABB. The flow parent in the 2D corpus carries no
 *    rotation/scale, so the world AABB extent equals the parent-local extent
 *    (extents are translation-invariant either way).
 *  - Additive: any axis offset already authored on a child is preserved.
 *  - Pivot Formula B is untouched — it runs per child before this and only
 *    shifts content by (1-S)*pivot, which rides along with the slot.
 */
type FlowAxis = "x" | "y";

function flowAxisFromDirection(direction: string | undefined): { axis: FlowAxis; sign: 1 | -1 } {
  switch (direction) {
    case "YMinus": return { axis: "y", sign: -1 };
    case "YPlus": return { axis: "y", sign: 1 };
    case "XMinus": return { axis: "x", sign: -1 };
    case "XPlus":
    case undefined:
    default: return { axis: "x", sign: 1 };
  }
}

/**
 * World-space font descent of the TextureText leaf inside a flow child (0 if
 * none / no measure — e.g. jsdom fallback or a Quad-only row). `measure.descent`
 * is the descent in world units AT THE EM (pre node scale); the leaf's world
 * scale brings it to world. Used as the top margin of a Y text stack.
 */
function firstRowFontDescent(child: Object3D | undefined): number {
  if (!child) return 0;
  child.updateWorldMatrix(true, true);
  let descent = 0;
  const tmp = new Vector3();
  child.traverse((o) => {
    const w = (o.userData as Record<string, unknown> | undefined)?.w3d as
      | { kind?: string; measure?: { descent?: number } }
      | undefined;
    if (w?.kind === "TextureText" && typeof w.measure?.descent === "number") {
      o.getWorldScale(tmp);
      const d = w.measure.descent * Math.abs(tmp.y);
      if (d > descent) descent = d;
    }
  });
  return descent;
}

function applyFlowLayout(group: Group, node: W3DGroupData): void {
  if (!node.flow?.children) return;
  if (group.children.length === 0) return;
  const { axis: mainAxis, sign } = flowAxisFromDirection(node.flow.direction);
  const leadingSpace = node.flow.leadingSpace ?? 0;

  // R3 FlowChildren anchors each child's LEADING EDGE — the edge facing the
  // flow origin — at the running cursor, NOT the child's transform origin. For
  // center-origin geometry (the LINEUP_LEFT player photos) the leading edge sits
  // half an extent ahead of the origin, so origin-anchoring left the whole
  // PLAYERS row half a card too far left — covering the LOGO and poking off the
  // 16:9 frame. Anchoring the measured leading edge fixes it: proven against the
  // R3 thumb (LINEUP_LEFT), the player numbers land within ~0.01 of R3's
  // pixel-measured X once leading-edge anchored.
  //
  // Measuring the child's actual world AABB (not the bare transform origin) also
  // makes this subsume two former special cases for the SAME origin-vs-content
  // gap: the old Phase D2 (YMinus "Trailing" top-edge re-anchor) and the Phase H3
  // Absolute-pivot scale residual. For left/top-aligned geometry the leading edge
  // already coincides with the origin, so `lead` is 0 and those flows are
  // unchanged.
  //
  // Group-local == world along the main axis: the flow parent in the 2D corpus
  // carries no rotation/scale, so subtracting the group's world position recovers
  // local extents (the cursor and child.position are both group-local).
  const groupWorld = new Vector3();
  group.getWorldPosition(groupWorld);
  // Top margin for a Y text stack = the first row's font DESCENT (the empty
  // bottom padding the font carries below the caps, measured per text). This
  // makes the gap ABOVE the first row (e.g. BENCH title → first name) match the
  // font's natural bottom padding instead of cramming it flush. Browser-only
  // (jsdom has no measure → 0). Quad-only stacks have no descent → 0.
  let cursor = mainAxis === "y" ? sign * firstRowFontDescent(group.children[0]) : 0;
  for (const child of group.children) {
    child.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(child);
    if (isFinite(box.min[mainAxis]) && isFinite(box.max[mainAxis])) {
      // Anchor the child's MEASURED leading edge — the box edge facing the flow
      // origin (min for +growth, max for −growth) — at the running cursor. Using
      // the actual world AABB edge (not the transform origin) makes this:
      //   • land center-origin geometry half an extent ahead of the origin — the
      //     R3 behavior the old origin-anchored loop missed, which left the
      //     LINEUP_LEFT PLAYERS row half a card too far left (over the LOGO, off
      //     frame). Player number X now matches the R3 thumb within ~0.01.
      //   • absorb any Absolute-pivot scale displacement: PLAYER_02 (Pivot
      //     X=1.29) anchors by its photo's real edge, landing on the uniform grid
      //     instead of +1.29 out of slot — subsumes the former Phase H3 residual.
      //   • keep YMinus "Trailing" stacks (BENCH_LIST) with their rendered top
      //     edge at the group origin — subsumes the former Phase D2 anchor.
      const leadingRel = (sign > 0 ? box.min[mainAxis] : box.max[mainAxis]) - groupWorld[mainAxis];
      child.position[mainAxis] += cursor - leadingRel;
    } else {
      child.position[mainAxis] += cursor;
    }
    cursor += sign * (flowMainExtent(child, mainAxis) + leadingSpace);
  }

  // Main-axis "Trailing" (FlowChildrenAlignment along the Flow Order axis). R3
  // anchors the packed block by an edge tied to the ALIGNMENT, not the flow sign:
  // "Leading" puts the block's MIN edge on the group origin, "Trailing" puts the
  // block's MAX edge there. The packing loop above anchors the LEADING edge per
  // flow sign, so a +growth flow (XPlus) lands the MIN edge at the origin =
  // "Leading" by construction. For "Trailing" we move the block back by its own
  // length so the MAX edge sits on the origin instead. This is how R3 mirrors a
  // panel: LINEUP_RIGHT PLAYERS is XPlus+Trailing, so the row anchors by its
  // RIGHT edge and sits on the opposite side of the origin instead of off-frame.
  //
  // Scoped to +growth flows (sign > 0). A −growth flow (YMinus, e.g. BENCH_LIST)
  // ALREADY anchors its MAX (top) edge at the origin via the packing loop, so it
  // is "Trailing" by construction — re-shifting it would swallow the
  // firstRowFontDescent top margin and cram the first row against the heading.
  // (A YMinus+Leading flow would need the symmetric shift; the corpus has none.)
  if (node.flow.alignment === "Trailing" && sign > 0) {
    let hi = -Infinity;
    for (const child of group.children) {
      child.updateWorldMatrix(true, true);
      const b = new Box3().setFromObject(child);
      if (isFinite(b.max[mainAxis])) hi = Math.max(hi, b.max[mainAxis] - groupWorld[mainAxis]);
    }
    if (isFinite(hi)) for (const child of group.children) child.position[mainAxis] += -hi;
  }

  // Phase P2 — cross-axis alignment. For Leading (default) we skip. For
  // Center/Trailing, compute each child's cross-axis extent and shift by the
  // delta against the widest sibling so trailing edges (Trailing) or centers
  // (Center) line up. Only authored values Center/Trailing trigger a shift —
  // any other / undefined alignment is a no-op (Leading).
  const alignment = node.flow.alignment;
  if (alignment !== "Center" && alignment !== "Trailing") return;
  const crossAxis: FlowAxis = mainAxis === "x" ? "y" : "x";
  // measureAlongAxis re-derives child Box3 — children's main-axis positions
  // were just mutated above, but cross-axis extent is invariant under a
  // main-axis translation so this measurement is correct.
  const crossExtents = group.children.map((c) => measuredAlongAxis(c, crossAxis));
  let maxCross = 0;
  for (const w of crossExtents) if (w > maxCross) maxCross = w;
  if (maxCross === 0) return;
  for (let i = 0; i < group.children.length; i++) {
    const own = crossExtents[i];
    const delta = maxCross - own;
    if (delta === 0) continue;
    const shift = alignment === "Trailing" ? delta : delta / 2;
    group.children[i].position[crossAxis] += shift;
  }
}

function measuredAlongAxis(obj: Object3D, axis: FlowAxis): number {
  obj.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(obj);
  if (!isFinite(box.min[axis]) || !isFinite(box.max[axis])) return 0;
  return box.max[axis] - box.min[axis];
}

/**
 * R3's text MEASURE (line-box) height in world units, at the engine base size.
 *
 * This is the height R3 reports as "Measure" / "Local Measure" for a TextureText
 * row — the font's LINE BOX, which is TALLER than the visible glyphs. R3 stacks
 * FlowChildren rows by THIS height, NOT the TextBoxSize and NOT the visible
 * render em. Observed as a constant (font/weight independent) in the LINEUP_LEFT
 * R3 panels:
 *   DARIUS   0.445 / scale 2.5 = 0.178
 *   STEPHENS 0.536 / scale 3   = 0.179
 *   BENCH    0.231 / scale 1.3 = 0.178
 * So a text row's flow extent = R3_TEXT_MEASURE_EM × scale (bench: 0.178×1.3 =
 * 0.231), and the stride = that + LeadingSpace (bench: 0.231 − 0.084 = 0.147).
 *
 * Distinct from R3_TEXT_BASE_EM (0.12), which is the VISIBLE glyph render height.
 * R3 carries both: a small visible em and a larger line-box used for layout.
 * Scope: only the Y main axis; X-axis flows stay on the raw Box3 width.
 */
const R3_TEXT_MEASURE_EM = 0.178;

/**
 * Main-axis extent used by `applyFlowLayout` to advance the cursor between
 * children. Extends the standard Box3 size by the natural line-spaced glyph
 * overflow for TextureText leaves when the flow direction is Y. For X-axis
 * flow, or for subtrees with no TextureText leaves, returns the raw Box3
 * size unchanged.
 */
function flowMainExtent(child: Object3D, axis: FlowAxis): number {
  const baseSize = measuredAlongAxis(child, axis);
  if (axis !== "y") return baseSize;

  // For a text row, the stride is the font LINE HEIGHT = textBox.y × scale ×
  // FACTOR — independent of how tall the rendered ink happens to be. We lift the
  // measured AABB (baseSize) up to that line height. This is robust to the ink
  // geometry: with the old TextBox-plane geometry baseSize == textBox.y × scale
  // so this reduces to the original (FACTOR-1) term; with the ink geometry
  // baseSize == inkHeight × scale (smaller), and without this lift the rows
  // would collapse on top of each other (the negative LeadingSpace eats the gap).
  // Subtrees with no TextureText leaves contribute zero (baseSize unchanged).
  let glyphOverflow = 0;
  const tmpScale = new Vector3();
  child.traverse((obj) => {
    const w3d = (obj.userData as Record<string, unknown> | undefined)?.w3d as
      | { kind?: string; textBox?: { y?: number } }
      | undefined;
    if (w3d?.kind !== "TextureText") return;
    const tby = w3d.textBox?.y;
    if (typeof tby !== "number" || tby <= 0) return;
    obj.getWorldScale(tmpScale);
    // R3 stacks rows by the line-box MEASURE height (× scale), independent of the
    // ink geometry or the TextBoxSize. Lift the measured AABB up to that.
    const lineHeight = R3_TEXT_MEASURE_EM * Math.abs(tmpScale.y);
    const overflow = lineHeight - baseSize;
    if (overflow > glyphOverflow) glyphOverflow = overflow;
  });
  return baseSize + glyphOverflow;
}

function buildQuad(
  node: W3DQuadData,
  ctx?: BuildContext,
  inheritedMaskIds?: string[],
  inheritedAlpha?: number,
): Object3D {
  if (node.children.length === 0) {
    const mesh = makeQuadMesh(node, ctx, inheritedAlpha);
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
    // Phase P4.1 — Foreground overlay promotion. A textured Quad that is
    // neither a mask writer nor a stencil reader (no own MaskId, no inherited
    // MaskId) currently lands at Three.js default renderOrder=0 and would be
    // overpainted by the colored mask panel sitting at lane 11+ (BASE_MAIN /
    // BASE_TEAM). When such a Quad carries a resolved texture, lift it to the
    // overlay lane so authored sibling order (e.g. LOGO authored after
    // BASE_MAIN in the same parent) is preserved visually. Guard:
    //   (1) not IsMask (writers handled above)
    //   (2) no own and no inherited maskIds (stencil readers handled in
    //       applyPhotoMaskStencil and assigned per-mask lanes there)
    //   (3) mesh.renderOrder still at default 0 (don't override stencil paths)
    //   (4) material.map is present (skip pure-color quads)
    promoteOverlayQuadRenderOrder(mesh, node, inheritedMaskIds);
    // Lift thin-sliver divider quads above the photo stack so one shows between
    // every card (overrides the overlay lane). Keyed on geometry, not name.
    applyThinDividerOverlay(mesh, node);
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
  const mesh = makeQuadMesh(node, ctx, inheritedAlpha);
  // Phase 2D.1 — same colored-mask rule as the leaf-Quad path. Pure stencil
  // masks (IsColoredMask=False) stay hidden; colored masks (IsColoredMask=True)
  // remain visible so the Quad-with-children carrier still renders its band.
  if (node.isMask && !isColoredMask(node)) mesh.visible = false;
  host.add(mesh);
  // Phase A1 carry-over — run the stencil writer/reader path for the carrier
  // mesh too. Without this, a Quad-with-children that is also a colored mask
  // (e.g. BASE_TEAM in LINEUP_LEFT, which carries BASE_BENCH as a child)
  // never gets stencilWrite=true, depthTest=false, or its per-mask render
  // order. It then ends up in the opaque pass with depthTest=true, where Z
  // sorts the carrier behind closer panels (BASE_MAIN at Z=0 vs BASE_TEAM at
  // Z=-17.44), occluding most of its visible region. Leaf-Quad masks already
  // call this on line 445 — this restores the same invariant for the
  // children-carrier branch.
  applyPhotoMaskStencil(mesh, node, ctx, inheritedMaskIds);
  const passToChildren = node.maskIds.length > 0 ? node.maskIds : inheritedMaskIds;
  // Phase P1 — Quad-with-children carries its inherited alpha to children
  // unchanged (the Quad's own alpha applies only to its own carrier mesh; a
  // Quad's Alpha attribute is a leaf concept, not a container concept).
  for (const c of node.children) host.add(buildNode(c, ctx, passToChildren, inheritedAlpha));
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

// R3 base text size in world units. R3 carries no per-font/per-node point size:
// text renders at this fixed engine default and the on-screen height is
// `R3_TEXT_BASE_EM * NodeTransform.Scale`. TextBoxSize is only a width
// constraint, not a size. This is the single knob for global text size — raise
// it and all text grows proportionally; lower it and all text shrinks.
const R3_TEXT_BASE_EM = 0.125;

/** Pixels-per-world-unit used internally when measuring glyph ink. */
const TEXT_MEASURE_PX_PER_UNIT = 1000;

/**
 * Set canvas letter spacing in px (the W3D FontStyle.Kerning tracking). The
 * `letterSpacing` 2D-context property is recent; guarded + cast so older type
 * libs / engines don't break. No-op for 0 so the common (Kerning=0) path is
 * untouched. Canvas resize clears 2D state, so callers re-apply after resize.
 */
function setCanvasLetterSpacing(c2d: CanvasRenderingContext2D, px: number): void {
  if (!(px > 0)) return;
  (c2d as unknown as { letterSpacing?: string }).letterSpacing = `${px}px`;
}

/**
 * Canvas-backed glyph-ink metrics provider (browser only). Returns world-unit
 * ink metrics for `text` at a given em. Returns null when no 2D context is
 * available (jsdom test env), so the caller falls back to the authored TextBox.
 */
function makeInkMetricsProvider(
  text: string, family: string, weight: string, style: string, letterSpacingEm = 0,
): MetricsProvider | null {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const c2d = canvas?.getContext("2d") ?? null;
  if (!c2d) return null;
  return (em: number) => {
    const px = Math.max(1, em * TEXT_MEASURE_PX_PER_UNIT);
    c2d.font = `${style} ${weight} ${px}px "${family}", sans-serif`;
    // FontStyle.Kerning × KerningScale = letter spacing as a fraction of the em.
    setCanvasLetterSpacing(c2d, letterSpacingEm * px);
    const m = c2d.measureText(text);
    // R3 measures the text LAYOUT box: advance width × font line height (not the
    // tight glyph ink). fontBoundingBox is content-independent (matches the
    // constant ~0.178 height in the R3 prints); advance avoids the italic ink
    // overhang that made the box too wide.
    const advance = m.width;
    const asc = finiteMetric(m.fontBoundingBoxAscent) ?? finiteMetric(m.actualBoundingBoxAscent) ?? px * 0.8;
    const desc = finiteMetric(m.fontBoundingBoxDescent) ?? finiteMetric(m.actualBoundingBoxDescent) ?? px * 0.2;
    // Actual ink bounds: left overhang + right extent of the rendered pixels.
    // For italics the right extent exceeds the advance (slant), and the left
    // can overhang the pen — using these (not the advance) stops the last
    // letter being clipped and anchors the visible ink, not the layout box.
    const inkLeft = finiteMetric(m.actualBoundingBoxLeft);
    const inkRight = finiteMetric(m.actualBoundingBoxRight);
    return {
      advanceWidth: advance / TEXT_MEASURE_PX_PER_UNIT,
      ascent: asc / TEXT_MEASURE_PX_PER_UNIT,
      descent: desc / TEXT_MEASURE_PX_PER_UNIT,
      ...(inkLeft !== undefined ? { inkLeft: inkLeft / TEXT_MEASURE_PX_PER_UNIT } : {}),
      ...(inkRight !== undefined ? { inkRight: inkRight / TEXT_MEASURE_PX_PER_UNIT } : {}),
    };
  };
}

/**
 * Rasterize `text` at `fontEm` into a canvas tightly bounding the glyph ink so
 * the texture maps 1:1 onto the ink-sized PlaneGeometry. Browser only.
 */
function renderInkTextToCanvas(opts: {
  text: string; family: string; weight: string; style: string; color: string;
  fontEm: number; quality: number; letterSpacingEm?: number;
}): CanvasTexture | null {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const c2d = canvas?.getContext("2d") ?? null;
  if (!canvas || !c2d) return null;
  const raster = 260 * Math.max(opts.quality, 0.5); // px per world unit (sharpness)
  const fontPx = Math.max(1, opts.fontEm * raster);
  const setFont = () => {
    c2d.font = `${opts.style} ${opts.weight} ${fontPx}px "${opts.family}", sans-serif`;
    setCanvasLetterSpacing(c2d, (opts.letterSpacingEm ?? 0) * fontPx);
  };
  setFont();
  const m = c2d.measureText(opts.text);
  // Canvas = the actual INK box (ink width × font line height), matching the
  // measured geometry so the texture maps 1:1. We size to the real ink extent
  // (not the advance) so italic right-overhang / side bearings are NOT clipped,
  // and draw the pen at `inkLeft` so the left overhang fits at x=0.
  const advance = m.width;
  const asc = finiteMetric(m.fontBoundingBoxAscent) ?? fontPx * 0.8;
  const desc = finiteMetric(m.fontBoundingBoxDescent) ?? fontPx * 0.2;
  const inkLeft = finiteMetric(m.actualBoundingBoxLeft) ?? 0;
  const inkRight = finiteMetric(m.actualBoundingBoxRight) ?? advance;
  const inkW = inkLeft + inkRight;
  const w = Math.max(1, Math.ceil(inkW));
  const h = Math.max(1, Math.ceil(asc + desc));
  canvas.width = w;
  canvas.height = h;
  setFont(); // resizing the canvas clears its 2D state
  c2d.fillStyle = opts.color;
  c2d.textAlign = "left";
  c2d.textBaseline = "alphabetic";
  c2d.fillText(opts.text, inkLeft, asc);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Anchor the text relative to NodeTransform.Position per the authored alignment.
 * PlaneGeometry is centred; we translate it so the anchor point lands at the
 * local origin (0,0), and the mesh position then places that point at the
 * authored Position.
 *
 * AlignmentX picks the horizontal edge that sits on the Position point:
 *   Left  → left edge on the point  → text extends RIGHT of it
 *   Right → right edge on the point → text extends LEFT of it
 *   Center→ centre on the point
 * Vertically we use the baseline (BaselineAligned FontStyles) or AlignmentY.
 * The TextBox is only a width constraint, never an anchor.
 */
function placeInkAnchor(
  geometry: PlaneGeometry,
  measured: MeasureResult,
  alignmentX: AlignmentX,
): void {
  const { dx, dy } = inkAnchorOffset(
    alignmentX,
    measured.verticalMode,
    measured.inkWidth,
    measured.ascent,
    measured.descent,
  );
  geometry.translate(dx, dy, 0);
}

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
  inheritedAlpha?: number,
): Object3D {
  // Preserve the authored TextBox verbatim as the PlaneGeometry / layout
  // bounds. R3 keeps the (sometimes very tall or very long) authored TextBox
  // and renders a COMPACT glyph-ink line *inside* it — the glyph is sized by
  // the metric height-fit + ConstrainMethod width-fit and placed by alignment
  // (see renderTextToCanvas). We must NOT resize the box as a shortcut: e.g.
  // COACH_FUNCTION's 0.73×2.73 box stays tall and the small "COACH" caption
  // sits inside it; SMALL_TEAM_NAME's 6.39-wide box stays long and the small
  // right-aligned "DETROIT IRONHAWKS" sits at its right edge.
  const renderTextBox = node.textBox;

  // Resolve color from the assigned BaseMaterial. TextureLayer is always
  // "Standard" for TextureText — no map/alphaMap path runs through the
  // resolver. Phase P6.1 — pass `expectsCallerMap: true` so resolveMaterial
  // skips the "DE1A3E3C without mapUrl → opacity=0" rule: TextureText
  // synthesises its own canvas glyph texture below and would otherwise be
  // wrongly hidden (PLAYER_LAST_NAME / PLAYER_FIRST_NAME, COACH text, etc.
  // all use MaterialId=DE1A3E3C as a neutral base).
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
      { expectsCallerMap: true },
    );
    ctx.warnings.push(...warnings);
    textColor = resolved.color;
    opacity = resolved.opacity;
  } else if (node.displayColor) {
    textColor = displayColorToHex(node.displayColor);
  }
  // Phase P1 — multiply cumulative parent-Group alpha into the final opacity.
  // `inheritedAlpha` is 1 (or undefined) when no ancestor Group authored a
  // fractional Alpha — common case is a no-op.
  opacity = opacity * (inheritedAlpha ?? 1);

  // Resolve font family / weight / style from the registry FontStyle entry.
  const fontStyle = ctx?.registry.fontStyles.get(node.fontStyleId ?? "");
  const family = fontStyle?.fontName?.trim() || "sans-serif";
  const { weight, style } = fontStyleTypeToCss(fontStyle?.type ?? "");
  // Phase H3 — non-rendering diagnostic. `true` when a FontFace matching
  // family/weight/style has been registered via the playground font loader.
  // Surfaces in the DEV inspector so a user can confirm whether the canvas
  // is using the authored R3 family or system fallback.
  const fontLoaded = ctx?.loadedFontIndex
    ? ctx.loadedFontIndex.has(`${family}|${weight}|${style}`)
    : undefined;

  // Phase TextureText constrain — recognise "Width" / "None" / "Height" as
  // explicit branches and warn on anything unknown (falling back to "Width"
  // so the previous default is preserved). LINEUP_LEFT only authors "Width"
  // (most labels) and "None" (BENCH_TITLE); other R3 scenes carry "Height"
  // in the corpus.
  const effectiveConstrain = resolveConstrainMethod(node.constrainMethod, node.name, ctx);

  // R3 measure model: render at the fixed base size and derive the object
  // geometry from the measured glyph INK — not from TextBoxSize. Browser only;
  // in jsdom (no canvas) fall back to the authored TextBox so the structural
  // tests stay stable. The pure measure logic + its tests live in
  // nodes/textureTextMeasure.ts.
  const baselineAligned = !!fontStyle?.baselineAligned;
  // FontStyle.Kerning × KerningScale = letter spacing (tracking) as a fraction
  // of the em. 0 for most labels; >0 spreads the glyphs (e.g. FS_08 team name).
  const letterSpacingEm = (fontStyle?.kerning ?? 0) * (fontStyle?.kerningScale ?? 1);
  const inkProvider = makeInkMetricsProvider(node.text, family, weight, style, letterSpacingEm);
  let geometry: PlaneGeometry;
  let texture: CanvasTexture;
  let measured: MeasureResult | undefined;
  if (inkProvider && node.text.trim().length > 0) {
    measured = measureTextureText(
      {
        text: node.text,
        baseEm: R3_TEXT_BASE_EM,
        hasTextBox: node.hasTextBox ?? (node.textBox.x > 0 && node.textBox.y > 0),
        textBox: node.textBox,
        constrainMethod: effectiveConstrain,
        alignmentY: node.alignmentY ?? "Center",
        baselineAligned,
      },
      inkProvider,
    );
    geometry = new PlaneGeometry(Math.max(measured.inkWidth, 0.001), Math.max(measured.inkHeight, 0.001));
    placeInkAnchor(geometry, measured, (node.alignmentX as AlignmentX) ?? "Left");
    texture =
      renderInkTextToCanvas({
        text: node.text, family, weight, style, color: textColor,
        fontEm: measured.fontEm, quality: node.textQuality, letterSpacingEm,
      }) ?? new CanvasTexture(document.createElement("canvas"));
  } else {
    // Fallback (jsdom / empty text): authored TextBox geometry + box-fitted glyph.
    geometry = new PlaneGeometry(
      Math.max(renderTextBox.x, 0.001),
      Math.max(renderTextBox.y, 0.001),
    );
    applyAlignment(geometry, {
      alignmentX: node.alignmentX,
      alignmentY: node.alignmentY,
      size: renderTextBox,
    });
    texture = renderTextToCanvas({
      text: node.text,
      family,
      weight,
      style,
      color: textColor,
      textBox: renderTextBox,
      alignmentX: node.alignmentX ?? "Center",
      alignmentY: node.alignmentY ?? "Center",
      quality: node.textQuality,
      constrainMethod: effectiveConstrain,
    });
  }

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
    ...(fontLoaded !== undefined ? { fontLoaded } : {}),
    ...(measured
      ? {
        measure: {
          width: measured.inkWidth,
          height: measured.inkHeight,
          fontEm: measured.fontEm,
          // Font descent in world units (the empty bottom padding below the
          // caps). Used by the flow to space text rows by the font's natural
          // bottom padding instead of cramming them edge-to-edge.
          descent: measured.descent,
          verticalMode: measured.verticalMode,
          widthConstrained: measured.widthConstrained,
        },
      }
      : {}),
  };

  applyTransform(mesh, node.transform);

  // Phase TextureText render-order — baseline state for labels without a
  // MaskId so they render above the photo-card stack (18/19/20). When the
  // TextureText carries a MaskId (own or inherited), applyPhotoMaskStencil's
  // reader path runs next and OVERRIDES renderOrder with the correct
  // stencil-reader value (16 for generic, 18-20 for photo-card). depth state
  // is set to false here so it matches the rest of the pipeline regardless
  // of which path runs.
  mesh.renderOrder = RENDER_ORDER_TEXT;
  material.depthWrite = false;
  material.depthTest = false;

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

/**
 * Normalised TextureText ConstrainMethod values. The W3D XML attribute is a
 * free-form string; this type captures the set the builder recognises:
 *   - "Width"  — shrink fontPx so measured text fits canvas width.
 *   - "None"   — render at the natural fontPx with no shrink pass.
 *   - "Height" — render at the natural fontPx (already fits canvas height
 *                via the `h * 0.85` glyph-fill ratio). Explicit branch so
 *                the value is recognised rather than aliased to "Width".
 */
type ConstrainMethod = "Width" | "None" | "Height";

/**
 * Validate the authored ConstrainMethod string. Returns the canonical value
 * for recognised inputs; falls back to "Width" (the historical default) and
 * pushes a warning for anything unknown, so corpus drift is observable.
 * `undefined`/empty falls back to "Width" silently (the previous default).
 */
function resolveConstrainMethod(
  raw: string | undefined,
  nodeName: string,
  ctx?: BuildContext,
): ConstrainMethod {
  if (raw === undefined || raw === "") return "Width";
  if (raw === "Width" || raw === "None" || raw === "Height") return raw;
  ctx?.warnings.push(
    `TextureText '${nodeName}': unknown ConstrainMethod '${raw}', falling back to 'Width'.`,
  );
  return "Width";
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
  /** Normalised R3 ConstrainMethod (Width shrinks; None/Height keep natural fontPx). */
  constrainMethod?: ConstrainMethod;
}

function finiteMetric(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textMetricInkWidth(metrics: TextMetrics): number {
  const left = finiteMetric(metrics.actualBoundingBoxLeft);
  const right = finiteMetric(metrics.actualBoundingBoxRight);
  if (left !== undefined && right !== undefined && left + right > 0) {
    return left + right;
  }
  return metrics.width;
}

function textMetricInkHeight(metrics: TextMetrics): { ascent: number; descent: number } | undefined {
  const ascent = finiteMetric(metrics.actualBoundingBoxAscent);
  const descent = finiteMetric(metrics.actualBoundingBoxDescent);
  if (ascent === undefined || descent === undefined || ascent + descent <= 0) return undefined;
  return { ascent, descent };
}

function applyCanvasFont(
  c2d: CanvasRenderingContext2D,
  opts: Pick<RenderTextOptions, "style" | "weight" | "family">,
  fontPx: number,
): void {
  c2d.font = `${opts.style} ${opts.weight} ${fontPx}px "${opts.family}", sans-serif`;
}

/**
 * Glyph layout height (in authored-TextBox units) used ONLY to choose the font
 * size — it is kept strictly separate from the authored TextBoxSize, which
 * always remains the PlaneGeometry / layout / mask / userData box. This mirrors
 * the R3 debug model: the yellow authored TextBox and the green rendered glyph
 * ink are different rectangles; the glyph is compact INSIDE the box.
 *
 * For a single-line, Width-constrained TextureText whose authored box is very
 * tall (`TextBoxSize.Y / TextBoxSize.X >= 3`, e.g. COACH_FUNCTION 0.73×2.73),
 * the glyph must render as a compact caption line — NOT fill the tall box. We
 * derive a small layout height from the box WIDTH and text length so a short
 * label gets a short line:
 *   glyphLayoutHeight = min(TextBoxSize.Y, TextBoxSize.X / text.length * 1.2)
 * For all other text the layout height is simply the authored box height (the
 * glyph still ends up smaller than the box because caps fill ~0.6-0.85 of the
 * em — green stays inside yellow). This controls glyph SIZING/PLACEMENT only;
 * the PlaneGeometry stays at the authored TextBoxSize (see buildTextureText).
 */
function glyphLayoutHeightUnits(opts: RenderTextOptions): number {
  const { textBox, text, constrainMethod } = opts;
  const isTallSingleLineWidth =
    constrainMethod === "Width" &&
    text.length > 0 &&
    !/[\r\n]/.test(text) &&
    textBox.x > 0 &&
    textBox.y / textBox.x >= 3;
  if (isTallSingleLineWidth) {
    return Math.min(textBox.y, (textBox.x / text.length) * 1.2);
  }
  return textBox.y;
}

/**
 * Rasterize `text` into a CanvasTexture sized roughly proportional to the
 * authored TextBoxSize × quality. In jsdom (test env) the 2D context is null;
 * the helper returns a valid empty CanvasTexture in that case so structural
 * tests can assert geometry/material without depending on font metrics.
 */
function renderTextToCanvas(opts: RenderTextOptions): CanvasTexture {
  const pxPerUnit = 200 * Math.max(opts.quality, 0.5);
  // Canvas == authored TextBox (the yellow box). Used for PlaneGeometry/layout.
  const w = Math.max(8, Math.round(opts.textBox.x * pxPerUnit));
  const h = Math.max(8, Math.round(opts.textBox.y * pxPerUnit));
  // Glyph layout height (the green-box sizing reference) — separate from the
  // canvas/TextBox height. For tall single-line Width text this is a compact
  // caption height so the glyph stays small inside the tall box; otherwise it
  // equals the canvas height. NEVER changes `h`/`w` (the authored box).
  const hGlyph = Math.max(8, Math.round(glyphLayoutHeightUnits(opts) * pxPerUnit));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c2d = canvas.getContext("2d");
  if (c2d) {
    c2d.clearRect(0, 0, w, h);
    // Small horizontal padding (~3% each side) so glyphs don't kiss the canvas edge.
    const padX = Math.max(2, Math.round(w * 0.03));
    const availableWidth = Math.max(8, w - padX * 2);

    // Initial font size from the GLYPH layout height (compact for tall boxes),
    // NOT the authored canvas height — this is what keeps COACH a small caption
    // inside its tall 2.73 TextBox. Leaves a small inset so descenders fit. This
    // is the starting fontPx for every ConstrainMethod branch below.
    let fontPx = Math.max(4, Math.floor(hGlyph * 0.85));
    applyCanvasFont(c2d, opts, fontPx);

    // Phase TextureText constrain — explicit branches per recognised value:
    //   - "Width":  shrink fontPx so the actual glyph ink bounds fit
    //               availableWidth. Canvas advance width can miss italic/bold
    //               overhangs, which produces R3-inaccurate edge clipping.
    //   - "Height": no extra pass — initial fontPx already fits canvas height.
    //   - "None":   no shrink — render at the natural fontPx.
    // Falling through with no branch is deliberate for None/Height.
    switch (opts.constrainMethod) {
      case "Width": {
        if (opts.text.length > 0) {
          const measured = textMetricInkWidth(c2d.measureText(opts.text));
          if (measured > availableWidth && measured > 0) {
            fontPx = Math.max(4, Math.floor((fontPx * availableWidth) / measured));
            applyCanvasFont(c2d, opts, fontPx);
          }
        }
        break;
      }
      case "Height":
      case "None":
      default:
        break;
    }

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
      opts.alignmentX === "Left" ? padX
        : opts.alignmentX === "Right" ? w - padX
          : w / 2;
    const ty =
      opts.alignmentY === "Top" ? 0
        : opts.alignmentY === "Bottom" ? h
          : h / 2;
    const finalMetrics = c2d.measureText(opts.text);
    const inkLeft = finiteMetric(finalMetrics.actualBoundingBoxLeft);
    const inkRight = finiteMetric(finalMetrics.actualBoundingBoxRight);
    let inkTx = tx;
    if (inkLeft !== undefined && inkRight !== undefined && inkLeft + inkRight > 0) {
      c2d.textAlign = "left";
      inkTx =
        opts.alignmentX === "Left" ? padX + inkLeft
          : opts.alignmentX === "Right" ? w - padX - inkRight
            : w / 2 + (inkLeft - inkRight) / 2;
    }
    const inkHeight = textMetricInkHeight(finalMetrics);
    let inkTy = ty;
    if (inkHeight) {
      const padY = Math.max(1, Math.round(h * 0.03));
      c2d.textBaseline = "alphabetic";
      inkTy =
        opts.alignmentY === "Top" ? padY + inkHeight.ascent
          : opts.alignmentY === "Bottom" ? h - padY - inkHeight.descent
            : h / 2 + (inkHeight.ascent - inkHeight.descent) / 2;
    }
    c2d.fillText(opts.text, inkTx, inkTy);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// R3 broadcast frame in world units (engine constant, not scene-specific).
const W3D_FRAME_WIDTH = 7.363797;
const W3D_FRAME_HEIGHT = 4.142136;

/**
 * A "full-frame fill" is a textured Quad whose geometry covers (about) the whole
 * R3 broadcast frame. When such a quad is the client of a colored mask, R3 treats
 * it as a single screen-space BACKGROUND layer revealed AROUND the panel (the mask
 * is a hole), with the texture mapped once across the frame. Text / smaller content
 * clients of the SAME mask are not full-frame fills and keep their normal
 * inside-the-panel reveal. The threshold uses the authored geometry size, so it
 * generalises to any R3 scene's full-frame fills (no node-name dependency).
 */
function isFullFrameQuadGeometry(geometry: PlaneGeometry): boolean {
  const p = geometry.parameters as { width?: number; height?: number } | undefined;
  if (!p || typeof p.width !== "number" || typeof p.height !== "number") return false;
  return p.width >= W3D_FRAME_WIDTH * 0.98 && p.height >= W3D_FRAME_HEIGHT * 0.98;
}

function makeQuadMesh(node: W3DQuadData, ctx?: BuildContext, inheritedAlpha?: number): Mesh {
  const geometry = new PlaneGeometry(node.geometry.size.x, node.geometry.size.y);
  applyAlignment(geometry, node.geometry);
  // Phase H5 — shear the LOCAL geometry by the snapshot Skew (degrees). No-op
  // when absent/zero. After alignment, before the mesh transform + pivot wrapper.
  applySkew(geometry, node.transform.skew?.x ?? 0, node.transform.skew?.y ?? 0);

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
  let textureBlending: string | undefined;
  let resolvedAlphaMapIsAlphaKey = false;

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
    resolvedAlphaMapIsAlphaKey = !!resolvedAlphaMapUrl && !!resolved.alphaMapIsAlphaKey;
    hasMaterialResolved = resolved.hasMaterialResolved;
    hasTextureLayerResolved = resolved.hasTextureLayerResolved;
    materialName = resolved.materialName;
    textureLayerName = resolved.textureLayerName;
    textureFilename = resolved.textureFilename;
    textureBlending = resolved.textureBlending;
  } else {
    // Phase-F fallback: no BuildContext provided
    resolvedColor = displayColorToHex(node.displayColor);
    resolvedOpacity = node.alpha;
    resolvedTransparent = node.alpha < 1;
  }

  // Phase P1 — multiply cumulative parent-Group alpha into the leaf opacity.
  // `inheritedAlpha` is 1/undefined for nodes outside any Alpha-bearing Group
  // (the common case is a no-op). For stencil writers this changes only the
  // color blending — stencilWrite, stencilRef, and the stencil test itself
  // are configured independently downstream in applyPhotoMaskStencil and are
  // not gated by material.opacity.
  const parentAlpha = inheritedAlpha ?? 1;
  if (parentAlpha !== 1) {
    resolvedOpacity = resolvedOpacity * parentAlpha;
    if (resolvedOpacity < 1) resolvedTransparent = true;
  }

  // Phase H2 — `material.blending` is intentionally LEFT AT THE THREE.JS
  // DEFAULT (NormalBlending). W3D `TextureBlending="Multiply"` denotes
  // texture-modulates-base-color, which `MeshBasicMaterial` already produces
  // via `color × map`. Do not assign `THREE.MultiplyBlending` here — that is
  // a framebuffer screen-blend mode and is the wrong operation for the R3
  // semantic. See `materialResolver.ts` doc-comment.
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
  // R3 fullframe fills are a single screen-space PATTERN layer. R3's TextureLayer
  // Scale is a ZOOM (the texture covers the frame once), which in three.js is
  // repeat = 1/Scale, rotated about the CENTRE, and clamped so the small authored
  // rotation can't expose a tiled seam at the corners. Authored repeat = Scale
  // would instead tile under Wrap and duplicate the pattern at the corners (the
  // bug). Scoped to full-frame textured colored-mask clients so per-quad textures
  // (photos, logos, text) are untouched.
  if (material.map && ctx?.genericMaskInfoByMaskId && isFullFrameQuadGeometry(geometry)) {
    const isColoredMaskClient = node.maskIds.some((id) => ctx.genericMaskInfoByMaskId!.has(id));
    if (isColoredMaskClient) {
      const t = material.map.clone();
      const rx = t.repeat.x || 1;
      const ry = t.repeat.y || 1;
      t.repeat.set(1 / rx, 1 / ry);
      t.center.set(0.5, 0.5);
      t.wrapS = ClampToEdgeWrapping;
      t.wrapT = ClampToEdgeWrapping;
      t.needsUpdate = true;
      material.map = t;
    }
  }
  if (resolvedAlphaMapUrl && ctx) {
    // R3 AlphaKey mattes (e.g. VERTICAL_RAMP.png) store the gradient in the
    // texture's ALPHA channel with RGB left solid white. Three.js samples the
    // alphaMap's GREEN channel, so we bake alpha→RGB first; otherwise the matte
    // reads as a flat 1.0 and the per-player base fade never appears.
    material.alphaMap = resolvedAlphaMapIsAlphaKey
      ? acquireAlphaMatteTexture(resolvedAlphaMapUrl, resolvedAlphaMapTransform, ctx.textureCache)
      : acquireTexture(resolvedAlphaMapUrl, resolvedAlphaMapTransform, ctx.textureCache);
    // Flag for the stencil epsilon (smooth ramp) and the base-fade pass.
    if (resolvedAlphaMapIsAlphaKey) material.userData.alphaMapFromAlpha = true;
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
    ...(textureBlending !== undefined ? { textureBlending } : {}),
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
 * Phase H5 — shear a PlaneGeometry in place by per-axis skew ANGLES (degrees).
 * No-op when both are 0. Lead axis hypothesis (to confirm visually):
 *   Skew.Y → x += y·tan(Yangle)   (vertical edges slant → card parallelogram)
 *   Skew.X → y += x·tan(Xangle)
 * Reads the original (x,y) before writing both so a combined X+Y shear is
 * applied simultaneously. Runs after applyAlignment and BEFORE the mesh's
 * applyTransform / pivot wrapper — a purely local-geometry shape change, so the
 * pivot/flow/stencil pipeline is untouched (a sheared mask quad just clips to a
 * parallelogram). If the slant goes the wrong way, flip the sign/axis here.
 */
export function applySkew(geometry: PlaneGeometry, skewXDeg: number, skewYDeg: number): void {
  if (skewXDeg === 0 && skewYDeg === 0) return;
  const tanX = Math.tan((skewXDeg * Math.PI) / 180);
  const tanY = Math.tan((skewYDeg * Math.PI) / 180);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setX(i, x + y * tanY);
    pos.setY(i, y + x * tanX);
  }
  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
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
      // The stencil silhouette is the player SHAPE only — cut the photo's own
      // alpha cutout at 0.5 so the contour is tight (a lower epsilon pulls in the
      // photo's faint feathered edge pixels, which then show the gold fill as a
      // streaky fringe along the player's sides). The smooth BASE fade is NOT
      // done here: it lives on the readers' alphaMap (applySmoothMaskBaseFade),
      // so the silhouette can stay tight without losing the falloff.
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
    mesh.renderOrder = genericWriterLane(index);
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
    let dummyMaskId: string | undefined;
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
          // The DUMMY mask carries the player's VERTICAL_RAMP. Remember its id so
          // the post-build pass fades this fill THROUGH the dummy (its smooth
          // contour) — the texture config lives on the mask, the fill just follows.
          dummyMaskId = id;
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
    // Phase 2D.3 + A1 — generic-only readers (no PHOTO bits) sit in the
    // per-mask block belonging to their writer: fill readers one lane above
    // the writer, text readers two lanes above. Each generic mask owner gets
    // a contiguous 3-lane block (writer/fill/text), so a later mask pair
    // fully replaces an earlier one in their overlap region. All blocks
    // remain below the photo-card stack (TEXTURE_PHOTO @ 20+).
    const isGenericOnly =
      maskOwner === undefined && dummyOwner === undefined && genericOwner !== undefined;
    const isTextClient =
      (mesh.userData?.w3d as { kind?: string } | undefined)?.kind === "TextureText";
    // Phase A1 — per-mask reader lanes. `genericOwner` is the 1-based discovery
    // index of the writer this reader is clipped against; its block sits at
    // genericWriterLane(index) so fill/text readers land just above it.
    mesh.renderOrder = isGenericOnly
      ? (isTextClient ? genericTextLane(genericOwner!) : genericFillLane(genericOwner!))
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
    // Hand the resolving dummy id to the post-build base-fade pass so this fill
    // can fade through the dummy mask's ramp.
    if (dummyMaskId !== undefined) mesh.userData.smoothFadeDummyId = dummyMaskId;
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
/**
 * Phase A1 — per-mask renderOrder block for generic colored masks.
 *
 * R3 renders generic colored-mask pairs in document order: writer N → readers
 * of N → writer N+1 → readers of N+1. A later mask pair must fully replace an
 * earlier one in their overlap region. The previous flat 15/16/17 layout
 * (every writer at 15, every reader at 16, every text reader at 17) violated
 * this: in LINEUP_LEFT, FF_MAIN (reader of BASE_MAIN @ 16) drew on top of
 * BASE_TEAM (writer @ 15) in their overlap, reducing the visible purple
 * panel to a thin sliver at the canvas right edge.
 *
 * New scheme: each generic mask gets a contiguous 3-lane block keyed off
 * its 1-based discovery index from `collectGenericMaskInfo`:
 *
 *   block(i) = [GENERIC_BLOCK_BASE + 3·(i-1) … GENERIC_BLOCK_BASE + 3·i - 1]
 *     writer  = block(i)[0]
 *     fill    = block(i)[1]   (TEXTURE_FULLFRAME_* and similar Quad readers)
 *     text    = block(i)[2]   (SMALL_TEAM_NAME / TEAM_NAME_* TextureText readers)
 *
 * With BASE_MAIN @ index 1 and BASE_TEAM @ index 2, LINEUP_LEFT lanes become:
 *   BASE_MAIN block  → 11 / 12 / 13   (writer / fill / text)
 *   BASE_TEAM block  → 14 / 15 / 16   (writer / fill / text)
 *
 * `STENCIL_GENERIC_INDEX_MAX = 3` caps the field to 3 owners, so the
 * highest possible generic lane is 19 (writer-3=17, fill-3=18, text-3=19).
 * Photo card readers therefore start at 20, leaving room beneath them for
 * up to 3 generic mask pairs without collision.
 *
 * Stencil refs/funcs/writeMasks are untouched by this phase — owner-field
 * allocation, mask-shape silhouette and reader equality tests remain
 * exactly as Phase 2J left them. Only the paint order changes.
 */
const GENERIC_BLOCK_BASE = 11;   // writer lane of the first generic mask block
const GENERIC_BLOCK_SIZE = 3;    // writer + fill-reader + text-reader

function genericWriterLane(maskIndex: number): number {
  return GENERIC_BLOCK_BASE + GENERIC_BLOCK_SIZE * (maskIndex - 1);
}
function genericFillLane(maskIndex: number): number {
  return genericWriterLane(maskIndex) + 1;
}
function genericTextLane(maskIndex: number): number {
  return genericWriterLane(maskIndex) + 2;
}

/**
 * Phase P4.1 — Foreground overlay lane for textured Quads that aren't
 * masks, aren't stencil readers, and are authored after the colored mask
 * panel they sit on top of (e.g. LINEUP_LEFT `LOGO` with IronHawks.png on
 * the yellow BASE_MAIN panel). With Three.js's default `renderOrder=0`
 * combined with the colored mask writer at lane 11+, such overlays would
 * be overpainted by the panel's gradient even though XML document order
 * places them in front. Lane 19 sits above the highest reserved generic
 * mask block (text-reader of the 3rd generic mask = 17+2 = 19 in the
 * theoretical max) but below the photo-card stack (20-22). Applies only
 * when a texture is actually resolved on the Quad — pure-color quads do
 * not get promoted.
 */
const RENDER_ORDER_OVERLAY = 19;
const RENDER_ORDER_TEXTURE_PHOTO = 20;   // photo-card pattern fill (was 18)
const RENDER_ORDER_PHOTO_COLOR = 21;     // photo-card colored block (was 19)
const RENDER_ORDER_DEFAULT_CLIENT = 22;  // PHOTO_NN and default photo-stencil reader (was 20)
/**
 * Phase TextureText render-order — labels without a MaskId default to
 * renderOrder=24 (above the photo-card stack at 20/21/22) so PLAYER_NUMBER /
 * PLAYER_POSITION / PLAYER_LAST_NAME draw on top of their card. TextureText
 * nodes WITH a MaskId still pass through applyPhotoMaskStencil's reader path
 * which overrides this value with the appropriate stencil-reader renderOrder.
 */
const RENDER_ORDER_TEXT = 24;
// Thin-divider lane — a sliver Quad (e.g. a divider / rule line) renders ABOVE
// the photo-card stack (20-22) but below the text labels (24). Such quads are
// no-mask textured Quads, so promoteOverlayQuadRenderOrder would otherwise leave
// them at the overlay lane (19), BEHIND the transparent photos.
const RENDER_ORDER_DIVIDER = 23;

const PHOTO_CARD_CLIENT_RE = /^(TEXTURE_PHOTO_\d+|PHOTO_COLOR_\d+|PHOTO_\d+)$/;

function photoCardRenderOrder(name: string): number {
  if (/^TEXTURE_PHOTO_\d+$/.test(name)) return RENDER_ORDER_TEXTURE_PHOTO;
  if (/^PHOTO_COLOR_\d+$/.test(name)) return RENDER_ORDER_PHOTO_COLOR;
  return RENDER_ORDER_DEFAULT_CLIENT;
}

function isPhotoCardClient(name: string): boolean {
  return PHOTO_CARD_CLIENT_RE.test(name);
}

/**
 * Phase P4.1 — see doc-comment on `RENDER_ORDER_OVERLAY`. Promotes a leaf
 * textured Quad that doesn't interact with any stencil mask to the foreground
 * overlay lane so authored sibling order (e.g. LINEUP_LEFT LOGO authored
 * AFTER BASE_MAIN) is preserved visually. No-op if any guard fails:
 *   - mesh.renderOrder was already set (mask writer/reader handled it)
 *   - node.isMask true (mask writer path)
 *   - own or inherited maskIds non-empty (stencil reader path)
 *   - material has no map (pure-color quad)
 */
function promoteOverlayQuadRenderOrder(
  mesh: Mesh,
  node: W3DQuadData,
  inheritedMaskIds?: string[],
): void {
  if (mesh.renderOrder !== 0) return;
  if (node.isMask) return;
  if (node.maskIds.length > 0) return;
  if (inheritedMaskIds && inheritedMaskIds.length > 0) return;
  const mat = mesh.material as MeshBasicMaterial;
  if (!mat || !mat.map) return;
  mesh.renderOrder = RENDER_ORDER_OVERLAY;
}

/**
 * Aspect ratio below which a Quad's geometry counts as a "thin divider" — a
 * sliver line such as a rule, separator or the R3 player "glow stick" dividers
 * (authored Size 0.01 × 2.43 → ratio ≈ 0.004). 1:20 is far below any real
 * content quad (photos ≈ 1:1, panels ≈ 1:3, logos ≈ 1:1) so this discriminates
 * dividers from content by GEOMETRY alone — no scene-specific name.
 */
const DIVIDER_ASPECT_MAX = 0.05;

/** A non-mask leaf Quad whose authored geometry is an extreme sliver (thin on
 * one axis relative to the other), in either orientation (vertical or
 * horizontal divider). */
function isThinDivider(node: W3DQuadData): boolean {
  if (node.isMask) return false;
  const { x, y } = node.geometry.size;
  const thin = Math.min(Math.abs(x), Math.abs(y));
  const long = Math.max(Math.abs(x), Math.abs(y));
  if (long <= 0) return false;
  // A real divider is a thin-but-present sliver. A ZERO thin dimension means a
  // degenerate / animated quad (e.g. BASE_BENCH authors Size X=0, its width
  // grows via a Size.XProp timeline) — that is a background strip, not a
  // divider, so it must NOT steal the divider render lane (it would then tie
  // with the real splitters and win on Z, hiding them).
  if (thin <= 0) return false;
  return thin / long < DIVIDER_ASPECT_MAX;
}

/**
 * Lift a thin-divider Quad ABOVE the photo-card stack. Such quads are no-mask
 * textured Quads, so promoteOverlayQuadRenderOrder lands them at the overlay
 * lane (19), which is BEHIND the transparent photo readers (20-22): an inner
 * divider gets overpainted by the overlapping photos (only the rightmost,
 * uncovered, survives). Promote it to a transparent overlay just above the
 * photos so a divider shows between every card. Keyed on the quad's GEOMETRY
 * (sliver aspect ratio) — not its name — so it generalises to any R3 scene's
 * dividers. Does NOT touch photos, masks/stencil, pivot, flow, or text.
 */
function applyThinDividerOverlay(mesh: Mesh, node: W3DQuadData): void {
  if (!isThinDivider(node)) return;
  const mat = mesh.material as MeshBasicMaterial | undefined;
  if (!mat) return;
  mesh.renderOrder = RENDER_ORDER_DIVIDER;
  mat.transparent = true;
  mat.depthTest = false;
  mat.depthWrite = false;
  // A thin divider inherited the colored mask's stencil clip (e.g. BENCH_SPLITTER
  // clipped by BASE_TEAM). R3 does NOT hard-clip these — the divider stays
  // exposed at its full size, drawn over the colored panel. Disable the stencil
  // test so the line renders un-clipped, matching R3.
  mat.stencilWrite = false;
}

/**
 * Phase 2K — bake a W3D AlphaKey matte's ALPHA channel into RGB so a stock
 * `material.alphaMap` (which samples GREEN) reproduces the matte.
 *
 * R3 `KeyType="AlphaKey"` ramps (e.g. VERTICAL_RAMP.png) keep RGB solid white
 * and store the gradient in the texture's ALPHA channel. Three.js's alphaMap
 * samples GREEN and ignores alpha, so the matte would read as a flat 1.0 and the
 * fade vanishes. Rather than patch the shader (renderer-version fragile), we
 * "edit the texture" the way you would in Photoshop/Photopea: copy alpha → RGB
 * once, on load, via a 2D canvas, producing a normal grayscale ramp whose GREEN
 * is the gradient. Clones (per-material UV transforms, and the base-fade fills)
 * share this baked source automatically, so they all sample the right channel.
 *
 * Cached under a distinct "#matte" key so the same file used as a colour `map`
 * elsewhere is unaffected. In jsdom (no 2D canvas) it degrades to the raw image
 * — harmless, since tests never rasterise.
 */
function loadCachedAlphaMatte(url: string, cache: Map<string, Texture>): Texture {
  const key = `${url}#alphaMatte`;
  const cached = cache.get(key);
  if (cached) return cached;
  const tex = new Texture();
  // alphaMap green is sampled raw (no colour-space decode) — keep the ramp
  // linear so the fade curve matches the authored alpha.
  tex.anisotropy = 16;
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const g = canvas.getContext("2d");
      if (!g) { tex.image = img; tex.needsUpdate = true; return; }
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        px[i] = a; px[i + 1] = a; px[i + 2] = a; px[i + 3] = 255;
      }
      g.putImageData(data, 0, 0);
      tex.image = canvas;
      tex.needsUpdate = true;
    } catch {
      tex.image = img; tex.needsUpdate = true;
    }
  };
  img.src = url;
  cache.set(key, tex);
  return tex;
}

/**
 * Acquire an AlphaKey matte texture (alpha-baked-to-RGB) with the layer's UV
 * transform applied. Mirrors `acquireTexture`'s clone-per-transform isolation so
 * two materials referencing the same ramp keep independent offset/repeat/wrap.
 */
function acquireAlphaMatteTexture(
  url: string,
  transform: UVTransform | undefined,
  cache: Map<string, Texture>,
): Texture {
  const base = loadCachedAlphaMatte(url, cache);
  if (!transform || isIdentityUVTransform(transform)) return base;
  const tex = base.clone();
  tex.offset.set(transform.offset.x, transform.offset.y);
  tex.repeat.set(transform.repeat.x, transform.repeat.y);
  tex.rotation = degToRad(transform.rotationDeg);
  if (transform.repeat.x < 0 || transform.repeat.y < 0) tex.center.set(0.5, 0.5);
  tex.wrapS = transform.wrapS;
  tex.wrapT = transform.wrapT;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Phase 2K — player base fade. The texture config (VERTICAL_RAMP) lives on the
 * player MASK: the PHOTO_DUMMY_0N silhouette and the visible PHOTO_0N it shares
 * (both flagged `alphaMapFromAlpha`). `DisableBinaryAlpha=True` means R3 fades
 * the fill THROUGH that smooth mask (`Player.alpha × VERTICAL_RAMP`).
 *
 * A stencil is binary, so we split it: (1) anchor + concentrate the ramp on the
 * photo/dummy mattes (`offset.y = 0`, `repeat *= BASE_FADE_GAIN`, keeping the
 * authored `1/ScaleKey` rate); (2) re-apply the SAME dummy ramp — identical
 * repeat/offset — as a smooth alphaMap on each fill the dummy clips, so the fill
 * fades EXACTLY like the silhouette mask (not a separate/different ramp on the
 * "strips"). The binary stencil keeps the shape; the alphaMap supplies the
 * smooth falloff that the binary mask cannot.
 *
 * Inert elsewhere: only AlphaKey mattes (`alphaMapFromAlpha`) are anchored, and
 * only readers stamped `smoothFadeDummyId` (clipped by such a dummy) get a fill
 * fade — and only if they have no alpha key of their own.
 */
function applySmoothMaskBaseFade(root: Group): void {
  // 1. Concentrate + anchor the photo + dummy mattes (the ones with the ramp).
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mat = o.material as MeshBasicMaterial;
    if (!mat.userData?.alphaMapFromAlpha || !mat.alphaMap) return;
    mat.alphaMap.wrapT = ClampToEdgeWrapping;
    mat.alphaMap.repeat.y *= BASE_FADE_GAIN;
    mat.alphaMap.offset.y = 0;
    mat.alphaMap.needsUpdate = true;
  });

  // 2. Map each dummy id → its (now anchored) ramp.
  const dummyRamp = new Map<string, MeshBasicMaterial["alphaMap"]>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const w = o.userData?.w3d as { id?: string; isMask?: boolean } | undefined;
    if (!w?.id || !w.isMask) return;
    const mat = o.material as MeshBasicMaterial;
    if (mat.userData?.alphaMapFromAlpha && mat.alphaMap) dummyRamp.set(w.id, mat.alphaMap);
  });
  if (dummyRamp.size === 0) return;

  // 3. Each fill the dummy clips fades through the dummy's ramp (same rate), but
  //    biased to vanish EARLIER (over its bottom FILL_FADE_FOOT) so its gold is
  //    gone behind the still-opaque photo — no gold "bar" in the fade region.
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const dummyId = o.userData?.smoothFadeDummyId as string | undefined;
    if (!dummyId) return;
    const ramp = dummyRamp.get(dummyId);
    if (!ramp) return;
    const mat = o.material as MeshBasicMaterial;
    if (mat.alphaMap) return; // never clobber a reader's own alpha key
    const tex = ramp.clone();
    tex.offset.y = -FILL_FADE_FOOT * tex.repeat.y;
    tex.needsUpdate = true;
    mat.alphaMap = tex;
    mat.transparent = true;
    mat.userData.alphaMapFromAlpha = true;
    mat.needsUpdate = true;
  });
}

function loadCachedTexture(url: string, cache: Map<string, Texture>): Texture {
  const cached = cache.get(url);
  if (cached) return cached;
  const tex = new TextureLoader().load(url);
  tex.colorSpace = SRGBColorSpace;
  // Match R3's `TextureFiltering*="Anisotropic"` (every photo/pattern layer in
  // the corpus sets it). Without it Three.js samples at anisotropy=1, which on
  // a non-uniformly scaled layer (e.g. FF_PHOTO Scale 1.7×0.82) and on the
  // alpha contour used to cut the player silhouette produces a low-quality,
  // shimmery margin. 16 is the de-facto GPU max; Three.js clamps to the actual
  // hardware limit at upload, so this is safe to set unconditionally.
  tex.anisotropy = 16;
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
  // Phase UV.2b — center pivot ONLY for mirror cases (negative repeat). R3
  // expects a horizontal/vertical flip to mirror around the texture centre;
  // Three.js default `texture.center = (0, 0)` makes a negative repeat under
  // Clamp wrap collapse to a single edge column instead of producing a real
  // mirror (e.g. INVERTED_GRADIENT's Scale.X = -1). Rotations are left at
  // the default corner pivot — small authored rotations (e.g. FF_MAIN's -1°)
  // already render correctly that way, and switching them to centre pivot
  // introduces a symmetric clamp band on both edges that visually duplicates
  // the pattern.
  if (transform.repeat.x < 0 || transform.repeat.y < 0) {
    tex.center.set(0.5, 0.5);
  }
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
  obj.rotation.set(degToRad(t.rotationDeg.x), degToRad(t.rotationDeg.y), degToRad(t.rotationDeg.z), t.rotationOrder ?? "YXZ");
  obj.scale.set(t.scale.x, t.scale.y, t.scale.z);
  // Pivot is applied by applyPivotAnchor / wrapMeshWithPivot (Phase 2B), not
  // here — those routines insert an inner offset under the transformed outer.
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
