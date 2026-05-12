import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultFontAsset } from "./fonts";
import { generateTypeScriptComponent } from "./exports";
import { createExportPackageData, createExportPackageZipBlob } from "./exportPackage";
import { createBlueprintFixture } from "../test/fixtures";
import type { ImageAsset } from "./types";

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

  it("builds a package manifest with blueprint, TypeScript, and referenced asset files", async () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Hero Banner";

    const packageData = await createExportPackageData(blueprint);
    const typeScriptFile = packageData.files.find((file) => file.path === packageData.typeScriptFileName);
    const blueprintFile = packageData.files.find((file) => file.path === packageData.blueprintFileName);
    const fontFile = packageData.files.find((file) => file.path.startsWith("assets/fonts/"));
    const imageFile = packageData.files.find((file) => file.path.startsWith("assets/images/"));
    const typeScriptContent = String(typeScriptFile?.content ?? "");
    const blueprintContent = String(blueprintFile?.content ?? "");

    expect(packageData.zipFileName).toBe("hero-banner.zip");
    expect(packageData.typeScriptFileName).toBe("hero-banner.ts");
    expect(packageData.blueprintFileName).toBe("hero-banner.blueprint.json");
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

  it("packages image assets referenced by imageId and deduplicates by source", async () => {
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

    const packageData = await createExportPackageData(blueprint);
    const imageFiles = packageData.files.filter((file) => file.path.startsWith("assets/images/"));
    const typeScriptContent = String(packageData.files.find((file) => file.path === packageData.typeScriptFileName)?.content ?? "");

    expect(imageFiles).toHaveLength(1);
    expect(imageFiles[0]?.path).toContain("shared-poster");
    expect(typeScriptContent.match(/\.\/assets\/images\/shared-poster\.png/g)).toHaveLength(2);
  });

  it("packages the generated files into a ZIP archive", async () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Hero Banner";

    const packageData = await createExportPackageData(blueprint);
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

// ---------------------------------------------------------------------------
// Phase 2 — image-sequence packaging
// ---------------------------------------------------------------------------

function makeSequenceImageAsset(opts: {
  id: string;
  name: string;
  manifestPath: string;
  sourceHashFull: string;
  frameCount: number;
  format?: "webp" | "png";
}): ImageAsset {
  const ext = opts.format ?? "webp";
  return {
    id: opts.id,
    name: opts.name,
    mimeType: "application/x-image-sequence",
    src: "blob:fake-frame-1",
    width: 1920,
    height: 1080,
    sequence: {
      type: "image-sequence",
      version: 3,
      format: ext,
      source: opts.name,
      framePattern: `frame_%06d.${ext}`,
      frameCount: opts.frameCount,
      fps: 25,
      width: 1920,
      height: 1080,
      durationSec: opts.frameCount / 25,
      loop: true,
      alpha: true,
      pixelFormat: "rgba",
      frameUrls: Array.from({ length: opts.frameCount }, (_, i) => `blob:fake-frame-${i + 1}`),
      storageType: "project-folder",
      manifestPath: opts.manifestPath,
      sourceHash: `sha256:${opts.sourceHashFull}`,
    },
  };
}

describe("exportPackage — image sequences (Phase 2)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.startsWith("blob:fake-frame-")) {
        const idx = url.replace("blob:fake-frame-", "");
        const bytes = new TextEncoder().encode(`mock-frame-${idx}-payload`);
        return new Response(bytes);
      }
      throw new Error(`unmocked fetch: ${url}`);
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("packages a project-folder sequence: sequence.json + every frame under Resources/Textures/<folder>/", async () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "SequenceProject";
    const imageNode = blueprint.nodes.find((n) => n.type === "image");
    if (!imageNode || imageNode.type !== "image") throw new Error("fixture needs an image node");
    const seqAsset = makeSequenceImageAsset({
      id: "seq-1",
      name: "PITCH_IN.mov",
      manifestPath: "Resources/Textures/pitch_in_sequence_abc12345/sequence.json",
      sourceHashFull: "abc12345deadbeef".repeat(4),
      frameCount: 3,
      format: "webp",
    });
    imageNode.imageId = seqAsset.id;
    imageNode.image = seqAsset;
    blueprint.images = [seqAsset];

    const pkg = await createExportPackageData(blueprint);
    const folder = "Resources/Textures/pitch_in_sequence_abc12345";
    const seqJsonFile = pkg.files.find((f) => f.path === `${folder}/sequence.json`);
    expect(seqJsonFile).toBeDefined();
    for (let i = 1; i <= 3; i += 1) {
      const frameFile = pkg.files.find((f) => f.path === `${folder}/frame_${String(i).padStart(6, "0")}.webp`);
      expect(frameFile, `frame ${i} missing`).toBeDefined();
      expect(frameFile?.content).toBeInstanceOf(Uint8Array);
    }
    expect(pkg.diagnostics.sequencesFound).toBe(1);
    expect(pkg.diagnostics.sequencesPackaged).toBe(1);
    expect(pkg.diagnostics.rewrittenManifestPaths).toContain(`${folder}/sequence.json`);
  });

  it("rewrites sequence.manifestPath in the exported blueprint to the Resources/Textures path", async () => {
    const blueprint = createBlueprintFixture();
    const imageNode = blueprint.nodes.find((n) => n.type === "image");
    if (!imageNode || imageNode.type !== "image") throw new Error("fixture needs an image node");
    const seqAsset = makeSequenceImageAsset({
      id: "seq-1",
      name: "PITCH_IN.mov",
      manifestPath: "Resources/Textures/pitch_in_sequence_abc12345/sequence.json",
      sourceHashFull: "abc12345deadbeef".repeat(4),
      frameCount: 2,
      format: "webp",
    });
    imageNode.imageId = seqAsset.id;
    imageNode.image = seqAsset;
    blueprint.images = [seqAsset];

    const pkg = await createExportPackageData(blueprint);
    const blueprintFile = pkg.files.find((f) => f.path === pkg.blueprintFileName);
    const exportedBp = JSON.parse(String(blueprintFile?.content ?? "{}"));
    const exportedAsset = exportedBp.images[0];
    // Folder-mirror: the exported manifestPath equals the original
    // project-folder layout, so blueprint and on-disk project agree.
    expect(exportedAsset.sequence.manifestPath).toBe("Resources/Textures/pitch_in_sequence_abc12345/sequence.json");
    expect(exportedAsset.sequence.storageType).toBe("project-folder");
    expect(exportedAsset.sequence.frameUrls).toEqual([]);
    expect(exportedAsset.sequence.framePattern).toBe("frame_%06d.webp");
    expect(exportedAsset.sequence.frameCount).toBe(2);
    expect(exportedAsset.sequence.fps).toBe(25);
    expect(exportedAsset.sequence.format).toBe("webp");
    expect(exportedAsset.sequence.alpha).toBe(true);
    expect(exportedAsset.sequence.sourceHash).toMatch(/^sha256:/);

    // sequence.json mirrored inside the zip mirrors the project folder.
    const seqJsonFile = pkg.files.find((f) => f.path === "Resources/Textures/pitch_in_sequence_abc12345/sequence.json");
    const seqJsonContent = JSON.parse(String(seqJsonFile?.content ?? "{}"));
    expect(seqJsonContent.storageType).toBe("project-folder");
    expect(seqJsonContent.frameUrls).toBeUndefined();
  });

  it("exported blueprint contains no absolute Windows paths nor blob: URLs nor /api/w3d/convert-mov/ URLs", async () => {
    const blueprint = createBlueprintFixture();
    const imageNode = blueprint.nodes.find((n) => n.type === "image");
    if (!imageNode || imageNode.type !== "image") throw new Error("fixture needs an image node");
    const seqAsset = makeSequenceImageAsset({
      id: "seq-1",
      name: "PITCH_IN.mov",
      manifestPath: "Resources/Textures/pitch_in_sequence_abc12345/sequence.json",
      sourceHashFull: "abc12345".repeat(8),
      frameCount: 1,
    });
    imageNode.imageId = seqAsset.id;
    imageNode.image = seqAsset;
    blueprint.images = [seqAsset];

    const pkg = await createExportPackageData(blueprint);
    const blueprintFile = pkg.files.find((f) => f.path === pkg.blueprintFileName);
    const blueprintText = String(blueprintFile?.content ?? "");
    expect(blueprintText).not.toMatch(/[A-Z]:\\\\/);
    expect(blueprintText).not.toMatch(/blob:/);
    expect(blueprintText).not.toMatch(/\/api\/w3d\/convert-mov\//);
  });

  it("missing frame URLs (fetch fails) push a clear warning into diagnostics; sequence is skipped", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error("blob revoked");
    });
    const blueprint = createBlueprintFixture();
    const imageNode = blueprint.nodes.find((n) => n.type === "image");
    if (!imageNode || imageNode.type !== "image") throw new Error("fixture needs an image node");
    const seqAsset = makeSequenceImageAsset({
      id: "seq-broken",
      name: "BROKEN.mov",
      manifestPath: "Resources/Textures/broken_sequence_def01234/sequence.json",
      sourceHashFull: "def01234".repeat(8),
      frameCount: 2,
    });
    imageNode.imageId = seqAsset.id;
    imageNode.image = seqAsset;
    blueprint.images = [seqAsset];

    const pkg = await createExportPackageData(blueprint);
    expect(pkg.diagnostics.sequencesPackaged).toBe(0);
    expect(pkg.diagnostics.sequencesSkipped.length).toBe(1);
    expect(pkg.diagnostics.sequencesSkipped[0].name).toContain("BROKEN");
    expect(pkg.diagnostics.warnings.some((w) => /BROKEN/.test(w))).toBe(true);
  });

  it("dev-cache sequence: with live frameUrls, packages it but pushes a non-portable warning", async () => {
    const blueprint = createBlueprintFixture();
    const imageNode = blueprint.nodes.find((n) => n.type === "image");
    if (!imageNode || imageNode.type !== "image") throw new Error("fixture needs an image node");
    const seqAsset = makeSequenceImageAsset({
      id: "seq-dev",
      name: "DEV.mov",
      manifestPath: "tmp/dev-cache/dev_sequence_xyz98765/sequence.json",
      sourceHashFull: "xyz98765".repeat(8),
      frameCount: 1,
    });
    seqAsset.sequence!.storageType = "dev-cache";
    imageNode.imageId = seqAsset.id;
    imageNode.image = seqAsset;
    blueprint.images = [seqAsset];

    const pkg = await createExportPackageData(blueprint);
    expect(pkg.diagnostics.sequencesPackaged).toBe(1);
    // dev-cache → packaged + warning that it was promoted to project-folder
    expect(pkg.diagnostics.warnings.some((w) => /Temporary|promoted|project-folder/i.test(w))).toBe(true);
    const blueprintFile = pkg.files.find((f) => f.path === pkg.blueprintFileName);
    const exportedBp = JSON.parse(String(blueprintFile?.content ?? "{}"));
    // Storage type is promoted to project-folder (same code path as a
    // first-class import). The exported manifest lives under
    // Resources/Textures/, never under tmp/dev-cache/.
    expect(exportedBp.images[0].sequence.storageType).toBe("project-folder");
    expect(exportedBp.images[0].sequence.manifestPath).toMatch(/^Resources\/Textures\//);
    expect(exportedBp.images[0].sequence.manifestPath).not.toMatch(/dev-cache|tmp\//);
  });

  it("does not regress existing image-export behaviour: a static image node still exports under assets/images/", async () => {
    const blueprint = createBlueprintFixture();
    const pkg = await createExportPackageData(blueprint);
    const imageFile = pkg.files.find((f) => f.path.startsWith("assets/images/"));
    expect(imageFile).toBeDefined();
  });
});
