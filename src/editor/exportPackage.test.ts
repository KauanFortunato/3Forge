import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createDefaultFontAsset } from "./fonts";
import { generateTypeScriptComponent } from "./exports";
import { createExportPackageData, createExportPackageZipBlob } from "./exportPackage";
import { HDR_FILE_TOO_LARGE_MESSAGE, MAX_HDR_FILE_SIZE_BYTES } from "./hdr";
import { MAX_MODEL_FILE_SIZE_BYTES, MODEL_FILE_TOO_LARGE_MESSAGE } from "./models";
import { createBlueprintFixture } from "../test/fixtures";

describe("exportPackage", () => {
  it("can generate TypeScript that resolves packaged assets through relative paths", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Hero Banner";

    const textNode = blueprint.nodes.find((node) => node.type === "text");
    const imageNode = blueprint.nodes.find((node) => node.type === "image");

    expect(textNode).toBeTruthy();
    expect(imageNode).toBeTruthy();

    textNode!.fontId = createDefaultFontAsset().id;

    const output = generateTypeScriptComponent(blueprint, {
      fontAssetPathsById: {
        [textNode!.fontId]: "./assets/fonts/hero-banner-font.typeface.json",
      },
      imageAssetPathsByNodeId: {
        [imageNode!.id]: "./assets/images/hero-banner-image.png",
      },
    });

    expect(output).toContain('fontLoader.loadAsync("./assets/fonts/hero-banner-font.typeface.json")');
    expect(output).toContain('./assets/images/hero-banner-image.png');
    expect(output).not.toContain("fontLoader.parse(");
  });

  it("builds a package manifest with blueprint, TypeScript, and referenced asset files", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Hero Banner";

    const packageData = createExportPackageData(blueprint);
    const typeScriptFile = packageData.files.find((file) => file.path === packageData.typeScriptFileName);
    const blueprintFile = packageData.files.find((file) => file.path === packageData.blueprintFileName);
    const fontFile = packageData.files.find((file) => file.path.startsWith("assets/fonts/"));
    const imageFile = packageData.files.find((file) => file.path.startsWith("assets/images/"));
    const typeScriptContent = String(typeScriptFile?.content ?? "");
    const blueprintContent = String(blueprintFile?.content ?? "");

    expect(packageData.zipFileName).toBe("hero-banner.zip");
    expect(packageData.typeScriptFileName).toBe("hero-banner.ts");
    expect(packageData.blueprintFileName).toBe("hero-banner.blueprint.3forge");
    expect(typeScriptFile).toBeTruthy();
    expect(blueprintFile).toBeTruthy();
    expect(fontFile).toBeTruthy();
    expect(imageFile).toBeTruthy();
    expect(typeof fontFile?.content).toBe("string");
    expect(imageFile?.content).toBeInstanceOf(Uint8Array);
    expect(typeScriptContent).toContain(`"./${fontFile?.path}"`);
    expect(typeScriptContent).toContain(`"./${imageFile?.path}"`);
    expect(JSON.parse(blueprintContent)).toEqual(blueprint);
  });

  it("packages image assets referenced by imageId and deduplicates by source", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Asset Images";
    const imageNodes = blueprint.nodes.filter((node) => node.type === "image");
    const firstImage = imageNodes[0];
    expect(firstImage).toBeTruthy();
    if (!firstImage || firstImage.type !== "image") {
      throw new Error("Expected fixture image.");
    }

    const sharedAsset = {
      id: "shared-poster",
      name: "Shared Poster.png",
      mimeType: "image/png",
      src: "data:image/png;base64,c2hhcmVk",
      width: 512,
      height: 256,
    };
    const secondImage = {
      ...firstImage,
      id: "second-image",
      name: "Second Image",
      imageId: sharedAsset.id,
      image: { ...firstImage.image, name: "Inline Fallback.png" },
    };
    firstImage.imageId = sharedAsset.id;
    firstImage.image = { ...firstImage.image, name: "Inline Fallback.png" };
    blueprint.images = [sharedAsset];
    blueprint.nodes.push(secondImage);

    const packageData = createExportPackageData(blueprint);
    const imageFiles = packageData.files.filter((file) => file.path.startsWith("assets/images/"));
    const typeScriptContent = String(packageData.files.find((file) => file.path === packageData.typeScriptFileName)?.content ?? "");

    expect(imageFiles).toHaveLength(1);
    expect(imageFiles[0]?.path).toContain("shared-poster");
    expect(typeScriptContent.match(/\.\/assets\/images\/shared-poster\.png/g)).toHaveLength(2);
  });

  it("packages GLB model assets and points TypeScript exports at assets/models", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Model Package";
    const sharedModel = {
      id: "shared-ship",
      name: "Shared Ship.glb",
      mimeType: "model/gltf-binary",
      src: "data:model/gltf-binary;base64,c2hpcA==",
      format: "glb" as const,
    };
    blueprint.models = [sharedModel];
    blueprint.nodes.push({
      id: "ship-a",
      name: "Ship A",
      type: "model",
      parentId: null,
      visible: true,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      origin: { x: "center", y: "center", z: "center" },
      editable: {},
      modelId: sharedModel.id,
    } as never);
    blueprint.nodes.push({
      id: "ship-b",
      name: "Ship B",
      type: "model",
      parentId: null,
      visible: true,
      transform: {
        position: { x: 2, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      origin: { x: "center", y: "center", z: "center" },
      editable: {},
      modelId: sharedModel.id,
    } as never);

    const packageData = createExportPackageData(blueprint);
    const modelFiles = packageData.files.filter((file) => file.path.startsWith("assets/models/"));
    const typeScriptContent = String(packageData.files.find((file) => file.path === packageData.typeScriptFileName)?.content ?? "");

    expect(modelFiles).toHaveLength(1);
    expect(modelFiles[0]?.path).toBe("assets/models/shared-ship.glb");
    expect(modelFiles[0]?.content).toBeInstanceOf(Uint8Array);
    expect(typeScriptContent).toContain('import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";');
    expect(typeScriptContent).toContain('"./assets/models/shared-ship.glb"');
    expect(typeScriptContent).toContain("gltfLoader.loadAsync");
  });

  it("packages selected HDR environment assets and points scene settings at assets/environments", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "HDR Package";
    blueprint.hdrs = [{
      id: "studio-hdr",
      name: "Studio HDR.hdr",
      mimeType: "image/vnd.radiance",
      src: "data:image/vnd.radiance;base64,aGRy",
    }];
    blueprint.sceneSettings = {
      ...blueprint.sceneSettings!,
      environment: {
        type: "hdr",
        hdrAssetId: "studio-hdr",
        intensity: 1.25,
      },
    };

    const packageData = createExportPackageData(blueprint);
    const hdrFiles = packageData.files.filter((file) => file.path.startsWith("assets/environments/"));
    const typeScriptContent = String(packageData.files.find((file) => file.path === packageData.typeScriptFileName)?.content ?? "");

    expect(hdrFiles).toHaveLength(1);
    expect(hdrFiles[0]?.path).toBe("assets/environments/studio-hdr.hdr");
    expect(hdrFiles[0]?.content).toBeInstanceOf(Uint8Array);
    expect(typeScriptContent).toContain('"hdrAssetPath": "./assets/environments/studio-hdr.hdr"');
  });

  it("rejects ZIP packages with oversized embedded HDR assets", () => {
    const blueprint = createBlueprintFixture();
    const oversizedBase64Length = Math.ceil((MAX_HDR_FILE_SIZE_BYTES + 1) / 3) * 4;
    const oversizedBase64 = "A".repeat(oversizedBase64Length);
    blueprint.hdrs = [{
      id: "oversized-hdr",
      name: "Oversized.hdr",
      mimeType: "image/vnd.radiance",
      src: `data:image/vnd.radiance;base64,${oversizedBase64}`,
    }];
    blueprint.sceneSettings = {
      ...blueprint.sceneSettings!,
      environment: {
        type: "hdr",
        hdrAssetId: "oversized-hdr",
        intensity: 1,
      },
    };

    expect(() => createExportPackageData(blueprint)).toThrow(HDR_FILE_TOO_LARGE_MESSAGE);
  });

  it("rejects ZIP packages with oversized embedded model assets", () => {
    const blueprint = createBlueprintFixture();
    const oversizedBase64Length = Math.ceil((MAX_MODEL_FILE_SIZE_BYTES + 1) / 3) * 4;
    const oversizedBase64 = "A".repeat(oversizedBase64Length);
    const model = {
      id: "oversized-model",
      name: "Oversized.glb",
      mimeType: "model/gltf-binary",
      src: `data:model/gltf-binary;base64,${oversizedBase64}`,
      format: "glb" as const,
    };
    blueprint.models = [model];
    blueprint.nodes.push({
      id: "oversized-node",
      name: "Oversized",
      type: "model",
      parentId: null,
      visible: true,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      origin: { x: "center", y: "center", z: "center" },
      editable: {},
      modelId: model.id,
    } as never);

    expect(() => createExportPackageData(blueprint)).toThrow(MODEL_FILE_TOO_LARGE_MESSAGE);
  });

  it("packages the generated files into a ZIP archive", async () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Hero Banner";

    const packageData = createExportPackageData(blueprint);
    const blob = await createExportPackageZipBlob(blueprint);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const fileNames = Object.keys(zip.files);

    expect(fileNames).toContain(packageData.typeScriptFileName);
    expect(fileNames).toContain(packageData.blueprintFileName);
    expect(fileNames.some((fileName) => fileName.startsWith("assets/fonts/"))).toBe(true);
    expect(fileNames.some((fileName) => fileName.startsWith("assets/images/"))).toBe(true);
    await expect(zip.file(packageData.typeScriptFileName)?.async("string")).resolves.toContain("fontLoader.loadAsync");
  });
});
