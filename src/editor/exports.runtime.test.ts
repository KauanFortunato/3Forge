import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { Group, Mesh } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createAnimationClip, createAnimationKeyframe, createAnimationTrack, createDefaultAnimation } from "./animation";
import { generateTypeScriptComponent } from "./exports";
import { createNode, ROOT_NODE_ID } from "./state";
import type { ComponentBlueprint } from "./types";

interface ExportedComponentInstance {
  group: Group;
  build: () => Promise<void> | void;
  dispose: () => void;
  createTimeline?: (clipName?: string) => Promise<unknown> | unknown;
  getClipNames?: () => string[];
  play?: (clipName?: string) => Promise<unknown> | unknown;
  playClip?: (clipName: string) => Promise<unknown> | unknown;
  pause?: () => Promise<void> | void;
  restart?: (clipName?: string) => Promise<unknown> | unknown;
  reverse?: (clipName?: string) => Promise<unknown> | unknown;
  seek?: (frame: number, clipName?: string) => Promise<void> | void;
  stop?: () => Promise<void> | void;
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

    await instance.seek?.(24, "main");
    expect(findNode(instance.group, "Animated Box A").position.x).toBeCloseTo(2, 5);
    expect(findNode(instance.group, "Animated Box B").scale.y).toBeCloseTo(1.5, 5);

    await instance.seek?.(30, "secondary");
    expect(findNode(instance.group, "Animated Box A").rotation.z).toBeCloseTo(0.6, 5);
    expect(findNode(instance.group, "Animated Box B").position.y).toBeCloseTo(2.5, 5);

    await instance.stop?.();
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

    await instance.seek?.(48, "main");
    expect(findNode(instance.group, "Animated Box A").position.x).toBeCloseTo(4, 5);

    await expect(instance.restart?.("main")).resolves.toEqual(expect.objectContaining({
      status: "completed",
      clipName: "main",
      direction: "forward",
    }));
    expect(timeline?.reversed()).toBe(false);
    expect(timeline?.progress()).toBeGreaterThan(0.95);

    await instance.stop?.();
    await expect(instance.reverse?.("main")).resolves.toEqual(expect.objectContaining({
      status: "completed",
      clipName: "main",
      direction: "reverse",
    }));
    expect(timeline?.reversed()).toBe(true);
    expect(timeline?.progress()).toBeLessThan(0.05);

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

    await instance.seek?.(72, "hold");
    expect(findNode(instance.group, "Hold Box").position.x).toBeCloseTo(6, 5);
    expect(findNode(instance.group, "Hold Box").scale.y).toBeCloseTo(1.4, 5);

    instance.dispose();
  });

  it("restarts a cached clip when returning to it after another clip was activated", async () => {
    const blueprint = createAnimatedBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    await instance.seek?.(24, "main");
    expect(findNode(instance.group, "Animated Box A").position.x).toBeCloseTo(2, 5);

    void instance.playClip?.("secondary");
    void instance.playClip?.("main");
    await instance.pause?.();

    expect(findNode(instance.group, "Animated Box A").position.x).toBeCloseTo(0, 5);

    instance.dispose();
  });

  it("returns an interrupted result when playback is cancelled before completion", async () => {
    const blueprint = createAnimatedBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    const playback = instance.playClip?.("main") as Promise<{ status: string; clipName: string; direction: string }> | undefined;
    expect(playback).toBeTruthy();

    await instance.stop?.();

    await expect(playback).resolves.toEqual(expect.objectContaining({
      status: "interrupted",
      clipName: "main",
      direction: "forward",
    }));

    instance.dispose();
  });

  it("resolves playback promises when a short clip finishes in forward and reverse", async () => {
    const blueprint = createQuickPlaybackBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    await expect(instance.playClip?.("blink")).resolves.toEqual(expect.objectContaining({
      status: "completed",
      clipName: "blink",
      direction: "forward",
    }));

    await instance.seek?.(2, "blink");

    await expect(instance.reverse?.("blink")).resolves.toEqual(expect.objectContaining({
      status: "completed",
      clipName: "blink",
      direction: "reverse",
    }));

    instance.dispose();
  });

  it("keeps initial visibility until the first delayed visible keyframe in exported runtime", async () => {
    const blueprint = createDelayedVisibleAnimationBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    const node = findNode(instance.group, "Blink Box");
    expect(node.visible).toBe(false);

    await instance.seek?.(0, "blink-visibility");
    expect(node.visible).toBe(false);

    await instance.seek?.(11, "blink-visibility");
    expect(node.visible).toBe(false);

    await instance.seek?.(12, "blink-visibility");
    expect(node.visible).toBe(true);

    await instance.seek?.(18, "blink-visibility");
    expect(node.visible).toBe(true);

    await instance.seek?.(24, "blink-visibility");
    expect(node.visible).toBe(false);

    await instance.stop?.();
    expect(node.visible).toBe(false);

    instance.dispose();
  });

  it("makes a renderable node appear even when its mesh starts hidden", async () => {
    const blueprint = createDelayedVisibleAnimationBlueprint();
    const blinkBox = blueprint.nodes.find((node) => node.id === "blink-box-delayed");
    if (!blinkBox || blinkBox.type === "group") {
      throw new Error("Expected delayed blink box node.");
    }
    blinkBox.material.visible = false;

    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    const node = findNode(instance.group, "Blink Box");
    const mesh = findMesh(node);
    expect(node.visible).toBe(false);
    expect(mesh.visible).toBe(false);

    await instance.seek?.(12, "blink-visibility");
    expect(node.visible).toBe(true);
    expect(mesh.visible).toBe(true);

    await instance.seek?.(24, "blink-visibility");
    expect(node.visible).toBe(false);
    expect(mesh.visible).toBe(false);

    instance.dispose();
  });

  it("applies visible frame-0 keyframes once playback time advances from the initial build state", async () => {
    const blueprint = createVisibleAnimationBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    const node = findNode(instance.group, "Blink Box");
    expect(node.visible).toBe(false);

    await instance.seek?.(11, "blink-visibility");
    expect(node.visible).toBe(true);

    await instance.seek?.(12, "blink-visibility");
    expect(node.visible).toBe(false);

    await instance.stop?.();
    expect(node.visible).toBe(true);

    instance.dispose();
  });

  it("keeps numeric track values untouched until the first delayed keyframe", async () => {
    const blueprint = createDelayedNumericAnimationBlueprint();
    const ExportedComponent = await loadExportedComponent(blueprint);
    const instance = new ExportedComponent();

    await instance.build();

    const node = findNode(instance.group, "Delayed Move Box");
    expect(node.position.x).toBeCloseTo(5, 5);

    await instance.seek?.(0, "delayed-move");
    expect(node.position.x).toBeCloseTo(5, 5);

    await instance.seek?.(5, "delayed-move");
    expect(node.position.x).toBeCloseTo(5, 5);

    await instance.seek?.(6, "delayed-move");
    expect(node.position.x).toBeCloseTo(1, 5);

    await instance.seek?.(12, "delayed-move");
    expect(node.position.x).toBeCloseTo(3, 5);

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

function createQuickPlaybackBlueprint(): ComponentBlueprint {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";

  const quickBox = createNode("box", ROOT_NODE_ID, "quick-box");
  quickBox.name = "Quick Box";

  const quickClip = createAnimationClip("blink", {
    fps: 1000,
    durationFrames: 2,
    tracks: [],
  });

  const positionTrack = createAnimationTrack(quickBox.id, "transform.position.x");
  positionTrack.keyframes.push(createAnimationKeyframe(0, 0, "linear"));
  positionTrack.keyframes.push(createAnimationKeyframe(2, 1, "linear"));
  quickClip.tracks.push(positionTrack);

  return {
    version: 1,
    componentName: "Quick Playback Sample",
    fonts: [],
    nodes: [root, quickBox],
    animation: {
      ...createDefaultAnimation(),
      activeClipId: quickClip.id,
      clips: [quickClip],
    },
  };
}

function createVisibleAnimationBlueprint(): ComponentBlueprint {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";

  const blinkBox = createNode("box", ROOT_NODE_ID, "blink-box");
  blinkBox.name = "Blink Box";
  blinkBox.visible = false;

  const clip = createAnimationClip("blink-visibility", {
    fps: 24,
    durationFrames: 24,
    tracks: [],
  });

  const visibleTrack = createAnimationTrack(blinkBox.id, "visible");
  visibleTrack.keyframes.push(createAnimationKeyframe(0, 1, "linear"));
  visibleTrack.keyframes.push(createAnimationKeyframe(12, 0, "easeOut"));
  clip.tracks.push(visibleTrack);

  return {
    version: 1,
    componentName: "Visible Animation Sample",
    fonts: [],
    nodes: [root, blinkBox],
    animation: {
      ...createDefaultAnimation(),
      activeClipId: clip.id,
      clips: [clip],
    },
  };
}

function createDelayedVisibleAnimationBlueprint(): ComponentBlueprint {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";

  const blinkBox = createNode("box", ROOT_NODE_ID, "blink-box-delayed");
  blinkBox.name = "Blink Box";
  blinkBox.visible = false;

  const clip = createAnimationClip("blink-visibility", {
    fps: 24,
    durationFrames: 24,
    tracks: [],
  });

  const visibleTrack = createAnimationTrack(blinkBox.id, "visible");
  visibleTrack.keyframes.push(createAnimationKeyframe(12, 1, "linear"));
  visibleTrack.keyframes.push(createAnimationKeyframe(24, 0, "easeOut"));
  clip.tracks.push(visibleTrack);

  return {
    version: 1,
    componentName: "Delayed Visible Animation Sample",
    fonts: [],
    nodes: [root, blinkBox],
    animation: {
      ...createDefaultAnimation(),
      activeClipId: clip.id,
      clips: [clip],
    },
  };
}

function createDelayedNumericAnimationBlueprint(): ComponentBlueprint {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";

  const delayedBox = createNode("box", ROOT_NODE_ID, "delayed-box");
  delayedBox.name = "Delayed Move Box";
  delayedBox.transform.position.x = 5;

  const clip = createAnimationClip("delayed-move", {
    fps: 24,
    durationFrames: 18,
    tracks: [],
  });

  const positionTrack = createAnimationTrack(delayedBox.id, "transform.position.x");
  positionTrack.keyframes.push(createAnimationKeyframe(6, 1, "linear"));
  positionTrack.keyframes.push(createAnimationKeyframe(18, 5, "linear"));
  clip.tracks.push(positionTrack);

  return {
    version: 1,
    componentName: "Delayed Numeric Sample",
    fonts: [],
    nodes: [root, delayedBox],
    animation: {
      ...createDefaultAnimation(),
      activeClipId: clip.id,
      clips: [clip],
    },
  };
}

function findNode(root: Group, name: string): Group {
  const node = root.getObjectByName(name);
  expect(node).toBeInstanceOf(Group);
  return node as Group;
}

function findMesh(root: Group): Mesh {
  const mesh = root.children.find((child): child is Mesh => child instanceof Mesh);
  expect(mesh).toBeInstanceOf(Mesh);
  return mesh as Mesh;
}
