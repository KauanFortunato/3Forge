import { AnimationMixer, BoxGeometry, Color, DataTexture, Group, LoopOnce, Matrix4, Mesh, MeshStandardMaterial, Quaternion, RGBAFormat, Texture, TextureLoader } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";
import { describe, expect, it, vi } from "vitest";

import { createAnimationClip, createAnimationKeyframe, createAnimationTrack } from "./animation";
import { createDefaultBlueprint, createNode, ROOT_NODE_ID } from "./state";
import {
  convertMaterialsForUsdz,
  createBlueprintExportGroup,
  exportBlueprintToGlbBlob,
  exportBlueprintToGltfJson,
  exportBlueprintToUsdzModelString,
  normalizeTexturesForCanvasExport,
  parseUsdzWithTextures,
} from "./gltfExport";
import type { ModelAsset, ModelNode } from "./types";

describe("gltfExport", () => {
  it("builds an exportable Three group from a blueprint", async () => {
    const blueprint = createDefaultBlueprint();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    expect(panel).toBeTruthy();
    if (!panel || panel.type === "group") {
      throw new Error("Expected panel node.");
    }

    panel.transform.position.x = 1.25;
    panel.material.color = "#112233";

    const group = await createBlueprintExportGroup(blueprint);
    const panelObject = group.getObjectByName(panel.name);
    const panelMesh = group.getObjectByName(`${panel.name} Mesh`);

    expect(group.name).toBe("3Forge-Component");
    expect(panelObject?.position.x).toBeCloseTo(1.25, 5);
    expect(panelMesh).toBeInstanceOf(Mesh);
  });

  it("exports a blueprint as GLTF JSON", async () => {
    const blueprint = createDefaultBlueprint();

    const gltfJson = await exportBlueprintToGltfJson(blueprint);
    const gltf = JSON.parse(gltfJson) as {
      asset?: { version?: string };
      nodes?: Array<{ name?: string }>;
      meshes?: unknown[];
    };

    expect(gltf.asset?.version).toBe("2.0");
    expect(gltf.nodes?.some((node) => node.name === blueprint.componentName)).toBe(true);
    expect(gltf.meshes?.length).toBeGreaterThan(0);
  });

  it("exports a blueprint as a binary GLB blob", async () => {
    const blob = await exportBlueprintToGlbBlob(createDefaultBlueprint());

    expect(blob.type).toBe("model/gltf-binary");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("exports position, rotation and scale animation tracks", async () => {
    const blueprint = createDefaultBlueprint();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    expect(panel).toBeTruthy();
    if (!panel) {
      throw new Error("Expected panel node.");
    }

    const positionTrack = createAnimationTrack(panel.id, "transform.position.x");
    positionTrack.keyframes = [
      createAnimationKeyframe(0, panel.transform.position.x, "linear"),
      createAnimationKeyframe(24, panel.transform.position.x + 2, "linear"),
    ];
    const rotationTrack = createAnimationTrack(panel.id, "transform.rotation.y");
    rotationTrack.keyframes = [
      createAnimationKeyframe(0, 0, "linear"),
      createAnimationKeyframe(12, Math.PI / 2, "linear"),
    ];
    const scaleTrack = createAnimationTrack(panel.id, "transform.scale.z");
    scaleTrack.keyframes = [
      createAnimationKeyframe(0, 1, "linear"),
      createAnimationKeyframe(48, 1.5, "linear"),
    ];
    const clip = createAnimationClip("entrance", {
      fps: 24,
      durationFrames: 48,
      tracks: [positionTrack, rotationTrack, scaleTrack],
    });
    blueprint.animation = {
      activeClipId: clip.id,
      clips: [clip],
    };

    const gltfJson = await exportBlueprintToGltfJson(blueprint);
    const gltf = JSON.parse(gltfJson) as {
      animations?: Array<{
        name?: string;
        channels?: Array<{ target?: { path?: string } }>;
      }>;
    };
    const channels = gltf.animations?.[0]?.channels ?? [];
    const parsed = await parseGltfJson(gltfJson);
    const position = parsed.animations[0]?.tracks.find((track) => track.name.includes(".position"));
    const rotation = parsed.animations[0]?.tracks.find((track) => track.name.includes(".quaternion"));
    const scale = parsed.animations[0]?.tracks.find((track) => track.name.includes(".scale"));
    const expectedHalfTurn = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);

    expect(gltf.animations?.[0]?.name).toBe("entrance");
    expect(channels.map((channel) => channel.target?.path).sort()).toEqual(["rotation", "scale", "translation"]);
    expect(position?.times).toEqual(new Float32Array([0, 1]));
    expect(position?.values).toEqual(new Float32Array([
      panel.transform.position.x,
      panel.transform.position.y,
      panel.transform.position.z,
      panel.transform.position.x + 2,
      panel.transform.position.y,
      panel.transform.position.z,
    ]));
    expect(rotation?.times).toEqual(new Float32Array([0, 0.5]));
    expect(rotation?.values.at(-4)).toBeCloseTo(expectedHalfTurn.x, 5);
    expect(rotation?.values.at(-3)).toBeCloseTo(expectedHalfTurn.y, 5);
    expect(rotation?.values.at(-2)).toBeCloseTo(expectedHalfTurn.z, 5);
    expect(rotation?.values.at(-1)).toBeCloseTo(expectedHalfTurn.w, 5);
    expect(scale?.times).toEqual(new Float32Array([0, 2]));
    expect(scale?.values).toEqual(new Float32Array([1, 1, 1, 1, 1, 1.5]));
  });

  it("exports multiple clips and validates the GLTF with Three loader", async () => {
    const blueprint = createDefaultBlueprint();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    expect(panel).toBeTruthy();
    if (!panel) {
      throw new Error("Expected panel node.");
    }

    const moveTrack = createAnimationTrack(panel.id, "transform.position.x");
    moveTrack.keyframes = [
      createAnimationKeyframe(0, 0, "linear"),
      createAnimationKeyframe(24, 1, "linear"),
    ];
    const growTrack = createAnimationTrack(panel.id, "transform.scale.x");
    growTrack.keyframes = [
      createAnimationKeyframe(0, 1, "linear"),
      createAnimationKeyframe(24, 2, "linear"),
    ];
    const moveClip = createAnimationClip("move", { tracks: [moveTrack] });
    const growClip = createAnimationClip("grow", { tracks: [growTrack] });
    blueprint.animation = {
      activeClipId: moveClip.id,
      clips: [moveClip, growClip],
    };

    const gltfJson = await exportBlueprintToGltfJson(blueprint);
    const parsed = await parseGltfJson(gltfJson);

    expect(parsed.animations.map((clip) => clip.name)).toEqual(["move", "grow"]);
    expect(parsed.animations[0]?.tracks[0]?.name).toContain(".position");
    expect(parsed.animations[1]?.tracks[0]?.name).toContain(".scale");
  });

  it("composes matrices and converts non-standard materials before USDZ export", async () => {
    const blueprint = createDefaultBlueprint();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    expect(panel).toBeTruthy();
    if (!panel || panel.type !== "box") {
      throw new Error("Expected panel node.");
    }

    panel.transform.position.x = 1;
    panel.transform.position.y = 2;
    panel.transform.position.z = 3;
    panel.transform.rotation.y = 1.5;
    panel.transform.scale.x = 2;
    panel.transform.scale.y = 2;
    panel.transform.scale.z = 2;
    panel.material.type = "phong";
    panel.material.color = "#33aa77";

    const group = await createBlueprintExportGroup(blueprint);
    const wrapper = group.getObjectByName(panel.name);
    const mesh = group.getObjectByName(`${panel.name} Mesh`);
    expect(wrapper).toBeTruthy();
    expect(mesh).toBeInstanceOf(Mesh);
    if (!wrapper || !(mesh instanceof Mesh)) {
      throw new Error("Expected wrapper and mesh.");
    }
    const originalColor = ((mesh.material as { color: Color }).color).clone();

    expect(wrapper.matrix.equals(new Matrix4())).toBe(true);
    expect((mesh.material as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial).not.toBe(true);

    group.updateMatrixWorld(true);
    convertMaterialsForUsdz(group);

    const convertedWrapper = group.getObjectByName(panel.name);
    const converted = group.getObjectByName(`${panel.name} Mesh`);
    expect(convertedWrapper).toBeTruthy();
    expect(converted).toBeInstanceOf(Mesh);
    if (!convertedWrapper || !(converted instanceof Mesh)) {
      throw new Error("Expected wrapper and mesh after conversion.");
    }

    expect(convertedWrapper.matrix.equals(new Matrix4())).toBe(false);
    const material = converted.material as { isMeshStandardMaterial?: boolean; color: Color };
    expect(material.isMeshStandardMaterial).toBe(true);
    expect(material.color.getHex()).toBe(originalColor.getHex());
  });

  it("exports transform animation as USDZ timeSamples", async () => {
    const blueprint = createDefaultBlueprint();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    if (!panel) {
      throw new Error("Expected panel node.");
    }

    const positionTrack = createAnimationTrack(panel.id, "transform.position.x");
    positionTrack.keyframes = [
      createAnimationKeyframe(0, panel.transform.position.x, "linear"),
      createAnimationKeyframe(24, panel.transform.position.x + 2, "linear"),
    ];
    const clip = createAnimationClip("entrance", {
      fps: 24,
      durationFrames: 24,
      tracks: [positionTrack],
    });
    blueprint.animation = { activeClipId: clip.id, clips: [clip] };

    const usda = await exportBlueprintToUsdzModelString(blueprint);

    // Stage-level time metadata in the header.
    expect(usda).toMatch(/startTimeCode = 0/);
    expect(usda).toMatch(/endTimeCode = 24/);
    expect(usda).toMatch(/timeCodesPerSecond = 24/);
    expect(usda).toMatch(/framesPerSecond = 24/);

    // The animated prim uses timeSamples instead of a static transform.
    expect(usda).toContain("matrix4d xformOp:transform.timeSamples = {");
    expect(usda).toMatch(/\n\s*0: \(/);
    expect(usda).toMatch(/\n\s*24: \(/);
  });

  it("lays out multiple clips sequentially on the USDZ timeline", async () => {
    const blueprint = createDefaultBlueprint();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    if (!panel) {
      throw new Error("Expected panel node.");
    }

    const moveTrack = createAnimationTrack(panel.id, "transform.position.x");
    moveTrack.keyframes = [
      createAnimationKeyframe(0, 0, "linear"),
      createAnimationKeyframe(10, 1, "linear"),
    ];
    const growTrack = createAnimationTrack(panel.id, "transform.scale.x");
    growTrack.keyframes = [
      createAnimationKeyframe(0, 1, "linear"),
      createAnimationKeyframe(10, 2, "linear"),
    ];
    const moveClip = createAnimationClip("move", { fps: 24, durationFrames: 10, tracks: [moveTrack] });
    const growClip = createAnimationClip("grow", { fps: 24, durationFrames: 10, tracks: [growTrack] });
    blueprint.animation = { activeClipId: moveClip.id, clips: [moveClip, growClip] };

    const usda = await exportBlueprintToUsdzModelString(blueprint);

    // First clip occupies frames 0..10, gap of one frame, second clip 11..21.
    expect(usda).toMatch(/endTimeCode = 21/);
    expect(usda).toMatch(/\n\s*11: \(/);
    expect(usda).toMatch(/\n\s*21: \(/);
  });

  it("keeps static USDZ transforms when there is no animation", async () => {
    const usda = await exportBlueprintToUsdzModelString(createDefaultBlueprint());

    expect(usda).not.toContain("timeSamples");
    expect(usda).not.toContain("startTimeCode");
    expect(usda).toContain("matrix4d xformOp:transform = (");
  });

  it("plays exported animation at the same key values as the editor timeline", async () => {
    const blueprint = createDefaultBlueprint();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    expect(panel).toBeTruthy();
    if (!panel) {
      throw new Error("Expected panel node.");
    }

    panel.transform.position.x = -0.25;
    const track = createAnimationTrack(panel.id, "transform.position.x");
    track.keyframes = [
      createAnimationKeyframe(0, panel.transform.position.x, "linear"),
      createAnimationKeyframe(12, 0.75, "linear"),
      createAnimationKeyframe(24, 1.25, "linear"),
    ];
    const clip = createAnimationClip("timeline-match", {
      fps: 24,
      durationFrames: 24,
      tracks: [track],
    });
    blueprint.animation = {
      activeClipId: clip.id,
      clips: [clip],
    };

    const parsed = await parseGltfJson(await exportBlueprintToGltfJson(blueprint));
    const trackTarget = parsed.animations[0]?.tracks[0]?.name.split(".")[0] ?? "";
    const exportedPanel = parsed.scene.getObjectByName(trackTarget)
      ?? parsed.scene.getObjectByProperty("uuid", trackTarget);
    expect(exportedPanel).toBeTruthy();
    if (!exportedPanel || !parsed.animations[0]) {
      throw new Error("Expected exported panel and animation.");
    }

    const mixer = new AnimationMixer(parsed.scene);
    const action = mixer.clipAction(parsed.animations[0]);
    action.setLoop(LoopOnce, 0);
    action.clampWhenFinished = true;
    action.play();

    mixer.setTime(0);
    expect(exportedPanel.position.x).toBeCloseTo(panel.transform.position.x, 5);
    mixer.setTime(0.5);
    expect(exportedPanel.position.x).toBeCloseTo(0.75, 5);
    mixer.setTime(1);
    expect(exportedPanel.position.x).toBeCloseTo(1.25, 5);
  });

  it("embeds imported GLB geometry into the exported scene group", async () => {
    const dataUrl = await makeGlbDataUrl();
    const asset: ModelAsset = {
      id: "asset-embed",
      name: "Fixture.glb",
      mimeType: "model/gltf-binary",
      src: dataUrl,
      format: "glb",
    };
    const blueprint = createDefaultBlueprint();
    const modelNode = createNode("model", null) as ModelNode;
    modelNode.modelId = asset.id;
    blueprint.models = [asset];
    blueprint.nodes = [modelNode];

    const group = await createBlueprintExportGroup(blueprint);
    let foundMesh: Mesh | null = null;
    group.traverse((child) => {
      if (child instanceof Mesh && child.userData.assetId === asset.id) {
        foundMesh = child;
      }
    });
    expect(foundMesh).not.toBeNull();
  });

  it("converts embedded GLB materials to MeshStandardMaterial for USDZ", async () => {
    const dataUrl = await makeGlbDataUrl();
    const asset: ModelAsset = {
      id: "asset-usdz-mat",
      name: "Fixture.glb",
      mimeType: "model/gltf-binary",
      src: dataUrl,
      format: "glb",
    };
    const blueprint = createDefaultBlueprint();
    const modelNode = createNode("model", null) as ModelNode;
    modelNode.modelId = asset.id;
    blueprint.models = [asset];
    blueprint.nodes = [modelNode];

    const group = await createBlueprintExportGroup(blueprint);
    convertMaterialsForUsdz(group);

    const embeddedMeshes: Mesh[] = [];
    group.traverse((child) => {
      if (child instanceof Mesh && child.userData.assetId === asset.id) {
        embeddedMeshes.push(child);
      }
    });
    expect(embeddedMeshes.length).toBeGreaterThan(0);
    for (const mesh of embeddedMeshes) {
      const material = mesh.material as { isMeshStandardMaterial?: boolean };
      expect(material.isMeshStandardMaterial).toBe(true);
    }
  });

  it("caches model parsing across multiple references", async () => {
    const dataUrl = await makeGlbDataUrl();
    const asset: ModelAsset = {
      id: "asset-cache",
      name: "Fixture.glb",
      mimeType: "model/gltf-binary",
      src: dataUrl,
      format: "glb",
    };
    const blueprint = createDefaultBlueprint();
    const firstNode = createNode("model", null) as ModelNode;
    firstNode.modelId = asset.id;
    const secondNode = createNode("model", null) as ModelNode;
    secondNode.modelId = asset.id;
    blueprint.models = [asset];
    blueprint.nodes = [firstNode, secondNode];

    const parseSpy = vi.spyOn(GLTFLoader.prototype, "parseAsync");
    try {
      await createBlueprintExportGroup(blueprint);
      expect(parseSpy).toHaveBeenCalledTimes(1);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("normalizes raw data textures to canvas images before exporter drawImage paths", () => {
    const context = {
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
        colorSpace: "srgb",
      }),
      putImageData: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    getContextSpy.mockImplementation(((contextId: string) => (
      contextId === "2d" ? context : null
    )) as HTMLCanvasElement["getContext"]);
    const texture = new DataTexture(
      new Uint8Array([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
        255, 255, 255, 255,
      ]),
      2,
      2,
      RGBAFormat,
    );
    texture.needsUpdate = true;
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({
      metalnessMap: texture,
      roughnessMap: texture,
    }));
    const group = new Group();
    group.add(mesh);

    try {
      normalizeTexturesForCanvasExport(group);

      expect(texture.image).toBeInstanceOf(HTMLCanvasElement);
      expect(texture.image.width).toBe(2);
      expect(texture.image.height).toBe(2);
    } finally {
      getContextSpy.mockRestore();
    }
  });

  describe("parseUsdzWithTextures", () => {
    it("waits for TextureLoader callbacks before resolving", async () => {
      const originalLoad = TextureLoader.prototype.load;
      const sourceData = { fake: "image", width: 1, height: 1 };
      let triggerOnLoad: (() => void) | undefined;

      // Replace the real loader so the test never depends on jsdom decoding an
      // actual <img> element. The patched-in stub inside parseUsdzWithTextures
      // will call THIS function (since we treat it as the "original") and
      // schedule its onLoad to be triggered later from the test.
      const stubLoad = function stubLoad(
        this: TextureLoader,
        _url: string,
        onLoad?: (texture: Texture) => void,
      ): Texture {
        const texture = new Texture();
        triggerOnLoad = (): void => {
          (texture as unknown as { source: { data: unknown } }).source = { data: sourceData };
          texture.needsUpdate = true;
          if (onLoad) onLoad(texture);
        };
        return texture;
      };
      (TextureLoader.prototype as unknown as { load: typeof stubLoad }).load = stubLoad;

      let capturedTexture: Texture | null = null;
      const fakeLoader = {
        parse: (_buffer: ArrayBuffer): Group => {
          const group = new Group();
          const texture = new TextureLoader().load("memory://fixture.png");
          capturedTexture = texture;
          group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map: texture })));
          return group;
        },
      } as unknown as USDLoader;

      try {
        const exportPromise = parseUsdzWithTextures(fakeLoader, new ArrayBuffer(8));
        // Microtask flush to ensure parse() has run and waiter is registered
        // before we fire the callback.
        await Promise.resolve();
        expect(triggerOnLoad).toBeTypeOf("function");
        triggerOnLoad?.();
        const group = await exportPromise;

        expect(group).toBeInstanceOf(Group);
        expect(capturedTexture).not.toBeNull();
        const sourceFromTexture = (capturedTexture as unknown as Texture & { source: { data: unknown } }).source.data;
        expect(sourceFromTexture).toBe(sourceData);
        // Prototype must be restored to the value that was in place when the
        // helper was invoked (our stubLoad — captured from the prototype slot
        // before patching).
        expect(TextureLoader.prototype.load).toBe(stubLoad);
      } finally {
        (TextureLoader.prototype as unknown as { load: typeof originalLoad }).load = originalLoad;
      }
    });

    it("restores prototype on parse exception", async () => {
      const loadBefore = TextureLoader.prototype.load;
      const fakeLoader = {
        parse: (): Group => {
          throw new Error("boom");
        },
      } as unknown as USDLoader;

      await expect(parseUsdzWithTextures(fakeLoader, new ArrayBuffer(8))).rejects.toThrow(/boom/);
      expect(TextureLoader.prototype.load).toBe(loadBefore);
    });

    it("continues when one texture load errors", async () => {
      const originalLoad = TextureLoader.prototype.load;
      const goodSourceData = { fake: "good", width: 1, height: 1 };
      const triggers: Array<() => void> = [];

      const stubLoad = function stubLoad(
        this: TextureLoader,
        url: string,
        onLoad?: (texture: Texture) => void,
        _onProgress?: (event: ProgressEvent) => void,
        onError?: (error: unknown) => void,
      ): Texture {
        const texture = new Texture();
        if (url.startsWith("bad://")) {
          triggers.push((): void => {
            if (onError) onError(new Error(`image decode failed for ${url}`));
          });
        } else {
          triggers.push((): void => {
            (texture as unknown as { source: { data: unknown } }).source = { data: goodSourceData };
            texture.needsUpdate = true;
            if (onLoad) onLoad(texture);
          });
        }
        return texture;
      };
      (TextureLoader.prototype as unknown as { load: typeof stubLoad }).load = stubLoad;

      let goodTexture: Texture | null = null;
      const fakeLoader = {
        parse: (_buffer: ArrayBuffer): Group => {
          const group = new Group();
          const loader = new TextureLoader();
          goodTexture = loader.load("memory://good.png");
          loader.load("bad://nonexistent.png");
          group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map: goodTexture })));
          return group;
        },
      } as unknown as USDLoader;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const exportPromise = parseUsdzWithTextures(fakeLoader, new ArrayBuffer(8));
        await Promise.resolve();
        expect(triggers.length).toBe(2);
        for (const trigger of triggers) trigger();
        const group = await exportPromise;

        expect(group).toBeInstanceOf(Group);
        expect(goodTexture).not.toBeNull();
        const sourceFromTexture = (goodTexture as unknown as Texture & { source: { data: unknown } }).source.data;
        expect(sourceFromTexture).toBe(goodSourceData);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
        (TextureLoader.prototype as unknown as { load: typeof originalLoad }).load = originalLoad;
      }
    });
  });
});

function parseGltfJson(gltfJson: string): Promise<Awaited<ReturnType<GLTFLoader["parseAsync"]>>> {
  return new GLTFLoader().parseAsync(gltfJson, "");
}

async function makeGlbDataUrl(): Promise<string> {
  const scene = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xff0000 }));
  mesh.name = "FixtureMesh";
  scene.add(mesh);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error("Expected GLB ArrayBuffer.");
  }
  const base64 = bytesToBase64(new Uint8Array(result));
  return `data:model/gltf-binary;base64,${base64}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return typeof btoa === "function" ? btoa(binary) : encodeBase64Bytes(bytes);
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += alphabet[first >> 2];
    result += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    result += index + 1 < bytes.length ? alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)] : "=";
    result += index + 2 < bytes.length ? alphabet[(third ?? 0) & 0x3f] : "=";
  }
  return result;
}
