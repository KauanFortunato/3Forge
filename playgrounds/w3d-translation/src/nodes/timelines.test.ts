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

  test("Transform.Skew.XProp / YProp populate skewByControllableId at the marker", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t1"`, `
      <Timeline Name="In" Id="t1" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Transform.Skew.YProp" ControllableId="mask-1">
          <KeyFrame FrameNumber="140" Value="0"/>
          <KeyFrame FrameNumber="155" Value="6"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Transform.Skew.XProp" ControllableId="mask-1">
          <KeyFrame FrameNumber="140" Value="0"/>
          <KeyFrame FrameNumber="155" Value="3"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    // Held past the last keyframe (frame 799 > 155) → settles to the final value.
    const sk = snap.skewByControllableId.get("mask-1");
    expect(sk?.y).toBeCloseTo(6, 5);
    expect(sk?.x).toBeCloseTo(3, 5);
  });

  test("Transform.Position vec3 is sampled at the marker (held past last keyframe)", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t1"`, `
      <Timeline Name="In" Id="t1" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Transform.Position" ControllableId="num-1">
          <KeyFrame FrameNumber="539" Value="0,0,0"/>
          <KeyFrame FrameNumber="575" Value="0,0.15,0"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    const p = snap.positionByControllableId.get("num-1");
    expect(p?.x).toBeCloseTo(0, 5);
    expect(p?.y).toBeCloseTo(0.15, 5);
    expect(p?.z).toBeCloseTo(0, 5);
  });

  test("per-axis Position props take precedence over the vec3 form (merge rule)", () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t1"`, `
      <Timeline Name="In" Id="t1" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Transform.Position" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="1,2,3"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Transform.Position.YProp" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="9"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    const p = snap.positionByControllableId.get("n");
    expect(p?.x).toBeCloseTo(1, 5); // from the vec3 base
    expect(p?.y).toBeCloseTo(9, 5); // per-axis prop wins
    expect(p?.z).toBeCloseTo(3, 5); // from the vec3 base
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

  test('Timeline with PreviewMarker=-1 → all maps empty (regression with Phase 2G semantics)', () => {
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
    expect(snap.scaleByControllableId.size).toBe(0);
  });
});

// -------------------------------------------------------------------------
// Phase 2D.4 — Transform.Scale snapshot.
// -------------------------------------------------------------------------
describe("parseTimelinePreviewSnapshot — Phase 2D.4 Transform.Scale", () => {
  test('NAME_01-like vec3 Scale: KF 140→"0,0,1" 175→"1,1,1" 220→"1,1,1" 255→"0.75,0.75,0.75", preview=799 → (0.75, 0.75, 0.75)', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Transform.Scale" ControllableId="name-01">
          <KeyFrame FrameNumber="140" Value="0,0,1"/>
          <KeyFrame FrameNumber="175" Value="1,1,1"/>
          <KeyFrame FrameNumber="220" Value="1,1,1"/>
          <KeyFrame FrameNumber="255" Value="0.75,0.75,0.75"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    const v = snap.scaleByControllableId.get("name-01")!;
    expect(v.x).toBeCloseTo(0.75, 5);
    expect(v.y).toBeCloseTo(0.75, 5);
    expect(v.z).toBeCloseTo(0.75, 5);
  });

  test('Transform.Scale linear interpolation between vec3 keyframes (frame between two KFs)', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="50">
        <KeyFrameAnimationController AnimatedProperty="Transform.Scale" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="0,0,1"/>
          <KeyFrame FrameNumber="100" Value="1,1,1"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    const v = snap.scaleByControllableId.get("n")!;
    expect(v.x).toBeCloseTo(0.5, 5);
    expect(v.y).toBeCloseTo(0.5, 5);
    expect(v.z).toBeCloseTo(1, 5);
  });

  test('malformed Value (not 3 components) → keyframe is dropped silently', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="50">
        <KeyFrameAnimationController AnimatedProperty="Transform.Scale" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="0,0"/>
          <KeyFrame FrameNumber="100" Value="1,1,1"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    // Only the second keyframe survived → preview frame past it → returns last
    const v = snap.scaleByControllableId.get("n")!;
    expect(v.x).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(1, 5);
    expect(v.z).toBeCloseTo(1, 5);
  });

  test('per-axis Transform.Scale.{X,Y,Z}Prop variants are also accepted (defensive)', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="500">
        <KeyFrameAnimationController AnimatedProperty="Transform.Scale.XProp" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="0.1"/>
          <KeyFrame FrameNumber="100" Value="2"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Transform.Scale.YProp" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="3"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    const v = snap.scaleByControllableId.get("n")!;
    expect(v.x).toBeCloseTo(2, 5);   // hold last past frame 100
    expect(v.y).toBeCloseTo(3, 5);
    expect(v.z).toBeUndefined();      // no Z controller
  });

  test('Mixed Alpha + Size + Position + Scale on same controllable → all four populated', () => {
    const snap = parseTimelinePreviewSnapshot(wrapWithAttr(`SelectedTimelineId="t"`, `
      <Timeline Name="In" Id="t" PreviewMarker="799">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="1"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="0"/><KeyFrame FrameNumber="100" Value="7.7"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Transform.Position.XProp" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="3.993"/>
        </KeyFrameAnimationController>
        <KeyFrameAnimationController AnimatedProperty="Transform.Scale" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="0,0,1"/><KeyFrame FrameNumber="100" Value="0.75,0.75,1"/>
        </KeyFrameAnimationController>
      </Timeline>
    `));
    expect(snap.alphaByControllableId.get("n")).toBeCloseTo(1, 5);
    expect(snap.sizeByControllableId.get("n")!.x).toBeCloseTo(7.7, 5);
    expect(snap.positionByControllableId.get("n")!.x).toBeCloseTo(3.993, 5);
    const sc = snap.scaleByControllableId.get("n")!;
    expect(sc.x).toBeCloseTo(0.75, 5);
    expect(sc.y).toBeCloseTo(0.75, 5);
    expect(sc.z).toBeCloseTo(1, 5);
  });
});

// Suppress unused warning if wrap helper isn't used in any test
void wrap;

// ---------------------------------------------------------------------------
// Runtime animation — parse tracks ONCE, evaluate at ANY frame (the timeline
// player path). parseTimelinePreviewSnapshot stays as the marker shortcut.
// ---------------------------------------------------------------------------
import { parseTimelineTracks, evaluateSnapshotAtFrame } from "./timelines";

describe("parseTimelineTracks + evaluateSnapshotAtFrame", () => {
  test("tracks expose name, previewMarker, maxFrames, isLoop and fps (from Timelines Format)", () => {
    const tracks = parseTimelineTracks(wrapWithAttr(`SelectedTimelineId="t1" Format="HD1080p50"`, `
      <Timeline Name="In" Id="t1" IsLoop="False" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="a">
          <KeyFrame FrameNumber="0" Value="0"/><KeyFrame FrameNumber="100" Value="1"/>
        </KeyFrameAnimationController>
      </Timeline>`));
    expect(tracks.timelineName).toBe("In");
    expect(tracks.previewMarker).toBe(799);
    expect(tracks.maxFrames).toBe(800);
    expect(tracks.fps).toBe(50);
    expect(tracks.isLoop).toBe(false);
  });

  test("evaluates at arbitrary frames: hold-before, linear mid, hold-after", () => {
    const tracks = parseTimelineTracks(wrapWithAttr(`SelectedTimelineId="t1"`, `
      <Timeline Name="In" Id="t1" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="a">
          <KeyFrame FrameNumber="100" Value="0"/>
          <KeyFrame FrameNumber="200" Value="1"/>
        </KeyFrameAnimationController>
      </Timeline>`));
    expect(evaluateSnapshotAtFrame(tracks, 0).alphaByControllableId.get("a")).toBeCloseTo(0, 5);
    expect(evaluateSnapshotAtFrame(tracks, 150).alphaByControllableId.get("a")).toBeCloseTo(0.5, 5);
    expect(evaluateSnapshotAtFrame(tracks, 750).alphaByControllableId.get("a")).toBeCloseTo(1, 5);
  });

  test("CubicBezier easing (right 1,0 → left 0,1) eases in: quarter-time value far below linear", () => {
    const tracks = parseTimelineTracks(wrapWithAttr(`SelectedTimelineId="t1"`, `
      <Timeline Name="In" Id="t1" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="a">
          <KeyFrame FrameNumber="0" Value="0" LeftType="Linear" RightType="CubicBezier" LeftControlPointX="0.5" LeftControlPointY="0.5" RightControlPointX="1" RightControlPointY="0"/>
          <KeyFrame FrameNumber="100" Value="1" LeftType="CubicBezier" RightType="Linear" LeftControlPointX="0" LeftControlPointY="1" RightControlPointX="0.5" RightControlPointY="0.5"/>
        </KeyFrameAnimationController>
      </Timeline>`));
    const quarter = evaluateSnapshotAtFrame(tracks, 25).alphaByControllableId.get("a")!;
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(0.1);  // linear would be 0.25 — bezier eases in
    const mid = evaluateSnapshotAtFrame(tracks, 50).alphaByControllableId.get("a")!;
    expect(mid).toBeCloseTo(0.5, 2);    // symmetric S-curve crosses the middle
  });

  test("vec3 tracks evaluate mid-segment too", () => {
    const tracks = parseTimelineTracks(wrapWithAttr(`SelectedTimelineId="t1"`, `
      <Timeline Name="In" Id="t1" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Transform.Position" ControllableId="n">
          <KeyFrame FrameNumber="0" Value="0,0,0"/>
          <KeyFrame FrameNumber="100" Value="2,4,6"/>
        </KeyFrameAnimationController>
      </Timeline>`));
    const p = evaluateSnapshotAtFrame(tracks, 50).positionByControllableId.get("n")!;
    expect(p.x).toBeCloseTo(1, 5);
    expect(p.y).toBeCloseTo(2, 5);
    expect(p.z).toBeCloseTo(3, 5);
  });

  test("Enabled step-evaluates at any frame", () => {
    const tracks = parseTimelineTracks(wrapWithAttr(`SelectedTimelineId="t1"`, `
      <Timeline Name="In" Id="t1" PreviewMarker="799" MaxFrames="800">
        <KeyFrameAnimationController AnimatedProperty="Enabled" ControllableId="q">
          <KeyFrame FrameNumber="10" Value="False"/>
          <KeyFrame FrameNumber="20" Value="True"/>
        </KeyFrameAnimationController>
      </Timeline>`));
    expect(evaluateSnapshotAtFrame(tracks, 15).enabledByControllableId.get("q")).toBe(false);
    expect(evaluateSnapshotAtFrame(tracks, 25).enabledByControllableId.get("q")).toBe(true);
  });

  test("unsupported AnimatedProperty values are surfaced for warnings", () => {
    const tracks = parseTimelineTracks(wrapWithAttr(`SelectedTimelineId="t1"`, `
      <Timeline Name="In" Id="t1" PreviewMarker="0" MaxFrames="100">
        <KeyFrameAnimationController AnimatedProperty="Animation" ControllableId="n1"/>
        <KeyFrameAnimationController AnimatedProperty="SceneNodeIndex" ControllableId="n2"/>
      </Timeline>`));
    expect(tracks.unsupportedProps).toEqual([
      { prop: "Animation", controllableId: "n1" },
      { prop: "SceneNodeIndex", controllableId: "n2" },
    ]);
  });

  test("ImageSequenceAnimationController is surfaced as unsupported (video/sequence playback)", () => {
    const tracks = parseTimelineTracks(wrapWithAttr(`SelectedTimelineId="t1"`, `
      <Timeline Name="In" Id="t1" PreviewMarker="0" MaxFrames="100">
        <ImageSequenceAnimationController IncrementValue="1" StartFrame="0" EndFrame="-2147483648" AnimatedProperty="Animation" ControllableId="seq-1" />
      </Timeline>`));
    expect(tracks.unsupportedProps).toEqual([
      { prop: "Animation (image sequence / video playback)", controllableId: "seq-1" },
    ]);
  });

  test("tracks are still parsed when PreviewMarker is -1 (timeline can play)", () => {
    const tracks = parseTimelineTracks(wrapWithAttr(``, `
      <Timeline Name="Out" Id="t1" PreviewMarker="-1" MaxFrames="200">
        <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="x">
          <KeyFrame FrameNumber="0" Value="1"/><KeyFrame FrameNumber="100" Value="0"/>
        </KeyFrameAnimationController>
      </Timeline>`));
    expect(tracks.previewMarker).toBeUndefined();
    expect(tracks.maxFrames).toBe(200);
    expect(evaluateSnapshotAtFrame(tracks, 50).alphaByControllableId.get("x")).toBeCloseTo(0.5, 5);
  });
});
