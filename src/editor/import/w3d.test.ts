import { describe, expect, it } from "vitest";
import { parseW3D } from "./w3d";
import type { ImageAsset } from "../types";
// Vite's ?raw import keeps the test runtime self-contained without Node fs.
import testSceneXml from "../../test/fixtures/w3d/TestScene.w3d?raw";
import gameNameFsXml from "../../test/fixtures/w3d/GameName_FS.w3d?raw";

describe("W3D import", () => {
  it("parses the simple TestScene fixture", () => {
    const result = parseW3D(testSceneXml, { sceneName: "TestScene" });

    expect(result.blueprint.componentName).toBe("TestScene");
    const root = result.blueprint.nodes.find((node) => node.parentId === null);
    expect(root?.type).toBe("group");

    const disk = result.blueprint.nodes.find((node) => node.name === "Disk1");
    expect(disk?.type).toBe("circle");
    expect(disk?.transform.position.x).toBeCloseTo(-4.19);
    if (disk?.type === "circle") {
      expect(disk.geometry.radius).toBeCloseTo(0.5);
      // 3Forge stores arc length in `thetaStarts` (yes, naming is reversed).
      expect(disk.geometry.thetaStarts).toBeCloseTo(Math.PI * 2, 3);
      // Start angle is stored in `thetaLenght`.
      expect(disk.geometry.thetaLenght).toBeCloseTo(0, 3);
    }

    expect(result.blueprint.animation.clips.length).toBe(2);
    const clipNames = result.blueprint.animation.clips.map((c) => c.name).sort();
    expect(clipNames).toEqual(["In", "Out"]);

    const inClip = result.blueprint.animation.clips.find((c) => c.name === "In");
    const track = inClip?.tracks[0];
    expect(track?.property).toBe("transform.position.x");
    expect(track?.keyframes.length).toBe(2);

    expect(result.warnings.some((w) => w.includes("DirectionalLight"))).toBe(true);
  });

  it("uses 25 fps for HD1080i50 timeline format", () => {
    const result = parseW3D(testSceneXml, { sceneName: "TestScene" });
    for (const clip of result.blueprint.animation.clips) {
      expect(clip.fps).toBe(25);
    }
  });

  it("parses the complex GameName_FS fixture without crashing", () => {
    const result = parseW3D(gameNameFsXml, { sceneName: "GameName_FS" });

    expect(result.blueprint.componentName).toBe("GameName_FS");
    expect(result.blueprint.nodes.length).toBeGreaterThan(20);

    const planes = result.blueprint.nodes.filter((node) => node.type === "plane");
    expect(planes.length).toBeGreaterThan(10);

    const groupNames = result.blueprint.nodes
      .filter((node) => node.type === "group")
      .map((node) => node.name);
    expect(groupNames).toContain("TEMPLATE");
    expect(groupNames).toContain("CONTENT");

    const texts = result.blueprint.nodes.filter((node) => node.type === "text");
    expect(texts.length).toBeGreaterThan(0);

    const clipNames = result.blueprint.animation.clips.map((c) => c.name);
    expect(clipNames).toContain("In");

    const maskNodes = result.blueprint.nodes.filter((n) => n.isMask === true);
    expect(maskNodes.length).toBeGreaterThan(0);
    const maskedNodes = result.blueprint.nodes.filter((n) => typeof n.maskId === "string");
    expect(maskedNodes.length).toBeGreaterThan(0);
    // Every maskId must point to a node that exists and is itself a mask.
    for (const masked of maskedNodes) {
      const mask = result.blueprint.nodes.find((n) => n.id === masked.maskId);
      expect(mask?.isMask).toBe(true);
    }
  });

  it("resolves <ImageSequence> resources to image nodes when supplied as video assets", () => {
    // GameName_FS references four .mov clips via <ImageSequence> entries in
    // <Resources>. Without the ImageSequence lookup the parser would treat
    // the layer's Texture GUID as unresolved and fall back to a plane.
    const videoFilenames = [
      "04_Game_Name_PITCH_IN.mov",
      "04_Game_Name_PITCH_OUT.mov",
      "CompetitionLogo_In.mov",
      "NEW LKL logo_LOOP_alt.mov",
    ];
    const textures = new Map<string, ImageAsset>();
    for (const name of videoFilenames) {
      textures.set(name, {
        name,
        mimeType: "video/quicktime",
        src: `blob:mock-${name}`,
        width: 1920,
        height: 1080,
      });
    }

    const result = parseW3D(gameNameFsXml, { sceneName: "GameName_FS", textures });

    const imageNodes = result.blueprint.nodes.filter((n) => n.type === "image");
    const videoImageNodes = imageNodes.filter(
      (n) => n.type === "image" && n.image.mimeType.startsWith("video/"),
    );
    expect(videoImageNodes.length).toBe(videoFilenames.length);

    // The parser must not also report the four ImageSequence GUIDs as missing.
    const missingWarning = result.warnings.find((w) => w.startsWith("Missing"));
    if (missingWarning) {
      for (const name of videoFilenames) {
        expect(missingWarning).not.toContain(name);
      }
    }
  });
});
