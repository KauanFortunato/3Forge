import { Group } from "three";

import type { TinyUSDZLoader as TinyUSDZLoaderType } from "../wasm/tinyusdz/TinyUSDZLoader";
import type { TinyUSDZLoaderUtils as TinyUSDZLoaderUtilsType } from "../wasm/tinyusdz/TinyUSDZLoaderUtils";

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

// DIAGNOSTIC LOGGING — REMOVE AFTER USER TEST
function logUsdcDiagnostics(usdScene: unknown, bufferSize: number, rootSource: string, rootCount: number): void {
  try {
    console.log(`[3FORGE-USDC-DEBUG] buffer size: ${bufferSize} bytes`);
    console.log(`[3FORGE-USDC-DEBUG] root nodes via "${rootSource}": ${rootCount} nodes`);

    const scene = (usdScene ?? {}) as UsdScene;

    try {
      const ownKeys = Object.keys(scene);
      console.log(`[3FORGE-USDC-DEBUG] usdScene own keys: ${ownKeys.join(", ")}`);
    } catch (error) {
      console.log("[3FORGE-USDC-DEBUG] could not read own keys:", error);
    }

    try {
      const proto = Object.getPrototypeOf(scene);
      const protoMethods = proto ? Object.getOwnPropertyNames(proto) : [];
      console.log(`[3FORGE-USDC-DEBUG] usdScene prototype methods: ${protoMethods.join(", ")}`);
    } catch (error) {
      console.log("[3FORGE-USDC-DEBUG] could not read prototype methods:", error);
    }

    // Mesh iteration — meshes own materialId; materials own *TextureId; textures own textureImageId.
    const textureIdKeys = [
      "diffuseColorTextureId",
      "normalTextureId",
      "roughnessTextureId",
      "metallicTextureId",
      "emissiveColorTextureId",
      "opacityTextureId",
      "occlusionTextureId",
      "displacementTextureId",
    ] as const;

    let meshCount = 0;
    try {
      const raw = scene.numMeshes;
      if (typeof raw === "function") {
        const result = (raw as (this: unknown) => unknown).call(scene);
        meshCount = typeof result === "number" ? result : 0;
      } else if (typeof raw === "number") {
        meshCount = raw;
      } else {
        console.log(`[3FORGE-USDC-DEBUG] numMeshes is neither function nor number: ${typeof raw}`);
      }
    } catch (error) {
      console.log("[3FORGE-USDC-DEBUG] reading numMeshes threw:", error);
    }
    console.log(`[3FORGE-USDC-DEBUG] numMeshes: ${meshCount}`);

    if (typeof scene.getMesh !== "function") {
      console.log("[3FORGE-USDC-DEBUG] usdScene.getMesh is not a function — cannot iterate meshes");
    } else {
      const limit = Math.min(meshCount, 20);
      for (let i = 0; i < limit; i++) {
        let mesh: unknown;
        try {
          mesh = (scene.getMesh as (this: unknown, idx: number) => unknown).call(scene, i);
        } catch (error) {
          console.log(`[3FORGE-USDC-DEBUG] getMesh(${i}) threw:`, error);
          continue;
        }
        if (!mesh || typeof mesh !== "object") {
          console.log(`[3FORGE-USDC-DEBUG] mesh[${i}] is not an object: ${typeof mesh}`);
          continue;
        }
        const meshObj = mesh as Record<string, unknown>;
        try {
          console.log(`[3FORGE-USDC-DEBUG] mesh[${i}] keys: ${Object.keys(meshObj).join(",")}`);
        } catch (error) {
          console.log(`[3FORGE-USDC-DEBUG] mesh[${i}] Object.keys threw:`, error);
        }
        const materialId = meshObj.materialId;
        console.log(`[3FORGE-USDC-DEBUG] mesh[${i}].materialId: ${String(materialId)}`);

        if (
          materialId === undefined ||
          typeof materialId !== "number" ||
          materialId < 0 ||
          typeof scene.getMaterial !== "function"
        ) {
          continue;
        }

        let material: unknown;
        try {
          material = (scene.getMaterial as (this: unknown, id: number) => unknown).call(scene, materialId);
        } catch (error) {
          console.log(`[3FORGE-USDC-DEBUG] getMaterial(${materialId}) threw:`, error);
          continue;
        }
        if (!material || typeof material !== "object") {
          console.log(`[3FORGE-USDC-DEBUG] mesh[${i}] material is not an object: ${typeof material}`);
          continue;
        }
        const mat = material as Record<string, unknown>;
        try {
          console.log(`[3FORGE-USDC-DEBUG] mesh[${i}] material keys: ${Object.keys(mat).join(",")}`);
        } catch (error) {
          console.log(`[3FORGE-USDC-DEBUG] mesh[${i}] material Object.keys threw:`, error);
        }
        const has = (k: string) => Object.prototype.hasOwnProperty.call(mat, k);
        console.log(
          `[3FORGE-USDC-DEBUG] mesh[${i}] material has diffuseColorTextureId=${has(
            "diffuseColorTextureId",
          )} normalTextureId=${has("normalTextureId")} roughnessTextureId=${has(
            "roughnessTextureId",
          )} metallicTextureId=${has("metallicTextureId")} emissiveColorTextureId=${has(
            "emissiveColorTextureId",
          )} opacityTextureId=${has("opacityTextureId")} occlusionTextureId=${has(
            "occlusionTextureId",
          )} displacementTextureId=${has("displacementTextureId")}`,
        );

        for (const slot of textureIdKeys) {
          if (!has(slot)) continue;
          const textureId = mat[slot];
          console.log(`[3FORGE-USDC-DEBUG] mesh[${i}] material.${slot}: ${String(textureId)}`);

          if (
            textureId === undefined ||
            typeof textureId !== "number" ||
            textureId < 0 ||
            typeof scene.getTexture !== "function"
          ) {
            continue;
          }

          let texture: unknown;
          try {
            texture = (scene.getTexture as (this: unknown, id: number) => unknown).call(scene, textureId);
          } catch (error) {
            console.log(`[3FORGE-USDC-DEBUG] getTexture(${textureId}) threw:`, error);
            continue;
          }
          if (!texture || typeof texture !== "object") {
            console.log(`[3FORGE-USDC-DEBUG] texture[${textureId}] is not an object: ${typeof texture}`);
            continue;
          }
          const tex = texture as Record<string, unknown>;
          try {
            console.log(`[3FORGE-USDC-DEBUG] texture[${textureId}] keys: ${Object.keys(tex).join(",")}`);
          } catch (error) {
            console.log(`[3FORGE-USDC-DEBUG] texture[${textureId}] Object.keys threw:`, error);
          }
          const imageId = tex.textureImageId;
          console.log(`[3FORGE-USDC-DEBUG] texture[${textureId}].textureImageId: ${String(imageId)}`);

          if (
            imageId === undefined ||
            typeof imageId !== "number" ||
            imageId < 0 ||
            typeof scene.getImage !== "function"
          ) {
            continue;
          }

          let image: unknown;
          try {
            image = (scene.getImage as (this: unknown, id: number) => unknown).call(scene, imageId);
          } catch (error) {
            console.log(`[3FORGE-USDC-DEBUG] getImage(${imageId}) threw:`, error);
            continue;
          }
          if (!image || typeof image !== "object") {
            console.log(`[3FORGE-USDC-DEBUG] image[${imageId}] is not an object: ${typeof image}`);
            continue;
          }
          const img = image as Record<string, unknown>;
          const dataLen =
            img.data && typeof (img.data as { length?: unknown }).length === "number"
              ? (img.data as { length: number }).length
              : "no-data";
          console.log(
            `[3FORGE-USDC-DEBUG] image[${imageId}] uri: ${
              img.uri ? String(img.uri) : "none"
            }, bufferId: ${String(img.bufferId)}, decoded: ${String(img.decoded)}, data?.length: ${String(
              dataLen,
            )}, width: ${String(img.width)}, height: ${String(img.height)}, channels: ${String(img.channels)}`,
          );
        }
      }
      if (meshCount > limit) {
        console.log(`[3FORGE-USDC-DEBUG] ... and ${meshCount - limit} more meshes (truncated)`);
      }
    }

    // Fallback hint: if no meshes surfaced, the converted Group is the next thing to inspect.
    if (meshCount === 0) {
      console.log(
        "[3FORGE-USDC-DEBUG] no source meshes discoverable — converted three.js materials may still be inspected after parseUsdc returns",
      );
    }
  } catch (error) {
    console.log("[3FORGE-USDC-DEBUG] diagnostic block crashed (suppressed):", error);
  }
}

/**
 * Parses a USDZ binary that contains USDC (Pixar binary USD) payloads using the
 * tinyusdz WASM module. Returns a `Group` with the converted Three.js scene
 * graph. Texture loads kicked off by `buildThreeNode` are NOT awaited here —
 * callers should wrap this in {@link awaitTextureLoadsDuring} if they need to
 * guarantee that textures are decoded before consuming the result (e.g. for
 * GLTF re-export).
 */
export async function parseUsdc(buffer: ArrayBuffer): Promise<Group> {
  const { loader, utils } = await getParserHandles();
  const binary = new Uint8Array(buffer);

  return new Promise<Group>((resolve, reject) => {
    loader.parse(
      binary,
      "asset.usdz",
      (usdScene) => {
        try {
          const root = new Group();
          root.name = "USDC Root";
          const { nodes: rootNodes, source: rootSource } = discoverRootNodes(usdScene);

          // DIAGNOSTIC LOGGING — REMOVE AFTER USER TEST
          logUsdcDiagnostics(usdScene, buffer.byteLength, rootSource, rootNodes.length);

          if (rootNodes.length === 0) {
            console.warn(
              "tinyusdz: parsed USD scene exposed no root nodes — the resulting Group will be empty.",
            );
          }
          for (const node of rootNodes) {
            root.add(utils.buildThreeNode(node, null, usdScene, {}));
          }
          resolve(root);
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

/**
 * Test-only: clears the cached loader/wasm handles so subsequent calls to
 * {@link parseUsdc} re-initialize. Real callers should never need this.
 */
export function resetUsdcParserForTests(): void {
  handlesPromise = null;
}
