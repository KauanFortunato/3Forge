// playgrounds/w3d-translation/src/nodes/builder.ts
import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry } from "three";
import type { W3DGroupData, W3DNodeData, W3DQuadData, W3DTransform } from "./data";

export function buildNodeTree(roots: W3DNodeData[]): Group {
  const top = new Group();
  top.name = "w3d-nodes-root";
  for (const r of roots) top.add(buildNode(r));
  return top;
}

export function buildNode(node: W3DNodeData): Object3D {
  if (node.kind === "Group") return buildGroup(node);
  return buildQuad(node);
}

function buildGroup(node: W3DGroupData): Group {
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
  for (const c of node.children) g.add(buildNode(c));
  return g;
}

function buildQuad(node: W3DQuadData): Object3D {
  if (node.children.length === 0) {
    const mesh = makeQuadMesh(node);
    applyTransform(mesh, node.transform);
    mesh.visible = node.enable;
    return mesh;
  }
  // Quad with children: transform goes on the wrapper Group so children inherit it.
  // The inner plane mesh stays at identity — the wrapper holds the Quad's transform.
  const wrapper = new Group();
  wrapper.name = `${node.name} (wrapper)`;
  applyTransform(wrapper, node.transform);
  wrapper.visible = node.enable;
  wrapper.userData.w3d = {
    id: node.id,
    name: node.name,
    kind: "Quad",
    hasChildren: true,
    maskIds: node.maskIds,
  };
  const mesh = makeQuadMesh(node);
  // mesh intentionally has no applyTransform — identity so children inherit wrapper's transform
  wrapper.add(mesh);
  for (const c of node.children) wrapper.add(buildNode(c));
  return wrapper;
}

function makeQuadMesh(node: W3DQuadData): Mesh {
  const geometry = new PlaneGeometry(node.geometry.size.x, node.geometry.size.y);
  const material = new MeshBasicMaterial({
    color: new Color(displayColorToHex(node.displayColor)),
    transparent: node.alpha < 1,
    opacity: node.alpha,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = node.name;
  mesh.userData.w3d = quadUserData(node);
  return mesh;
}

function quadUserData(node: W3DQuadData) {
  const { children: _children, ...rest } = node;
  return {
    ...rest,
    kind: "Quad",
    hasMaterialResolved: false,
    hasTextureLayerResolved: false,
  };
}

/**
 * Convert W3D DisplayColor (signed Int32, ARGB) to "#rrggbb".
 * Fallback magenta when missing or unparseable.
 */
function displayColorToHex(raw: string | undefined): string {
  if (!raw) return "#ff00ff";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "#ff00ff";
  const argb = n < 0 ? n + 0x1_0000_0000 : n;
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
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
