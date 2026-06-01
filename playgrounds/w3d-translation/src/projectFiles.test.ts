import { describe, expect, it } from "vitest";
import {
  collectSceneMovFiles,
  collectSceneTextureFiles,
  indexW3DProject,
} from "./projectFiles";

function makeFile(path: string): File {
  const file = new File(["x"], path.split(/[\\/]/).pop() ?? path);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("indexW3DProject", () => {
  it("discovers scenes and project-level fonts from an R3-style project root", () => {
    const files = [
      makeFile("26PT_WTV_BASKETBALL/LINEUP_LEFT/scene.w3d"),
      makeFile("26PT_WTV_BASKETBALL/LINEUP_LEFT/Resources/Textures/Background.png"),
      makeFile("26PT_WTV_BASKETBALL/LINEUP_RIGHT/scene.w3d"),
      makeFile("26PT_WTV_BASKETBALL/Resources/Fonts/ObviouslyCond-Bold.otf"),
      makeFile("26PT_WTV_BASKETBALL/_GRAPHICS/FONTS/Obviously-LightItalic.otf"),
    ];

    const project = indexW3DProject(files);

    expect(project.projectName).toBe("26PT_WTV_BASKETBALL");
    expect(project.scenes.map((scene) => scene.name)).toEqual(["LINEUP_LEFT", "LINEUP_RIGHT"]);
    expect(project.fontFiles.map((file) => file.name).sort()).toEqual([
      "Obviously-LightItalic.otf",
      "ObviouslyCond-Bold.otf",
    ]);
  });

  it("discovers fonts under any case-insensitive `fonts` segment, top-level, and woff", () => {
    const files = [
      makeFile("26PT/LINEUP_LEFT/scene.w3d"),
      makeFile("26PT/Resources/Fonts/Obviously-Bold.otf"),         // mixed-case
      makeFile("26PT/resources/fonts/obviouslycond-bold.otf"),      // all lowercase
      makeFile("26PT/_GRAPHICS/FONTS/Obviously-LightItalic.otf"),   // UPPERCASE
      makeFile("26PT/_Graphics/Fonts/ObviouslyCond-Black.otf"),     // mixed segments
      makeFile("FONTS/Top-Level.woff2"),                            // top-level + woff2
      makeFile("26PT/Resources/Fonts/Roboto-Regular.woff"),         // woff
      makeFile("26PT/Other/stray.otf"),                             // NOT under a fonts dir → ignored
    ];

    const project = indexW3DProject(files);
    const names = project.fontFiles.map((file) => file.name).sort();

    expect(names).toEqual([
      "Obviously-Bold.otf",
      "Obviously-LightItalic.otf",
      "ObviouslyCond-Black.otf",
      "Roboto-Regular.woff",
      "Top-Level.woff2",
      "obviouslycond-bold.otf",
    ]);
    expect(names).not.toContain("stray.otf");
  });

  it("resolves shared parent fonts when the project root is imported (scene in a subfolder)", () => {
    // The real fix: importing 26PT_WTV_BASKETBALL (root) makes LINEUP_LEFT resolve
    // ObviouslyCond/Obviously from the sibling _GRAPHICS/FONTS. (Importing only
    // LINEUP_LEFT cannot — browser can't read sibling folders — so the loader warns.)
    const files = [
      makeFile("26PT_WTV_BASKETBALL/LINEUP_LEFT/scene.w3d"),
      makeFile("26PT_WTV_BASKETBALL/_GRAPHICS/FONTS/ObviouslyCond-Bold.otf"),
      makeFile("26PT_WTV_BASKETBALL/_GRAPHICS/FONTS/Obviously-Light.otf"),
    ];
    const project = indexW3DProject(files);
    expect(project.scenes.map((s) => s.name)).toEqual(["LINEUP_LEFT"]);
    expect(project.fontFiles.map((f) => f.name).sort()).toEqual([
      "Obviously-Light.otf",
      "ObviouslyCond-Bold.otf",
    ]);
  });

  it("scopes textures and videos to the selected scene", () => {
    const files = [
      makeFile("PROJ/LINEUP_LEFT/scene.w3d"),
      makeFile("PROJ/LINEUP_LEFT/Resources/Textures/Background.png"),
      makeFile("PROJ/LINEUP_LEFT/Resources/Textures/Pitch_In.mov"),
      makeFile("PROJ/LINEUP_RIGHT/scene.w3d"),
      makeFile("PROJ/LINEUP_RIGHT/Resources/Textures/Other.png"),
      makeFile("PROJ/Resources/Textures/Shared.png"),
    ];
    const project = indexW3DProject(files);
    const lineupLeft = project.scenes.find((scene) => scene.name === "LINEUP_LEFT");

    expect(lineupLeft).toBeDefined();
    expect(collectSceneTextureFiles(files, lineupLeft!).map((file) => file.name)).toEqual(["Background.png"]);
    expect(collectSceneMovFiles(files, lineupLeft!).map((file) => file.name)).toEqual(["Pitch_In.mov"]);
  });
});
