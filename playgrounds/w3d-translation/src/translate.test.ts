import { describe, expect, test } from "vitest";
import { translateBlueprint } from "./translate";
import type { W3DQuadData } from "./nodes/data";

function buildScene(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Scene Id="s" Name="Sample" Version="3.6.0.*" Is2DScene="False">
  <SceneLayer Name="L" Id="l">
    <SceneNode Id="root" Name="RootNode">
      <Children>${body}</Children>
    </SceneNode>
  </SceneLayer>
  <Resources/>
  <Timelines SelectedTimelineId="t-in">
    <Timeline Name="In" Id="t-in" PreviewMarker="799" MaxFrames="800">
      <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="photo-01-id">
        <KeyFrame FrameNumber="141" Value="0.5"/>
        <KeyFrame FrameNumber="175" Value="1"/>
      </KeyFrameAnimationController>
    </Timeline>
  </Timelines>
</Scene>`;
}

describe("translateBlueprint — Phase 2G timeline preview snapshot", () => {
  test("PHOTO_01-like quad with static Alpha=0.5 + timeline reaching 1.0 → final alpha=1.0", () => {
    const xml = buildScene(`
      <Quad Id="photo-01-id" Name="PHOTO_01" Alpha="0.5">
        <GeometryOptions AlignmentY="Bottom"><Size X="2.3" Y="2.3"/></GeometryOptions>
      </Quad>
    `);
    const { nodes } = translateBlueprint(xml);
    const q = nodes[0] as W3DQuadData;
    expect(q.kind).toBe("Quad");
    expect(q.id).toBe("photo-01-id");
    expect(q.alpha).toBeCloseTo(1, 5); // overridden by timeline @ frame 799
  });

  test("Quad without timeline override keeps its static Alpha", () => {
    const xml = buildScene(`
      <Quad Id="not-animated" Name="STATIC" Alpha="0.3">
        <GeometryOptions><Size X="1" Y="1"/></GeometryOptions>
      </Quad>
    `);
    const { nodes } = translateBlueprint(xml);
    const q = nodes[0] as W3DQuadData;
    expect(q.alpha).toBeCloseTo(0.3, 5); // unchanged
  });

  test("Scene without <Timelines> leaves all alphas at static values", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Id="s" Name="Sample"><SceneLayer Name="L" Id="l">
  <SceneNode Id="root" Name="RootNode"><Children>
    <Quad Id="q" Name="X" Alpha="0.5"><GeometryOptions><Size X="1" Y="1"/></GeometryOptions></Quad>
  </Children></SceneNode>
</SceneLayer><Resources/></Scene>`;
    const { nodes } = translateBlueprint(xml);
    const q = nodes[0] as W3DQuadData;
    expect(q.alpha).toBeCloseTo(0.5, 5);
  });
});
