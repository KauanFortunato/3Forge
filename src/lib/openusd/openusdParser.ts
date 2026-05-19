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

import { loadOpenUSD } from "./loadOpenUsd";

/**
 * A node in the import plan derived from a USDZ stage, mirroring the prim
 * hierarchy. Editor consumers turn each entry into a blueprint node (group or
 * model) and attach children recursively. The `position`/`rotation`/`scale`
 * fields are the decomposed *local* transform (relative to the kept parent),
 * so when applied to a blueprint node they reproduce the authored world pose.
 */
export interface UsdImportPlanNode {
  usdPath: string;
  name: string;
  kind: "xform" | "mesh";
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  children: UsdImportPlanNode[];
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

function expandPerCorner(mesh: MeshData): ExpandedAttributes {
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
  }

  return { positions, normals: outNormals, uvs: outUvs, triCount, triToFace };
}

function buildSubsetGeometry(
  expanded: ExpandedAttributes,
  faceIndices: Int32Array | null,
): BufferGeometry {
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
export async function parseUsdz(buffer: ArrayBuffer, filename = "asset.usdz"): Promise<Group> {
  const usd = await getModule();
  const bytes = new Uint8Array(buffer);
  const stageId = usd.openStageFromBinary(bytes, filename);
  if (stageId < 0) throw new Error("OpenUSD: failed to open stage from binary");

  try {
    const root = new Group();
    root.name = filename;
    root.userData.usdPath = "/";
    root.userData.usdKind = "xform";

    const prims = usd.listPrims(stageId);
    const primsByPath = new Map<string, PrimInfo>();
    for (const p of prims) primsByPath.set(p.path, p);

    const textureCache = new Map<string, Promise<Texture | null>>();
    const materialCache = new Map<string, Promise<MeshPhysicalMaterial>>();

    const resolveMaterial = (matPath: string): Promise<MeshPhysicalMaterial> => {
      let cached = materialCache.get(matPath);
      if (cached) return cached;
      cached = (async () => {
        const params = usd.getMaterialParams(stageId, matPath);
        const mat = new MeshPhysicalMaterial({ side: DoubleSide });
        if (params) await applyMaterialParams(usd, stageId, params, mat, textureCache);
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
        const meshData = usd.getMeshData(stageId, prim.path);
        if (meshData && meshData.points.length > 0 && meshData.faceVertexIndices.length > 0) {
          const expanded = expandPerCorner(meshData);
          if (meshData.subsets.length > 0) {
            for (const subset of meshData.subsets) {
              const geom = buildSubsetGeometry(expanded, subset.indices);
              const mat = subset.materialPath
                ? await resolveMaterial(subset.materialPath)
                : new MeshPhysicalMaterial({ side: DoubleSide });
              const mesh = new Mesh(geom, mat);
              mesh.name = subset.name;
              mesh.userData.usdSubsetName = subset.name;
              if (subset.materialPath) mesh.userData.usdMaterialPath = subset.materialPath;
              obj.add(mesh);
            }
          } else {
            const geom = buildSubsetGeometry(expanded, null);
            const matPath = usd.getMaterialBinding(stageId, prim.path);
            const mat = matPath
              ? await resolveMaterial(matPath)
              : new MeshPhysicalMaterial({ side: DoubleSide });
            const mesh = new Mesh(geom, mat);
            mesh.name = primShortName(prim.path) || prim.path;
            if (matPath) mesh.userData.usdMaterialPath = matPath;
            obj.add(mesh);
          }
        }
      }

      parentObj.add(obj);
      objectsByPath.set(prim.path, obj);
    }

    return root;
  } finally {
    usd.closeStage(stageId);
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

    return {
      usdPath,
      name: object.name || primShortName(usdPath),
      kind: usdKind,
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
      scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
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

// Test/dev: clear the registered-plugins flag so plugins re-register on next call.
export function resetOpenUsdParserForTests(): void {
  pluginsRegistered = false;
}
