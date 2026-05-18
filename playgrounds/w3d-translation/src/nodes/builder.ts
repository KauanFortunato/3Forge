// playgrounds/w3d-translation/src/nodes/builder.ts
import {
  Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D,
  PlaneGeometry, SRGBColorSpace, Texture, TextureLoader,
} from "three";
import type { W3DGroupData, W3DNodeData, W3DQuadData, W3DTransform } from "./data";
import { resolveMaterial, displayColorToHex } from "./materialResolver";
import type { W3DResourceRegistry } from "./resources";

export type BuildContext = {
  registry: W3DResourceRegistry;
  textureUrlsByFilename: Map<string, string>;
  textureCache: Map<string, Texture>;
  warnings: string[];
};

export function buildNodeTree(roots: W3DNodeData[], ctx?: BuildContext): Group {
  const top = new Group();
  top.name = "w3d-nodes-root";
  for (const r of roots) top.add(buildNode(r, ctx));
  return top;
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
