import { describe, expect, test } from "vitest";
import { parseTimelinePreviewSnapshot } from "./timelines";

function wrap(timelinesInner: string): string {
  return `<?xml version="1.0"?><Scene><Timelines ${timelinesInner.startsWith("Selected") ? "" : ""}>${timelinesInner}</Timelines></Scene>`;
}

function wrapWithAttr(attrs: string, timelinesInner: string): string {
  return `<?xml version="1.0"?><Scene><Timelines ${attrs}>${timelinesInner}</Timelines></Scene>`;
}

describe("parseTimelinePreviewSnapshot", () => {
  test("no <Timelines> element → empty map", () => {
    const snap = parseTimelinePreviewSnapshot(`<?xml version="1.0"?><Scene/>`);
    expect(snap.alphaByControllableId.size).toBe(0);
    expect(snap.previewMarker).toBeUndefined();
  });

  test("empty <Timelines> → empty map", () => {
    const snap = parseTimelinePreviewSnapshot(`<?xml version="1.0"?><Scene><Timelines/></Scene>`);
    expect(snap.alphaByControllableId.size).toBe(0);
  });

  test("Timeline with PreviewMarker=-1 → no evaluation", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(``, `
      <Timeline Name="Out" Id="t1" PreviewMarker="-1" MaxFrames="200">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="x">
          <KeyFrame FrameNumber="0" Value="1"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.previewMarker).toBeUndefined();
    expect(snap.alphaByControllableId.size).toBe(0);
  });

  test("SelectedTimelineId picks the matching timeline", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t-in"`, `
      <Timeline Name="In" Id="t-in" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="photo-1">
          <KeyFrame FrameNumber="141" Value="0.5"/>
          <KeyFrame FrameNumber="175" Value="1"/>
        </KeyFrameAnimationController>
      </Timeline>
      <Timeline Name="Out" Id="t-out" PreviewMarker="-1" MaxFrames="200">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="photo-1">
          <KeyFrame FrameNumber="0" Value="0"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.timelineName).toBe("In");
    expect(snap.previewMarker).toBe(799);
    expect(snap.alphaByControllableId.get("photo-1")).toBeCloseTo(1, 5);
  });

  test("fallback to first Timeline when SelectedTimelineId is absent", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(``, `
      <Timeline Name="First" Id="t1" PreviewMarker="100">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="a">
          <KeyFrame FrameNumber="0" Value="0"/>
          <KeyFrame FrameNumber="200" Value="1"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.timelineName).toBe("First");
    expect(snap.previewMarker).toBe(100);
    expect(snap.alphaByControllableId.get("a")).toBeCloseTo(0.5, 5);
  });

  test("PHOTO_01-like: keyframes (141,0.5)→(175,1.0), preview=799 → holds last = 1.0", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="photo-01-id">
          <KeyFrame FrameNumber="141" Value="0.5"/>
          <KeyFrame FrameNumber="175" Value="1"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.alphaByControllableId.get("photo-01-id")).toBeCloseTo(1, 5);
  });

  test("Preview before first keyframe → holds first value", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="50">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="x">
          <KeyFrame FrameNumber="100" Value="0.2"/>
          <KeyFrame FrameNumber="200" Value="0.8"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.alphaByControllableId.get("x")).toBeCloseTo(0.2, 5);
  });

  test("Preview between keyframes → linear interpolation", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="150">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="x">
          <KeyFrame FrameNumber="100" Value="0"/>
          <KeyFrame FrameNumber="200" Value="1"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.alphaByControllableId.get("x")).toBeCloseTo(0.5, 5);
  });

  test("Non-Alpha animated properties are ignored", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="100">
        <KeyFrameAnimationController AnimatedProperty="Transform.Position.YProp" ControllableId="x">
          <KeyFrame FrameNumber="0" Value="0"/>
          <KeyFrame FrameNumber="200" Value="5"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.alphaByControllableId.size).toBe(0);
  });

  test("Keyframes are sorted before evaluation (out-of-order document)", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="150">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="x">
          <KeyFrame FrameNumber="200" Value="1"/>
          <KeyFrame FrameNumber="100" Value="0"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.alphaByControllableId.get("x")).toBeCloseTo(0.5, 5);
  });

  test("Multiple Alpha controllers in same timeline are all captured", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="500">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="a">
          <KeyFrame FrameNumber="100" Value="0.5"/>
          <KeyFrame FrameNumber="200" Value="1"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="b">
          <KeyFrame FrameNumber="300" Value="0.5"/>
          <KeyFrame FrameNumber="400" Value="1"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.alphaByControllableId.size).toBe(2);
    expect(snap.alphaByControllableId.get("a")).toBeCloseTo(1, 5);
    expect(snap.alphaByControllableId.get("b")).toBeCloseTo(1, 5);
  });
});

// Suppress unused warning if wrap helper isn't used in any test
void wrap;
