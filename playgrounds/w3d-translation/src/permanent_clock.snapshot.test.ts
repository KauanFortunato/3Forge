// playgrounds/w3d-translation/src/permanent_clock.snapshot.test.ts
//
// Second-template snapshot fidelity test (LINEUP_LEFT was the first).
// PERMANENT_CLOCK exercises constructs not present in LINEUP_LEFT:
//   - Single SceneLayer with 3 Timelines (In / Out / Referees_In), only "In"
//     has a positive PreviewMarker → tests the selected-timeline fallback path.
//   - Heavy Enabled-track usage (22 controllers) — locks the Phase 2D.5 hold-
//     last snapshot semantics against more than one fixture.
//   - FlowChildren groups with HasConstrainBox / ConstrainMethod / FlowChildren
//     Alignment values not exercised by LINEUP_LEFT — parser must ignore the
//     unknown GeometryOptions attributes silently and the runtime must not
//     crash.
//   - Distinct font set (Obviously Wide SemiBold, Obviously Medium, Obviously
//     Cond Black) — locks the font-style → CSS weight mapping for a broader
//     range of Type strings.
//
// The fixture is a verbatim copy of PERMANENT_CLOCK/scene.w3d; the source
// scene is never modified.
import { describe, expect, test } from "vitest";
import { translateBlueprint } from "./translate";
import { buildNodeTree, type BuildContext } from "./nodes/builder";
import type {
  W3DNodeData, W3DGroupData, W3DQuadData, W3DTextureTextData,
} from "./nodes/data";
import permanentClockXmlRaw from "./__fixtures__/PERMANENT_CLOCK.scene.w3d?raw";

const permanentClockXml = permanentClockXmlRaw.replace(/^﻿/, "");

function findByName(roots: W3DNodeData[], name: string): W3DNodeData | undefined {
  const stack = [...roots];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.name === name) return n;
    stack.push(...n.children);
  }
  return undefined;
}

function collectAll(roots: W3DNodeData[], predicate: (n: W3DNodeData) => boolean): W3DNodeData[] {
  const out: W3DNodeData[] = [];
  const stack = [...roots];
  while (stack.length) {
    const n = stack.shift()!;
    if (predicate(n)) out.push(n);
    stack.push(...n.children);
  }
  return out;
}

describe("PERMANENT_CLOCK fixture — translation + PreviewMarker snapshot", () => {
  test("translateBlueprint completes without throwing and parses the scene", () => {
    const result = translateBlueprint(permanentClockXml);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.resources).toBeDefined();
    expect(result.blueprint.sceneSettings?.mode).toBe("2d");
  });

  const { nodes, resources, warnings } = translateBlueprint(permanentClockXml);

  const textureText = (name: string): W3DTextureTextData => {
    const n = findByName(nodes, name);
    expect(n, `TextureText "${name}" not found`).toBeDefined();
    expect(n!.kind, `node "${name}" should be a TextureText`).toBe("TextureText");
    return n as W3DTextureTextData;
  };
  const group = (name: string): W3DGroupData => {
    const n = findByName(nodes, name);
    expect(n, `Group "${name}" not found`).toBeDefined();
    expect(n!.kind, `node "${name}" should be a Group`).toBe("Group");
    return n as W3DGroupData;
  };

  test("scene constructs: ≥30 TextureText nodes, ≥1 mask, ≥5 flow groups", () => {
    const ttCount = collectAll(nodes, (n) => n.kind === "TextureText").length;
    const masks = collectAll(nodes, (n) => n.kind === "Quad" && (n as W3DQuadData).isMask);
    const flowGroups = collectAll(nodes,
      (n) => n.kind === "Group" && (n as W3DGroupData).flow?.children === true);
    expect(ttCount).toBeGreaterThanOrEqual(30);
    expect(masks.length).toBeGreaterThanOrEqual(1);
    expect(flowGroups.length).toBeGreaterThanOrEqual(5);
  });

  test("resources: 7 distinct FontStyles parsed, family names preserved", () => {
    expect(resources.fontStyles.size).toBeGreaterThanOrEqual(7);
    const families = new Set<string>();
    for (const fs of resources.fontStyles.values()) families.add(fs.fontName);
    // PERMANENT_CLOCK uses three distinct families.
    expect(families.has("Obviously Wide")).toBe(true);
    expect(families.has("Obviously")).toBe(true);
    expect(families.has("Obviously Cond")).toBe(true);
  });

  test("Enabled snapshot: SHOT_TIMER goes from authored False to True at PreviewMarker=50", () => {
    // SHOT_TIMER timeline: KeyFrame frame 0 = False, frame 25 = True. At
    // PreviewMarker=50 the hold-last evaluation lands on True.
    expect(textureText("SHOT_TIMER").enable).toBe(true);
  });

  test("Enabled snapshot: STAT (masked TextureText) settles to True at PreviewMarker", () => {
    // STAT timeline: 0=False, 25=True. At frame 50 holds True.
    expect(textureText("STAT").enable).toBe(true);
  });

  test("Enabled snapshot: STATS_LEFT (authored Enable=False) stays False at PreviewMarker", () => {
    // STATS_LEFT has authored Enable="False" and only one keyframe at frame 0 = False.
    // Hold-last evaluation at frame 50 keeps it False.
    expect(textureText("STATS_LEFT").enable).toBe(false);
  });

  test("Enabled snapshot: STATS_RIGHT (authored Enable=False) stays False at PreviewMarker", () => {
    expect(textureText("STATS_RIGHT").enable).toBe(false);
  });

  test("FlowChildren parser tolerates HasConstrainBox / ConstrainMethod / FlowChildrenAlignment attrs", () => {
    // PLAYER_INFO_LEFT and PLAYER_INFO_RIGHT carry GeometryOptions with
    // HasConstrainBox="True" ConstrainMethod="Width" FlowChildren="True"
    // FlowChildrenAlignment="Center". The Phase G parser only extracts
    // FlowChildren / LeadingSpace / Direction / FlowChildrenAlignment and
    // must ignore the rest without dropping the flow flag itself.
    const left = group("PLAYER_INFO_LEFT");
    expect(left.flow?.children).toBe(true);
    expect(left.flow?.alignment).toBe("Center");
    const right = group("PLAYER_INFO_RIGHT");
    expect(right.flow?.children).toBe(true);
    expect(right.flow?.alignment).toBe("Center");
  });

  test("FlowChildren XPlus default: LEFT_ENABLED keeps authored LeadingSpace + flow flag", () => {
    // LEFT_ENABLED / LEFT_DISABLED / RIGHT_ENABLED / RIGHT_DISABLED — flow
    // containers with no Direction (defaults to XPlus) and a positive
    // LeadingSpace gap of 0.057.
    const leftEnabled = group("LEFT_ENABLED");
    expect(leftEnabled.flow?.children).toBe(true);
    expect(leftEnabled.flow?.leadingSpace).toBeCloseTo(0.057, 5);
    expect(leftEnabled.flow?.direction).toBeUndefined(); // default XPlus
  });

  test("FlowChildrenAlignment Trailing parsed on RIGHT_DISABLED / RIGHT_ENABLED", () => {
    expect(group("RIGHT_DISABLED").flow?.alignment).toBe("Trailing");
    expect(group("RIGHT_ENABLED").flow?.alignment).toBe("Trailing");
  });

  test("warnings: no warning indicates a dropped core construct (Quad/Group/TextureText/Children)", () => {
    // Phase B audit found that AnimatedProperty values like SetExportAction,
    // SceneNodeIndex, Animation are not implemented yet — those are silently
    // skipped by timelines.ts (no warning emitted, just not applied). What we
    // DO want to fail on: any "Ignored <Quad>"-style structural warning.
    const dropped = warnings.filter((w) =>
      /Ignored <(?:Quad|Group|TextureText|Children)>/.test(w),
    );
    expect(dropped).toEqual([]);
  });

  // ---- Build-side smoke: the importer can produce a Three.js tree without crashing ----
  test("buildNodeTree builds without crashing under a full BuildContext", () => {
    const ctx: BuildContext = {
      registry: resources,
      textureUrlsByFilename: new Map(),
      textureCache: new Map(),
      warnings: [],
    };
    const root = buildNodeTree(nodes, ctx);
    // Children count == roots count.
    expect(root.children.length).toBeGreaterThan(0);
    // No "Ignored …" warnings should be emitted by the builder either.
    const droppedAtBuild = ctx.warnings.filter((w) =>
      /Ignored <(?:Quad|Group|TextureText|Children)>/.test(w),
    );
    expect(droppedAtBuild).toEqual([]);
  });
});
