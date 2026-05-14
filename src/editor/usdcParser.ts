import { Group } from "three";

import type { TinyUSDZLoader as TinyUSDZLoaderType } from "../wasm/tinyusdz/TinyUSDZLoader";
import type { TinyUSDZLoaderUtils as TinyUSDZLoaderUtilsType } from "../wasm/tinyusdz/TinyUSDZLoaderUtils";
import type { ModelAssetStructure, ModelAssetStructureNode } from "./types";

interface ParserHandles {
  loader: TinyUSDZLoaderType;
  utils: typeof TinyUSDZLoaderUtilsType;
}

let handlesPromise: Promise<ParserHandles> | null = null;

async function getParserHandles(): Promise<ParserHandles> {
  if (!handlesPromise) {
    handlesPromise = (async () => {
      const [{ TinyUSDZLoader }, { TinyUSDZLoaderUtils }] = await Promise.all([
        import("../wasm/tinyusdz/TinyUSDZLoader"),
        import("../wasm/tinyusdz/TinyUSDZLoaderUtils"),
      ]);

      const response = await fetch("/wasm/tinyusdz/tinyusdz.wasm");
      if (!response.ok) {
        throw new Error(`Failed to fetch tinyusdz.wasm: ${response.status} ${response.statusText}`);
      }
      const wasmBinary = await response.arrayBuffer();

      const loader = new TinyUSDZLoader();
      await loader.init({ wasmBinary });

      return { loader, utils: TinyUSDZLoaderUtils };
    })().catch((error) => {
      handlesPromise = null;
      throw error;
    });
  }
  return handlesPromise;
}

type UsdScene = Record<string, unknown>;

function callIfFunction(target: UsdScene, name: string): unknown {
  const candidate = target[name];
  if (typeof candidate === "function") {
    try {
      return (candidate as (this: unknown) => unknown).call(target);
    } catch (error) {
      console.warn(`tinyusdz: ${name}() threw`, error);
      return undefined;
    }
  }
  return undefined;
}

function discoverRootNodes(usdScene: unknown): { nodes: unknown[]; source: string } {
  const scene = (usdScene ?? {}) as UsdScene;

  const arrayCandidates = ["getDefaultRootNodes", "getRootNodes"];
  for (const name of arrayCandidates) {
    const value = callIfFunction(scene, name);
    if (Array.isArray(value) && value.length > 0) {
      return { nodes: value, source: `${name}()` };
    }
  }

  const singleCandidates = ["getDefaultRootNode", "getRootNode"];
  for (const name of singleCandidates) {
    const value = callIfFunction(scene, name);
    if (value && typeof value === "object") {
      return { nodes: [value], source: `${name}()` };
    }
  }

  const propertyCandidates = ["rootNodes", "defaultRootNodes"];
  for (const name of propertyCandidates) {
    const value = scene[name];
    if (Array.isArray(value) && value.length > 0) {
      return { nodes: value, source: `${name} (property)` };
    }
  }

  const propertySingles = ["rootNode", "defaultRootNode"];
  for (const name of propertySingles) {
    const value = scene[name];
    if (value && typeof value === "object") {
      return { nodes: [value], source: `${name} (property)` };
    }
  }

  return { nodes: [], source: "<none>" };
}

function countIfFunction(target: UsdScene, name: string): number {
  const value = callIfFunction(target, name);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function createUsdcStructureNode(node: unknown, fallbackId: string): ModelAssetStructureNode {
  const source = (node ?? {}) as Record<string, unknown>;
  const rawChildren = Array.isArray(source.children) ? source.children : [];
  const children = rawChildren.map((child, index) => createUsdcStructureNode(child, `${fallbackId}.${index}`));
  const type = typeof source.nodeType === "string" && source.nodeType.trim()
    ? source.nodeType.trim()
    : "node";
  const name = (typeof source.displayName === "string" && source.displayName.trim())
    || (typeof source.primName === "string" && source.primName.trim())
    || (typeof source.absPath === "string" && source.absPath.trim())
    || type;
  const isMesh = type.toLowerCase() === "mesh";
  const childMeshCount = children.reduce((total, child) => total + child.meshCount, 0);
  return {
    id: typeof source.absPath === "string" && source.absPath.trim() ? source.absPath.trim() : fallbackId,
    name,
    type,
    childCount: children.length,
    meshCount: (isMesh ? 1 : 0) + childMeshCount,
    materialCount: 0,
    children,
  };
}

function collectMeshMaterialIds(usdScene: UsdScene, meshCount: number): Set<number> {
  const materialIds = new Set<number>();
  if (typeof usdScene.getMesh !== "function") {
    return materialIds;
  }
  for (let index = 0; index < meshCount; index++) {
    let mesh: unknown;
    try {
      mesh = (usdScene.getMesh as (this: unknown, idx: number) => unknown).call(usdScene, index);
    } catch {
      continue;
    }
    const materialId = mesh && typeof mesh === "object"
      ? (mesh as Record<string, unknown>).materialId
      : undefined;
    if (typeof materialId === "number" && materialId >= 0) {
      materialIds.add(materialId);
    }
  }
  return materialIds;
}

function countTextureSlots(usdScene: UsdScene, materialIds: Set<number>): number {
  if (typeof usdScene.getMaterial !== "function") {
    return 0;
  }
  const textureIds = new Set<number>();
  for (const materialId of materialIds) {
    let material: unknown;
    try {
      material = (usdScene.getMaterial as (this: unknown, id: number) => unknown).call(usdScene, materialId);
    } catch {
      continue;
    }
    if (!material || typeof material !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(material as Record<string, unknown>)) {
      if (key.endsWith("TextureId") && typeof value === "number" && value >= 0) {
        textureIds.add(value);
      }
    }
  }
  return textureIds.size;
}

/**
 * Parses a USDZ binary that contains USDC (Pixar binary USD) payloads using the
 * tinyusdz WASM module. Returns a `Group` with the converted Three.js scene
 * graph. The returned promise only resolves after every `buildThreeNode` await
 * chain (including all texture decodes) has completed, so the scene is safe to
 * render or re-export immediately.
 */
export async function parseUsdc(buffer: ArrayBuffer): Promise<Group> {
  const { loader, utils } = await getParserHandles();
  const binary = new Uint8Array(buffer);

  return new Promise<Group>((resolve, reject) => {
    loader.parse(
      binary,
      "asset.usdz",
      (usdScene) => {
        (async () => {
          try {
            const root = new Group();
            root.name = "USDC Root";
            const { nodes: rootNodes } = discoverRootNodes(usdScene);

            if (rootNodes.length === 0) {
              console.warn(
                "tinyusdz: parsed USD scene exposed no root nodes — the resulting Group will be empty.",
              );
            }
            for (const node of rootNodes) {
              const child = await utils.buildThreeNode(node, null, usdScene, {});
              root.add(child);
            }
            resolve(root);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      },
      (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function inspectUsdcStructure(buffer: ArrayBuffer): Promise<ModelAssetStructure> {
  const { loader } = await getParserHandles();
  const binary = new Uint8Array(buffer);

  return new Promise<ModelAssetStructure>((resolve, reject) => {
    loader.parse(
      binary,
      "asset.usdz",
      (usdScene) => {
        try {
          const scene = (usdScene ?? {}) as UsdScene;
          const { nodes: rootNodes } = discoverRootNodes(usdScene);
          const roots = rootNodes.map((node, index) => createUsdcStructureNode(node, `root-${index}`));
          const nodeCount = roots.reduce((total, root) => total + countStructureNodes(root), 0);
          const meshCount = countIfFunction(scene, "numMeshes") || roots.reduce((total, root) => total + root.meshCount, 0);
          const materialIds = collectMeshMaterialIds(scene, meshCount);
          resolve({
            format: "usdz",
            source: "tinyusdz",
            nodeCount,
            meshCount,
            materialCount: materialIds.size,
            textureCount: countTextureSlots(scene, materialIds),
            roots,
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
      (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function countStructureNodes(node: ModelAssetStructureNode): number {
  return 1 + node.children.reduce((total, child) => total + countStructureNodes(child), 0);
}

/**
 * Test-only: clears the cached loader/wasm handles so subsequent calls to
 * {@link parseUsdc} re-initialize. Real callers should never need this.
 */
export function resetUsdcParserForTests(): void {
  handlesPromise = null;
}

export interface ExtractedUsdcImage {
  name: string;
  mimeType: string;
  src: string;
  width: number;
  height: number;
}

interface UsdcRawImage {
  uri?: string;
  bufferId?: number;
  decoded?: boolean;
  data?: Uint8Array;
  width?: number;
  height?: number;
  channels?: number;
}

/**
 * Test-only seam: by default we use the real parser handles, but tests can
 * override this to inject a stub `usdScene` without spinning up the WASM
 * module. The override is removed automatically after one call.
 */
let usdSceneFactoryOverride: ((buffer: ArrayBuffer) => unknown) | null = null;

export function __setUsdSceneFactoryForTests(
  factory: ((buffer: ArrayBuffer) => unknown) | null,
): void {
  usdSceneFactoryOverride = factory;
}

/**
 * Walks a parsed USDC `usdScene` and returns one `ExtractedUsdcImage` per
 * unique referenced texture image. Each image is converted to a PNG `data:`
 * URL so it can be stored alongside the model in the editor's Assets panel.
 *
 * Iteration order is mesh-major → material slot-major to keep results stable
 * for debugging. Deduplication is performed on `textureImageId`.
 */
async function collectImagesFromUsdScene(usdScene: unknown): Promise<ExtractedUsdcImage[]> {
  const scene = (usdScene ?? {}) as UsdScene;
  const results: ExtractedUsdcImage[] = [];

  if (typeof scene.getMaterial !== "function"
    || typeof scene.getTexture !== "function"
    || typeof scene.getImage !== "function") {
    return results;
  }

  // Build the list of material IDs to scan. We don't rely on mesh-driven
  // discovery anymore because tinyusdz doesn't propagate `materialBindingAPI`
  // inheritance — many models have meshes with materialId=-1 even though
  // materials are present at the scene level. Instead we enumerate every
  // material directly: prefer numMaterials() if exposed, else probe by index.
  const materialIds: number[] = [];
  const numMatRaw = scene.numMaterials;
  let numMat = 0;
  if (typeof numMatRaw === "function") {
    try {
      const result = (numMatRaw as (this: unknown) => unknown).call(scene);
      if (typeof result === "number" && Number.isFinite(result)) numMat = result;
    } catch (error) {
      console.warn("tinyusdz: numMaterials() threw", error);
    }
  } else if (typeof numMatRaw === "number") {
    numMat = numMatRaw;
  }

  if (numMat > 0) {
    for (let i = 0; i < numMat; i += 1) materialIds.push(i);
  } else {
    // No numMaterials API — probe getMaterial(0..31) and stop at the first miss.
    for (let i = 0; i < 32; i += 1) {
      let probe: unknown;
      try {
        probe = (scene.getMaterial as (this: unknown, id: number) => unknown).call(scene, i);
      } catch {
        break;
      }
      if (!probe || typeof probe !== "object") break;
      // tinyusdz often returns an empty object for out-of-range ids; filter.
      const probeKeys = Object.keys(probe as Record<string, unknown>);
      if (probeKeys.length === 0) break;
      materialIds.push(i);
    }
  }

  const seenImageIds = new Set<number>();

  for (const materialId of materialIds) {
    let material: unknown;
    try {
      material = (scene.getMaterial as (this: unknown, id: number) => unknown).call(scene, materialId);
    } catch (error) {
      console.warn(`tinyusdz: getMaterial(${materialId}) threw`, error);
      continue;
    }
    if (!material || typeof material !== "object") continue;

    for (const [key, value] of Object.entries(material as Record<string, unknown>)) {
      if (!key.endsWith("TextureId") || typeof value !== "number" || value < 0) continue;

      let texture: unknown;
      try {
        texture = (scene.getTexture as (this: unknown, id: number) => unknown).call(scene, value);
      } catch (error) {
        console.warn(`tinyusdz: getTexture(${value}) threw`, error);
        continue;
      }
      if (!texture || typeof texture !== "object") continue;
      const textureImageId = (texture as Record<string, unknown>).textureImageId;
      if (typeof textureImageId !== "number" || textureImageId < 0) continue;
      if (seenImageIds.has(textureImageId)) continue;
      seenImageIds.add(textureImageId);

      let rawImage: unknown;
      try {
        rawImage = (scene.getImage as (this: unknown, id: number) => unknown).call(scene, textureImageId);
      } catch (error) {
        console.warn(`tinyusdz: getImage(${textureImageId}) threw`, error);
        continue;
      }
      if (!rawImage || typeof rawImage !== "object") continue;

      let converted: { src: string; mimeType: string; width: number; height: number } | null;
      try {
        converted = await imageToDataUrl(rawImage as UsdcRawImage);
      } catch (error) {
        console.warn(`tinyusdz: imageToDataUrl threw for image ${textureImageId}:`, error);
        converted = null;
      }

      if (!converted) continue;

      const name = imageDisplayName(rawImage as UsdcRawImage, textureImageId);
      results.push({
        name,
        mimeType: converted.mimeType,
        src: converted.src,
        width: converted.width,
        height: converted.height,
      });
    }
  }

  return results;
}

function imageDisplayName(image: UsdcRawImage, imageId: number): string {
  const uri = typeof image.uri === "string" ? image.uri.trim() : "";
  if (uri) {
    // tinyusdz prefixes URIs with `<bufferId>/` for archive-embedded files.
    return uri.replace(/^\d+\//, "");
  }
  return `texture_${imageId}.png`;
}

function sniffImageMimeType(data: Uint8Array): string {
  if (data.length >= 4) {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
      return "image/png";
    }
    if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
      return "image/jpeg";
    }
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
      return "image/webp";
    }
  }
  return "image/png";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunk to avoid `String.fromCharCode` stack-overflow on large buffers.
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, Math.min(index + chunk, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  // Node fallback (used by some test environments).
  const bufferCtor = (globalThis as { Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(binary, "binary").toString("base64");
  }
  throw new Error("No base64 encoder available in this environment.");
}

async function imageToDataUrl(image: UsdcRawImage): Promise<{ src: string; mimeType: string; width: number; height: number } | null> {
  const { decoded, data, width, height, channels } = image;
  if (!data || typeof width !== "number" || typeof height !== "number") {
    return null;
  }

  // Case A: tinyusdz did not decode the image — `data` holds the original
  // archive bytes (PNG/JPEG/WEBP). Wrap as-is in a data URL so we preserve
  // the source encoding.
  if (decoded !== true) {
    const mimeType = sniffImageMimeType(data);
    const base64 = bytesToBase64(data);
    return {
      src: `data:${mimeType};base64,${base64}`,
      mimeType,
      width,
      height,
    };
  }

  // Case B: tinyusdz decoded the image to raw pixels. Re-encode as PNG via a
  // canvas so the asset panel can display it.
  if (typeof channels !== "number" || channels < 1 || channels > 4) {
    console.warn(`tinyusdz: unsupported channel count ${channels} for decoded image; skipping.`);
    return null;
  }

  const pixelCount = width * height;
  const componentCount = pixelCount * channels;
  // Some textures (e.g. 16-bit linear AO/normal maps) are decoded with two
  // bytes per component. Downsample to 8-bit by taking the high byte (matches
  // TinyUSDZLoaderUtils.createTextureDataView's strategy). Source bytes assumed
  // little-endian, so the high byte sits at offset `i*2 + 1`.
  let source8: Uint8Array;
  if (data.byteLength === componentCount) {
    source8 = data;
  } else if (data.byteLength === componentCount * 2) {
    source8 = new Uint8Array(componentCount);
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < componentCount; i += 1) {
      source8[i] = view[i * 2 + 1] ?? view[i * 2] ?? 0;
    }
  } else {
    console.warn(
      `tinyusdz: unexpected decoded payload size for image (w=${width} h=${height} channels=${channels}, dataLen=${data.byteLength}); skipping.`,
    );
    return null;
  }

  const rgba = new Uint8ClampedArray(pixelCount * 4);
  if (channels === 4) {
    rgba.set(source8);
  } else if (channels === 3) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const src = pixel * 3;
      const dst = pixel * 4;
      rgba[dst] = source8[src];
      rgba[dst + 1] = source8[src + 1];
      rgba[dst + 2] = source8[src + 2];
      rgba[dst + 3] = 0xFF;
    }
  } else if (channels === 2) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const src = pixel * 2;
      const dst = pixel * 4;
      rgba[dst] = source8[src];
      rgba[dst + 1] = source8[src];
      rgba[dst + 2] = source8[src];
      rgba[dst + 3] = source8[src + 1];
    }
  } else {
    // channels === 1
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const value = source8[pixel];
      const dst = pixel * 4;
      rgba[dst] = value;
      rgba[dst + 1] = value;
      rgba[dst + 2] = value;
      rgba[dst + 3] = 0xFF;
    }
  }

  const src = await encodeRgbaAsPngDataUrl(rgba, width, height);
  if (!src) {
    return null;
  }
  return { src, mimeType: "image/png", width, height };
}

async function encodeRgbaAsPngDataUrl(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string | null> {
  // Prefer OffscreenCanvas where available (workers, modern browsers) since it
  // does not require a DOM. Fall back to a regular canvas otherwise. If neither
  // path works (e.g. jsdom without canvas), return null so the caller can skip
  // this image without aborting extraction.
  try {
    const OffscreenCanvasCtor = (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
    if (typeof OffscreenCanvasCtor === "function") {
      const offscreen = new OffscreenCanvasCtor(width, height);
      const ctx = offscreen.getContext("2d");
      if (!ctx) {
        return null;
      }
      // Copy into a fresh ImageData to avoid TS friction with
      // Uint8ClampedArray<ArrayBufferLike> in some lib targets.
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(rgba);
      ctx.putImageData(imageData, 0, 0);
      const blob = await offscreen.convertToBlob({ type: "image/png" });
      return await blobToDataUrl(blob);
    }
  } catch (error) {
    console.warn("tinyusdz: OffscreenCanvas PNG encode failed, falling back.", error);
  }

  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return null;
      }
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(rgba);
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL("image/png");
    } catch (error) {
      console.warn("tinyusdz: <canvas> PNG encode failed; skipping image.", error);
      return null;
    }
  }

  return null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob as data URL."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid blob result."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Parses a USDC-binary USDZ buffer and returns the embedded texture images as
 * `ExtractedUsdcImage` entries suitable for `EditorStore.addImageAsset`. Each
 * unique referenced image is included once; unreferenced images and decoded
 * formats we don't support are skipped with a warning rather than throwing.
 */
export async function extractUsdcImages(buffer: ArrayBuffer): Promise<ExtractedUsdcImage[]> {
  if (usdSceneFactoryOverride) {
    const factory = usdSceneFactoryOverride;
    usdSceneFactoryOverride = null;
    const usdScene = factory(buffer);
    return collectImagesFromUsdScene(usdScene);
  }

  const { loader } = await getParserHandles();
  const binary = new Uint8Array(buffer);

  const viaUsdc = await new Promise<ExtractedUsdcImage[]>((resolve, reject) => {
    loader.parse(
      binary,
      "asset.usdz",
      (usdScene) => {
        collectImagesFromUsdScene(usdScene).then(
          (out) => resolve(out),
          (error) => reject(error instanceof Error ? error : new Error(String(error))),
        );
      },
      (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

  if (viaUsdc.length > 0) return viaUsdc;

  // Fallback: tinyusdz couldn't surface any material→texture chain (common for
  // USDZ assets where material binding lives on parent xforms or variant sets).
  // USDZ archives are uncompressed ZIPs by spec, so we can crack the container
  // ourselves and pull every embedded image out. This keeps the assets visible
  // in the editor even when the binding graph is too complex for tinyusdz.
  return extractImagesFromUsdzZip(binary);
}

interface ZipEntry {
  filename: string;
  data: Uint8Array;
}

/**
 * Minimal ZIP reader for USDZ archives. USDZ files are guaranteed to be ZIP
 * containers with all entries STORED (compression method 0) and 64-byte aligned
 * (per the Pixar USDZ spec). We only need to find the End-of-Central-Directory
 * record, walk the central directory, and for each STORED entry slice into the
 * archive bytes. No deflate/zlib dependency required.
 */
function readUsdzZipEntries(bytes: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  if (bytes.byteLength < 22) return entries;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Locate End of Central Directory record (signature 0x06054b50). Search from
  // the end, allowing for the optional comment field (max 65535 bytes).
  let eocdOffset = -1;
  const minSearch = Math.max(0, bytes.byteLength - 22 - 65535);
  for (let i = bytes.byteLength - 22; i >= minSearch; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return entries;

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const decoder = new TextDecoder("utf-8");
  let pos = cdOffset;
  for (let i = 0; i < totalEntries && pos + 46 <= cdOffset + cdSize; i += 1) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const filenameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    const filename = decoder.decode(bytes.subarray(pos + 46, pos + 46 + filenameLength));

    if (compressionMethod === 0 && uncompressedSize > 0
      && localHeaderOffset + 30 <= bytes.byteLength
      && view.getUint32(localHeaderOffset, true) === 0x04034b50) {
      const localFnLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localFnLen + localExtraLen;
      if (dataStart + uncompressedSize <= bytes.byteLength) {
        entries.push({ filename, data: bytes.subarray(dataStart, dataStart + uncompressedSize) });
      }
    } else if (compressionMethod !== 0) {
      console.warn(`tinyusdz: zip entry "${filename}" uses compression ${compressionMethod}; skipping (USDZ requires STORED)`);
    }

    pos += 46 + filenameLength + extraLength + commentLength;
  }

  return entries;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp"]);

async function extractImagesFromUsdzZip(bytes: Uint8Array): Promise<ExtractedUsdcImage[]> {
  const entries = readUsdzZipEntries(bytes);
  const results: ExtractedUsdcImage[] = [];

  for (const entry of entries) {
    const dotIdx = entry.filename.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const ext = entry.filename.slice(dotIdx + 1).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    if (entry.data.byteLength === 0) continue;

    const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "webp" ? "image/webp"
      : ext === "bmp" ? "image/bmp"
      : "image/png";

    let dims = { width: 0, height: 0 };
    try {
      dims = await readImageDimensionsFromBytes(entry.data, mimeType);
    } catch (error) {
      console.warn(`tinyusdz: could not read dimensions for ${entry.filename}:`, error);
    }

    const base64 = bytesToBase64(entry.data);
    const displayName = entry.filename.replace(/^\d+\//, "");
    results.push({
      name: displayName,
      mimeType,
      src: `data:${mimeType};base64,${base64}`,
      width: dims.width,
      height: dims.height,
    });
  }

  return results;
}

function readImageDimensionsFromBytes(bytes: Uint8Array, mimeType: string): Promise<{ width: number; height: number }> {
  // Quick path: PNG IHDR is at fixed offset (sig 8 bytes + length 4 + type 4 = byte 16 onwards: width@16, height@20, both big-endian uint32).
  if (mimeType === "image/png" && bytes.byteLength >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Promise.resolve({ width: dv.getUint32(16, false), height: dv.getUint32(20, false) });
  }
  // Generic path via <img>: works in DOM contexts (browser); harmless if it fails.
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      reject(new Error("No DOM for image dimension probe"));
      return;
    }
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("img.onerror"));
    };
    img.src = url;
  });
}
