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
 */
export interface ParsedUsdSubsetData {
  name: string;
  materialPath?: string;
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
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
  subsets: ParsedUsdSubsetData[];
}

export interface ParsedUsdModelData {
  name: string;
  prims: ParsedUsdPrim[];
  materials: Record<string, ParsedUsdMaterialData>;
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
