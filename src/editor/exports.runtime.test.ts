import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { Group } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createAnimationClip, createAnimationKeyframe, createAnimationTrack, createDefaultAnimation } from "./animation";
import { generateTypeScriptComponent } from "./exports";
import { createNode, ROOT_NODE_ID } from "./state";
import type { ComponentBlueprint } from "./types";

interface ExportedComponentInstance {
  group: Group;
  build: () => Promise<void> | void;
  dispose: () => void;
  createTimeline?: (clipName?: string) => unknown;
  getClipNames?: () => string[];
  play?: () => void;
  playClip?: (clipName: string) => void;
  pause?: () => void;
  restart?: (clipName?: string) => void;
  reverse?: (clipName?: string) => void;
  seek?: (frame: number, clipName?: string) => void;
  stop?: () => void;
}

const tempFiles: string[] = [];

afterEach(async () => {
  await Promise.all(tempFiles.splice(0).map((filePath) => rm(filePath, { force: true })));
});

describe("exported component runtime", () => {
  it("reuses cached timelines, supports clip switching, and preserves multi-node animation fidelity", async () => {
    const blueprint = createAnimatedBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    const firstTimeline = instance.createTimeline?.("main");
    const secondTimeline = instance.createTimeline?.("main");

    expect(firstTimeline).toBeTruthy();
    expect(secondTimeline).toBe(firstTimeline);
    expect(instance.getClipNames?.()).toEqual(["main", "secondary"]);

    instance.seek?.(24, "main");
    expect(findNode(instance.group, "Animated Box A").position.x).toBeCloseTo(2, 5);
    expect(findNode(instance.group, "Animated Box B").scale.y).toBeCloseTo(1.5, 5);

    instance.seek?.(30, "secondary");
    expect(findNode(instance.group, "Animated Box A").rotation.z).toBeCloseTo(0.6, 5);
    expect(findNode(instance.group, "Animated Box B").position.y).toBeCloseTo(2.5, 5);

    instance.stop?.();
    expect(findNode(instance.group, "Animated Box A").rotation.z).toBeCloseTo(0, 5);
    expect(findNode(instance.group, "Animated Box B").position.y).toBeCloseTo(1, 5);

    instance.dispose();
  });

  it("supports deterministic restart and reverse control on exported clips", async () => {
    const blueprint = createAnimatedBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    const timeline = instance.createTimeline?.("main") as { progress: () => number; reversed: () => boolean } | null;
    expect(timeline).toBeTruthy();

    instance.seek?.(48, "main");
    expect(findNode(instance.group, "Animated Box A").position.x).toBeCloseTo(4, 5);

    instance.restart?.("main");
    expect(timeline?.reversed()).toBe(false);
    expect(timeline?.progress()).toBeLessThan(0.05);

    instance.stop?.();
    instance.reverse?.("main");
    expect(timeline?.reversed()).toBe(true);
    expect(timeline?.progress()).toBeGreaterThan(0.95);

    instance.dispose();
  });

  it("anchors clip duration to the exported durationFrames even with trailing idle time", async () => {
    const blueprint = createTrailingHoldBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    const timeline = instance.createTimeline?.("hold") as { duration: () => number } | null;
    expect(timeline).toBeTruthy();
    expect(timeline?.duration()).toBeCloseTo(3, 5);

    instance.seek?.(72, "hold");
    expect(findNode(instance.group, "Hold Box").position.x).toBeCloseTo(6, 5);
    expect(findNode(instance.group, "Hold Box").scale.y).toBeCloseTo(1.4, 5);

    instance.dispose();
  });

  it("restarts a cached clip when returning to it after another clip was activated", async () => {
    const blueprint = createAnimatedBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    instance.seek?.(24, "main");
    expect(findNode(instance.group, "Animated Box A").position.x).toBeCloseTo(2, 5);

    instance.playClip?.("secondary");
    instance.playClip?.("main");
    instance.pause?.();

    expect(findNode(instance.group, "Animated Box A").position.x).toBeCloseTo(0, 5);

    instance.dispose();
  });
});

async function loadExportedComponent(blueprint: ComponentBlueprint): Promise<new () => ExportedComponentInstance> {
  const source = generateTypeScriptComponent(blueprint);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
    fileName: "generated-export.ts",
    reportDiagnostics: true,
  });

  expect(transpiled.diagnostics ?? []).toEqual([]);
  const directory = "src/test/.generated-runtime";
  await mkdir(directory, { recursive: true });
  const fileName = `${randomUUID()}.mjs`;
  const filePath = join(directory, fileName);
  tempFiles.push(filePath);
  await writeFile(filePath, transpiled.outputText, "utf8");

  const moduleRecord = await import(/* @vite-ignore */ `/src/test/.generated-runtime/${fileName}?v=${Date.now()}`);
  const constructor = Object.values(moduleRecord).find((candidate) =>
    typeof candidate === "function"
    && typeof (candidate as { prototype?: ExportedComponentInstance }).prototype?.build === "function"
    && typeof (candidate as { prototype?: ExportedComponentInstance }).prototype?.dispose === "function",
  );

  expect(constructor).toBeTruthy();
  return constructor as new () => ExportedComponentInstance;
}

function createAnimatedBlueprint(): ComponentBlueprint {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";

  const firstBox = createNode("box", ROOT_NODE_ID, "box-a");
  firstBox.name = "Animated Box A";

  const secondBox = createNode("box", ROOT_NODE_ID, "box-b");
  secondBox.name = "Animated Box B";
  secondBox.transform.position.y = 1;

  const mainClip = createAnimationClip("main", {
    fps: 24,
    durationFrames: 48,
    tracks: [],
  });
  const mainPositionTrack = createAnimationTrack(firstBox.id, "transform.position.x");
  mainPositionTrack.keyframes.push(createAnimationKeyframe(0, 0, "linear"));
  mainPositionTrack.keyframes.push(createAnimationKeyframe(48, 4, "linear"));
  const mainScaleTrack = createAnimationTrack(secondBox.id, "transform.scale.y");
  mainScaleTrack.keyframes.push(createAnimationKeyframe(0, 1, "linear"));
  mainScaleTrack.keyframes.push(createAnimationKeyframe(48, 2, "linear"));
  mainClip.tracks.push(mainPositionTrack, mainScaleTrack);

  const secondaryClip = createAnimationClip("secondary", {
    fps: 30,
    durationFrames: 60,
    tracks: [],
  });
  const secondaryRotationTrack = createAnimationTrack(firstBox.id, "transform.rotation.z");
  secondaryRotationTrack.keyframes.push(createAnimationKeyframe(0, 0, "linear"));
  secondaryRotationTrack.keyframes.push(createAnimationKeyframe(60, 1.2, "linear"));
  const secondaryPositionTrack = createAnimationTrack(secondBox.id, "transform.position.y");
  secondaryPositionTrack.keyframes.push(createAnimationKeyframe(0, 1, "linear"));
  secondaryPositionTrack.keyframes.push(createAnimationKeyframe(60, 4, "linear"));
  secondaryClip.tracks.push(secondaryRotationTrack, secondaryPositionTrack);

  return {
    version: 1,
    componentName: "Runtime Export Sample",
    fonts: [],
    nodes: [root, firstBox, secondBox],
    animation: {
      ...createDefaultAnimation(),
      activeClipId: mainClip.id,
      clips: [mainClip, secondaryClip],
    },
  };
}

function createTrailingHoldBlueprint(): ComponentBlueprint {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";

  const holdBox = createNode("box", ROOT_NODE_ID, "hold-box");
  holdBox.name = "Hold Box";

  const holdClip = createAnimationClip("hold", {
    fps: 24,
    durationFrames: 72,
    tracks: [],
  });

  const positionTrack = createAnimationTrack(holdBox.id, "transform.position.x");
  positionTrack.keyframes.push(createAnimationKeyframe(0, 0, "linear"));
  positionTrack.keyframes.push(createAnimationKeyframe(48, 6, "linear"));

  const singleKeyframeScaleTrack = createAnimationTrack(holdBox.id, "transform.scale.y");
  singleKeyframeScaleTrack.keyframes.push(createAnimationKeyframe(24, 1.4, "linear"));

  holdClip.tracks.push(positionTrack, singleKeyframeScaleTrack);

  return {
    version: 1,
    componentName: "Trailing Hold Sample",
    fonts: [],
    nodes: [root, holdBox],
    animation: {
      ...createDefaultAnimation(),
      activeClipId: holdClip.id,
      clips: [holdClip],
    },
  };
}

function findNode(root: Group, name: string): Group {
  const node = root.getObjectByName(name);
  expect(node).toBeInstanceOf(Group);
  return node as Group;
}
