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
type PhotoMaskInfo = { bit: number; isInverted: boolean };

const PHOTO_MASK_BIT = 1;
const PHOTO_DUMMY_BIT = 2;

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
    ctx.photoMaskInfoByMaskId = collectPhotoMaskInfo(roots);
  }
  const top = new Group();
  top.name = "w3d-nodes-root";
  for (const r of roots) top.add(buildNode(r, ctx));
  return top;
}

const PHOTO_MASK_NAME_RE = /^PHOTO_MASK_\d+$/;
const PHOTO_DUMMY_NAME_RE = /^PHOTO_DUMMY_\d+$/;

function collectPhotoMaskInfo(roots: W3DNodeData[]): Map<string, PhotoMaskInfo> {
  const out = new Map<string, PhotoMaskInfo>();
  const walk = (n: W3DNodeData): void => {
    if (n.kind === "Quad" && n.isMask) {
      const isInverted = !!n.maskProperties?.isInvertedMask;
      if (PHOTO_MASK_NAME_RE.test(n.name)) {
        out.set(n.id, { bit: PHOTO_MASK_BIT, isInverted });
      } else if (PHOTO_DUMMY_NAME_RE.test(n.name)) {
        out.set(n.id, { bit: PHOTO_DUMMY_BIT, isInverted });
      }
    }
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
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
  // Own maskIds override inherited (R3 semantics). Children with no maskIds of
  // their own pick up this group's maskIds as their effective stencil source.
  const passToChildren = node.maskIds.length > 0 ? node.maskIds : inheritedMaskIds;
  for (const c of node.children) g.add(buildNode(c, ctx, passToChildren));
  return g;
}

function buildQuad(node: W3DQuadData, ctx?: BuildContext, inheritedMaskIds?: string[]): Object3D {
  if (node.children.length === 0) {
    const mesh = makeQuadMesh(node, ctx);
    applyTransform(mesh, node.transform);
    // isMask quads are stencil planes — hide the plane itself until Phase H
    mesh.visible = node.enable && !node.isMask;
    applyPhotoMaskStencil(mesh, node, ctx, inheritedMaskIds);
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
  const mesh = makeQuadMesh(node, ctx);
  // Hide the mask plane itself even when wrapper is visible
  if (node.isMask) mesh.visible = false;
  wrapper.add(mesh);
  const passToChildren = node.maskIds.length > 0 ? node.maskIds : inheritedMaskIds;
  for (const c of node.children) wrapper.add(buildNode(c, ctx, passToChildren));
  return wrapper;
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
    const { bit } = info.get(node.id)!;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.stencilWrite = true;
    mat.stencilWriteMask = bit;
    mat.stencilFunc = AlwaysStencilFunc;
    mat.stencilRef = bit;
    mat.stencilZPass = ReplaceStencilOp;
    mat.stencilFail = ReplaceStencilOp;
    mat.stencilZFail = ReplaceStencilOp;
    mesh.renderOrder = 10;
    mesh.visible = node.enable; // override the "hide isMask" default in buildQuad

    if (ctx.stencilDebugShowMask) {
      // Debug aid: paint the mask red 50% so its shape is visible
      mat.color = new Color("#ff0000");
      mat.opacity = 0.5;
      mat.transparent = true;
      mat.colorWrite = true;
      mat.map = null;
      mat.alphaMap = null;
      mat.needsUpdate = true;
    } else {
      mat.colorWrite = false;
    }
    return;
  }

  // Reader: own maskIds take precedence; otherwise inherit from parent Group.
  // Phase 1a + Patch A single-mask only — uses maskIds[0]. Multi-mask
  // intersection (PHOTO_FILL_02..05 with two entries) deferred to a later phase.
  const effectiveMaskId = node.maskIds.length > 0
    ? node.maskIds[0]
    : (inheritedMaskIds && inheritedMaskIds.length > 0 ? inheritedMaskIds[0] : undefined);
  if (effectiveMaskId) {
    const target = info.get(effectiveMaskId);
    if (!target) return;
    mat.stencilWrite = true;
    mat.stencilFunc = target.isInverted ? EqualStencilFunc : NotEqualStencilFunc;
    mat.stencilRef = target.bit;
    mat.stencilFuncMask = target.bit;
    mat.stencilFail = KeepStencilOp;
    mat.stencilZFail = KeepStencilOp;
    mat.stencilZPass = KeepStencilOp;
    mat.depthWrite = false;
    mat.depthTest = false;
    mesh.renderOrder = 20;
  }
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
  // pivot intentionally not applied in this phase
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
