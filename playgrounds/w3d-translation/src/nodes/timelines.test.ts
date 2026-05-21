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

// -------------------------------------------------------------------------
// Phase 2D.2 — Size and Position snapshot evaluation.
// -------------------------------------------------------------------------
describe("parseTimelinePreviewSnapshot — Phase 2D.2 Size / Position", () => {
  test('Size.XProp evaluated at PreviewMarker (BASE_MAIN-like: 50→0, 97→7.7, preview=799 → 7.7)', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="base-main">
          <KeyFrame FrameNumber="50" Value="0"/>
          <KeyFrame FrameNumber="97" Value="7.7"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.sizeByControllableId.get("base-main")!.x).toBeCloseTo(7.7, 5);
    expect(snap.sizeByControllableId.get("base-main")!.y).toBeUndefined();
  });

  test('Size.YProp evaluated at PreviewMarker (BASE_MAIN-like: 65→1.404, 145→2.77, preview=799 → 2.77)', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="799">
        <KeyFrameAnimationController AnimatedProperty="Size.YProp" ControllableId="base-main">
          <KeyFrame FrameNumber="65" Value="1.404"/>
          <KeyFrame FrameNumber="145" Value="2.77"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.sizeByControllableId.get("base-main")!.y).toBeCloseTo(2.77, 5);
    expect(snap.sizeByControllableId.get("base-main")!.x).toBeUndefined();
  });

  test('Size.X and Size.Y on the same ControllableId merge into one entry', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="799">
        <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="n">
          <KeyFrame FrameNumber="50" Value="0"/>
          <KeyFrame FrameNumber="97" Value="7.7"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Size.YProp" ControllableId="n">
          <KeyFrame FrameNumber="65" Value="1.404"/>
          <KeyFrame FrameNumber="145" Value="2.77"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    const e = snap.sizeByControllableId.get("n")!;
    expect(e.x).toBeCloseTo(7.7, 5);
    expect(e.y).toBeCloseTo(2.77, 5);
  });

  test('Transform.Position.{X,Y,Z}Prop evaluated and merged on the same controllable', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="500">
        <KeyFrameAnimationController AnimatedProperty="Transform.Position.XProp" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="0"/>
          <KeyFrame FrameNumber="100" Value="10"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Transform.Position.YProp" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="0"/>
          <KeyFrame FrameNumber="200" Value="5"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Transform.Position.ZProp" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="-1"/>
          <KeyFrame FrameNumber="800" Value="-1"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    const p = snap.positionByControllableId.get("n")!;
    expect(p.x).toBeCloseTo(10, 5); // beyond last KF → hold last
    expect(p.y).toBeCloseTo(5, 5);  // beyond last KF → hold last
    expect(p.z).toBeCloseTo(-1, 5); // within span, both KFs at -1 → -1
  });

  test('Alpha + Size + Position on the same ControllableId all preserved', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="799">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="0"/>
          <KeyFrame FrameNumber="100" Value="1"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="n">
          <KeyFrame FrameNumber="50" Value="0"/>
          <KeyFrame FrameNumber="97" Value="7.7"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Transform.Position.XProp" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="3.993"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.alphaByControllableId.get("n")).toBeCloseTo(1, 5);
    expect(snap.sizeByControllableId.get("n")!.x).toBeCloseTo(7.7, 5);
    expect(snap.positionByControllableId.get("n")!.x).toBeCloseTo(3.993, 5);
  });

  test('non-Alpha non-Size non-Position properties are still ignored', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="100">
        <KeyFrameAnimationController AnimatedProperty="Transform.Scale.XProp" ControllableId="x">
          <KeyFrame FrameNumber="0" Value="0"/>
          <KeyFrame FrameNumber="200" Value="2"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Transform.Rotation.ZProp" ControllableId="x">
          <KeyFrame FrameNumber="0" Value="0"/>
          <KeyFrame FrameNumber="200" Value="90"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.alphaByControllableId.size).toBe(0);
    expect(snap.sizeByControllableId.size).toBe(0);
    expect(snap.positionByControllableId.size).toBe(0);
  });

  test('Timeline with PreviewMarker=-1 → all three maps empty (regression with Phase 2G semantics)', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(``, `
      <Timeline Name="Out" Id="t" PreviewMarker="-1" MaxFrames="200">
        <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="x">
          <KeyFrame FrameNumber="0" Value="0"/>
          <KeyFrame FrameNumber="100" Value="10"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.previewMarker).toBeUndefined();
    expect(snap.alphaByControllableId.size).toBe(0);
    expect(snap.sizeByControllableId.size).toBe(0);
    expect(snap.positionByControllableId.size).toBe(0);
  });
});

// Suppress unused warning if wrap helper isn't used in any test
void wrap;
