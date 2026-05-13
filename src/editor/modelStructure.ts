import { Mesh, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";

import { containsUsdcMagic } from "./modelBuffer";
import type { ModelAsset, ModelAssetStructure, ModelAssetStructureNode } from "./types";

export async function inspectModelFileStructure(
  file: File,
  format: ModelAsset["format"],
): Promise<ModelAssetStructure | undefined> {
  try {
    const buffer = await file.arrayBuffer();
    if (format === "usdz") {
      const bytes = new Uint8Array(buffer);
      if (containsUsdcMagic(bytes)) {
        const { inspectUsdcStructure } = await import("./usdcParser");
        return inspectUsdcStructure(buffer);
      }
      return inspectObjectStructure(new USDLoader().parse(buffer), format, "three");
    }

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
