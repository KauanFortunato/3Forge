import { describe, expect, it } from "vitest";
import { parseW3DFromFolder } from "./w3dFolder";

function makeFile(path: string, body: string): File {
  const file = new File([body], path.split(/[\\/]/).pop() ?? path, { type: "text/xml" });
  // Mimic the `webkitRelativePath` that `<input webkitdirectory>` provides.
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

const MINIMAL_SCENE_XML = `<?xml version="1.0"?>
<Scene Name="Demo" Is2DScene="True">
  <SceneLayer BackgroundColor="-65536" />
</Scene>`;

describe("parseW3DFromFolder", () => {
  it("finds scene.w3d at the folder root and parses it", async () => {
    const files = [
      makeFile("LINEUP_LEFT/scene.w3d", MINIMAL_SCENE_XML),
      makeFile("LINEUP_LEFT/Resources/Textures/foo.png", "binary"),
    ];

    const result = await parseW3DFromFolder(files);

    expect(result.sceneFileName).toBe("LINEUP_LEFT/scene.w3d");
    expect(result.blueprint.componentName).toBe("Demo");
    expect(result.blueprint.sceneSettings?.mode).toBe("2d");
    expect(result.blueprint.sceneSettings?.backgroundColor).toBe("#ff0000");
  });

  it("falls back to a versioned .w3d when scene.w3d is missing", async () => {
    const files = [
      makeFile("Proj/scene_3.5.2.w3d", MINIMAL_SCENE_XML),
      makeFile("Proj/Resources/Textures/foo.png", "binary"),
    ];

    const result = await parseW3DFromFolder(files);

    expect(result.sceneFileName).toBe("Proj/scene_3.5.2.w3d");
    expect(result.blueprint.componentName).toBe("Demo");
  });

  it("throws when no .w3d file is present", async () => {
    const files = [makeFile("Empty/readme.txt", "hi")];

    await expect(parseW3DFromFolder(files)).rejects.toThrowError(/No \.w3d scene/);
  });

  it("throws on an empty file list", async () => {
    await expect(parseW3DFromFolder([])).rejects.toThrowError(/No files/);
  });

  it("collects .mov files under Resources/Textures/", async () => {
    const files = [
      makeFile("PROJ/scene.w3d", MINIMAL_SCENE_XML),
      makeFile("PROJ/Resources/Textures/Pitch_In.mov", "binary"),
      makeFile("PROJ/Resources/Textures/Pitch_Out.MP4", "binary"),
      makeFile("PROJ/Resources/Textures/Background.png", "binary"),
      // .mov outside of Resources/Textures should be ignored.
      makeFile("PROJ/Other/foo.mov", "binary"),
    ];

    const result = await parseW3DFromFolder(files);
    const names = result.movFiles.map((f) => f.name).sort();

    expect(names).toEqual(["Pitch_In.mov", "Pitch_Out.MP4"]);
  });

  it("returns empty movFiles when the folder has none", async () => {
    const files = [makeFile("PROJ/scene.w3d", MINIMAL_SCENE_XML)];

    const result = await parseW3DFromFolder(files);

    expect(result.movFiles).toEqual([]);
    expect(result.rasterTextureFiles).toEqual([]);
  });

  it("collects raster textures under Resources/Textures/", async () => {
    const files = [
      makeFile("PROJ/scene.w3d", MINIMAL_SCENE_XML),
      makeFile("PROJ/Resources/Textures/Background.png", "binary"),
      makeFile("PROJ/Resources/Textures/Player 1.png", "binary"),
      makeFile("PROJ/Resources/Textures/badge.JPG", "binary"),
      makeFile("PROJ/Resources/Textures/logo.svg", "binary"),
      makeFile("PROJ/Resources/Textures/Pitch_In.mov", "binary"),
      // Raster outside Resources/Textures/ is ignored.
      makeFile("PROJ/Other/icon.png", "binary"),
      // Unknown extensions ignored.
      makeFile("PROJ/Resources/Textures/notes.txt", "txt"),
    ];

    const result = await parseW3DFromFolder(files);
    const rasters = result.rasterTextureFiles.map((f) => f.name).sort();

    expect(rasters).toEqual(["Background.png", "Player 1.png", "badge.JPG", "logo.svg"]);
    expect(result.movFiles.map((f) => f.name)).toEqual(["Pitch_In.mov"]);
  });
});
