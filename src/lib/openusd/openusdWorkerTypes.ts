import type { ParseUsdzProgressUpdate } from "./openusdParser";
import type { ImportedNodeAnimation } from "../../editor/types";

export interface ParsedUsdTextureData {
  bytes: Uint8Array;
  wrapS?: string;
  wrapT?: string;
}

export interface ParsedUsdMaterialData {
  color?: [number, number, number];
  emissive?: [number, number, number];
  metalness?: number;
  roughness?: number;
  opacity?: number;
  ior?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  specularColor?: [number, number, number];
  textures: Partial<Record<
    "map" | "metalnessMap" | "roughnessMap" | "normalMap" | "aoMap" | "emissiveMap" | "alphaMap",
    ParsedUsdTextureData
  >>;
}

/**
 * One sub-mesh of a USD Mesh prim. A mesh prim with N GeomSubsets emits N
 * ParsedUsdSubsetData entries (one per subset, each with its own materialPath);
 * a mesh prim with no subsets emits a single entry whose `name` is the prim's
 * own short name. The main thread reconstructs three.js Mesh objects from
 * these, tagging userData.usdSubsetName so per-subset selection works.
 *
 * `skinIndex` / `skinWeight` are present when the parent prim has a
 * SkelBindingAPI — they're per-corner Float32/Uint16 arrays sized
 * `cornerCount * numInfluencesPerComponent`. The main thread uses them
 * to construct a THREE.SkinnedMesh bound to the skeleton in
 * {@link ParsedUsdModelData.skeletons} keyed by {@link ParsedUsdSkinning.skeletonPath}.
 */
export interface ParsedUsdSubsetData {
  name: string;
  materialPath?: string;
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  skinIndex: Uint16Array | null;
  skinWeight: Float32Array | null;
}

/**
 * Skin binding metadata attached to a Mesh prim that authors a
 * SkelBindingAPI. The actual skeleton + animation data live keyed by
 * {@link skeletonPath} / {@link animationPath} on {@link ParsedUsdModelData}
 * so multiple skinned meshes that share a skeleton resolve to one Three.js
 * Skeleton at render time.
 */
export interface ParsedUsdSkinning {
  skeletonPath: string;
  animationPath: string;
  geomBindTransform: Float32Array;
  numInfluencesPerComponent: number;
}

/**
 * One USD Skeleton's joint hierarchy snapshot. `joints` are USD joint paths
 * ("root", "root/A", "root/A/B"); `parentIndices[i] = -1` for roots, else
 * the index of joint i's parent in `joints`. `restMatrices` are joint-local
 * 4x4 matrices (column-major, 16 floats per joint). `bindMatrices` are world-
 * space at bind time — the renderer derives Three.js's `boneInverses` by
 * inverting them.
 */
export interface ParsedUsdSkeleton {
  joints: string[];
  parentIndices: Int32Array;
  restMatrices: Float32Array;
  bindMatrices: Float32Array;
}

/**
 * Per-frame joint TRS samples for a USD SkelAnimation. `jointsOrder` is the
 * SkelAnimation's own joints list — usually but not always identical to the
 * Skeleton's joints; the renderer remaps to skeleton joint order at apply
 * time. `frames[i].translations` is 3 floats per joint, `.rotations` is 4
 * floats per joint packed as (x, y, z, w) — Three.js Quaternion convention.
 */
export interface ParsedUsdSkeletalAnimation {
  fps: number;
  durationFrames: number;
  jointsOrder: string[];
  frames: Array<{
    frame: number;
    translations: Float32Array;
    rotations: Float32Array;
    scales: Float32Array;
  }>;
}

/**
 * One USD prim in the hierarchy (kept = Mesh or Xformable, with shader/material
 * network prims filtered out upstream). Prims are emitted in parent-before-
 * child order so the reconstructor can hand each one to its already-built
 * parent via `parent` (the USD path of the nearest kept ancestor, or "" if
 * the prim parents directly to the model root).
 *
 * `worldMatrix` is the absolute world transform straight from
 * `getWorldTransform`. The main-thread reconstructor derives the local
 * transform as `inverse(parentWorld) * primWorld` using three.js's Matrix4
 * once it knows the parent's world matrix — keeping all matrix math in the
 * thread that already has three.js available, so the worker doesn't carry
 * its own inverse/multiply implementation.
 *
 * `primaryMaterialPath` (mesh prims only) is the first subset's material path,
 * used by the editor's import plan to bind the prim's blueprint node to a
 * shared MaterialAsset when the subsets all share one material.
 */
export interface ParsedUsdPrim {
  path: string;
  parent: string;
  kind: "xform" | "mesh";
  worldMatrix: number[] | null;
  primaryMaterialPath?: string;
  animation?: ImportedNodeAnimation;
  /**
   * Non-null when the mesh prim authors a SkelBindingAPI. The main thread
   * builds a THREE.SkinnedMesh and binds it to {@link ParsedUsdModelData.skeletons}
   * keyed by {@link ParsedUsdSkinning.skeletonPath}.
   */
  skinning?: ParsedUsdSkinning;
  subsets: ParsedUsdSubsetData[];
}

export interface ParsedUsdModelData {
  name: string;
  prims: ParsedUsdPrim[];
  materials: Record<string, ParsedUsdMaterialData>;
  /** Skeletons keyed by USD prim path. Shared across skinned meshes that bind to the same Skeleton. */
  skeletons: Record<string, ParsedUsdSkeleton>;
  /** SkelAnimations keyed by USD prim path. Shared across skinned meshes that reference the same animation. */
  skeletalAnimations: Record<string, ParsedUsdSkeletalAnimation>;
}

export type OpenUsdWorkerRequest = {
  type: "parse";
  buffer: ArrayBuffer;
  filename: string;
};

export type OpenUsdWorkerResponse =
  | { type: "progress"; update: ParseUsdzProgressUpdate }
  | { type: "result"; model: ParsedUsdModelData }
  | { type: "error"; message: string };
