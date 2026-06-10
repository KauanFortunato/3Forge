import { describe, expect, test } from "vitest";
import { parseNodes, type W3DGroupData, type W3DQuadData } from "./data";

function wrapInScene(inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Scene Id="s" Name="Sample">
  <SceneLayer Name="L" Id="l">
    <SceneNode Id="root" Name="RootNode">
      <Children>${inner}</Children>
    </SceneNode>
  </SceneLayer>
</Scene>`;
}

describe("parseNodes (skeleton)", () => {
  test("returns empty roots and no warnings for empty Children", () => {
    const result = parseNodes(wrapInScene(""));
    expect(result.roots).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("throws on invalid XML", () => {
    expect(() => parseNodes("<not-xml")).toThrow();
  });
});

export { wrapInScene };

describe("parseTriangle", () => {
  test("Triangle parses as a Quad-kind node with the triangle shape from GeometryOptions", () => {
    const { roots, warnings } = parseNodes(wrapInScene(
      `<Triangle Id="t1" Name="ARROW_LEFT" DisplayColor="11119017" MaskId="m1;">
         <GeometryOptions Angle="90" Edge1="1" Edge2="2" />
       </Triangle>`,
    ));
    expect(warnings).toEqual([]); // no "unknown node" warning
    expect(roots).toHaveLength(1);
    const t = roots[0] as W3DQuadData;
    expect(t.kind).toBe("Quad");
    expect(t.id).toBe("t1");
    expect(t.maskIds).toEqual(["m1"]);
    expect(t.triangle).toEqual({ angleDeg: 90, edge1: 1, edge2: 2 });
    // Layout size = the triangle's bounding box (90° → edge1 × edge2).
    expect(t.geometry.size.x).toBeCloseTo(1, 5);
    expect(t.geometry.size.y).toBeCloseTo(2, 5);
  });
});

describe("parseQuad direct attributes", () => {
  test("reads Id, Name and defaults Enable=true, Alpha=1, SpeedScale=1", () => {
    const { roots } = parseNodes(wrapInScene(`<Quad Id="q1" Name="BG"/>`));
    expect(roots).toHaveLength(1);
    expect(roots[0].kind).toBe("Quad");
    const q = roots[0] as W3DQuadData;
    expect(q.id).toBe("q1");
    expect(q.name).toBe("BG");
    expect(q.enable).toBe(true);
    expect(q.alpha).toBe(1);
    expect(q.speedScale).toBe(1);
    expect(q.isMask).toBe(false);
    expect(q.maskIds).toEqual([]);
  });

  test("Enable=\"False\" sets enable to false", () => {
    const { roots } = parseNodes(wrapInScene(`<Quad Id="q" Name="x" Enable="False"/>`));
    expect((roots[0] as W3DQuadData).enable).toBe(false);
  });

  test("Alpha=\"0\" stores 0 exactly", () => {
    const { roots } = parseNodes(wrapInScene(`<Quad Id="q" Name="x" Alpha="0"/>`));
    expect((roots[0] as W3DQuadData).alpha).toBe(0);
  });

  test("MaskId=\"a;b;\" splits into [\"a\", \"b\"]", () => {
    const { roots } = parseNodes(wrapInScene(`<Quad Id="q" Name="x" MaskId="a;b;"/>`));
    expect((roots[0] as W3DQuadData).maskIds).toEqual(["a", "b"]);
  });

  test("IsMask=\"True\" sets isMask", () => {
    const { roots } = parseNodes(wrapInScene(`<Quad Id="q" Name="x" IsMask="True"/>`));
    expect((roots[0] as W3DQuadData).isMask).toBe(true);
  });

  test("DisplayColor is preserved as raw string", () => {
    const { roots } = parseNodes(wrapInScene(`<Quad Id="q" Name="x" DisplayColor="11119017"/>`));
    expect((roots[0] as W3DQuadData).displayColor).toBe("11119017");
  });
});

describe("parseQuad geometry", () => {
  test("reads Size X, Y and AlignmentX/Y", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <GeometryOptions AlignmentX="Right" AlignmentY="Center">
          <Size X="7.36" Y="4.14"/>
        </GeometryOptions>
      </Quad>
    `));
    const q = roots[0] as W3DQuadData;
    expect(q.geometry.size.x).toBeCloseTo(7.36, 5);
    expect(q.geometry.size.y).toBeCloseTo(4.14, 5);
    expect(q.geometry.alignmentX).toBe("Right");
    expect(q.geometry.alignmentY).toBe("Center");
  });

  test("Size Lock preserved", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <GeometryOptions>
          <Size X="3.5" Y="3.5" Lock="XtoY"/>
        </GeometryOptions>
      </Quad>
    `));
    expect((roots[0] as W3DQuadData).geometry.size.lock).toBe("XtoY");
  });

  test("Size X=0 builds but emits warning", () => {
    const { roots, warnings } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="MASK_BASE">
        <GeometryOptions>
          <Size X="0" Y="1.4"/>
        </GeometryOptions>
      </Quad>
    `));
    expect((roots[0] as W3DQuadData).geometry.size.x).toBe(0);
    expect(warnings.some((w) => w.includes("MASK_BASE") && w.includes("Size"))).toBe(true);
  });

  test("missing Size yields 0/0 with no warning", () => {
    const { roots, warnings } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x"><GeometryOptions/></Quad>
    `));
    const q = roots[0] as W3DQuadData;
    expect(q.geometry.size.x).toBe(0);
    expect(q.geometry.size.y).toBe(0);
    expect(warnings).toEqual([]);
  });
});

describe("parseQuad transform", () => {
  test("reads Position, Scale and defaults missing axes", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <NodeTransform>
          <Position X="1.5" Z="-2"/>
          <Scale X="0.8" Y="0.8" Z="0.8" Lock="XtoYtoZ"/>
        </NodeTransform>
      </Quad>
    `));
    const t = (roots[0] as W3DQuadData).transform;
    expect(t.position).toEqual({ x: 1.5, y: 0, z: -2 });
    expect(t.scale).toEqual({ x: 0.8, y: 0.8, z: 0.8, lock: "XtoYtoZ" });
  });

  test("Rotation stays in degrees", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <NodeTransform>
          <Rotation X="0" Y="90" Z="0"/>
        </NodeTransform>
      </Quad>
    `));
    expect((roots[0] as W3DQuadData).transform.rotationDeg).toEqual({ x: 0, y: 90, z: 0 });
  });

  test("Pivot inside NodeTransform is preserved", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <NodeTransform>
          <Pivot X="0.5" Y="0" Z="0"/>
        </NodeTransform>
      </Quad>
    `));
    expect((roots[0] as W3DQuadData).transform.pivot).toEqual({ x: 0.5, y: 0, z: 0 });
  });

  test("no NodeTransform yields default transform", () => {
    const { roots } = parseNodes(wrapInScene(`<Quad Id="q" Name="x"/>`));
    const t = (roots[0] as W3DQuadData).transform;
    expect(t.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(t.rotationDeg).toEqual({ x: 0, y: 0, z: 0 });
    expect(t.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(t.pivot).toBeUndefined();
  });

  test('Phase P7: PivotType="Absolute" attribute is captured on W3DTransform', () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <NodeTransform PivotType="Absolute">
          <Pivot Y="-1.4"/>
          <Position Y="-1.4"/>
        </NodeTransform>
      </Quad>
    `));
    const t = (roots[0] as W3DQuadData).transform;
    expect(t.pivotType).toBe("Absolute");
    expect(t.pivot).toEqual({ x: 0, y: -1.4, z: 0 });
  });

  test('Phase P7: PivotType="Relative" is captured (forward-compatible, never authored in corpus)', () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <NodeTransform PivotType="Relative"><Pivot Y="1"/></NodeTransform>
      </Quad>
    `));
    expect((roots[0] as W3DQuadData).transform.pivotType).toBe("Relative");
  });

  test("Phase P7: missing PivotType leaves field undefined", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <NodeTransform><Pivot Y="-1.4"/></NodeTransform>
      </Quad>
    `));
    expect((roots[0] as W3DQuadData).transform.pivotType).toBeUndefined();
  });
});

describe("parseQuad FaceMapping and MaskProperties", () => {
  test("first NamedBaseFaceMapping is preserved", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <Primitive>
          <FaceMappingList>
            <NamedBaseFaceMapping SurfaceName="All Faces" MaterialId="mat-1" TextureLayerId="tex-1" BaseMaterialInherited="False" TextureInherited="False"/>
          </FaceMappingList>
        </Primitive>
      </Quad>
    `));
    const fm = (roots[0] as W3DQuadData).faceMapping!;
    expect(fm.materialId).toBe("mat-1");
    expect(fm.textureLayerId).toBe("tex-1");
    expect(fm.surfaceName).toBe("All Faces");
    expect(fm.baseMaterialInherited).toBe(false);
    expect(fm.textureInherited).toBe(false);
  });

  test("extra NamedBaseFaceMappings are counted in raw.extraFaceMappings", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x">
        <Primitive>
          <FaceMappingList>
            <NamedBaseFaceMapping SurfaceName="All" MaterialId="m1" TextureLayerId="t1" BaseMaterialInherited="False" TextureInherited="False"/>
            <NamedBaseFaceMapping SurfaceName="Front" MaterialId="m2" TextureLayerId="t2" BaseMaterialInherited="True" TextureInherited="True"/>
            <NamedBaseFaceMapping SurfaceName="Back" MaterialId="m3" TextureLayerId="t3" BaseMaterialInherited="True" TextureInherited="True"/>
          </FaceMappingList>
        </Primitive>
      </Quad>
    `));
    const q = roots[0] as W3DQuadData;
    expect(q.faceMapping?.materialId).toBe("m1");
    expect(q.raw?.extraFaceMappings).toBe(2);
  });

  test("MaskProperties is preserved", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q" Name="x" IsMask="True">
        <MaskProperties DisableBinaryAlpha="False" HasSampleCount="False" IsColoredMask="True" IsInvertedMask="True"/>
      </Quad>
    `));
    const q = roots[0] as W3DQuadData;
    expect(q.isMask).toBe(true);
    expect(q.maskProperties).toEqual({
      disableBinaryAlpha: false,
      hasSampleCount: false,
      isColoredMask: true,
      isInvertedMask: true,
    });
  });

  test("missing FaceMapping and MaskProperties is undefined, no warning", () => {
    const { roots, warnings } = parseNodes(wrapInScene(`<Quad Id="q" Name="x"/>`));
    const q = roots[0] as W3DQuadData;
    expect(q.faceMapping).toBeUndefined();
    expect(q.maskProperties).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

describe("parseGroup and recursion", () => {
  test("Group with transform contains Quad children", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Group Id="g1" Name="MAIN">
        <NodeTransform><Position X="2" Y="0" Z="0"/></NodeTransform>
        <Children>
          <Quad Id="q1" Name="A"/>
          <Quad Id="q2" Name="B"/>
        </Children>
      </Group>
    `));
    expect(roots).toHaveLength(1);
    expect(roots[0].kind).toBe("Group");
    const g = roots[0] as W3DGroupData;
    expect(g.id).toBe("g1");
    expect(g.transform.position.x).toBe(2);
    expect(g.children).toHaveLength(2);
    expect(g.children[0].kind).toBe("Quad");
    expect(g.children[1].kind).toBe("Quad");
  });

  test("Quad with nested Quad children", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Quad Id="q-parent" Name="P">
        <Children>
          <Quad Id="q-child" Name="C"/>
        </Children>
      </Quad>
    `));
    const parent = roots[0] as W3DQuadData;
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].kind).toBe("Quad");
    expect((parent.children[0] as W3DQuadData).id).toBe("q-child");
  });

  test("TextureText is parsed alongside Quads (no longer ignored — Phase TextureText)", () => {
    const { roots, warnings } = parseNodes(wrapInScene(`
      <Quad Id="q1" Name="A"/>
      <TextureText Id="tt" Name="TITLE">
        <GeometryOptions Text="HELLO" FontStyle="fs-1" AlignmentX="Left" AlignmentY="Center" TextQuality="3">
          <TextBoxSize X="1.5" Y="0.3"/>
        </GeometryOptions>
      </TextureText>
      <Quad Id="q2" Name="B"/>
    `));
    expect(roots).toHaveLength(3);
    expect((roots[0] as W3DQuadData).id).toBe("q1");
    expect(roots[1].kind).toBe("TextureText");
    expect((roots[2] as W3DQuadData).id).toBe("q2");
    // No "Ignored <TextureText>" warning anymore.
    expect(warnings.some((w) => w.includes("Ignored <TextureText>"))).toBe(false);
  });

  test('Phase TextureText layout v2: GeometryOptions ConstrainMethod="Width" is parsed', () => {
    const { roots } = parseNodes(wrapInScene(`
      <TextureText Id="tt" Name="NUM">
        <GeometryOptions Text="23" FontStyle="fs-1" AlignmentX="Center" AlignmentY="Center"
                         TextQuality="4" ConstrainMethod="Width">
          <TextBoxSize X="0.08" Y="0.19"/>
        </GeometryOptions>
      </TextureText>
    `));
    expect(roots).toHaveLength(1);
    const tt = roots[0];
    expect(tt.kind).toBe("TextureText");
    if (tt.kind !== "TextureText") return;
    expect(tt.constrainMethod).toBe("Width");
  });

  test('Phase TextureText layout v2: ConstrainMethod absent → constrainMethod undefined', () => {
    const { roots } = parseNodes(wrapInScene(`
      <TextureText Id="tt" Name="NUM">
        <GeometryOptions Text="X" FontStyle="fs-1" AlignmentX="Center" AlignmentY="Center" TextQuality="1">
          <TextBoxSize X="0.5" Y="0.5"/>
        </GeometryOptions>
      </TextureText>
    `));
    const tt = roots[0];
    if (tt.kind !== "TextureText") throw new Error("expected TextureText");
    expect(tt.constrainMethod).toBeUndefined();
  });

  test("Group MaskId is parsed", () => {
    const { roots } = parseNodes(wrapInScene(`<Group Id="g" Name="x" MaskId="m1;"/>`));
    expect((roots[0] as W3DGroupData).maskIds).toEqual(["m1"]);
  });

  test("Phase 2A: Group GeometryOptions FlowChildren=True LeadingSpace=-1.26 → flow set", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Group Id="g" Name="PLAYERS">
        <GeometryOptions LeadingSpace="-1.26" FlowChildren="True"/>
      </Group>
    `));
    const g = roots[0] as W3DGroupData;
    expect(g.flow).toBeDefined();
    expect(g.flow?.children).toBe(true);
    expect(g.flow?.leadingSpace).toBeCloseTo(-1.26, 5);
    expect(g.flow?.direction).toBeUndefined();
  });

  test("Phase 2A: Direction attribute is preserved generically (e.g. YMinus)", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Group Id="g" Name="BENCH_LIST">
        <GeometryOptions FlowChildren="True" LeadingSpace="-0.084" Direction="YMinus"/>
      </Group>
    `));
    const g = roots[0] as W3DGroupData;
    expect(g.flow?.direction).toBe("YMinus");
    expect(g.flow?.leadingSpace).toBeCloseTo(-0.084, 5);
  });

  test("Phase G: FlowChildrenAlignment is preserved (e.g. Trailing, Center)", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Group Id="g" Name="BENCH_LIST">
        <GeometryOptions FlowChildren="True" LeadingSpace="-0.084" Direction="YMinus" FlowChildrenAlignment="Trailing"/>
      </Group>
    `));
    const g = roots[0] as W3DGroupData;
    expect(g.flow?.alignment).toBe("Trailing");
  });

  test("Phase G: FlowChildrenAlignment alone (without FlowChildren=True) still parses but flow.children=false", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Group Id="g" Name="INNER">
        <GeometryOptions FlowChildrenAlignment="Center" Direction="YMinus"/>
      </Group>
    `));
    const g = roots[0] as W3DGroupData;
    expect(g.flow?.children).toBe(false);
    expect(g.flow?.alignment).toBe("Center");
    expect(g.flow?.direction).toBe("YMinus");
  });

  test("Phase 2A: Group without GeometryOptions → flow undefined", () => {
    const { roots } = parseNodes(wrapInScene(`<Group Id="g" Name="x"/>`));
    expect((roots[0] as W3DGroupData).flow).toBeUndefined();
  });

  test("Phase 2A: Group with GeometryOptions but no flow attrs → flow undefined", () => {
    const { roots } = parseNodes(wrapInScene(`
      <Group Id="g" Name="x">
        <GeometryOptions/>
      </Group>
    `));
    expect((roots[0] as W3DGroupData).flow).toBeUndefined();
  });
});
