import { describe, expect, it } from "vitest";

import {
  createBlueprintFromAiScene,
  isAiAnimationPatch,
  isAiSceneSpec,
  type AiSceneSpec,
} from "./aiBlueprint";
import {
  AI_BLUEPRINT_EXAMPLES,
  buildExamplesBlock,
  selectRelevantExamples,
} from "./aiBlueprintExamples";

const createExamples = AI_BLUEPRINT_EXAMPLES.filter((example) => example.mode === "create");
const animateExisting = AI_BLUEPRINT_EXAMPLES.filter((example) => example.mode === "animate-existing");

describe("gold example bank — create examples", () => {
  it.each(createExamples.map((example) => [example.id, example] as const))(
    "%s is a valid, centered, uniquely named scene spec",
    (_id, example) => {
      const spec = example.output as AiSceneSpec;
      expect(isAiSceneSpec(spec)).toBe(true);
      expect(spec.objects.length).toBeGreaterThanOrEqual(1);
      expect(spec.objects.length).toBeLessThanOrEqual(28);

      const names = spec.objects.map((object) => object.name);
      expect(new Set(names).size).toBe(names.length);

      for (const object of spec.objects) {
        expect(Math.abs(object.position.x ?? 0)).toBeLessThanOrEqual(4);
        expect(Math.abs(object.position.y ?? 0)).toBeLessThanOrEqual(4);
        expect(Math.abs(object.position.z ?? 0)).toBeLessThanOrEqual(4);
      }
    },
  );

  it.each(createExamples.map((example) => [example.id, example] as const))(
    "%s converts into a blueprint with resolvable animation targets",
    (_id, example) => {
      const spec = example.output as AiSceneSpec;
      const blueprint = createBlueprintFromAiScene(spec);

      // root + one node per object.
      expect(blueprint.nodes.length).toBe(spec.objects.length + 1);

      const nodeIds = new Set(blueprint.nodes.map((node) => node.id));
      const specClips = (spec.animation as { clips?: unknown[] } | undefined)?.clips ?? [];

      if (specClips.length > 0) {
        expect(blueprint.animation.clips.length).toBeGreaterThan(0);
        for (const clip of blueprint.animation.clips) {
          expect(clip.tracks.length).toBeGreaterThan(0);
          for (const track of clip.tracks) {
            // objectName must have resolved to a real node id.
            expect(nodeIds.has(track.nodeId)).toBe(true);
            const frames = track.keyframes.map((keyframe) => keyframe.frame);
            expect([...frames]).toEqual([...frames].sort((a, b) => a - b));
            expect(Math.max(...frames)).toBeLessThanOrEqual(clip.durationFrames);
          }
        }
      }
    },
  );
});

describe("gold example bank — expanded capabilities", () => {
  it("preserves torus primitives through conversion (robot hands)", () => {
    const robot = createExamples.find((example) => example.id === "robot");
    expect(robot).toBeDefined();
    const spec = robot!.output as AiSceneSpec;
    const toruses = spec.objects.filter((object) => object.type === "torus");
    expect(toruses.length).toBeGreaterThan(0);

    const blueprint = createBlueprintFromAiScene(spec);
    expect(blueprint.nodes.filter((node) => node.type === "torus")).toHaveLength(toruses.length);
  });

  it("applies a non-center origin through conversion (bouncing ball)", () => {
    const ball = createExamples.find((example) => example.id === "bouncing-ball");
    expect(ball).toBeDefined();
    const spec = ball!.output as AiSceneSpec;
    expect(spec.objects.some((object) => object.origin?.y === "bottom")).toBe(true);

    const blueprint = createBlueprintFromAiScene(spec);
    const ballNode = blueprint.nodes.find((node) => node.name === "Ball");
    expect(ballNode?.origin.y).toBe("bottom");
  });
});

describe("gold example bank — existing blueprint patch", () => {
  it("is shaped as a Mode B animation patch", () => {
    expect(animateExisting.length).toBeGreaterThan(0);
    for (const example of animateExisting) {
      expect(isAiAnimationPatch(example.output)).toBe(true);
      expect(isAiSceneSpec(example.output)).toBe(false);
    }
  });
});

describe("selectRelevantExamples", () => {
  it("surfaces a matching example by keyword", () => {
    const selected = selectRelevantExamples("a cute robot with antennas", { count: 2 });
    expect(selected.map((example) => example.id)).toContain("robot");
  });

  it("includes the existing-blueprint patch when the request edits the current scene", () => {
    const selected = selectRelevantExamples("add a jump animation to this current scene", { count: 2 });
    expect(selected.some((example) => example.mode === "animate-existing")).toBe(true);
  });

  it("excludes the existing-blueprint patch for fresh creation requests", () => {
    const selected = selectRelevantExamples("a wooden table", { count: 3 });
    expect(selected.some((example) => example.mode === "animate-existing")).toBe(false);
  });

  it("falls back to generic examples when nothing matches", () => {
    const selected = selectRelevantExamples("an abstract xyzzy thing", { count: 2 });
    expect(selected.length).toBe(2);
    expect(selected.every((example) => example.mode === "create")).toBe(true);
  });

  it("respects the requested count", () => {
    expect(selectRelevantExamples("a spinning propeller", { count: 1 })).toHaveLength(1);
  });
});

describe("buildExamplesBlock", () => {
  it("produces a prompt fragment with the example output", () => {
    const block = buildExamplesBlock("a desktop monitor", { count: 1 });
    expect(block).toContain("Reference examples");
    expect(block).toContain("Correct JSON output:");
    expect(block).toContain("Desktop Monitor");
  });
});
