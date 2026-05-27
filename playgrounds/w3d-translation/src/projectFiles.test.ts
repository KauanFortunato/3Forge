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
