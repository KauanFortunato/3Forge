import { loadOpenUSD, releaseOpenUSD } from "./loadOpenUsd";
import type {
  OpenUsdWorkerRequest,
  OpenUsdWorkerResponse,
  ParsedUsdMaterialData,
  ParsedUsdMeshData,
  ParsedUsdModelData,
  ParsedUsdTextureData,
} from "./openusdWorkerTypes";

interface PrimInfo {
  path: string;
  type: string;
  parent: string;
  isMesh: boolean;
  isXformable: boolean;
}

interface MeshSubset {
  name: string;
  indices: Int32Array;
  materialPath: string;
}

interface MeshData {
  points: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  faceVertexCounts: Int32Array;
  faceVertexIndices: Int32Array;
  normalsInterpolation: string;
  uvsInterpolation: string;
  subsets: MeshSubset[];
}

interface MaterialValueInput {
  type: "value";
  value: number | number[] | boolean | null;
}

interface MaterialTextureInput {
  type: "texture";
  assetPath?: string;
  wrapS?: string;
  wrapT?: string;
}

type MaterialInput = MaterialValueInput | MaterialTextureInput;

interface UsdModule {
  registerPlugins(path: string): string;
  openStageFromBinary(bytes: Uint8Array, filename: string): number;
  closeStage(id: number): void;
  listPrims(id: number): PrimInfo[];
  getMeshData(id: number, primPath: string): MeshData | null;
  getWorldTransform(id: number, primPath: string, t: number): Float32Array | null;
  getMaterialBinding(id: number, primPath: string): string;
  getMaterialParams(id: number, matPath: string): Record<string, MaterialInput> | null;
  getAssetBytes(stageId: number, assetPath: string): Uint8Array | null;
}

interface ExpandedAttributes {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  triCount: number;
  triToFace: Uint32Array;
}

function post(response: OpenUsdWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer });
}

function report(update: OpenUsdWorkerResponse & { type: "progress" }): void {
  post(update);
}

function formatByteSize(byteLength: number): string {
  const mb = byteLength / (1024 * 1024);
  return mb >= 10 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

let pluginsRegistered = false;

async function getModule(): Promise<UsdModule> {
  const usd = (await loadOpenUSD()) as unknown as UsdModule;
  if (!pluginsRegistered) {
    usd.registerPlugins("/usd");
    pluginsRegistered = true;
  }
  return usd;
}

function cloneBytes(bytes: Uint8Array | null): Uint8Array | null {
  return bytes && bytes.byteLength > 0 ? new Uint8Array(bytes) : null;
}

function textureSlotForUsdInput(slot: string): keyof ParsedUsdMaterialData["textures"] | null {
  switch (slot) {
    case "diffuseColor":
      return "map";
    case "metallic":
      return "metalnessMap";
    case "roughness":
      return "roughnessMap";
    case "normal":
      return "normalMap";
    case "occlusion":
      return "aoMap";
    case "emissiveColor":
      return "emissiveMap";
    case "opacity":
      return "alphaMap";
    default:
      return null;
  }
}

function resolveMaterialData(
  usd: UsdModule,
  stageId: number,
  params: Record<string, MaterialInput> | null,
  textureCache: Map<string, ParsedUsdTextureData | null>,
): ParsedUsdMaterialData {
  const material: ParsedUsdMaterialData = { textures: {} };
  if (!params) {
    return material;
  }

  for (const [slot, input] of Object.entries(params)) {
    if (input.type === "value") {
      const value = input.value;
      switch (slot) {
        case "diffuseColor":
          if (Array.isArray(value) && value.length >= 3) material.color = [value[0], value[1], value[2]];
          break;
        case "emissiveColor":
          if (Array.isArray(value) && value.length >= 3) material.emissive = [value[0], value[1], value[2]];
          break;
        case "metallic":
          if (typeof value === "number") material.metalness = value;
          break;
        case "roughness":
          if (typeof value === "number") material.roughness = value;
          break;
        case "opacity":
          if (typeof value === "number") material.opacity = value;
          break;
        case "ior":
          if (typeof value === "number") material.ior = value;
          break;
        case "clearcoat":
          if (typeof value === "number") material.clearcoat = value;
          break;
        case "clearcoatRoughness":
          if (typeof value === "number") material.clearcoatRoughness = value;
          break;
        case "specularColor":
          if (Array.isArray(value) && value.length >= 3) material.specularColor = [value[0], value[1], value[2]];
          break;
      }
      continue;
    }

    if (!input.assetPath) {
      continue;
    }
    const textureSlot = textureSlotForUsdInput(slot);
    if (!textureSlot) {
      continue;
    }
    let texture = textureCache.get(input.assetPath);
    if (texture === undefined) {
      const bytes = cloneBytes(usd.getAssetBytes(stageId, input.assetPath));
      texture = bytes ? { bytes, wrapS: input.wrapS, wrapT: input.wrapT } : null;
      textureCache.set(input.assetPath, texture);
    }
    if (texture) {
      material.textures[textureSlot] = texture;
      if (textureSlot === "metalnessMap") material.metalness = 1;
      if (textureSlot === "roughnessMap") material.roughness = 1;
      if (textureSlot === "alphaMap") material.opacity = material.opacity ?? 1;
    }
  }

  return material;
}

function expandPerCorner(mesh: MeshData): ExpandedAttributes {
  const { points, normals, uvs, faceVertexCounts, faceVertexIndices, normalsInterpolation, uvsInterpolation } = mesh;
  let triCount = 0;
  for (let i = 0; i < faceVertexCounts.length; i++) triCount += Math.max(0, faceVertexCounts[i] - 2);

  const cornerCount = triCount * 3;
  const positions = new Float32Array(cornerCount * 3);
  const outNormals = normals.length > 0 ? new Float32Array(cornerCount * 3) : null;
  const outUvs = uvs.length > 0 ? new Float32Array(cornerCount * 2) : null;
  const triToFace = new Uint32Array(triCount);

  const writeNormal = (cornerIdx: number, fvCorner: number, vertexId: number, faceId: number) => {
    if (!outNormals) return;
    const dst = cornerIdx * 3;
    if (normalsInterpolation === "faceVarying") {
      outNormals[dst] = normals[fvCorner * 3];
      outNormals[dst + 1] = normals[fvCorner * 3 + 1];
      outNormals[dst + 2] = normals[fvCorner * 3 + 2];
    } else if (normalsInterpolation === "vertex" || normalsInterpolation === "varying") {
      outNormals[dst] = normals[vertexId * 3];
      outNormals[dst + 1] = normals[vertexId * 3 + 1];
      outNormals[dst + 2] = normals[vertexId * 3 + 2];
    } else if (normalsInterpolation === "uniform") {
      outNormals[dst] = normals[faceId * 3];
      outNormals[dst + 1] = normals[faceId * 3 + 1];
      outNormals[dst + 2] = normals[faceId * 3 + 2];
    } else if (normalsInterpolation === "constant") {
      outNormals[dst] = normals[0];
      outNormals[dst + 1] = normals[1];
      outNormals[dst + 2] = normals[2];
    }
  };

  const writeUv = (cornerIdx: number, fvCorner: number, vertexId: number, faceId: number) => {
    if (!outUvs) return;
    const dst = cornerIdx * 2;
    if (uvsInterpolation === "faceVarying") {
      outUvs[dst] = uvs[fvCorner * 2];
      outUvs[dst + 1] = uvs[fvCorner * 2 + 1];
    } else if (uvsInterpolation === "vertex" || uvsInterpolation === "varying") {
      outUvs[dst] = uvs[vertexId * 2];
      outUvs[dst + 1] = uvs[vertexId * 2 + 1];
    } else if (uvsInterpolation === "uniform") {
      outUvs[dst] = uvs[faceId * 2];
      outUvs[dst + 1] = uvs[faceId * 2 + 1];
    } else if (uvsInterpolation === "constant") {
      outUvs[dst] = uvs[0];
      outUvs[dst + 1] = uvs[1];
    }
  };

  let triCursor = 0;
  let fvCursor = 0;
  for (let f = 0; f < faceVertexCounts.length; f++) {
    const n = faceVertexCounts[f];
    for (let k = 1; k < n - 1; k++) {
      const c0 = fvCursor;
      const c1 = fvCursor + k;
      const c2 = fvCursor + k + 1;
      const v0 = faceVertexIndices[c0];
      const v1 = faceVertexIndices[c1];
      const v2 = faceVertexIndices[c2];
      const corner0 = triCursor * 3;

      positions[corner0 * 3] = points[v0 * 3];
      positions[corner0 * 3 + 1] = points[v0 * 3 + 1];
      positions[corner0 * 3 + 2] = points[v0 * 3 + 2];
      positions[corner0 * 3 + 3] = points[v1 * 3];
      positions[corner0 * 3 + 4] = points[v1 * 3 + 1];
      positions[corner0 * 3 + 5] = points[v1 * 3 + 2];
      positions[corner0 * 3 + 6] = points[v2 * 3];
      positions[corner0 * 3 + 7] = points[v2 * 3 + 1];
      positions[corner0 * 3 + 8] = points[v2 * 3 + 2];

      writeNormal(corner0, c0, v0, f);
      writeNormal(corner0 + 1, c1, v1, f);
      writeNormal(corner0 + 2, c2, v2, f);
      writeUv(corner0, c0, v0, f);
      writeUv(corner0 + 1, c1, v1, f);
      writeUv(corner0 + 2, c2, v2, f);

      triToFace[triCursor] = f;
      triCursor += 1;
    }
    fvCursor += n;
  }

  return { positions, normals: outNormals, uvs: outUvs, triCount, triToFace };
}

function createGeometryData(
  expanded: ExpandedAttributes,
  faceIndices: Int32Array | null,
): Pick<ParsedUsdMeshData, "positions" | "normals" | "uvs"> {
  const { positions, normals, uvs, triCount, triToFace } = expanded;
  if (!faceIndices) {
    return { positions, normals, uvs };
  }

  const allowed = new Set<number>(Array.from(faceIndices));
  let kept = 0;
  for (let t = 0; t < triCount; t++) if (allowed.has(triToFace[t])) kept += 1;

  const cornerCount = kept * 3;
  const subPos = new Float32Array(cornerCount * 3);
  const subNorm = normals ? new Float32Array(cornerCount * 3) : null;
  const subUv = uvs ? new Float32Array(cornerCount * 2) : null;
  let dst = 0;
  for (let t = 0; t < triCount; t++) {
    if (!allowed.has(triToFace[t])) continue;
    for (let j = 0; j < 3; j++) {
      const srcCorner = t * 3 + j;
      const dstCorner = dst * 3 + j;
      subPos[dstCorner * 3] = positions[srcCorner * 3];
      subPos[dstCorner * 3 + 1] = positions[srcCorner * 3 + 1];
      subPos[dstCorner * 3 + 2] = positions[srcCorner * 3 + 2];
      if (subNorm && normals) {
        subNorm[dstCorner * 3] = normals[srcCorner * 3];
        subNorm[dstCorner * 3 + 1] = normals[srcCorner * 3 + 1];
        subNorm[dstCorner * 3 + 2] = normals[srcCorner * 3 + 2];
      }
      if (subUv && uvs) {
        subUv[dstCorner * 2] = uvs[srcCorner * 2];
        subUv[dstCorner * 2 + 1] = uvs[srcCorner * 2 + 1];
      }
    }
    dst += 1;
  }

  return { positions: subPos, normals: subNorm, uvs: subUv };
}

function collectTransferables(model: ParsedUsdModelData): Transferable[] {
  // Textures and materials are cached and shared across meshes, so the same
  // ArrayBuffer can be referenced by multiple meshes. postMessage rejects a
  // transfer list that contains the same buffer twice — deduplicate here.
  const seen = new Set<ArrayBuffer>();
  const transfer: Transferable[] = [];
  const add = (buffer: ArrayBufferLike) => {
    if (buffer instanceof ArrayBuffer && !seen.has(buffer)) {
      seen.add(buffer);
      transfer.push(buffer);
    }
  };
  for (const mesh of model.meshes) {
    add(mesh.positions.buffer);
    if (mesh.normals) add(mesh.normals.buffer);
    if (mesh.uvs) add(mesh.uvs.buffer);
    for (const texture of Object.values(mesh.material.textures)) {
      if (texture) add(texture.bytes.buffer);
    }
  }
  return transfer;
}

async function parse(buffer: ArrayBuffer, filename: string): Promise<ParsedUsdModelData> {
  report({
    type: "progress",
    update: {
      label: "Loading OpenUSD worker",
      detail: `${filename} - ${formatByteSize(buffer.byteLength)}`,
      progress: null,
    },
  });
  const usd = await getModule();
  const stageId = usd.openStageFromBinary(new Uint8Array(buffer), filename);
  if (stageId < 0) throw new Error("OpenUSD: failed to open stage from binary");

  try {
    const prims = usd.listPrims(stageId);
    const meshPrims = prims.filter((prim) => prim.isMesh);
    const materialCache = new Map<string, ParsedUsdMaterialData>();
    const textureCache = new Map<string, ParsedUsdTextureData | null>();
    const meshes: ParsedUsdMeshData[] = [];

    for (let index = 0; index < meshPrims.length; index += 1) {
      const prim = meshPrims[index];
      report({
        type: "progress",
        update: {
          label: "Parsing USDZ in worker",
          detail: `${index + 1}/${meshPrims.length}: ${prim.path}`,
          progress: 0.1 + (index / Math.max(meshPrims.length, 1)) * 0.8,
        },
      });

      const meshData = usd.getMeshData(stageId, prim.path);
      if (!meshData || meshData.points.length === 0 || meshData.faceVertexIndices.length === 0) {
        continue;
      }

      const expanded = expandPerCorner(meshData);
      const matrix = usd.getWorldTransform(stageId, prim.path, NaN);
      const matrixArray = matrix && matrix.length === 16 ? Array.from(matrix) : null;

      if (meshData.subsets.length > 0) {
        for (const subset of meshData.subsets) {
          const geometry = createGeometryData(expanded, subset.indices);
          let material = subset.materialPath ? materialCache.get(subset.materialPath) : undefined;
          if (!material && subset.materialPath) {
            material = resolveMaterialData(usd, stageId, usd.getMaterialParams(stageId, subset.materialPath), textureCache);
            materialCache.set(subset.materialPath, material);
          }
          meshes.push({
            groupName: prim.path,
            name: `${prim.path}/${subset.name}`,
            matrix: matrixArray,
            ...geometry,
            material: material ?? { textures: {} },
          });
        }
      } else {
        const geometry = createGeometryData(expanded, null);
        const matPath = usd.getMaterialBinding(stageId, prim.path);
        let material = matPath ? materialCache.get(matPath) : undefined;
        if (!material && matPath) {
          material = resolveMaterialData(usd, stageId, usd.getMaterialParams(stageId, matPath), textureCache);
          materialCache.set(matPath, material);
        }
        meshes.push({
          groupName: prim.path,
          name: prim.path,
          matrix: matrixArray,
          ...geometry,
          material: material ?? { textures: {} },
        });
      }
    }

    return { name: filename, meshes };
  } finally {
    usd.closeStage(stageId);
    pluginsRegistered = false;
    releaseOpenUSD();
  }
}

self.addEventListener("message", (event: MessageEvent<OpenUsdWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "parse") return;

  void parse(request.buffer, request.filename)
    .then((model) => post({ type: "result", model }, collectTransferables(model)))
    .catch((error) => {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    });
});
