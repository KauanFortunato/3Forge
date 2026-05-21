import { describe, expect, test } from "vitest";
import { translateBlueprint } from "./translate";
import type { W3DGroupData, W3DQuadData } from "./nodes/data";

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

// -------------------------------------------------------------------------
// Phase 2D.2 — Size / Position snapshot applied at PreviewMarker.
// -------------------------------------------------------------------------

function buildSceneWithControllers(body: string, controllers: string): string {
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
      ${controllers}
    </Timeline>
  </Timelines>
</Scene>`;
}

describe("translateBlueprint — Phase 2D.2 Size/Position snapshot", () => {
  test("BASE_MAIN-like: Size.XProp animates 0→7.7, Size.YProp 1.404→2.77 → geometry.size overridden at PreviewMarker", () => {
    const xml = buildSceneWithControllers(
      `<Quad Id="base-main" Name="BASE_MAIN" IsMask="True">
         <GeometryOptions AlignmentX="Right"><Size X="0" Y="1.404"/></GeometryOptions>
         <MaskProperties IsColoredMask="True" IsInvertedMask="True"/>
         <NodeTransform><Position X="3.993044"/></NodeTransform>
       </Quad>`,
      `<KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="base-main">
         <KeyFrame FrameNumber="50" Value="0"/>
         <KeyFrame FrameNumber="97" Value="7.7"/>
       </KeyFrameAnimationController>
       <KeyFrameAnimationController AnimatedProperty="Size.YProp" ControllableId="base-main">
         <KeyFrame FrameNumber="65" Value="1.404"/>
         <KeyFrame FrameNumber="145" Value="2.77"/>
       </KeyFrameAnimationController>`,
    );
    const { nodes } = translateBlueprint(xml);
    const q = nodes[0] as W3DQuadData;
    expect(q.geometry.size.x).toBeCloseTo(7.7, 5);
    expect(q.geometry.size.y).toBeCloseTo(2.77, 5);
  });

  test("Transform.Position.{X,Y,Z}Prop overrides Quad.transform.position", () => {
    const xml = buildSceneWithControllers(
      `<Quad Id="n" Name="N">
         <GeometryOptions><Size X="1" Y="1"/></GeometryOptions>
         <NodeTransform><Position X="0" Y="0" Z="0"/></NodeTransform>
       </Quad>`,
      `<KeyFrameAnimationController AnimatedProperty="Transform.Position.XProp" ControllableId="n">
         <KeyFrame FrameNumber="0" Value="0"/><KeyFrame FrameNumber="100" Value="10"/>
       </KeyFrameAnimationController>
       <KeyFrameAnimationController AnimatedProperty="Transform.Position.YProp" ControllableId="n">
         <KeyFrame FrameNumber="0" Value="0"/><KeyFrame FrameNumber="200" Value="-2"/>
       </KeyFrameAnimationController>
       <KeyFrameAnimationController AnimatedProperty="Transform.Position.ZProp" ControllableId="n">
         <KeyFrame FrameNumber="0" Value="-5"/>
       </KeyFrameAnimationController>`,
    );
    const { nodes } = translateBlueprint(xml);
    const q = nodes[0] as W3DQuadData;
    expect(q.transform.position.x).toBeCloseTo(10, 5);
    expect(q.transform.position.y).toBeCloseTo(-2, 5);
    expect(q.transform.position.z).toBeCloseTo(-5, 5);
  });

  test("Transform.Position.XProp also applies to Group nodes (not only Quads)", () => {
    const xml = buildSceneWithControllers(
      `<Group Id="g" Name="PLAYERS">
         <GeometryOptions/>
         <NodeTransform><Position X="0"/></NodeTransform>
         <Children/>
       </Group>`,
      `<KeyFrameAnimationController AnimatedProperty="Transform.Position.XProp" ControllableId="g">
         <KeyFrame FrameNumber="0" Value="0"/><KeyFrame FrameNumber="100" Value="1.938"/>
       </KeyFrameAnimationController>`,
    );
    const { nodes } = translateBlueprint(xml);
    const g = nodes[0] as W3DGroupData;
    expect(g.kind).toBe("Group");
    expect(g.transform.position.x).toBeCloseTo(1.938, 5);
  });

  test("Alpha + Size + Position on the same controllable → all three applied in one pass", () => {
    const xml = buildSceneWithControllers(
      `<Quad Id="base-main" Name="BASE_MAIN" Alpha="0" IsMask="True">
         <GeometryOptions><Size X="0" Y="0"/></GeometryOptions>
         <MaskProperties IsColoredMask="True" IsInvertedMask="True"/>
         <NodeTransform><Position X="0"/></NodeTransform>
       </Quad>`,
      `<KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="base-main">
         <KeyFrame FrameNumber="0" Value="1"/>
       </KeyFrameAnimationController>
       <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="base-main">
         <KeyFrame FrameNumber="50" Value="0"/><KeyFrame FrameNumber="97" Value="7.7"/>
       </KeyFrameAnimationController>
       <KeyFrameAnimationController AnimatedProperty="Transform.Position.XProp" ControllableId="base-main">
         <KeyFrame FrameNumber="0" Value="3.993"/>
       </KeyFrameAnimationController>`,
    );
    const { nodes } = translateBlueprint(xml);
    const q = nodes[0] as W3DQuadData;
    expect(q.alpha).toBeCloseTo(1, 5);
    expect(q.geometry.size.x).toBeCloseTo(7.7, 5);
    expect(q.geometry.size.y).toBe(0); // untouched — no Size.YProp controller
    expect(q.transform.position.x).toBeCloseTo(3.993, 5);
  });

  test("Quad without any timeline override keeps static Size/Position/Alpha", () => {
    const xml = buildSceneWithControllers(
      `<Quad Id="other" Name="OTHER" Alpha="0.4">
         <GeometryOptions><Size X="1.5" Y="2.5"/></GeometryOptions>
         <NodeTransform><Position X="3" Y="4" Z="5"/></NodeTransform>
       </Quad>`,
      `<KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="unrelated">
         <KeyFrame FrameNumber="0" Value="99"/>
       </KeyFrameAnimationController>`,
    );
    const { nodes } = translateBlueprint(xml);
    const q = nodes[0] as W3DQuadData;
    expect(q.alpha).toBeCloseTo(0.4, 5);
    expect(q.geometry.size.x).toBeCloseTo(1.5, 5);
    expect(q.geometry.size.y).toBeCloseTo(2.5, 5);
    expect(q.transform.position.x).toBeCloseTo(3, 5);
    expect(q.transform.position.y).toBeCloseTo(4, 5);
    expect(q.transform.position.z).toBeCloseTo(5, 5);
  });

  test("Existing Phase 2G Alpha snapshot semantics still apply alongside Size/Position", () => {
    // PHOTO_01-like: static Alpha=0.5, timeline reaches 1.0.
    // Plus a Size animation for the same controllable — both must be applied.
    const xml = buildSceneWithControllers(
      `<Quad Id="photo-01" Name="PHOTO_01" Alpha="0.5">
         <GeometryOptions AlignmentY="Bottom"><Size X="2.3" Y="2.3"/></GeometryOptions>
       </Quad>`,
      `<KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="photo-01">
         <KeyFrame FrameNumber="141" Value="0.5"/><KeyFrame FrameNumber="175" Value="1"/>
       </KeyFrameAnimationController>
       <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="photo-01">
         <KeyFrame FrameNumber="0" Value="0"/><KeyFrame FrameNumber="100" Value="2.3"/>
       </KeyFrameAnimationController>`,
    );
    const { nodes } = translateBlueprint(xml);
    const q = nodes[0] as W3DQuadData;
    expect(q.alpha).toBeCloseTo(1, 5);
    expect(q.geometry.size.x).toBeCloseTo(2.3, 5);
    expect(q.geometry.size.y).toBeCloseTo(2.3, 5); // unchanged — no Size.YProp
  });

  test("Partial axes — Size.XProp only leaves geometry.size.y untouched (and vice-versa)", () => {
    const xml = buildSceneWithControllers(
      `<Quad Id="n" Name="N">
         <GeometryOptions><Size X="0.1" Y="0.2"/></GeometryOptions>
       </Quad>`,
      `<KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="n">
         <KeyFrame FrameNumber="0" Value="9"/>
       </KeyFrameAnimationController>`,
    );
    const { nodes } = translateBlueprint(xml);
    const q = nodes[0] as W3DQuadData;
    expect(q.geometry.size.x).toBeCloseTo(9, 5);
    expect(q.geometry.size.y).toBeCloseTo(0.2, 5); // static preserved
  });
});
