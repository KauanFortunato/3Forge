// playgrounds/w3d-translation/src/inspector.ts
//
// DEV-Inspector — pure helper that turns a clicked Three.js Object3D into a
// structured InspectorReport. No DOM. No Three.js renderer. Read-only: never
// mutates the object, its children, materials, or textures.
//
// Resolution rule: when the raycaster hits a pivot helper (Object3D with
// userData.w3d.kind === "(pivot helper)") we traverse up its ancestor chain
// until we land on a real Group/Quad node. The hierarchy path likewise skips
// pivot helpers so the visible path mirrors the authored W3D tree.

import { Box3, type Material, type Mesh, type Object3D, Vector3 } from "three";
import type { W3DResourceRegistry, W3DTextureLayerData } from "./nodes/resources";

export type InspectorVec3 = { x: number; y: number; z: number };
export type InspectorVec2 = { x: number; y: number };

export interface InspectorReport {
  identity: {
    id: string;
    name: string;
    kind: "Quad" | "Group";
    hierarchyPath: string;
    hasChildren?: boolean;
  };
  transform: {
    localPosition: InspectorVec3;
    worldPosition: InspectorVec3;
    rotationDeg: InspectorVec3;
    scale: InspectorVec3;
    pivot?: InspectorVec3;
    alignmentX?: string;
    alignmentY?: string;
  };
  geometry: {
    /** Size from `node.geometry.size` — note this is post-timeline-snapshot. */
    currentSize?: InspectorVec2;
    worldBounds: {
      min: InspectorVec3;
      max: InspectorVec3;
      width: number;
      height: number;
      depth: number;
    };
    renderOrder: number;
  };
  visibility: {
    enable?: boolean;
    visible: boolean;
    alpha?: number;
    opacity?: number;
    transparent?: boolean;
    hiddenReason: string | null;
  };
  mask: {
    isMask?: boolean;
    isColoredMask?: boolean;
    isInvertedMask?: boolean;
    disableBinaryAlpha?: boolean;
    ownMaskIds: string[];
    effectiveMaskIds: string[];
  };
  stencil: {
    stencilWrite: boolean;
    stencilRef: number;
    stencilWriteMask: number;
    stencilFunc: number;
    stencilFuncMask: number;
    colorWrite: boolean;
    depthWrite: boolean;
    depthTest: boolean;
  } | null;
  material: {
    materialId?: string;
    materialName?: string;
    textureLayerId?: string;
    textureLayerName?: string;
    mapFilename?: string;
    alphaMapFilename?: string;
  };
  uv: {
    mapOffset?: InspectorVec2;
    mapRepeat?: InspectorVec2;
    mapRotationRad?: number;
    mapWrapS?: number;
    mapWrapT?: number;
    alphaMapOffset?: InspectorVec2;
    alphaMapRepeat?: InspectorVec2;
    alphaMapRotationRad?: number;
    alphaMapWrapS?: number;
    alphaMapWrapT?: number;
  };
  flow: {
    underFlowParent: string | null;
    slotIndex?: number;
    parentLeadingSpace?: number;
    parentFlowDirection?: string;
  };
}

interface W3DUserDataPivotHelper {
  kind: "(pivot helper)";
  forNodeId: string;
}

interface W3DUserDataNode {
  kind: "Quad" | "Group";
  id: string;
  name: string;
  hasChildren?: boolean;
  enable?: boolean;
  alpha?: number;
  isMask?: boolean;
  maskIds?: string[];
  geometry?: {
    alignmentX?: string;
    alignmentY?: string;
    size?: { x: number; y: number };
  };
  transform?: {
    position: { x: number; y: number; z: number };
    rotationDeg: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    pivot?: { x: number; y: number; z: number };
  };
  faceMapping?: {
    materialId?: string;
    textureLayerId?: string;
  };
  maskProperties?: {
    isColoredMask?: boolean;
    isInvertedMask?: boolean;
    disableBinaryAlpha?: boolean;
  };
  materialName?: string;
  textureLayerName?: string;
  textureFilename?: string;
  flow?: {
    children: boolean;
    leadingSpace?: number;
    direction?: string;
  };
}

type AnyW3DUserData = W3DUserDataNode | W3DUserDataPivotHelper | undefined;

function readUserData(o: Object3D | null | undefined): AnyW3DUserData {
  return (o?.userData?.w3d as AnyW3DUserData) ?? undefined;
}

function isRealW3DNode(w: AnyW3DUserData): w is W3DUserDataNode {
  return !!w && (w.kind === "Quad" || w.kind === "Group");
}

/**
 * Walks up from `start` until it finds the first ancestor with a real W3D
 * node (Quad or Group). Pivot helpers and the unnamed root are skipped.
 */
export function resolveInspectorTarget(start: Object3D): Object3D | null {
  let cur: Object3D | null = start;
  while (cur) {
    if (isRealW3DNode(readUserData(cur))) return cur;
    cur = cur.parent;
  }
  return null;
}

function hierarchyPathOf(o: Object3D): string {
  const parts: string[] = [];
  let cur: Object3D | null = o;
  while (cur) {
    const w = readUserData(cur);
    if (isRealW3DNode(w) && w.name) parts.unshift(w.name);
    cur = cur.parent;
  }
  return parts.join(" > ");
}

function effectiveMaskIdsOf(o: Object3D): string[] {
  // Own maskIds win; otherwise walk up to find the first non-empty list.
  let cur: Object3D | null = o;
  while (cur) {
    const w = readUserData(cur);
    if (isRealW3DNode(w) && w.maskIds && w.maskIds.length > 0) return w.maskIds.slice();
    cur = cur.parent;
  }
  return [];
}

function flowContextOf(o: Object3D): InspectorReport["flow"] {
  // Find the nearest real ancestor whose parent is a Group with flow.children=true.
  let cur: Object3D | null = o;
  while (cur && cur.parent) {
    const parentW = readUserData(cur.parent);
    if (isRealW3DNode(parentW) && parentW.kind === "Group" && parentW.flow?.children === true) {
      const slotIndex = cur.parent.children.indexOf(cur);
      return {
        underFlowParent: parentW.name,
        slotIndex,
        ...(parentW.flow?.leadingSpace !== undefined ? { parentLeadingSpace: parentW.flow.leadingSpace } : {}),
        ...(parentW.flow?.direction !== undefined ? { parentFlowDirection: parentW.flow.direction } : {}),
      };
    }
    cur = cur.parent;
  }
  return { underFlowParent: null };
}

function vec3(x: number, y: number, z: number): InspectorVec3 {
  return { x, y, z };
}

function hiddenReasonOf(target: Object3D, w: W3DUserDataNode, mat: Material | null): string | null {
  if (w.enable === false) return "Enable=False";
  if (w.alpha === 0) return "Alpha=0 (static)";
  if (mat && (mat as { opacity?: number }).opacity === 0) return "material.opacity=0 (resolved)";
  if (w.isMask === true && w.maskProperties?.isColoredMask !== true) {
    return "pure stencil writer (IsColoredMask=False)";
  }
  if (!target.visible) return "Object3D.visible=false";
  return null;
}

function materialOf(o: Object3D): Material | null {
  const m = (o as Mesh).material as Material | Material[] | undefined;
  if (!m) return null;
  return Array.isArray(m) ? m[0] : m;
}

function looksLikeMeshBasic(m: Material | null): m is Material & {
  stencilWrite: boolean;
  stencilRef: number;
  stencilWriteMask: number;
  stencilFunc: number;
  stencilFuncMask: number;
  colorWrite: boolean;
  depthWrite: boolean;
  depthTest: boolean;
  transparent: boolean;
  opacity: number;
  map?: { offset: { x: number; y: number }; repeat: { x: number; y: number }; rotation: number; wrapS: number; wrapT: number };
  alphaMap?: { offset: { x: number; y: number }; repeat: { x: number; y: number }; rotation: number; wrapS: number; wrapT: number };
} {
  return !!m && typeof (m as { stencilWrite?: unknown }).stencilWrite === "boolean";
}

function stencilOf(mat: Material | null): InspectorReport["stencil"] {
  if (!looksLikeMeshBasic(mat)) return null;
  return {
    stencilWrite: mat.stencilWrite,
    stencilRef: mat.stencilRef,
    stencilWriteMask: mat.stencilWriteMask,
    stencilFunc: mat.stencilFunc,
    stencilFuncMask: mat.stencilFuncMask,
    colorWrite: mat.colorWrite,
    depthWrite: mat.depthWrite,
    depthTest: mat.depthTest,
  };
}

function uvOf(mat: Material | null): InspectorReport["uv"] {
  const out: InspectorReport["uv"] = {};
  if (!looksLikeMeshBasic(mat)) return out;
  if (mat.map) {
    out.mapOffset = { x: mat.map.offset.x, y: mat.map.offset.y };
    out.mapRepeat = { x: mat.map.repeat.x, y: mat.map.repeat.y };
    out.mapRotationRad = mat.map.rotation;
    out.mapWrapS = mat.map.wrapS;
    out.mapWrapT = mat.map.wrapT;
  }
  if (mat.alphaMap) {
    out.alphaMapOffset = { x: mat.alphaMap.offset.x, y: mat.alphaMap.offset.y };
    out.alphaMapRepeat = { x: mat.alphaMap.repeat.x, y: mat.alphaMap.repeat.y };
    out.alphaMapRotationRad = mat.alphaMap.rotation;
    out.alphaMapWrapS = mat.alphaMap.wrapS;
    out.alphaMapWrapT = mat.alphaMap.wrapT;
  }
  return out;
}

function alphaMapFilenameOf(w: W3DUserDataNode, registry?: W3DResourceRegistry): string | undefined {
  if (!registry) return undefined;
  const layerId = w.faceMapping?.textureLayerId;
  if (!layerId || layerId === "Standard") return undefined;
  const layer: W3DTextureLayerData | undefined = registry.textureLayers.get(layerId);
  const keyGuid = layer?.mapping?.keyGuid;
  if (!keyGuid) return undefined;
  return registry.textures.get(keyGuid)?.filename;
}

/**
 * Build an InspectorReport for an Object3D the user clicked in the viewport.
 *
 * Steps:
 *   1. Resolve to the first real W3D ancestor (skipping pivot helpers).
 *   2. Read the userData payload attached by the builder.
 *   3. Read live material state (stencil + UV) from `mesh.material`.
 *   4. Compute world position & bounds via Three.js.
 *   5. Walk parents to derive hierarchy path, effective maskIds, flow info.
 *
 * Returns null if no real W3D node is reachable from `start` (e.g. the user
 * clicked on the top-level `w3d-nodes-root` Group or a stray helper).
 */
export function buildInspectorReport(
  start: Object3D,
  registry?: W3DResourceRegistry,
): InspectorReport | null {
  const target = resolveInspectorTarget(start);
  if (!target) return null;
  const w = readUserData(target) as W3DUserDataNode;

  const mat = materialOf(target);
  const worldPos = target.getWorldPosition(new Vector3());
  const box = new Box3().setFromObject(target);
  const boxValid = isFinite(box.min.x) && isFinite(box.max.x);
  const boxWidth = boxValid ? box.max.x - box.min.x : 0;
  const boxHeight = boxValid ? box.max.y - box.min.y : 0;
  const boxDepth = boxValid ? box.max.z - box.min.z : 0;

  const t = w.transform;
  const ownMaskIds = (w.maskIds ?? []).slice();
  const effectiveMaskIds = ownMaskIds.length > 0 ? ownMaskIds : effectiveMaskIdsOf(target);

  return {
    identity: {
      id: w.id,
      name: w.name,
      kind: w.kind,
      hierarchyPath: hierarchyPathOf(target),
      ...(w.hasChildren !== undefined ? { hasChildren: w.hasChildren } : {}),
    },
    transform: {
      localPosition: vec3(target.position.x, target.position.y, target.position.z),
      worldPosition: vec3(worldPos.x, worldPos.y, worldPos.z),
      rotationDeg: t?.rotationDeg
        ? vec3(t.rotationDeg.x, t.rotationDeg.y, t.rotationDeg.z)
        : vec3(0, 0, 0),
      scale: t?.scale ? vec3(t.scale.x, t.scale.y, t.scale.z) : vec3(1, 1, 1),
      ...(t?.pivot ? { pivot: vec3(t.pivot.x, t.pivot.y, t.pivot.z) } : {}),
      ...(w.geometry?.alignmentX ? { alignmentX: w.geometry.alignmentX } : {}),
      ...(w.geometry?.alignmentY ? { alignmentY: w.geometry.alignmentY } : {}),
    },
    geometry: {
      ...(w.geometry?.size
        ? { currentSize: { x: w.geometry.size.x, y: w.geometry.size.y } }
        : {}),
      worldBounds: {
        min: vec3(box.min.x, box.min.y, box.min.z),
        max: vec3(box.max.x, box.max.y, box.max.z),
        width: boxWidth,
        height: boxHeight,
        depth: boxDepth,
      },
      renderOrder: target.renderOrder,
    },
    visibility: {
      ...(w.enable !== undefined ? { enable: w.enable } : {}),
      visible: target.visible,
      ...(w.alpha !== undefined ? { alpha: w.alpha } : {}),
      ...(looksLikeMeshBasic(mat) ? { opacity: mat.opacity, transparent: mat.transparent } : {}),
      hiddenReason: hiddenReasonOf(target, w, mat),
    },
    mask: {
      ...(w.isMask !== undefined ? { isMask: w.isMask } : {}),
      ...(w.maskProperties?.isColoredMask !== undefined
        ? { isColoredMask: w.maskProperties.isColoredMask }
        : {}),
      ...(w.maskProperties?.isInvertedMask !== undefined
        ? { isInvertedMask: w.maskProperties.isInvertedMask }
        : {}),
      ...(w.maskProperties?.disableBinaryAlpha !== undefined
        ? { disableBinaryAlpha: w.maskProperties.disableBinaryAlpha }
        : {}),
      ownMaskIds,
      effectiveMaskIds,
    },
    stencil: stencilOf(mat),
    material: {
      ...(w.faceMapping?.materialId ? { materialId: w.faceMapping.materialId } : {}),
      ...(w.materialName ? { materialName: w.materialName } : {}),
      ...(w.faceMapping?.textureLayerId ? { textureLayerId: w.faceMapping.textureLayerId } : {}),
      ...(w.textureLayerName ? { textureLayerName: w.textureLayerName } : {}),
      ...(w.textureFilename ? { mapFilename: w.textureFilename } : {}),
      ...(((): { alphaMapFilename?: string } => {
        const f = alphaMapFilenameOf(w, registry);
        return f ? { alphaMapFilename: f } : {};
      })()),
    },
    uv: uvOf(mat),
    flow: flowContextOf(target),
  };
}
