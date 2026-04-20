import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createDefaultFontAsset } from "./fonts";
import { generateTypeScriptComponent } from "./exports";
import { createExportPackageData, createExportPackageZipBlob } from "./exportPackage";
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
