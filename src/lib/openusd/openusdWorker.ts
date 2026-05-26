import { loadOpenUSD, releaseOpenUSD } from "./loadOpenUsd";
import { buildUsdPrimAnimation, resolveUsdAnimationFps, usdTimeCodeToFrame, type UsdStageTimeInfo } from "./usdAnimation";
import type {
  OpenUsdWorkerRequest,
  OpenUsdWorkerResponse,
  ParsedUsdMaterialData,
  ParsedUsdModelData,
  ParsedUsdPrim,
  ParsedUsdSkeletalAnimation,
  ParsedUsdSkeleton,
  ParsedUsdSkinning,
  ParsedUsdSubsetData,
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

interface SkeletonRaw {
  joints: string[] | ArrayLike<string>;
  parentIndices: Int32Array | number[];
  restTransforms: Float32Array | number[];
  bindTransforms: Float32Array | number[];
}

interface SkinBindingRaw {
  skelPath: string;
  animationPath: string;
  jointIndices: Int32Array | number[];
  jointWeights: Float32Array | number[];
  numInfluencesPerComponent: number;
  geomBindTransform: Float32Array | number[];
  blendShapes: string[] | ArrayLike<string>;
  blendShapeTargets: string[] | ArrayLike<string>;
}

interface SkelAnimationRaw {
  joints: string[] | ArrayLike<string>;
  rotations: Float32Array | number[];
  translations: Float32Array | number[];
  scales: Float32Array | number[];
  blendShapes: string[] | ArrayLike<string>;
  blendShapeWeights: Float32Array | number[];
}

interface UsdModule {
  registerPlugins(path: string): string;
  openStageFromBinary(bytes: Uint8Array, filename: string): number;
  closeStage(id: number): void;
  listPrims(id: number): PrimInfo[];
  getMeshData(id: number, primPath: string): MeshData | null;
  getWorldTransform(id: number, primPath: string, t: number): Float32Array | null;
  getStageTimeInfo(id: number): UsdStageTimeInfo | null;
  getTimeSamples(id: number, attrPath: string): number[] | ArrayLike<number> | null;
  getTimeSampledAttributes(id: number, primPath: string): string[] | ArrayLike<string> | null;
  getVisibility(id: number, primPath: string, t: number): string;
  getMaterialBinding(id: number, primPath: string): string;
  getMaterialParams(id: number, matPath: string): Record<string, MaterialInput> | null;
  getAssetBytes(stageId: number, assetPath: string): Uint8Array | null;
  getSkeleton?: (id: number, skelPath: string) => SkeletonRaw | null;
  getSkinBinding?: (id: number, meshPath: string) => SkinBindingRaw | null;
  getSkelAnimation?: (id: number, animPath: string, t: number) => SkelAnimationRaw | null;
}

interface ExpandedAttributes {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  skinIndex: Uint16Array | null;
  skinWeight: Float32Array | null;
  triCount: number;
  triToFace: Uint32Array;
}

// Three.js SkinnedMesh requires exactly 4 influences per vertex; pad or
// truncate when USD authored more or fewer.
const THREE_INFLUENCES = 4;

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

function expandPerCorner(
  mesh: MeshData,
  skinBinding?: { jointIndices: ArrayLike<number>; jointWeights: ArrayLike<number>; numInfluencesPerComponent: number },
): ExpandedAttributes {
  const { points, normals, uvs, faceVertexCounts, faceVertexIndices, normalsInterpolation, uvsInterpolation } = mesh;
  let triCount = 0;
  for (let i = 0; i < faceVertexCounts.length; i++) triCount += Math.max(0, faceVertexCounts[i] - 2);

  const cornerCount = triCount * 3;
  const positions = new Float32Array(cornerCount * 3);
  const outNormals = normals.length > 0 ? new Float32Array(cornerCount * 3) : null;
  const outUvs = uvs.length > 0 ? new Float32Array(cornerCount * 2) : null;
  const triToFace = new Uint32Array(triCount);
  const outSkinIndex = skinBinding ? new Uint16Array(cornerCount * THREE_INFLUENCES) : null;
  const outSkinWeight = skinBinding ? new Float32Array(cornerCount * THREE_INFLUENCES) : null;
  const usdInfluences = skinBinding?.numInfluencesPerComponent ?? 0;

  const writeSkin = (cornerIdx: number, vertexId: number) => {
    if (!outSkinIndex || !outSkinWeight || !skinBinding) return;
    const dst = cornerIdx * THREE_INFLUENCES;
    const src = vertexId * usdInfluences;
    // Three.js wants exactly 4 influences. When USD authored more (the
    // seahorse uses 11), picking the FIRST 4 would often skip the strongest
    // bones; instead, do a small top-K by weight so the dominant deformers
    // survive. For usdInfluences <= 4 the loop is essentially a copy + pad.
    const take = Math.min(usdInfluences, THREE_INFLUENCES);
    if (usdInfluences <= THREE_INFLUENCES) {
      for (let i = 0; i < take; i++) {
        outSkinIndex[dst + i] = skinBinding.jointIndices[src + i] ?? 0;
        outSkinWeight[dst + i] = skinBinding.jointWeights[src + i] ?? 0;
      }
    } else {
      // O(N) top-4 by weight — N rarely exceeds ~12, no need for a heap.
      let totalWeight = 0;
      const picked: Array<{ idx: number; weight: number }> = [];
      for (let i = 0; i < usdInfluences; i++) {
        const weight = skinBinding.jointWeights[src + i] ?? 0;
        if (weight <= 0) continue;
        if (picked.length < THREE_INFLUENCES) {
          picked.push({ idx: skinBinding.jointIndices[src + i] ?? 0, weight });
        } else {
          let minPos = 0;
          for (let p = 1; p < picked.length; p++) if (picked[p].weight < picked[minPos].weight) minPos = p;
          if (weight > picked[minPos].weight) {
            picked[minPos] = { idx: skinBinding.jointIndices[src + i] ?? 0, weight };
          }
        }
      }
      for (const p of picked) totalWeight += p.weight;
      // Renormalize so the kept-4 weights sum to whatever the original sum
      // was (Three.js auto-normalizes per vertex anyway, but this preserves
      // relative contributions when we dropped influences).
      const scale = totalWeight > 0 ? 1 / totalWeight : 0;
      for (let i = 0; i < THREE_INFLUENCES; i++) {
        const entry = picked[i];
        if (entry) {
          outSkinIndex[dst + i] = entry.idx;
          outSkinWeight[dst + i] = entry.weight * scale;
        } else {
          outSkinIndex[dst + i] = 0;
          outSkinWeight[dst + i] = 0;
        }
      }
      return;
    }
    for (let i = take; i < THREE_INFLUENCES; i++) {
      outSkinIndex[dst + i] = 0;
      outSkinWeight[dst + i] = 0;
    }
  };

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
      writeSkin(corner0, v0);
      writeSkin(corner0 + 1, v1);
      writeSkin(corner0 + 2, v2);

      triToFace[triCursor] = f;
      triCursor += 1;
    }
    fvCursor += n;
  }

  return { positions, normals: outNormals, uvs: outUvs, skinIndex: outSkinIndex, skinWeight: outSkinWeight, triCount, triToFace };
}

function createGeometryData(
  expanded: ExpandedAttributes,
  faceIndices: Int32Array | null,
): Pick<ParsedUsdSubsetData, "positions" | "normals" | "uvs" | "skinIndex" | "skinWeight"> {
  const { positions, normals, uvs, skinIndex, skinWeight, triCount, triToFace } = expanded;
  if (!faceIndices) {
    return { positions, normals, uvs, skinIndex, skinWeight };
  }

  const allowed = new Set<number>(Array.from(faceIndices));
  let kept = 0;
  for (let t = 0; t < triCount; t++) if (allowed.has(triToFace[t])) kept += 1;

  const cornerCount = kept * 3;
  const subPos = new Float32Array(cornerCount * 3);
  const subNorm = normals ? new Float32Array(cornerCount * 3) : null;
  const subUv = uvs ? new Float32Array(cornerCount * 2) : null;
  const subSkinIndex = skinIndex ? new Uint16Array(cornerCount * THREE_INFLUENCES) : null;
  const subSkinWeight = skinWeight ? new Float32Array(cornerCount * THREE_INFLUENCES) : null;
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
      if (subSkinIndex && skinIndex && subSkinWeight && skinWeight) {
        for (let i = 0; i < THREE_INFLUENCES; i++) {
          subSkinIndex[dstCorner * THREE_INFLUENCES + i] = skinIndex[srcCorner * THREE_INFLUENCES + i];
          subSkinWeight[dstCorner * THREE_INFLUENCES + i] = skinWeight[srcCorner * THREE_INFLUENCES + i];
        }
      }
    }
    dst += 1;
  }

  return { positions: subPos, normals: subNorm, uvs: subUv, skinIndex: subSkinIndex, skinWeight: subSkinWeight };
}

function collectTransferables(model: ParsedUsdModelData): Transferable[] {
  // Textures and material data are cached and shared across prims/subsets, so
  // the same ArrayBuffer can be referenced by multiple subsets/materials.
  // postMessage rejects a transfer list that contains the same buffer twice —
  // deduplicate here.
  const seen = new Set<ArrayBuffer>();
  const transfer: Transferable[] = [];
  const add = (buffer: ArrayBufferLike) => {
    if (buffer instanceof ArrayBuffer && !seen.has(buffer)) {
      seen.add(buffer);
      transfer.push(buffer);
    }
  };
  for (const prim of model.prims) {
    for (const subset of prim.subsets) {
      add(subset.positions.buffer);
      if (subset.normals) add(subset.normals.buffer);
      if (subset.uvs) add(subset.uvs.buffer);
      if (subset.skinIndex) add(subset.skinIndex.buffer);
      if (subset.skinWeight) add(subset.skinWeight.buffer);
    }
    if (prim.skinning) {
      add(prim.skinning.geomBindTransform.buffer);
    }
  }
  for (const material of Object.values(model.materials)) {
    for (const texture of Object.values(material.textures)) {
      if (texture) add(texture.bytes.buffer);
    }
  }
  for (const skeleton of Object.values(model.skeletons)) {
    add(skeleton.parentIndices.buffer);
    add(skeleton.restMatrices.buffer);
    add(skeleton.bindMatrices.buffer);
  }
  for (const animation of Object.values(model.skeletalAnimations)) {
    for (const frame of animation.frames) {
      add(frame.translations.buffer);
      add(frame.rotations.buffer);
      add(frame.scales.buffer);
    }
  }
  return transfer;
}

function toStringArray(raw: ArrayLike<string> | string[]): string[] {
  return Array.from(raw).filter((value): value is string => typeof value === "string");
}

function toFloat32Array(raw: ArrayLike<number> | Float32Array | number[]): Float32Array {
  if (raw instanceof Float32Array) return new Float32Array(raw);
  return new Float32Array(Array.from(raw));
}

function toInt32Array(raw: ArrayLike<number> | Int32Array | number[]): Int32Array {
  if (raw instanceof Int32Array) return new Int32Array(raw);
  return new Int32Array(Array.from(raw));
}

function buildSkeletonFromRaw(raw: SkeletonRaw): ParsedUsdSkeleton {
  return {
    joints: toStringArray(raw.joints),
    parentIndices: toInt32Array(raw.parentIndices),
    restMatrices: toFloat32Array(raw.restTransforms),
    bindMatrices: toFloat32Array(raw.bindTransforms),
  };
}

function bakeSkeletalAnimation(
  usd: UsdModule,
  stageId: number,
  animationPath: string,
  stageTimeInfo: UsdStageTimeInfo | null,
): ParsedUsdSkeletalAnimation | null {
  if (!usd.getSkelAnimation) return null;
  const fps = resolveUsdAnimationFps(stageTimeInfo);
  const startTime = stageTimeInfo?.startTime ?? 0;
  const endTime = stageTimeInfo?.endTime ?? startTime;
  const tcps = stageTimeInfo?.timeCodesPerSecond ?? fps;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return null;
  }

  // Sample every authored frame between startTime and endTime in time-code
  // units (frames = timeCode delta * fps / tcps). For Apple-style stages
  // where tcps == fps this gives one sample per integer time code.
  const frames: ParsedUsdSkeletalAnimation["frames"] = [];
  let jointsOrder: string[] = [];
  const step = tcps / fps;
  for (let t = startTime; t <= endTime + 1e-6; t += step) {
    const sample = usd.getSkelAnimation(stageId, animationPath, t);
    if (!sample) continue;
    if (jointsOrder.length === 0) {
      jointsOrder = toStringArray(sample.joints);
    }
    frames.push({
      frame: usdTimeCodeToFrame(t, stageTimeInfo),
      translations: toFloat32Array(sample.translations),
      rotations: toFloat32Array(sample.rotations),
      scales: toFloat32Array(sample.scales),
    });
  }

  if (frames.length === 0) return null;

  const durationFrames = Math.max(1, frames[frames.length - 1]?.frame ?? 0);
  return { fps, durationFrames, jointsOrder, frames };
}

const NON_HIERARCHY_TYPES = new Set([
  "Material",
  "Shader",
  "NodeGraph",
  "GeomSubset",
  "Camera",
]);

function depthOfPath(path: string): number {
  return path.match(/\//g)?.length ?? 0;
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
    const stageTimeInfo = usd.getStageTimeInfo(stageId);
    const primsByPath = new Map<string, PrimInfo>();
    for (const prim of prims) primsByPath.set(prim.path, prim);

    // Filter the same way parseUsdzDirect does: keep Mesh + Xformable prims,
    // drop Material/Shader/NodeGraph/GeomSubset/Camera. Sort parent-before-
    // child so the main-thread reconstructor can resolve `parent` references
    // against an already-built map.
    const isKept = (prim: PrimInfo): boolean => {
      if (NON_HIERARCHY_TYPES.has(prim.type)) return false;
      return prim.isMesh || prim.isXformable;
    };
    const kept = prims.filter(isKept);
    kept.sort((a, b) => depthOfPath(a.path) - depthOfPath(b.path) || a.path.localeCompare(b.path));
    const keptPaths = new Set(kept.map((p) => p.path));

    const materialCache = new Map<string, ParsedUsdMaterialData>();
    const textureCache = new Map<string, ParsedUsdTextureData | null>();
    const skeletonCache = new Map<string, ParsedUsdSkeleton>();
    const animationCache = new Map<string, ParsedUsdSkeletalAnimation | null>();
    const meshPrims = kept.filter((prim) => prim.isMesh);
    const outPrims: ParsedUsdPrim[] = [];
    let meshIndex = 0;

    const ensureMaterial = (matPath: string): ParsedUsdMaterialData => {
      let cached = materialCache.get(matPath);
      if (!cached) {
        cached = resolveMaterialData(usd, stageId, usd.getMaterialParams(stageId, matPath), textureCache);
        materialCache.set(matPath, cached);
      }
      return cached;
    };

    const ensureSkeleton = (skelPath: string): void => {
      if (!skelPath || skeletonCache.has(skelPath) || !usd.getSkeleton) return;
      const raw = usd.getSkeleton(stageId, skelPath);
      if (raw) skeletonCache.set(skelPath, buildSkeletonFromRaw(raw));
    };

    const ensureSkelAnimation = (animPath: string): void => {
      if (!animPath || animationCache.has(animPath)) return;
      animationCache.set(animPath, bakeSkeletalAnimation(usd, stageId, animPath, stageTimeInfo));
    };

    for (const prim of kept) {
      // Walk up to find the nearest already-kept ancestor; that becomes the
      // reconstructor's parent reference. "" means "parents directly to the
      // model root" — used by the reconstructor to attach to the Group.
      let parentPath = "";
      let cursor = prim.parent;
      while (cursor && cursor !== "/" && cursor !== "") {
        if (keptPaths.has(cursor)) {
          parentPath = cursor;
          break;
        }
        const parentPrim = primsByPath.get(cursor);
        if (!parentPrim) break;
        cursor = parentPrim.parent;
      }

      const worldMatrix = usd.getWorldTransform(stageId, prim.path, NaN);
      const worldMatrixArray = worldMatrix && worldMatrix.length === 16 ? Array.from(worldMatrix) : null;
      const animation = buildUsdPrimAnimation({
        sampler: usd,
        stageId,
        primPath: prim.path,
        parentPath,
        stageTimeInfo,
      });

      const subsetsOut: ParsedUsdSubsetData[] = [];
      let primaryMaterialPath: string | undefined;
      let skinningOut: ParsedUsdSkinning | undefined;

      if (prim.isMesh) {
        report({
          type: "progress",
          update: {
            label: "Parsing USDZ in worker",
            detail: `${meshIndex + 1}/${meshPrims.length}: ${prim.path}`,
            progress: 0.1 + (meshIndex / Math.max(meshPrims.length, 1)) * 0.8,
          },
        });
        const meshData = usd.getMeshData(stageId, prim.path);
        const skinRaw = usd.getSkinBinding?.(stageId, prim.path) ?? null;
        const skinBinding = skinRaw
          ? {
              jointIndices: Array.from(skinRaw.jointIndices),
              jointWeights: Array.from(skinRaw.jointWeights),
              numInfluencesPerComponent: skinRaw.numInfluencesPerComponent || THREE_INFLUENCES,
            }
          : undefined;

        if (meshData && meshData.points.length > 0 && meshData.faceVertexIndices.length > 0) {
          const expanded = expandPerCorner(meshData, skinBinding);
          if (meshData.subsets.length > 0) {
            for (const subset of meshData.subsets) {
              const geometry = createGeometryData(expanded, subset.indices);
              if (subset.materialPath) {
                ensureMaterial(subset.materialPath);
                if (!primaryMaterialPath) primaryMaterialPath = subset.materialPath;
              }
              subsetsOut.push({
                name: subset.name,
                materialPath: subset.materialPath || undefined,
                ...geometry,
              });
            }
          } else {
            const geometry = createGeometryData(expanded, null);
            const matPath = usd.getMaterialBinding(stageId, prim.path);
            if (matPath) {
              ensureMaterial(matPath);
              primaryMaterialPath = matPath;
            }
            // Fall back to the prim's leaf name so the reconstructor has
            // something to put on the Mesh's .name field.
            const slashIndex = prim.path.lastIndexOf("/");
            const leaf = slashIndex >= 0 ? prim.path.slice(slashIndex + 1) : prim.path;
            subsetsOut.push({
              name: leaf || prim.path,
              materialPath: matPath || undefined,
              ...geometry,
            });
          }
        }

        if (skinRaw && skinRaw.skelPath) {
          ensureSkeleton(skinRaw.skelPath);
          if (skinRaw.animationPath) {
            ensureSkelAnimation(skinRaw.animationPath);
          }
          skinningOut = {
            skeletonPath: skinRaw.skelPath,
            animationPath: skinRaw.animationPath ?? "",
            geomBindTransform: toFloat32Array(skinRaw.geomBindTransform),
            numInfluencesPerComponent: skinRaw.numInfluencesPerComponent || THREE_INFLUENCES,
          };
        }
        meshIndex += 1;
      }

      outPrims.push({
        path: prim.path,
        parent: parentPath,
        kind: prim.isMesh ? "mesh" : "xform",
        worldMatrix: worldMatrixArray,
        primaryMaterialPath,
        ...(animation ? { animation } : {}),
        ...(skinningOut ? { skinning: skinningOut } : {}),
        subsets: subsetsOut,
      });
    }

    const materials: Record<string, ParsedUsdMaterialData> = {};
    for (const [path, data] of materialCache) {
      materials[path] = data;
    }

    const skeletons: Record<string, ParsedUsdSkeleton> = {};
    for (const [path, data] of skeletonCache) {
      skeletons[path] = data;
    }

    const skeletalAnimations: Record<string, ParsedUsdSkeletalAnimation> = {};
    for (const [path, data] of animationCache) {
      if (data) skeletalAnimations[path] = data;
    }

    return { name: filename, prims: outPrims, materials, skeletons, skeletalAnimations };
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
