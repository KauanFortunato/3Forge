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
 * Phase 1a — stencil clipping for the PHOTO_MASK_0X / PHOTO_0X subset of W3D.
 * Scope intentionally narrow until BASE_MAIN/BASE_TEAM (layout-dependent) and
 * PHOTO_DUMMY/PHOTO_FILL (multi-mask intersection) are addressed in later phases.
 *
 * Semantics (validated empirically against R3 on 2026-05-19):
 *   IsInvertedMask=True  → client uses EqualStencilFunc    (visible inside mask shape)
 *   IsInvertedMask=False → client uses NotEqualStencilFunc (visible outside mask shape)
 */
type PhotoMaskInfo = { ref: number; isInverted: boolean };

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

function collectPhotoMaskInfo(roots: W3DNodeData[]): Map<string, PhotoMaskInfo> {
  const out = new Map<string, PhotoMaskInfo>();
  let next = 1;
  const walk = (n: W3DNodeData): void => {
    if (n.kind === "Quad" && n.isMask && PHOTO_MASK_NAME_RE.test(n.name)) {
      out.set(n.id, { ref: next++, isInverted: !!n.maskProperties?.isInvertedMask });
    }
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

export function buildNode(node: W3DNodeData, ctx?: BuildContext): Object3D {
  if (node.kind === "Group") return buildGroup(node, ctx);
  return buildQuad(node, ctx);
}

function buildGroup(node: W3DGroupData, ctx?: BuildContext): Group {
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
  for (const c of node.children) g.add(buildNode(c, ctx));
  return g;
}

function buildQuad(node: W3DQuadData, ctx?: BuildContext): Object3D {
  if (node.children.length === 0) {
    const mesh = makeQuadMesh(node, ctx);
    applyTransform(mesh, node.transform);
    // isMask quads are stencil planes — hide the plane itself until Phase H
    mesh.visible = node.enable && !node.isMask;
    applyPhotoMaskStencil(mesh, node, ctx);
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
  for (const c of node.children) wrapper.add(buildNode(c, ctx));
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
 * Apply Phase 1a stencil clipping to a quad mesh.
 *
 * - PHOTO_MASK_0X (isMask=true, name matches /^PHOTO_MASK_\d+$/):
 *   stencilWrite=true, Always, ReplaceStencilOp, colorWrite=false.
 *
 * - Quads with maskIds[0] pointing to a PHOTO_MASK_0X:
 *   stencilWrite=true (required by three.js to participate), KeepStencilOp on
 *   all ops (buffer read-only), stencilFunc derived from IsInvertedMask:
 *     Inverted=True  → EqualStencilFunc
 *     Inverted=False → NotEqualStencilFunc
 *
 * Quads outside this scope (BASE_*, PHOTO_DUMMY_0X, multi-mask PHOTO_FILL_0X)
 * pass through untouched and continue to render with their existing materials.
 */
function applyPhotoMaskStencil(mesh: Mesh, node: W3DQuadData, ctx?: BuildContext): void {
  if (!ctx) return;
  const info = ctx.photoMaskInfoByMaskId;
  if (!info) return;
  const mat = mesh.material as MeshBasicMaterial;

  // PHOTO_MASK_0X — stencil writer
  if (node.isMask && info.has(node.id)) {
    const { ref } = info.get(node.id)!;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.stencilWrite = true;
    mat.stencilFunc = AlwaysStencilFunc;
    mat.stencilRef = ref;
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

  // Client — stencil reader, only when maskIds[0] points to a PHOTO_MASK_0X.
  // Multi-mask cases (PHOTO_FILL_02..05 with [DUMMY; MASK]) are intentionally
  // skipped here because their maskIds[0] is a PHOTO_DUMMY (not in info).
  if (node.maskIds.length > 0) {
    const target = info.get(node.maskIds[0]);
    if (!target) return;
    mat.stencilWrite = true;
    mat.stencilFunc = target.isInverted ? EqualStencilFunc : NotEqualStencilFunc;
    mat.stencilRef = target.ref;
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
