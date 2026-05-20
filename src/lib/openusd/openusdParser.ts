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
  Object3D,
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

/**
 * A node in the import plan derived from a USDZ stage, mirroring the prim
 * hierarchy. Editor consumers turn each entry into a blueprint node (group or
 * model) and attach children recursively. The `position`/`rotation`/`scale`
 * fields are the decomposed *local* transform (relative to the kept parent),
 * so when applied to a blueprint node they reproduce the authored world pose.
 *
 * The `primPath` field is the USD prim path that becomes the ModelNode's
 * `primPath` — chosen to match the editor type so state.ts can spread the
 * plan node directly into a blueprint node without renaming fields.
 *
 * `materialPath` (mesh-kind only) is the USD material path bound to the
 * prim. Consumers can use this as a dedup key to share a single project
 * MaterialAsset across multiple prims that authored the same material.
 */
export interface UsdImportPlanNode {
  primPath: string;
  name: string;
  kind: "xform" | "mesh";
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  materialPath?: string;
  /**
   * GeomSubset name when this plan node represents one subset of a
   * multi-material mesh prim. The parent plan node (`xform` kind) shares
   * the same {@link primPath}; sibling subset nodes carry their own
   * {@link materialPath}. Renderer filters mesh children by
   * `userData.usdSubsetName` to clone just this subset.
   */
  subsetName?: string;
  children: UsdImportPlanNode[];
}

/**
 * PBR property snapshot of a UsdPreviewSurface material, distilled to the
 * scalar/color fields the editor's MaterialSpec carries. Returned alongside
 * the import plan so the App layer can register each unique material as a
 * MaterialAsset and link mesh prims to it via `materialId`. Texture maps
 * are intentionally omitted for now — the cached parsed material still
 * provides them at render time; the editable Inspector handles only the
 * scalar/color overrides.
 */
export interface UsdMaterialSnapshot {
  path: string;
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  emissive: string;
}

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

function primShortName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function depthOfPath(path: string): number {
  return (path.match(/\//g)?.length ?? 0);
}

/**
 * Parse a USDZ (or USDC) buffer using OpenUSD WASM and return a hierarchical
 * Three.js Group whose tree mirrors the USD prim hierarchy.
 *
 * Each kept prim (Xformable or Mesh) becomes an `Object3D` carrying its
 * *local* transform (decomposed onto `position`/`quaternion`/`scale`). Each
 * such Object3D is tagged with `userData.usdPath` and `userData.usdKind`
 * (`"mesh"` | `"xform"`) so downstream code can derive a blueprint import
 * plan via `buildUsdImportPlanFromGroup` and locate specific prims at render
 * time by their USD path.
 *
 * Non-kept intermediate prims (Material, Shader, Scope without xform, etc.)
 * are skipped, but their local transforms are folded into their kept
 * descendants so the world pose is preserved exactly.
 *
 * Pipeline:
 *   1. Open stage from binary buffer.
 *   2. List all prims; keep only Mesh and Xformable ones.
 *   3. Process kept prims parent-before-child; reparent each to its nearest
 *      kept ancestor with the accumulated transform applied.
 *   4. For Mesh prims, build geometries + materials (per GeomSubset or whole
 *      mesh) and attach as children of the kept Object3D.
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

/**
 * Reconstruct a hierarchical three.js Group from the worker's serialised
 * prim tree, mirroring exactly the layout produced by `parseUsdzDirect`:
 *
 *   - One Object3D per kept prim, parented to the nearest kept ancestor.
 *   - `userData.usdPath` + `usdKind` tags so {@link buildUsdImportPlanFromGroup}
 *     and {@link findObjectByUsdPath} can navigate by USD path.
 *   - Local matrix derived from `inverse(parentWorld) * primWorld` so the
 *     authored world pose is preserved relative to the kept ancestor.
 *   - For mesh prims: one Three.js Mesh child per subset, each carrying
 *     `userData.usdSubsetName` + `usdMaterialPath` plus the parent prim's
 *     `userData.usdMaterialPath` set to the primary subset's material so
 *     single-material prims still bind via the same lookup path.
 *
 * Materials are resolved once per material path via the shared `model.materials`
 * dictionary and cached so multiple prims/subsets referencing the same USD
 * material share a single MeshPhysicalMaterial instance.
 */
async function buildGroupFromWorkerModel(model: ParsedUsdModelData): Promise<Group> {
  const root = new Group();
  root.name = model.name;
  root.userData.usdPath = "/";
  root.userData.usdKind = "xform";

  const materialCache = new Map<string, MeshPhysicalMaterial>();
  const resolveMaterial = async (path: string | undefined): Promise<MeshPhysicalMaterial> => {
    if (!path) return new MeshPhysicalMaterial({ side: DoubleSide });
    let cached = materialCache.get(path);
    if (cached) return cached;
    const data = model.materials[path];
    cached = data
      ? await materialDataToMaterial(data)
      : new MeshPhysicalMaterial({ side: DoubleSide });
    materialCache.set(path, cached);
    return cached;
  };

  // World matrices keyed by prim path so each prim can compute its local
  // matrix as `inverse(parentWorld) * primWorld` (same math as parseUsdzDirect).
  // Prims arrive parent-before-child, so by the time we hit a child its
  // parent's worldMatrix is already in the map.
  const worldMatrices = new Map<string, Matrix4>();
  const objectsByPath = new Map<string, Group>();
  const tmpInverse = new Matrix4();

  for (const prim of model.prims) {
    const primWorld = prim.worldMatrix && prim.worldMatrix.length === 16
      ? new Matrix4().fromArray(prim.worldMatrix)
      : new Matrix4();
    worldMatrices.set(prim.path, primWorld);

    const parentObj = prim.parent ? objectsByPath.get(prim.parent) ?? root : root;
    const parentWorld = prim.parent ? worldMatrices.get(prim.parent) ?? null : null;
    const localMatrix = parentWorld
      ? new Matrix4().multiplyMatrices(tmpInverse.copy(parentWorld).invert(), primWorld)
      : primWorld.clone();

    const obj = new Group();
    obj.name = primShortName(prim.path) || prim.path;
    obj.userData.usdPath = prim.path;
    obj.userData.usdKind = prim.kind;
    obj.applyMatrix4(localMatrix);

    if (prim.kind === "mesh") {
      for (const subset of prim.subsets) {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(subset.positions, 3));
        if (subset.normals) geometry.setAttribute("normal", new BufferAttribute(subset.normals, 3));
        if (subset.uvs) {
          geometry.setAttribute("uv", new BufferAttribute(subset.uvs, 2));
          geometry.setAttribute("uv1", new BufferAttribute(subset.uvs, 2));
        }
        if (!subset.normals) geometry.computeVertexNormals();

        const material = await resolveMaterial(subset.materialPath);
        const mesh = new Mesh(geometry, material);
        mesh.name = subset.name;
        mesh.userData.usdSubsetName = subset.name;
        if (subset.materialPath) {
          mesh.userData.usdMaterialPath = subset.materialPath;
        }
        obj.add(mesh);
      }
      if (prim.primaryMaterialPath) {
        obj.userData.usdMaterialPath = prim.primaryMaterialPath;
      }
    }

    parentObj.add(obj);
    objectsByPath.set(prim.path, obj);
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
    root.userData.usdPath = "/";
    root.userData.usdKind = "xform";

    report({
      label: "Scanning USD hierarchy",
      detail: "Listing prims and model structure",
      progress: null,
    });
    await waitForPaint();
    const prims = usd.listPrims(stageId);
    const primsByPath = new Map<string, PrimInfo>();
    for (const p of prims) primsByPath.set(p.path, p);
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

    // Material / Shader / GeomSubset etc. are bound to mesh prims separately
    // and have no place in the scene hierarchy — skip them outright to keep
    // the exploded blueprint tree from being polluted by shader-network prims.
    const NON_HIERARCHY_TYPES = new Set([
      "Material",
      "Shader",
      "NodeGraph",
      "GeomSubset",
      "Camera",
    ]);
    const isKept = (prim: PrimInfo): boolean => {
      if (NON_HIERARCHY_TYPES.has(prim.type)) return false;
      return prim.isMesh || prim.isXformable;
    };
    const kept = prims.filter(isKept);
    // Stable parent-before-child: ascending depth, then path for tiebreak.
    kept.sort((a, b) => depthOfPath(a.path) - depthOfPath(b.path) || a.path.localeCompare(b.path));

    // We rely on getWorldTransform (the same API the editor has been using
    // for the legacy flat-import path) rather than getLocalTransform, which
    // has historically been untested in our WASM build. Local-frame matrices
    // are derived from `inverse(parentWorld) * primWorld`, so each Object3D
    // ends up with the correct transform relative to its kept ancestor.
    const worldMatrices = new Map<string, Matrix4>();
    const getWorldMatrix = (path: string): Matrix4 => {
      let cached = worldMatrices.get(path);
      if (cached) return cached;
      const wm = usd.getWorldTransform(stageId, path, NaN);
      cached = wm && wm.length === 16 ? new Matrix4().fromArray(wm) : new Matrix4();
      worldMatrices.set(path, cached);
      return cached;
    };

    const objectsByPath = new Map<string, Group>();
    const tmpInverse = new Matrix4();
    let meshIndex = 0;

    for (const prim of kept) {
      // Walk up to find the nearest already-processed (kept) ancestor.
      let parentPath = prim.parent;
      let parentObj: Group = root;
      let parentWorld: Matrix4 | null = null;
      while (parentPath && parentPath !== "/" && parentPath !== "") {
        const existing = objectsByPath.get(parentPath);
        if (existing) {
          parentObj = existing;
          parentWorld = getWorldMatrix(parentPath);
          break;
        }
        const parentPrim = primsByPath.get(parentPath);
        if (!parentPrim) break;
        parentPath = parentPrim.parent;
      }

      const primWorld = getWorldMatrix(prim.path);
      const localMatrix = parentWorld
        ? new Matrix4().multiplyMatrices(tmpInverse.copy(parentWorld).invert(), primWorld)
        : primWorld.clone();

      const obj = new Group();
      obj.name = primShortName(prim.path) || prim.path;
      obj.userData.usdPath = prim.path;
      obj.userData.usdKind = prim.isMesh ? "mesh" : "xform";
      // applyMatrix4 premultiplies onto the current (identity) matrix and
      // decomposes back into position/quaternion/scale automatically.
      obj.applyMatrix4(localMatrix);

      if (prim.isMesh) {
        currentMeshProgress = 0.28 + (meshPrims.length > 0 ? (meshIndex / meshPrims.length) * 0.48 : 0);
        report({
          label: "Building USDZ meshes",
          detail: `${meshIndex + 1}/${meshPrims.length}: ${prim.path}`,
          progress: null,
        });
        await waitForPaint();
        const meshData = usd.getMeshData(stageId, prim.path);
        if (meshData && meshData.points.length > 0 && meshData.faceVertexIndices.length > 0) {
          const expanded = await expandPerCorner(meshData, (processedFaces, totalFaces) => {
            report({
              label: "Triangulating USDZ meshes",
              detail: `${meshIndex + 1}/${meshPrims.length}: ${processedFaces}/${totalFaces} faces`,
              progress: currentMeshProgress,
            });
          });

          // Track the prim's "primary" material binding so the editor can
          // link this mesh to a shared MaterialAsset. Prims with subsets
          // use the first subset's material as a representative; per-subset
          // material overrides are exposed via `userData.usdMaterialPath`
          // on each child mesh so the editor's plan builder can split
          // multi-material prims into per-subset blueprint nodes.
          let primaryMaterialPath: string | null = null;
          if (meshData.subsets.length > 0) {
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
              mesh.name = subset.name;
              mesh.userData.usdSubsetName = subset.name;
              if (subset.materialPath) {
                mesh.userData.usdMaterialPath = subset.materialPath;
                if (!primaryMaterialPath) primaryMaterialPath = subset.materialPath;
              }
              obj.add(mesh);
            }
          } else {
            const geom = await buildSubsetGeometry(expanded, null);
            const matPath = usd.getMaterialBinding(stageId, prim.path);
            const mat = matPath
              ? await resolveMaterial(matPath)
              : new MeshPhysicalMaterial({ side: DoubleSide });
            const mesh = new Mesh(geom, mat);
            mesh.name = primShortName(prim.path) || prim.path;
            if (matPath) {
              mesh.userData.usdMaterialPath = matPath;
              primaryMaterialPath = matPath;
            }
            obj.add(mesh);
          }
          if (primaryMaterialPath) {
            obj.userData.usdMaterialPath = primaryMaterialPath;
          }
        }

        report({
          label: "Building USDZ meshes",
          detail: `${meshIndex + 1}/${meshPrims.length} mesh${meshPrims.length === 1 ? "" : "es"} built`,
          progress: 0.28 + (((meshIndex + 1) / meshPrims.length) * 0.48),
        });
        meshIndex += 1;
      }

      parentObj.add(obj);
      objectsByPath.set(prim.path, obj);
    }

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

/**
 * Walk a tagged Group produced by {@link parseUsdz} and derive a flat-tree
 * plan of nodes to create in the editor blueprint. Skips meshes / subsets
 * attached as children of kept Object3Ds (those become the rendered mesh
 * children of a single blueprint model node, not separate blueprint nodes).
 */
export function buildUsdImportPlanFromGroup(group: Group): UsdImportPlanNode[] {
  const visit = (object: Object3D): UsdImportPlanNode | null => {
    const usdPath = object.userData?.usdPath as string | undefined;
    const usdKind = object.userData?.usdKind as UsdImportPlanNode["kind"] | undefined;
    if (!usdPath || !usdKind) return null;

    const childPlans: UsdImportPlanNode[] = [];
    for (const child of object.children) {
      const childPlan = visit(child);
      if (childPlan) childPlans.push(childPlan);
    }

    // For mesh prims with multiple GeomSubsets bound to *different* materials,
    // split each subset into its own synthetic child plan node so it becomes
    // an independently editable blueprint node (selectable, movable, linkable
    // to its own MaterialAsset). The prim itself degrades to an xform-only
    // container — it carries the prim's local transform and nests the subset
    // children. Single-material meshes keep the legacy single-node layout.
    if (usdKind === "mesh") {
      const directMeshes = object.children.filter(
        (c): c is Mesh => c instanceof Mesh,
      );
      const subsetEntries = directMeshes
        .map((m) => ({
          subsetName: m.userData?.usdSubsetName as string | undefined,
          materialPath: m.userData?.usdMaterialPath as string | undefined,
          name: m.name,
        }))
        .filter((e) => e.subsetName && e.materialPath);
      const distinctMaterials = new Set(subsetEntries.map((e) => e.materialPath));
      if (subsetEntries.length > 1 && distinctMaterials.size > 1) {
        for (const entry of subsetEntries) {
          childPlans.push({
            primPath: usdPath,
            name: entry.name || entry.subsetName || "subset",
            kind: "mesh",
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            materialPath: entry.materialPath,
            subsetName: entry.subsetName,
            children: [],
          });
        }
        return {
          primPath: usdPath,
          name: object.name || primShortName(usdPath),
          kind: "xform",
          position: { x: object.position.x, y: object.position.y, z: object.position.z },
          rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
          scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
          children: childPlans,
        };
      }
    }

    const materialPath = usdKind === "mesh"
      ? (object.userData?.usdMaterialPath as string | undefined)
      : undefined;

    return {
      primPath: usdPath,
      name: object.name || primShortName(usdPath),
      kind: usdKind,
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
      scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
      ...(materialPath ? { materialPath } : {}),
      children: childPlans,
    };
  };

  // Skip the root group itself (it represents the whole file, not a USD prim
  // in the user's hierarchy). Emit its direct kept descendants as roots.
  const plans: UsdImportPlanNode[] = [];
  for (const child of group.children) {
    const plan = visit(child);
    if (plan) plans.push(plan);
  }
  return plans;
}

function colorToHex(color: { r: number; g: number; b: number }): string {
  const toHex = (channel: number): string => {
    const clamped = Math.round(Math.max(0, Math.min(1, channel)) * 255);
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

/**
 * Walk a tagged Group produced by {@link parseUsdz} and snapshot each unique
 * UsdPreviewSurface material it references. Used during USDZ import to
 * register one MaterialAsset per authored material, then link mesh prims
 * sharing the same material path to the same MaterialAsset id.
 */
export function extractUsdMaterialSnapshotsFromGroup(group: Group): UsdMaterialSnapshot[] {
  const snapshots = new Map<string, UsdMaterialSnapshot>();
  group.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const matPath = obj.userData?.usdMaterialPath as string | undefined;
    if (!matPath || snapshots.has(matPath)) return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!(mat instanceof MeshPhysicalMaterial)) return;
    snapshots.set(matPath, {
      path: matPath,
      name: primShortName(matPath) || "Material",
      color: colorToHex(mat.color),
      roughness: mat.roughness,
      metalness: mat.metalness,
      opacity: mat.opacity,
      emissive: colorToHex(mat.emissive),
    });
  });
  return Array.from(snapshots.values());
}

// Test/dev: clear the registered-plugins flag so plugins re-register on next call.
export function resetOpenUsdParserForTests(): void {
  pluginsRegistered = false;
}
