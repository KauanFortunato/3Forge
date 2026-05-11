import { describe, expect, it } from "vitest";
import {
  applyAnimationValue,
  animationValueToBoolean,
  assertKeyframesSorted,
  clampFrame,
  createAnimationClip,
  createAnimationKeyframe,
  createAnimationTrack,
  createDefaultAnimation,
  getAnimationValue,
  getTrackSegments,
  isAnimationEasePreset,
  isAnimationPropertyPath,
  isTrackMuted,
  isW3DPlaybackGuarded,
  maxPreviewFrameFromClips,
  normalizeAnimation,
  normalizeAnimationValueForProperty,
  secondsToFrame,
  frameToSeconds,
  sortTrackKeyframes,
  W3D_PLAYBACK_GUARD_WARNING,
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

describe("maxPreviewFrameFromClips", () => {
  // Used by:
  //   - applyWorkspaceBlueprint (pick initial editor frame)
  //   - the defensive resync useEffect (restore correct frame after a
  //     blueprint reload / undo / viewport remount)
  //   - __r3Dump().timelineRuntime.previewFrame (forensic dump)
  // The tests below pin the contract those three call sites rely on.

  it("returns -1 when no clip declares a preview frame", () => {
    const a = createAnimationClip("a", { fps: 25, durationFrames: 100 });
    const b = createAnimationClip("b", { fps: 25, durationFrames: 50 });
    expect(maxPreviewFrameFromClips([a, b])).toBe(-1);
  });

  it("returns the only clip's previewFrame when present", () => {
    const a = createAnimationClip("a", { fps: 25, durationFrames: 100 });
    a.previewFrame = 80;
    expect(maxPreviewFrameFromClips([a])).toBe(80);
  });

  it("returns the maximum previewFrame across multiple clips (LINEUP_LEFT scenario)", () => {
    // "In" timeline at frame 799, "Out" timeline with no preview marker.
    const inClip = createAnimationClip("In", { fps: 25, durationFrames: 800 });
    inClip.previewFrame = 799;
    const outClip = createAnimationClip("Out", { fps: 25, durationFrames: 200 });
    expect(maxPreviewFrameFromClips([inClip, outClip])).toBe(799);
  });

  it("returns the larger previewFrame when multiple clips declare one", () => {
    const a = createAnimationClip("a", { fps: 25, durationFrames: 100 });
    a.previewFrame = 30;
    const b = createAnimationClip("b", { fps: 25, durationFrames: 100 });
    b.previewFrame = 80;
    expect(maxPreviewFrameFromClips([a, b])).toBe(80);
    expect(maxPreviewFrameFromClips([b, a])).toBe(80); // order-independent
  });

  it("treats previewFrame=0 as a valid preview (legitimate \"rest at frame 0\")", () => {
    const a = createAnimationClip("a", { fps: 25, durationFrames: 100 });
    a.previewFrame = 0;
    // Beats the -1 sentinel for "no preview", so 0 wins.
    expect(maxPreviewFrameFromClips([a])).toBe(0);
  });

  it("handles an empty clip array gracefully", () => {
    expect(maxPreviewFrameFromClips([])).toBe(-1);
  });
});

describe("isW3DPlaybackGuarded", () => {
  // The guard activates when both signals agree: W3D origin marker on
  // the blueprint metadata + at least one clip declares a non-negative
  // PreviewMarker. Anything else (legacy 3Forge blueprints, hand-authored
  // timelines, W3D imports that never declared a preview marker) keeps
  // playback enabled.

  const makeClipWithPreview = (frame: number) => {
    const clip = createAnimationClip("In", { fps: 25, durationFrames: 800 });
    clip.previewFrame = frame;
    return clip;
  };
  const makePlainClip = () => createAnimationClip("plain", { fps: 25, durationFrames: 100 });

  it("returns false for a non-W3D blueprint (no metadata.w3d marker)", () => {
    expect(isW3DPlaybackGuarded({
      blueprintMetadata: { foo: "bar" },
      clips: [makeClipWithPreview(799)],
    })).toBe(false);
  });

  it("returns false when metadata is null / undefined", () => {
    expect(isW3DPlaybackGuarded({ blueprintMetadata: null, clips: [makeClipWithPreview(799)] })).toBe(false);
    expect(isW3DPlaybackGuarded({ blueprintMetadata: undefined, clips: [makeClipWithPreview(799)] })).toBe(false);
  });

  it("returns false for a W3D blueprint with no preview marker on any clip", () => {
    expect(isW3DPlaybackGuarded({
      blueprintMetadata: { w3d: { originalXml: "<x/>" } },
      clips: [makePlainClip(), makePlainClip()],
    })).toBe(false);
  });

  it("returns true for a W3D blueprint with a positive preview marker (LINEUP_LEFT)", () => {
    expect(isW3DPlaybackGuarded({
      blueprintMetadata: { w3d: { originalXml: "<x/>" } },
      clips: [makeClipWithPreview(799)],
    })).toBe(true);
  });

  it("returns true even with previewFrame=0 (legitimate 'rest at frame 0' counts as a snapshot)", () => {
    expect(isW3DPlaybackGuarded({
      blueprintMetadata: { w3d: { originalXml: "<x/>" } },
      clips: [makeClipWithPreview(0)],
    })).toBe(true);
  });

  it("exports a stable warning string that the UI can show to the operator", () => {
    expect(typeof W3D_PLAYBACK_GUARD_WARNING).toBe("string");
    expect(W3D_PLAYBACK_GUARD_WARNING).toMatch(/PreviewMarker/);
    expect(W3D_PLAYBACK_GUARD_WARNING.length).toBeGreaterThan(20);
  });
});
