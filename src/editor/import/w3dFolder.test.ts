import { describe, expect, it } from "vitest";
import type { ImageAsset } from "../types";
import { collectTextureMap, parseW3D } from "./w3d";
import { classifyMovAssets } from "./w3dFolder";
import gameNameFsXml from "../../test/fixtures/w3d/GameName_FS.w3d?raw";

function makeFile(relativePath: string): File {
  const file = new File(["x"], relativePath.split("/").pop() ?? "f");
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    configurable: true,
  });
  return file;
}

describe("classifyMovAssets", () => {
  it("returns empty arrays when no .mov files are present", () => {
    const result = classifyMovAssets([
      makeFile("Project/Resources/Textures/logo.png"),
      makeFile("Project/scene.w3d"),
    ]);
    expect(result.withSequence.length).toBe(0);
    expect(result.withoutSequence.length).toBe(0);
  });

  it("classifies a .mov without a sibling sequence.json as 'withoutSequence'", () => {
    const result = classifyMovAssets([
      makeFile("Project/Resources/Textures/PITCH_IN.mov"),
    ]);
    expect(result.withoutSequence).toEqual([{ videoName: "PITCH_IN.mov" }]);
    expect(result.withSequence.length).toBe(0);
  });

  it("classifies a .mov with sibling <basename>_frames/sequence.json as 'withSequence'", () => {
    const result = classifyMovAssets([
      makeFile("Project/Resources/Textures/PITCH_IN.mov"),
      makeFile("Project/Resources/Textures/PITCH_IN_frames/sequence.json"),
      makeFile("Project/Resources/Textures/PITCH_IN_frames/frame_000001.png"),
    ]);
    expect(result.withSequence.length).toBe(1);
    expect(result.withSequence[0].videoName).toBe("PITCH_IN.mov");
    expect(result.withSequence[0].sequencePath).toBe(
      "Project/Resources/Textures/PITCH_IN_frames/sequence.json",
    );
    expect(result.withoutSequence.length).toBe(0);
  });

  it("handles many .mov files with mixed sequence presence", () => {
    const result = classifyMovAssets([
      makeFile("P/Resources/Textures/A.mov"),
      makeFile("P/Resources/Textures/A_frames/sequence.json"),
      makeFile("P/Resources/Textures/B.mov"),
      makeFile("P/Resources/Textures/C.mov"),
      makeFile("P/Resources/Textures/C_frames/sequence.json"),
    ]);
    expect(result.withSequence.map((s) => s.videoName).sort()).toEqual(["A.mov", "C.mov"]);
    expect(result.withoutSequence.map((s) => s.videoName).sort()).toEqual(["B.mov"]);
  });

  it("ignores .mov files outside Resources/Textures", () => {
    const result = classifyMovAssets([
      makeFile("Project/SomeOtherFolder/clip.mov"),
    ]);
    expect(result.withSequence.length).toBe(0);
    expect(result.withoutSequence.length).toBe(0);
  });
});

describe("W3D folder import (parser extensions)", () => {
  it("collectTextureMap resolves layer ids to filenames", () => {
    const map = collectTextureMap(gameNameFsXml);
    const filenames = new Set(map.values());
    expect(filenames.has("HomeTeamLogo_00025.png") || filenames.has("_0014_DPD_logo_white_rgb.png")).toBe(true);
    // Keys are lower-cased GUIDs.
    for (const key of map.keys()) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it("does not populate blueprint.images when no folder textures are supplied", () => {
    const result = parseW3D(gameNameFsXml, { sceneName: "GameName_FS" });
    expect(result.blueprint.images).toEqual([]);
  });

  it("converts a textured Quad into an image node when a matching ImageAsset is supplied", () => {
    const layerMap = collectTextureMap(gameNameFsXml);
    // Pick any filename actually referenced by a layer so we know a Quad uses it.
    const filename = Array.from(layerMap.values())[0];
    expect(filename).toBeTruthy();

    const fakeAsset: ImageAsset = {
      name: filename,
      mimeType: "image/png",
      src: "data:image/png;base64,AAAA",
      width: 64,
      height: 64,
    };

    const textures = new Map<string, ImageAsset>([[filename, fakeAsset]]);
    const result = parseW3D(gameNameFsXml, { sceneName: "GameName_FS", textures });

    expect(result.blueprint.images.length).toBeGreaterThanOrEqual(1);
    const stored = result.blueprint.images.find((asset) => asset.name === filename);
    expect(stored).toBeDefined();
    expect(stored?.id).toBeTruthy();

    const imageNode = result.blueprint.nodes.find(
      (node) => node.type === "image" && node.imageId === stored?.id,
    );
    expect(imageNode).toBeDefined();
    expect(imageNode?.type).toBe("image");

    // Compare transform against the reference plane parse to ensure no drift.
    const reference = parseW3D(gameNameFsXml, { sceneName: "GameName_FS" });
    const w3dId = result.blueprint.metadata?.w3d as { nodeIds: Record<string, string> } | undefined;
    const referenceW3d = reference.blueprint.metadata?.w3d as { nodeIds: Record<string, string> } | undefined;
    expect(w3dId && imageNode && w3dId.nodeIds[imageNode.id]).toBeTruthy();
    const originalGuid = w3dId!.nodeIds[imageNode!.id];
    const referenceNodeId = Object.entries(referenceW3d!.nodeIds).find(([, guid]) => guid === originalGuid)?.[0];
    const referenceNode = reference.blueprint.nodes.find((node) => node.id === referenceNodeId);
    expect(referenceNode).toBeDefined();
    expect(imageNode!.transform.position.x).toBeCloseTo(referenceNode!.transform.position.x);
    expect(imageNode!.transform.position.y).toBeCloseTo(referenceNode!.transform.position.y);
    expect(imageNode!.transform.position.z).toBeCloseTo(referenceNode!.transform.position.z);
  });
});
