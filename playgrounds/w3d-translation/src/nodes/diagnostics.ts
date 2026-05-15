// playgrounds/w3d-translation/src/nodes/diagnostics.ts
import type { W3DNodeData, W3DQuadData } from "./data";

export type DumpRow = {
  depth: number;
  path: string;
  kind: "Group" | "Quad";
  id: string;
  name: string;
  enabled: boolean;
  disabledByEnable: boolean;
  alpha: number;
  transparentByAlpha0: boolean;
  effectiveVisible: boolean;
  size: string;
  position: string;
  scale: string;
  rotation: string;
  isMask: boolean;
  maskIds: string[];
  materialId: string;
  textureLayerId: string;
  hasMaterialResolved: boolean;
  hasTextureLayerResolved: boolean;
  maskProperties: string;
  childrenCount: number;
};

export function dumpNodes(roots: W3DNodeData[]): DumpRow[] {
  const rows: DumpRow[] = [];
  for (const r of roots) walk(r, 0, [], rows);
  return rows;
}

function walk(node: W3DNodeData, depth: number, ancestors: string[], rows: DumpRow[]): void {
  const path = [...ancestors, node.name].join(" > ");
  rows.push(node.kind === "Quad" ? quadRow(node, depth, path) : groupRow(node, depth, path));
  for (const c of node.children) walk(c, depth + 1, [...ancestors, node.name], rows);
}

function groupRow(node: Extract<W3DNodeData, { kind: "Group" }>, depth: number, path: string): DumpRow {
  const t = node.transform;
  return {
    depth,
    path,
    kind: "Group",
    id: node.id,
    name: node.name,
    enabled: true,
    disabledByEnable: false,
    alpha: 1,
    transparentByAlpha0: false,
    effectiveVisible: true,
    size: "—",
    position: vecStr(t.position),
    scale: vecStr(t.scale),
    rotation: degStr(t.rotationDeg),
    isMask: false,
    maskIds: node.maskIds,
    materialId: "—",
    textureLayerId: "—",
    hasMaterialResolved: false,
    hasTextureLayerResolved: false,
    maskProperties: "—",
    childrenCount: node.children.length,
  };
}

function quadRow(node: W3DQuadData, depth: number, path: string): DumpRow {
  const t = node.transform;
  const transparentByAlpha0 = node.alpha === 0;
  return {
    depth,
    path,
    kind: "Quad",
    id: node.id,
    name: node.name,
    enabled: node.enable,
    disabledByEnable: !node.enable,
    alpha: node.alpha,
    transparentByAlpha0,
    effectiveVisible: node.enable && node.alpha > 0,
    size: `${fmt(node.geometry.size.x)} × ${fmt(node.geometry.size.y)}`,
    position: vecStr(t.position),
    scale: vecStr(t.scale),
    rotation: degStr(t.rotationDeg),
    isMask: node.isMask,
    maskIds: node.maskIds,
    materialId: node.faceMapping?.materialId ?? "—",
    textureLayerId: node.faceMapping?.textureLayerId ?? "—",
    hasMaterialResolved: false,
    hasTextureLayerResolved: false,
    maskProperties: node.maskProperties
      ? Object.entries(node.maskProperties)
          .filter(([, v]) => v === true)
          .map(([k]) => k)
          .join(", ") || "—"
      : "—",
    childrenCount: node.children.length,
  };
}

function vecStr(v: { x: number; y: number; z: number }): string {
  return `${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)}`;
}

function degStr(v: { x: number; y: number; z: number }): string {
  return `${fmt(v.x)}°, ${fmt(v.y)}°, ${fmt(v.z)}°`;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
