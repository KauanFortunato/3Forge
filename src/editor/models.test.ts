import { describe, expect, it } from "vitest";
import { MAX_MODEL_FILE_SIZE_BYTES, MODEL_FILE_TOO_LARGE_MESSAGE, isModelFile, modelFileToAsset } from "./models";

describe("model file imports", () => {
  it("accepts GLB and GLTF files by extension or MIME type", () => {
    expect(isModelFile(new File(["glb"], "hero.glb", { type: "" }))).toBe(true);
    expect(isModelFile(new File(["gltf"], "hero.gltf", { type: "" }))).toBe(true);
    expect(isModelFile(new File(["gltf"], "hero.txt", { type: "model/gltf+json" }))).toBe(true);
    expect(isModelFile(new File(["png"], "hero.png", { type: "image/png" }))).toBe(false);
  });

  it("converts a GLTF file to serializable model asset metadata", async () => {
    const asset = await modelFileToAsset(new File(["{}"], "Hero Model.gltf", { type: "model/gltf+json" }));

    expect(asset).toMatchObject({
      id: "",
      name: "Hero Model.gltf",
      mimeType: "model/gltf+json",
      format: "gltf",
      originalFileName: "Hero Model.gltf",
      source: "imported",
    });
    expect(asset.src).toMatch(/^data:model\/gltf\+json;base64,/);
  });

  it("rejects unsupported files", async () => {
    await expect(modelFileToAsset(new File(["text"], "notes.txt", { type: "text/plain" })))
      .rejects
      .toThrow("Unsupported model file.");
  });

  it("rejects model files larger than the supported import limit", async () => {
    const oversizedModel = new File([new Uint8Array(MAX_MODEL_FILE_SIZE_BYTES + 1)], "oversized.glb", {
      type: "model/gltf-binary",
    });

    await expect(modelFileToAsset(oversizedModel))
      .rejects
      .toThrow(MODEL_FILE_TOO_LARGE_MESSAGE);
  });
});
