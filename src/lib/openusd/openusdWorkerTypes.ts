import type { ParseUsdzProgressUpdate } from "./openusdParser";

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

export interface ParsedUsdMeshData {
  groupName: string;
  name: string;
  matrix: number[] | null;
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  material: ParsedUsdMaterialData;
}

export interface ParsedUsdModelData {
  name: string;
  meshes: ParsedUsdMeshData[];
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
