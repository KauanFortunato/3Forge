import { Mesh, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { ModelAsset, ModelAssetStructure, ModelAssetStructureNode } from "./types";

export async function inspectModelFileStructure(
  file: File,
  format: ModelAsset["format"],
): Promise<ModelAssetStructure | undefined> {
  try {
    // USDZ is parsed by the OpenUSD WASM at scene-build time; the structure is
    // populated lazily then via `EditorStore.updateModelAssetStructure` (see
    // `scene.ts → buildModelObject`). Don't attempt to inspect it here — three's
    // bundled USDLoader can't parse binary USDC payloads and just throws.
    if (format === "usdz") {
      return undefined;
    }

    const buffer = await file.arrayBuffer();
    if (format === "glb") {
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      return inspectObjectStructure(gltf.scene, format, "three");
    }

    const text = await file.text();
    const gltf = await new GLTFLoader().parseAsync(text, "");
    return inspectObjectStructure(gltf.scene, format, "three");
  } catch (error) {
    console.warn("Failed to inspect model structure:", error);
    return undefined;
  }
}

function inspectObjectStructure(
  root: Object3D,
  format: ModelAsset["format"],
  source: ModelAssetStructure["source"],
): ModelAssetStructure {
  const roots = root.children.length > 0
    ? root.children.map((child, index) => createObjectStructureNode(child, `root-${index}`))
    : [createObjectStructureNode(root, "root")];
  const materialIds = new Set<unknown>();
  const textureIds = new Set<unknown>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      materialIds.add(material.uuid);
      for (const value of Object.values(material)) {
        if (value && typeof value === "object" && "isTexture" in value && value.isTexture === true) {
          textureIds.add((value as { uuid?: unknown }).uuid ?? value);
        }
      }
    }
  });
  return {
    format,
    source,
    nodeCount: roots.reduce((total, node) => total + countNodes(node), 0),
    meshCount: roots.reduce((total, node) => total + node.meshCount, 0),
    materialCount: materialIds.size,
    textureCount: textureIds.size,
    roots,
  };
}

function createObjectStructureNode(object: Object3D, fallbackId: string): ModelAssetStructureNode {
  const children = object.children.map((child, index) => createObjectStructureNode(child, `${fallbackId}.${index}`));
  const isMesh = object instanceof Mesh;
  return {
    id: object.uuid || fallbackId,
    name: object.name || (isMesh ? "Mesh" : "Node"),
    type: isMesh ? "mesh" : object.type || "node",
    childCount: children.length,
    meshCount: (isMesh ? 1 : 0) + children.reduce((total, child) => total + child.meshCount, 0),
    materialCount: isMesh
      ? Array.isArray(object.material)
        ? object.material.length
        : 1
      : 0,
    children,
  };
}

function countNodes(node: ModelAssetStructureNode): number {
  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0);
}

/**
 * Build a ModelAssetStructure from a rendered Three.js Group, using
 * child-index paths as stable IDs ("0", "0.1", "0.1.2", …). These IDs
 * survive `Object3D.clone(true)` because the tree shape is preserved,
 * which is essential for matching hierarchy-panel rows to the visible
 * meshes in the viewport (e.g. when toggling part visibility).
 */
export function buildStructureFromGroup(
  root: Object3D,
  format: ModelAsset["format"],
  source: ModelAssetStructure["source"] = "three",
): ModelAssetStructure {
  // If the root itself wraps a single child (common for our parsers),
  // treat its direct children as the roots so the user doesn't see an
  // extra "Group" wrapper layer in the hierarchy.
  const useChildrenAsRoots = root.children.length > 0;
  const roots = useChildrenAsRoots
    ? root.children.map((child, index) => buildStructureNodeByIndex(child, String(index)))
    : [buildStructureNodeByIndex(root, "0")];

  const materialIds = new Set<unknown>();
  const textureIds = new Set<unknown>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      materialIds.add(material.uuid);
      for (const value of Object.values(material)) {
        if (value && typeof value === "object" && "isTexture" in value && value.isTexture === true) {
          textureIds.add((value as { uuid?: unknown }).uuid ?? value);
        }
      }
    }
  });

  return {
    format,
    source,
    nodeCount: roots.reduce((total, node) => total + countNodes(node), 0),
    meshCount: roots.reduce((total, node) => total + node.meshCount, 0),
    materialCount: materialIds.size,
    textureCount: textureIds.size,
    roots,
  };
}

function buildStructureNodeByIndex(object: Object3D, indexPath: string): ModelAssetStructureNode {
  const children = object.children.map((child, index) =>
    buildStructureNodeByIndex(child, `${indexPath}.${index}`),
  );
  const isMesh = object instanceof Mesh;
  const rawName = (object.name || "").trim();
  // Many parsers (incl. our openusdParser) set names to USD prim paths.
  // For display, prefer just the leaf segment so the tree stays readable.
  const displayName = rawName
    ? rawName.includes("/")
      ? (rawName.split("/").filter(Boolean).pop() ?? rawName)
      : rawName
    : isMesh ? "Mesh" : "Node";
  return {
    id: indexPath,
    name: displayName,
    type: isMesh ? "mesh" : object.type || "node",
    childCount: children.length,
    meshCount: (isMesh ? 1 : 0) + children.reduce((total, child) => total + child.meshCount, 0),
    materialCount: isMesh
      ? Array.isArray(object.material)
        ? object.material.length
        : 1
      : 0,
    children,
  };
}

/**
 * Walk a tagged Group produced by the OpenUSD parser and return the
 * Object3D representing the given USD prim path (matched against
 * `userData.usdPath`). Returns `null` when no descendant carries the
 * requested tag — typically because the model was re-parsed with a
 * different tree shape or it isn't an OpenUSD-parsed model.
 */
export function findObjectByUsdPath(root: Object3D, usdPath: string): Object3D | null {
  if (root.userData?.usdPath === usdPath) {
    return root;
  }
  for (const child of root.children) {
    const found = findObjectByUsdPath(child, usdPath);
    if (found) return found;
  }
  return null;
}

/**
 * Walk a cloned Group by index path (the canonical part ID format)
 * and return the matching Object3D, or undefined if the path doesn't
 * resolve (e.g. the model's tree shape changed since the structure
 * was built).
 */
export function findObjectByIndexPath(root: Object3D, indexPath: string): Object3D | undefined {
  // The structure treats root.children as the roots, so the first
  // segment of the path indexes into root.children.
  if (!indexPath) return root;
  const segments = indexPath.split(".");
  let current: Object3D | undefined = root;
  for (const segment of segments) {
    if (!current) return undefined;
    const index = Number.parseInt(segment, 10);
    if (Number.isNaN(index) || index < 0 || index >= current.children.length) {
      return undefined;
    }
    current = current.children[index];
  }
  return current;
}
