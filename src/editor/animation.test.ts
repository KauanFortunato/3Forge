import { describe, expect, it } from "vitest";
import {
  applyAnimationValue,
  animationValueToBoolean,
  assertKeyframesSorted,
  clampFrame,
  createAnimationKeyframe,
  createAnimationTrack,
  createDefaultAnimation,
  getAnimationValue,
  getTrackSegments,
  isAnimationEasePreset,
  isAnimationPropertyPath,
  isTrackMuted,
  normalizeAnimation,
  normalizeAnimationValueForProperty,
  secondsToFrame,
  frameToSeconds,
  sortTrackKeyframes,
} from "./animation";
import { createNode } from "./state";

describe("animation helpers", () => {
  it("exposes the default animation shape and valid guards", () => {
    expect(createDefaultAnimation()).toEqual({
      activeClipId: "",
      clips: [],
    });
    expect(isAnimationPropertyPath("transform.position.x")).toBe(true);
    expect(isAnimationPropertyPath("visible")).toBe(true);
    expect(isAnimationPropertyPath("material.color")).toBe(false);
    expect(isAnimationEasePreset("easeInOut")).toBe(true);
    expect(isAnimationEasePreset("invalid")).toBe(false);
  });

  it("converts frames, seconds, and clamps values consistently", () => {
    expect(frameToSeconds(12, 24)).toBe(0.5);
    expect(secondsToFrame(0.5, 24)).toBe(12);
    expect(clampFrame(99.6, 40)).toBe(40);
    expect(clampFrame(-3, 40)).toBe(0);
  });

  it("sorts keyframes and skips zero-length segments", () => {
    const track = createAnimationTrack("node-1", "transform.position.x");
    const later = createAnimationKeyframe(24, 2);
    const first = createAnimationKeyframe(0, 0);
    const duplicateFrame = createAnimationKeyframe(24, 3);

    track.keyframes = [later, first, duplicateFrame];

    expect(sortTrackKeyframes(track.keyframes).map((keyframe) => keyframe.frame)).toEqual([0, 24, 24]);
    expect(getTrackSegments(track)).toHaveLength(1);
    expect(getTrackSegments(track)[0]).toMatchObject({
      from: { frame: 0, value: 0 },
      to: { frame: 24 },
    });
  });

  it("normalizes legacy and modern animation payloads", () => {
    const node = createNode("box", null, "node-1");
    const animation = normalizeAnimation(
      {
        activeClipId: "missing",
        clips: [
          {
            id: "clip-a",
            name: "Main",
            fps: 30,
            durationFrames: 48,
            tracks: [
              {
                id: "track-a",
                nodeId: node.id,
                property: "transform.position.x",
                keyframes: [
                  { id: "key-b", frame: 20, value: 2, ease: "easeOut" },
                  { id: "key-a", frame: 0, value: 1, ease: "linear" },
                  { id: "ignored", frame: 20, value: 4, ease: "easeIn" },
                ],
              },
              {
                id: "track-visible",
                nodeId: node.id,
                property: "visible",
                keyframes: [
                  { id: "visible-a", frame: 0, value: 2, ease: "linear" },
                  { id: "visible-b", frame: 12, value: 0.4, ease: "easeIn" },
                ],
              },
              {
                id: "track-bad",
                nodeId: "missing",
                property: "material.color",
                keyframes: [],
              },
            ],
          },
          {
            id: "clip-b",
            name: "main",
            fps: 24,
            durationFrames: 120,
            tracks: [],
          },
        ],
      },
      new Set([node.id]),
    );

    expect(animation.activeClipId).toBe("clip-a");
    expect(animation.clips).toHaveLength(2);
    expect(animation.clips[0]?.tracks).toHaveLength(2);
    expect(animation.clips[0]?.tracks[0]?.keyframes.map((keyframe) => keyframe.frame)).toEqual([1, 20]);
    expect(animation.clips[0]?.tracks[1]).toMatchObject({
      property: "visible",
      keyframes: [
        { frame: 1, value: 1 },
        { frame: 12, value: 0 },
      ],
    });
    expect(animation.clips[1]?.name).toBe("main 2");
  });

  it("reads visible animation values from nodes as numeric booleans", () => {
    const node = createNode("box", null, "node-1");
    node.visible = false;

    expect(getAnimationValue(node, "visible")).toBe(0);
    expect(animationValueToBoolean("visible", 1)).toBe(true);
    expect(animationValueToBoolean("visible", 0)).toBe(false);
    expect(normalizeAnimationValueForProperty("visible", 0.49)).toBe(0);
    expect(normalizeAnimationValueForProperty("visible", 0.5)).toBe(1);
  });

  it("normalizes visible keyframes to discrete numeric values", () => {
    const node = createNode("box", null, "node-1");
    const animation = normalizeAnimation(
      {
        activeClipId: "clip-a",
        clips: [
          {
            id: "clip-a",
            name: "Main",
            fps: 24,
            durationFrames: 48,
            tracks: [
              {
                id: "track-a",
                nodeId: node.id,
                property: "visible",
                keyframes: [
                  { id: "key-a", frame: 0, value: false, ease: "linear" },
                  { id: "key-b", frame: 12, value: 0.7, ease: "linear" },
                ],
              },
            ],
          },
        ],
      },
      new Set([node.id]),
    );

    expect(animation.clips[0]?.tracks[0]?.keyframes.map((keyframe) => keyframe.value)).toEqual([0, 1]);
  });

  it("reads and applies animation values on nodes", () => {
    const node = createNode("box", null, "node-1");
    node.transform.position.x = 1.25;
    node.visible = false;

    expect(getAnimationValue(node, "transform.position.x")).toBe(1.25);
    expect(getAnimationValue(node, "visible")).toBe(0);
    expect(getAnimationValue(node, "transform.rotation.y")).toBe(0);

    applyAnimationValue(node, "visible", 0.49);
    expect(node.visible).toBe(false);

    applyAnimationValue(node, "visible", 1);
    expect(node.visible).toBe(true);
  });

  it("isTrackMuted returns false for undefined and true only for literal true", () => {
    const track = createAnimationTrack("node-1", "transform.position.x");
    expect(isTrackMuted(track)).toBe(false);

    track.muted = true;
    expect(isTrackMuted(track)).toBe(true);

    track.muted = false;
    expect(isTrackMuted(track)).toBe(false);
  });

  it("assertKeyframesSorted is a no-op on a sorted track and throws on out-of-order keyframes", () => {
    const sortedTrack = createAnimationTrack("node-1", "transform.position.x");
    sortedTrack.keyframes = [
      createAnimationKeyframe(0, 0),
      createAnimationKeyframe(12, 1),
      createAnimationKeyframe(24, 2),
    ];
    expect(() => assertKeyframesSorted(sortedTrack)).not.toThrow();

    const outOfOrderTrack = createAnimationTrack("node-1", "transform.position.x");
    outOfOrderTrack.keyframes = [
      createAnimationKeyframe(24, 2),
      createAnimationKeyframe(0, 0),
    ];
    expect(() => assertKeyframesSorted(outOfOrderTrack)).toThrow(/not sorted/);
  });
});
