import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ImageAsset } from "../types";
import { collectTextureMap, parseW3D } from "./w3d";
import { classifyMovAssets, parseW3DFromFolder } from "./w3dFolder";
import gameNameFsXml from "../../test/fixtures/w3d/GameName_FS.w3d?raw";

function makeFile(relativePath: string): File {
  const file = new File(["x"], relativePath.split("/").pop() ?? "f");
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    configurable: true,
  });
  return file;
}

function makeFileWithBytes(relativePath: string, bytes: Uint8Array): File {
  const file = new File([bytes], relativePath.split("/").pop() ?? "f");
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    configurable: true,
  });
  return file;
}

const MIN_W3D = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><Resources>
<ImageSequence Id="seq1" Name="PITCH_IN.mov"/>
<TextureLayer Id="LY1"><TextureMappingOption Texture="seq1"/></TextureLayer>
</Resources><SceneLayer><SceneNode><Children>
<Quad Id="q1" Name="PITCH_IN">
<Primitive><FaceMappingList>
<NamedBaseFaceMapping TextureLayerId="LY1"/>
</FaceMappingList></Primitive>
</Quad></Children></SceneNode></SceneLayer></Scene>`;

const VALID_SEQUENCE_JSON = JSON.stringify({
  version: 1,
  type: "image-sequence",
  source: "PITCH_IN.mov",
  framePattern: "frame_%06d.png",
  frameCount: 3,
  fps: 25,
  width: 1920,
  height: 1080,
  durationSec: 0.12,
  loop: true,
  alpha: true,
  pixelFormat: "rgba",
});

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

describe("parseW3DFromFolder sequence preference", () => {
  // jsdom does not fire `loadedmetadata` for fake video bytes, and
  // `Image.onload` never resolves for placeholder PNGs. The folder importer
  // calls into both paths, so we mock the asset loaders' async DOM APIs to
  // resolve synchronously with sentinel values.
  let videoSrcSetter: PropertyDescriptor | undefined;
  let imageSrcSetter: PropertyDescriptor | undefined;
  beforeAll(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fixture");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    videoSrcSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      set(this: HTMLMediaElement, value: string) {
        Object.defineProperty(this, "_src", { configurable: true, value });
        // Empty assignments are the videoFileToAsset cleanup ("video.src =
        // \"\"" right after onloadedmetadata) — must NOT re-fire the
        // event or we deadlock the test in an infinite microtask loop.
        if (!value) return;
        Object.defineProperty(this, "videoWidth", { configurable: true, value: 1920 });
        Object.defineProperty(this, "videoHeight", { configurable: true, value: 1080 });
        queueMicrotask(() => {
          this.onloadedmetadata?.(new Event("loadedmetadata"));
        });
      },
      get(this: HTMLMediaElement) {
        return (this as unknown as { _src?: string })._src ?? "";
      },
    });
    imageSrcSetter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      set(this: HTMLImageElement, value: string) {
        Object.defineProperty(this, "_src", { configurable: true, value });
        if (!value) return;
        Object.defineProperty(this, "naturalWidth", { configurable: true, value: 4 });
        Object.defineProperty(this, "naturalHeight", { configurable: true, value: 4 });
        queueMicrotask(() => {
          this.onload?.(new Event("load"));
        });
      },
      get(this: HTMLImageElement) {
        return (this as unknown as { _src?: string })._src ?? "";
      },
    });
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (videoSrcSetter) Object.defineProperty(HTMLMediaElement.prototype, "src", videoSrcSetter);
    if (imageSrcSetter) Object.defineProperty(HTMLImageElement.prototype, "src", imageSrcSetter);
  });

  it("prefers <basename>_frames/sequence.json over the .mov when both are present", async () => {
    const enc = new TextEncoder();
    const png1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header (placeholder)
    const files = [
      makeFileWithBytes("Project/scene.w3d", enc.encode(MIN_W3D)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN.mov", new Uint8Array([0])),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/sequence.json", enc.encode(VALID_SEQUENCE_JSON)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/frame_000001.png", png1),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/frame_000002.png", png1),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/frame_000003.png", png1),
    ];
    const result = await parseW3DFromFolder(files);
    const node = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    expect(node?.type).toBe("image");
    if (node?.type === "image") {
      expect(node.image.mimeType).toBe("application/x-image-sequence");
      expect(node.image.sequence?.frameCount).toBe(3);
      expect(node.image.sequence?.frameUrls.length).toBe(3);
      expect(node.image.sequence?.alpha).toBe(true);
    }
  });

  it("falls back to video/quicktime when sequence.json is invalid (parse error)", async () => {
    const enc = new TextEncoder();
    const files = [
      makeFileWithBytes("Project/scene.w3d", enc.encode(MIN_W3D)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN.mov", new Uint8Array([0])),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/sequence.json", enc.encode("{ not valid json")),
    ];
    const result = await parseW3DFromFolder(files);
    const node = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    expect(node?.type).toBe("image");
    if (node?.type === "image") {
      expect(node.image.mimeType).toBe("video/quicktime");
    }
    expect(result.warnings.some((w) => /sequence\.json.*invalid/i.test(w))).toBe(true);
  });

  it("falls back to video/quicktime when sequence.json references missing PNG frames", async () => {
    const enc = new TextEncoder();
    const partialJson = JSON.stringify({
      version: 1,
      type: "image-sequence",
      source: "PITCH_IN.mov",
      framePattern: "frame_%06d.png",
      frameCount: 3,
      fps: 25, width: 1920, height: 1080, durationSec: 0.12,
      loop: true, alpha: true, pixelFormat: "rgba",
    });
    const files = [
      makeFileWithBytes("Project/scene.w3d", enc.encode(MIN_W3D)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN.mov", new Uint8Array([0])),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/sequence.json", enc.encode(partialJson)),
      // NB: only 1 of the claimed 3 frames is present
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/frame_000001.png", new Uint8Array([0x89])),
    ];
    const result = await parseW3DFromFolder(files);
    const node = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    if (node?.type === "image") {
      expect(node.image.mimeType).toBe("video/quicktime");
    }
    expect(result.warnings.some((w) => /sequence\.json.*missing/i.test(w))).toBe(true);
  });

  it("invariant: a referenced .mov NEVER vanishes — without sequence, image node still exists with video mime", async () => {
    const enc = new TextEncoder();
    const files = [
      makeFileWithBytes("Project/scene.w3d", enc.encode(MIN_W3D)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN.mov", new Uint8Array([0])),
    ];
    const result = await parseW3DFromFolder(files);
    const node = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    expect(node?.type).toBe("image");
    if (node?.type === "image") {
      expect(node.image.mimeType).toBe("video/quicktime");
    }
  });
});
