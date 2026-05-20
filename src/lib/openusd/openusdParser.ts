import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three";

import { loadOpenUSD, releaseOpenUSD } from "./loadOpenUsd";
import type {
  OpenUsdWorkerRequest,
  OpenUsdWorkerResponse,
  ParsedUsdMaterialData,
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
  shaderPath: string;
  assetPath?: string;
  resolvedPath?: string;
  uvSet?: string;
  wrapS?: string;
  wrapT?: string;
  sourceName: string;
}

type MaterialInput = MaterialValueInput | MaterialTextureInput;

export interface ParseUsdzProgressUpdate {
  label?: string;
  progress?: number | null;
  detail?: string;
}

export type ParseUsdzProgressHandler = (update: ParseUsdzProgressUpdate) => void;

interface UsdModule {
  registerPlugins(path: string): string;
  openStageFromBinary(bytes: Uint8Array, filename: string): number;
  closeStage(id: number): void;
  hasStage(id: number): boolean;
  listPrims(id: number): PrimInfo[];
  getMeshData(id: number, primPath: string): MeshData | null;
  getLocalTransform(id: number, primPath: string): Float32Array | null;
  getWorldTransform(id: number, primPath: string, t: number): Float32Array | null;
  getMaterialBinding(id: number, primPath: string): string;
  getMaterialParams(id: number, matPath: string): Record<string, MaterialInput> | null;
  getAssetBytes(stageId: number, assetPath: string): Uint8Array | null;
}

let pluginsRegistered = false;

function formatByteSize(byteLength: number): string {
  const mb = byteLength / (1024 * 1024);
  return mb >= 10 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function shouldYield(startedAt: number, budgetMs = 16): boolean {
  return performance.now() - startedAt >= budgetMs;
}

async function getModule(): Promise<UsdModule> {
  const usd = (await loadOpenUSD()) as unknown as UsdModule;
  if (!pluginsRegistered) {
    usd.registerPlugins("/usd");
    pluginsRegistered = true;
  }
  return usd;
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  }
  return "image/png";
}

async function bytesToTexture(bytes: Uint8Array): Promise<Texture | null> {
  try {
    const blob = new Blob([bytes as BlobPart], { type: sniffImageMime(bytes) });
    // imageOrientation: "flipY" makes createImageBitmap return a bitmap with
    // origin at bottom-left, matching Three.js UV convention. We can't rely on
    // Texture.flipY for ImageBitmap sources (Three.js ignores it for those).
    const bitmap = await createImageBitmap(blob, { imageOrientation: "flipY" });
    const tex = new Texture(bitmap as unknown as HTMLImageElement);
    // The bitmap is already flipped at decode time. Three.js ignores
    // Texture.flipY for ImageBitmap during render, but GLTFExporter honors it
    // when baking images to canvas. Keep it false to avoid a second flip in
    // exported GLB/GLTF/USDZ files.
    tex.flipY = false;
    tex.needsUpdate = true;
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    // texture.dispose() releases the WebGL handle but does NOT release the
    // ImageBitmap — the decoded GPU image stays alive until close() is called.
    // Across many imports this is the root of the renderer OOM crash.
    tex.addEventListener("dispose", () => {
      bitmap.close();
    });
    return tex;
  } catch (err) {
    console.warn("openusd: failed to decode texture bytes:", err);
    return null;
  }
}

function applyWrapMode(tex: Texture, wrap?: string): void {
  if (wrap === "clamp") {
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
  }
}

async function textureDataToTexture(textureData: ParsedUsdTextureData): Promise<Texture | null> {
  const texture = await bytesToTexture(textureData.bytes);
  if (!texture) {
    return null;
  }
  if (textureData.wrapS === "clamp" || textureData.wrapT === "clamp") {
    applyWrapMode(texture, "clamp");
  }
  return texture;
}

async function materialDataToMaterial(data: ParsedUsdMaterialData): Promise<MeshPhysicalMaterial> {
  const material = new MeshPhysicalMaterial({ side: DoubleSide });
  if (data.color) material.color = new Color(data.color[0], data.color[1], data.color[2]);
  if (data.emissive) material.emissive = new Color(data.emissive[0], data.emissive[1], data.emissive[2]);
  if (typeof data.metalness === "number") material.metalness = data.metalness;
  if (typeof data.roughness === "number") material.roughness = data.roughness;
  if (typeof data.opacity === "number") {
    material.opacity = data.opacity;
    material.transparent = data.opacity < 1;
  }
  if (typeof data.ior === "number") material.ior = data.ior;
  if (typeof data.clearcoat === "number") material.clearcoat = data.clearcoat;
  if (typeof data.clearcoatRoughness === "number") material.clearcoatRoughness = data.clearcoatRoughness;
  if (data.specularColor) material.specularColor = new Color(data.specularColor[0], data.specularColor[1], data.specularColor[2]);

  const entries = Object.entries(data.textures) as Array<[keyof ParsedUsdMaterialData["textures"], ParsedUsdTextureData | undefined]>;
  await Promise.all(entries.map(async ([slot, textureData]) => {
    if (!textureData) return;
    const texture = await textureDataToTexture(textureData);
    if (!texture) return;
    switch (slot) {
      case "map":
        texture.colorSpace = SRGBColorSpace;
        material.map = texture;
        break;
      case "metalnessMap":
        material.metalnessMap = texture;
        material.metalness = 1;
        break;
      case "roughnessMap":
        material.roughnessMap = texture;
        material.roughness = 1;
        break;
      case "normalMap":
        material.normalMap = texture;
        break;
      case "aoMap":
        material.aoMap = texture;
        break;
      case "emissiveMap":
        texture.colorSpace = SRGBColorSpace;
        material.emissiveMap = texture;
        if (material.emissive.r === 0 && material.emissive.g === 0 && material.emissive.b === 0) {
          material.emissive = new Color(1, 1, 1);
        }
        break;
      case "alphaMap":
        material.alphaMap = texture;
        material.transparent = true;
        break;
    }
  }));

  return material;
}

async function loadAssetTexture(
  usd: UsdModule,
  stageId: number,
  assetPath: string,
  textureCache: Map<string, Promise<Texture | null>>,
): Promise<Texture | null> {
  let p = textureCache.get(assetPath);
  if (!p) {
    p = (async () => {
      const bytes = usd.getAssetBytes(stageId, assetPath);
      if (!bytes || bytes.byteLength === 0) return null;
      return await bytesToTexture(bytes);
    })();
    textureCache.set(assetPath, p);
  }
  return p;
}

async function applyMaterialParams(
  usd: UsdModule,
  stageId: number,
  params: Record<string, MaterialInput>,
  mat: MeshPhysicalMaterial,
  textureCache: Map<string, Promise<Texture | null>>,
): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const [slot, input] of Object.entries(params)) {
    if (input.type === "value") {
      const v = input.value;
      switch (slot) {
        case "diffuseColor":
          if (Array.isArray(v) && v.length >= 3) mat.color = new Color(v[0], v[1], v[2]);
          break;
        case "emissiveColor":
          if (Array.isArray(v) && v.length >= 3) mat.emissive = new Color(v[0], v[1], v[2]);
          break;
        case "metallic":
          if (typeof v === "number") mat.metalness = v;
          break;
        case "roughness":
          if (typeof v === "number") mat.roughness = v;
          break;
        case "opacity":
          if (typeof v === "number") {
            mat.opacity = v;
            mat.transparent = v < 1;
          }
          break;
        case "ior":
          if (typeof v === "number") mat.ior = v;
          break;
        case "clearcoat":
          if (typeof v === "number") mat.clearcoat = v;
          break;
        case "clearcoatRoughness":
          if (typeof v === "number") mat.clearcoatRoughness = v;
          break;
        case "specularColor":
          if (Array.isArray(v) && v.length >= 3) mat.specularColor = new Color(v[0], v[1], v[2]);
          break;
      }
    } else if (input.type === "texture" && input.assetPath) {
      const assetPath = input.assetPath;
      const wrapS = input.wrapS;
      const wrapT = input.wrapT;
      promises.push(
        loadAssetTexture(usd, stageId, assetPath, textureCache).then((tex) => {
          if (!tex) return;
          if (wrapS === "clamp" || wrapT === "clamp") applyWrapMode(tex, "clamp");
          switch (slot) {
            case "diffuseColor":
              tex.colorSpace = SRGBColorSpace;
              mat.map = tex;
              break;
            case "metallic":
              mat.metalnessMap = tex;
              // UsdPreviewSurface drives metalness via the texture, but Three.js
              // also multiplies by the scalar metalness — ensure it's 1.
              mat.metalness = 1;
              break;
            case "roughness":
              mat.roughnessMap = tex;
              mat.roughness = 1;
              break;
            case "normal":
              mat.normalMap = tex;
              break;
            case "occlusion":
              mat.aoMap = tex;
              break;
            case "emissiveColor":
              tex.colorSpace = SRGBColorSpace;
              mat.emissiveMap = tex;
              if (mat.emissive.r === 0 && mat.emissive.g === 0 && mat.emissive.b === 0) {
                mat.emissive = new Color(1, 1, 1);
              }
              break;
            case "opacity":
              mat.alphaMap = tex;
              mat.transparent = true;
              break;
          }
        }),
      );
    }
  }

  await Promise.allSettled(promises);
}

interface ExpandedAttributes {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  triCount: number;
  triToFace: Uint32Array;
}

async function expandPerCorner(
  mesh: MeshData,
  onYield?: (processedFaces: number, totalFaces: number) => void,
): Promise<ExpandedAttributes> {
  const { points, normals, uvs, faceVertexCounts, faceVertexIndices, normalsInterpolation, uvsInterpolation } = mesh;

  let triCount = 0;
  for (let i = 0; i < faceVertexCounts.length; i++) triCount += Math.max(0, faceVertexCounts[i] - 2);

  const cornerCount = triCount * 3;
  const positions = new Float32Array(cornerCount * 3);
  const expandNormals = normals.length > 0;
  const expandUvs = uvs.length > 0;
  const outNormals = expandNormals ? new Float32Array(cornerCount * 3) : null;
  const outUvs = expandUvs ? new Float32Array(cornerCount * 2) : null;
  const triToFace = new Uint32Array(triCount);

  const writeNormal = (cornerIdx: number, fvCorner: number, vertexId: number, faceId: number) => {
    if (!outNormals) return;
    const dst = cornerIdx * 3;
    if (normalsInterpolation === "faceVarying") {
      outNormals[dst + 0] = normals[fvCorner * 3 + 0];
      outNormals[dst + 1] = normals[fvCorner * 3 + 1];
      outNormals[dst + 2] = normals[fvCorner * 3 + 2];
    } else if (normalsInterpolation === "vertex" || normalsInterpolation === "varying") {
      outNormals[dst + 0] = normals[vertexId * 3 + 0];
      outNormals[dst + 1] = normals[vertexId * 3 + 1];
      outNormals[dst + 2] = normals[vertexId * 3 + 2];
    } else if (normalsInterpolation === "uniform") {
      outNormals[dst + 0] = normals[faceId * 3 + 0];
      outNormals[dst + 1] = normals[faceId * 3 + 1];
      outNormals[dst + 2] = normals[faceId * 3 + 2];
    } else if (normalsInterpolation === "constant") {
      outNormals[dst + 0] = normals[0];
      outNormals[dst + 1] = normals[1];
      outNormals[dst + 2] = normals[2];
    }
  };

  const writeUv = (cornerIdx: number, fvCorner: number, vertexId: number, faceId: number) => {
    if (!outUvs) return;
    const dst = cornerIdx * 2;
    if (uvsInterpolation === "faceVarying") {
      outUvs[dst + 0] = uvs[fvCorner * 2 + 0];
      outUvs[dst + 1] = uvs[fvCorner * 2 + 1];
    } else if (uvsInterpolation === "vertex" || uvsInterpolation === "varying") {
      outUvs[dst + 0] = uvs[vertexId * 2 + 0];
      outUvs[dst + 1] = uvs[vertexId * 2 + 1];
    } else if (uvsInterpolation === "uniform") {
      outUvs[dst + 0] = uvs[faceId * 2 + 0];
      outUvs[dst + 1] = uvs[faceId * 2 + 1];
    } else if (uvsInterpolation === "constant") {
      outUvs[dst + 0] = uvs[0];
      outUvs[dst + 1] = uvs[1];
    }
  };

  let triCursor = 0;
  let fvCursor = 0;
  let yieldStartedAt = performance.now();
  for (let f = 0; f < faceVertexCounts.length; f++) {
    const n = faceVertexCounts[f];
    for (let k = 1; k < n - 1; k++) {
      const c0 = fvCursor + 0;
      const c1 = fvCursor + k;
      const c2 = fvCursor + k + 1;
      const v0 = faceVertexIndices[c0];
      const v1 = faceVertexIndices[c1];
      const v2 = faceVertexIndices[c2];
      const corner0 = triCursor * 3;

      positions[corner0 * 3 + 0] = points[v0 * 3 + 0];
      positions[corner0 * 3 + 1] = points[v0 * 3 + 1];
      positions[corner0 * 3 + 2] = points[v0 * 3 + 2];
      positions[corner0 * 3 + 3] = points[v1 * 3 + 0];
      positions[corner0 * 3 + 4] = points[v1 * 3 + 1];
      positions[corner0 * 3 + 5] = points[v1 * 3 + 2];
      positions[corner0 * 3 + 6] = points[v2 * 3 + 0];
      positions[corner0 * 3 + 7] = points[v2 * 3 + 1];
      positions[corner0 * 3 + 8] = points[v2 * 3 + 2];

      writeNormal(corner0 + 0, c0, v0, f);
      writeNormal(corner0 + 1, c1, v1, f);
      writeNormal(corner0 + 2, c2, v2, f);

      writeUv(corner0 + 0, c0, v0, f);
      writeUv(corner0 + 1, c1, v1, f);
      writeUv(corner0 + 2, c2, v2, f);

      triToFace[triCursor] = f;
      triCursor++;
    }
    fvCursor += n;

    if (f % 250 === 0 && shouldYield(yieldStartedAt)) {
      onYield?.(f + 1, faceVertexCounts.length);
      await waitForPaint();
      yieldStartedAt = performance.now();
    }
  }

  return { positions, normals: outNormals, uvs: outUvs, triCount, triToFace };
}

async function buildSubsetGeometry(
  expanded: ExpandedAttributes,
  faceIndices: Int32Array | null,
  onYield?: (processedTriangles: number, totalTriangles: number) => void,
): Promise<BufferGeometry> {
  const geometry = new BufferGeometry();
  const { positions, normals, uvs, triCount, triToFace } = expanded;

  if (!faceIndices) {
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    if (normals) geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    if (uvs) geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    if (uvs) geometry.setAttribute("uv1", new BufferAttribute(uvs, 2));
    if (!normals) geometry.computeVertexNormals();
    return geometry;
  }

  // Build per-subset by selecting only triangles whose source face is in the subset.
  const allowed = new Set<number>(Array.from(faceIndices));
  let kept = 0;
  for (let t = 0; t < triCount; t++) if (allowed.has(triToFace[t])) kept++;

  const cornerCount = kept * 3;
  const subPos = new Float32Array(cornerCount * 3);
  const subNorm = normals ? new Float32Array(cornerCount * 3) : null;
  const subUv = uvs ? new Float32Array(cornerCount * 2) : null;
  let dst = 0;
  let yieldStartedAt = performance.now();
  for (let t = 0; t < triCount; t++) {
    if (!allowed.has(triToFace[t])) continue;
    for (let j = 0; j < 3; j++) {
      const srcCorner = t * 3 + j;
      const dstCorner = dst * 3 + j;
      subPos[dstCorner * 3 + 0] = positions[srcCorner * 3 + 0];
      subPos[dstCorner * 3 + 1] = positions[srcCorner * 3 + 1];
      subPos[dstCorner * 3 + 2] = positions[srcCorner * 3 + 2];
      if (subNorm && normals) {
        subNorm[dstCorner * 3 + 0] = normals[srcCorner * 3 + 0];
        subNorm[dstCorner * 3 + 1] = normals[srcCorner * 3 + 1];
        subNorm[dstCorner * 3 + 2] = normals[srcCorner * 3 + 2];
      }
      if (subUv && uvs) {
        subUv[dstCorner * 2 + 0] = uvs[srcCorner * 2 + 0];
        subUv[dstCorner * 2 + 1] = uvs[srcCorner * 2 + 1];
      }
    }
    dst++;

    if (t % 2000 === 0 && shouldYield(yieldStartedAt)) {
      onYield?.(t + 1, triCount);
      await waitForPaint();
      yieldStartedAt = performance.now();
    }
  }
  geometry.setAttribute("position", new BufferAttribute(subPos, 3));
  if (subNorm) geometry.setAttribute("normal", new BufferAttribute(subNorm, 3));
  if (subUv) {
    geometry.setAttribute("uv", new BufferAttribute(subUv, 2));
    geometry.setAttribute("uv1", new BufferAttribute(subUv, 2));
  }
  if (!subNorm) geometry.computeVertexNormals();
  return geometry;
}

/**
 * Parse a USDZ (or USDC) buffer using OpenUSD WASM and return a Three.js Group.
 *
 * Pipeline:
 *   1. Open stage from binary buffer (OpenUSD handles USDZ unzip + USDC parse internally).
 *   2. Walk all prims; for each Mesh, extract geometry + bound material.
 *   3. For each material, extract UsdPreviewSurface params + texture references.
 *   4. For each texture, fetch raw bytes via ArResolver (handles USDZ archive paths).
 *   5. Apply world transforms so the scene graph matches authored layout.
 */
export async function parseUsdz(
  buffer: ArrayBuffer,
  filename = "asset.usdz",
  onProgress?: ParseUsdzProgressHandler,
): Promise<Group> {
  if (typeof Worker !== "undefined") {
    const model = await parseUsdzInWorker(buffer, filename, onProgress);
    return await buildGroupFromWorkerModel(model);
  }

  return parseUsdzDirect(buffer, filename, onProgress);
}

async function parseUsdzInWorker(
  buffer: ArrayBuffer,
  filename: string,
  onProgress?: ParseUsdzProgressHandler,
): Promise<ParsedUsdModelData> {
  return await new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./openusdWorker.ts", import.meta.url), { type: "module" });
    const cleanup = () => worker.terminate();

    worker.addEventListener("message", (event: MessageEvent<OpenUsdWorkerResponse>) => {
      const response = event.data;
      switch (response.type) {
        case "progress":
          onProgress?.(response.update);
          break;
        case "result":
          cleanup();
          resolve(response.model);
          break;
        case "error":
          cleanup();
          reject(new Error(response.message));
          break;
      }
    });
    worker.addEventListener("error", (event) => {
      cleanup();
      reject(event.error instanceof Error ? event.error : new Error(event.message));
    });

    const workerBuffer = buffer.slice(0);
    const request: OpenUsdWorkerRequest = { type: "parse", buffer: workerBuffer, filename };
    worker.postMessage(request, [workerBuffer]);
  });
}

async function buildGroupFromWorkerModel(model: ParsedUsdModelData): Promise<Group> {
  const root = new Group();
  root.name = model.name;
  const groups = new Map<string, Group>();

  for (const meshData of model.meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(meshData.positions, 3));
    if (meshData.normals) geometry.setAttribute("normal", new BufferAttribute(meshData.normals, 3));
    if (meshData.uvs) {
      geometry.setAttribute("uv", new BufferAttribute(meshData.uvs, 2));
      geometry.setAttribute("uv1", new BufferAttribute(meshData.uvs, 2));
    }
    if (!meshData.normals) geometry.computeVertexNormals();

    const material = await materialDataToMaterial(meshData.material);
    const mesh = new Mesh(geometry, material);
    mesh.name = meshData.name;

    let meshGroup = groups.get(meshData.groupName);
    if (!meshGroup) {
      meshGroup = new Group();
      meshGroup.name = meshData.groupName;
      if (meshData.matrix && meshData.matrix.length === 16) {
        meshGroup.applyMatrix4(new Matrix4().fromArray(meshData.matrix));
      }
      groups.set(meshData.groupName, meshGroup);
      root.add(meshGroup);
    }
    meshGroup.add(mesh);
  }

  return root;
}

async function parseUsdzDirect(
  buffer: ArrayBuffer,
  filename = "asset.usdz",
  onProgress?: ParseUsdzProgressHandler,
): Promise<Group> {
  const report = (update: ParseUsdzProgressUpdate): void => {
    onProgress?.({
      ...update,
      progress: update.progress === undefined
        ? undefined
        : update.progress === null
          ? null
        : Math.max(0, Math.min(1, update.progress)),
    });
  };

  report({
    label: "Loading OpenUSD runtime",
    detail: `${filename} - ${formatByteSize(buffer.byteLength)}`,
    progress: null,
  });
  await waitForPaint();
  const usd = await getModule();

  report({
    label: "Opening USD stage",
    detail: "Reading archive and stage metadata",
    progress: null,
  });
  await waitForPaint();
  const bytes = new Uint8Array(buffer);
  const stageId = usd.openStageFromBinary(bytes, filename);
  if (stageId < 0) throw new Error("OpenUSD: failed to open stage from binary");

  try {
    const root = new Group();
    root.name = filename;

    report({
      label: "Scanning USD hierarchy",
      detail: "Listing prims and model structure",
      progress: null,
    });
    await waitForPaint();
    const prims = usd.listPrims(stageId);
    const meshPrims = prims.filter((prim) => prim.isMesh);
    report({
      label: "Scanning USD hierarchy",
      detail: `${meshPrims.length} mesh prim${meshPrims.length === 1 ? "" : "s"} found`,
      progress: 0.24,
    });
    const textureCache = new Map<string, Promise<Texture | null>>();
    const materialCache = new Map<string, Promise<MeshPhysicalMaterial>>();
    let resolvedMaterials = 0;
    let currentMeshProgress = 0.28;

    const resolveMaterial = (matPath: string): Promise<MeshPhysicalMaterial> => {
      let cached = materialCache.get(matPath);
      if (cached) return cached;
      cached = (async () => {
        report({
          label: "Resolving USD materials",
          detail: matPath,
          progress: currentMeshProgress,
        });
        const params = usd.getMaterialParams(stageId, matPath);
        const mat = new MeshPhysicalMaterial({ side: DoubleSide });
        if (params) await applyMaterialParams(usd, stageId, params, mat, textureCache);
        resolvedMaterials += 1;
        report({
          label: "Resolving USD materials",
          detail: `${resolvedMaterials} material${resolvedMaterials === 1 ? "" : "s"} resolved`,
          progress: Math.min(0.76, currentMeshProgress + 0.01),
        });
        return mat;
      })();
      materialCache.set(matPath, cached);
      return cached;
    };

    const meshGroups: { prim: PrimInfo; group: Group }[] = [];

    for (let index = 0; index < meshPrims.length; index += 1) {
      const prim = meshPrims[index];
      currentMeshProgress = 0.28 + (meshPrims.length > 0 ? (index / meshPrims.length) * 0.48 : 0);
      report({
        label: "Building USDZ meshes",
        detail: `${index + 1}/${meshPrims.length}: ${prim.path}`,
        progress: null,
      });
      await waitForPaint();
      const meshData = usd.getMeshData(stageId, prim.path);
      if (!meshData) continue;
      if (meshData.points.length === 0 || meshData.faceVertexIndices.length === 0) continue;

      const expanded = await expandPerCorner(meshData, (processedFaces, totalFaces) => {
        report({
          label: "Triangulating USDZ meshes",
          detail: `${index + 1}/${meshPrims.length}: ${processedFaces}/${totalFaces} faces`,
          progress: currentMeshProgress,
        });
      });
      const meshGroup = new Group();
      meshGroup.name = prim.path;

      // World transform — bake it into the mesh's matrix
      const worldM = usd.getWorldTransform(stageId, prim.path, NaN);
      if (worldM && worldM.length === 16) {
        const matrix = new Matrix4().fromArray(worldM);
        meshGroup.applyMatrix4(matrix);
      }

      if (meshData.subsets.length > 0) {
        // One sub-mesh per GeomSubset
        for (const subset of meshData.subsets) {
          const geom = await buildSubsetGeometry(expanded, subset.indices, (processedTriangles, totalTriangles) => {
            report({
              label: "Building USDZ mesh subsets",
              detail: `${subset.name}: ${processedTriangles}/${totalTriangles} triangles`,
              progress: currentMeshProgress,
            });
          });
          const mat = subset.materialPath
            ? await resolveMaterial(subset.materialPath)
            : new MeshPhysicalMaterial({ side: DoubleSide });
          const mesh = new Mesh(geom, mat);
          mesh.name = `${prim.path}/${subset.name}`;
          meshGroup.add(mesh);
        }
      } else {
        const geom = await buildSubsetGeometry(expanded, null);
        const matPath = usd.getMaterialBinding(stageId, prim.path);
        const mat = matPath
          ? await resolveMaterial(matPath)
          : new MeshPhysicalMaterial({ side: DoubleSide });
        const mesh = new Mesh(geom, mat);
        mesh.name = prim.path;
        meshGroup.add(mesh);
      }

      meshGroups.push({ prim, group: meshGroup });
      report({
        label: "Building USDZ meshes",
        detail: `${index + 1}/${meshPrims.length} mesh${meshPrims.length === 1 ? "" : "es"} built`,
        progress: 0.28 + (((index + 1) / meshPrims.length) * 0.48),
      });
    }

    report({
      label: "Finalizing USDZ model",
      detail: `${meshGroups.length} mesh group${meshGroups.length === 1 ? "" : "s"} ready`,
      progress: 0.94,
    });
    for (const { group } of meshGroups) root.add(group);
    report({
      label: "Finalizing USDZ model",
      detail: "Preparing model for the editor",
      progress: 0.98,
    });
    return root;
  } finally {
    usd.closeStage(stageId);
    pluginsRegistered = false;
    releaseOpenUSD();
  }
}

// Test/dev: clear the registered-plugins flag so plugins re-register on next call.
export function resetOpenUsdParserForTests(): void {
  pluginsRegistered = false;
}
