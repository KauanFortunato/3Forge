import { AnimationMixer, LoopOnce, Mesh, Quaternion } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { createAnimationClip, createAnimationKeyframe, createAnimationTrack } from "./animation";
import { createDefaultBlueprint, ROOT_NODE_ID } from "./state";
import { createBlueprintExportGroup, exportBlueprintToGlbBlob, exportBlueprintToGltfJson } from "./gltfExport";

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
});

function parseGltfJson(gltfJson: string): Promise<Awaited<ReturnType<GLTFLoader["parseAsync"]>>> {
  return new GLTFLoader().parseAsync(gltfJson, "");
}
