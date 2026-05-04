import { describe, expect, it } from "vitest";
import { parseW3D } from "../import/w3d";
import { exportToW3D } from "./w3d";
import { createDefaultBlueprint } from "../state";
import testSceneXml from "../../test/fixtures/w3d/TestScene.w3d?raw";
import gameNameFsXml from "../../test/fixtures/w3d/GameName_FS.w3d?raw";

describe("W3D export", () => {
  it("round-trips a fresh import without losing nodes, clips, or keyframes", () => {
    const first = parseW3D(testSceneXml, { sceneName: "TestScene" });
    const { xml, warnings } = exportToW3D(first.blueprint);
    expect(warnings).toEqual([]);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);

    const second = parseW3D(xml, { sceneName: "TestScene" });

    const namesA = first.blueprint.nodes.map((n) => n.name).sort();
    const namesB = second.blueprint.nodes.map((n) => n.name).sort();
    expect(namesB).toEqual(namesA);

    const clipsA = first.blueprint.animation.clips.map((c) => c.name).sort();
    const clipsB = second.blueprint.animation.clips.map((c) => c.name).sort();
    expect(clipsB).toEqual(clipsA);

    for (const clipA of first.blueprint.animation.clips) {
      const clipB = second.blueprint.animation.clips.find((c) => c.name === clipA.name);
      expect(clipB).toBeDefined();
      const trackKfsA = clipA.tracks.map((t) => t.keyframes.length).sort();
      const trackKfsB = (clipB?.tracks ?? []).map((t) => t.keyframes.length).sort();
      expect(trackKfsB).toEqual(trackKfsA);
    }
  });

  it("patches a mutated transform into the exported XML", () => {
    const imported = parseW3D(testSceneXml, { sceneName: "TestScene" });
    const disk = imported.blueprint.nodes.find((n) => n.name === "Disk1");
    expect(disk).toBeDefined();
    if (!disk) return;
    disk.transform.position.x = 7.25;

    const { xml } = exportToW3D(imported.blueprint);
    const reparsed = parseW3D(xml, { sceneName: "TestScene" });
    const diskAgain = reparsed.blueprint.nodes.find((n) => n.name === "Disk1");
    expect(diskAgain?.transform.position.x).toBeCloseTo(7.25);
  });

  it("preserves opaque W3D structures on the GameName_FS round-trip", () => {
    const imported = parseW3D(gameNameFsXml, { sceneName: "GameName_FS" });
    const { xml } = exportToW3D(imported.blueprint);
    expect(xml).toContain("<TextureLayer");
    expect(xml).toContain("<ImageSequence");
    expect(xml).toContain("<MaskProperties");
    // Reparseable end-to-end.
    const second = parseW3D(xml, { sceneName: "GameName_FS" });
    expect(second.blueprint.nodes.length).toBe(imported.blueprint.nodes.length);
  });

  it("preserves Enable='False' on round-trip when the user didn't touch the node", () => {
    // The importer flips Enable='False' to visible=true (design-view), but
    // the exporter must re-emit Enable='False' for nodes the user didn't
    // explicitly re-enable, otherwise a re-import in R3 would silently lose
    // the authoring intent.
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False" Id="root-id" Name="T">' +
      "<SceneLayer><SceneNode><Children>" +
      '<Group Id="g1" Name="HELPERS" Enable="False"><Children>' +
      '<Quad Id="q1" Name="Floor"/>' +
      "</Children></Group>" +
      "</Children></SceneNode></SceneLayer></Scene>";
    const imported = parseW3D(xml, { sceneName: "T" });
    const helpers = imported.blueprint.nodes.find((n) => n.name === "HELPERS");
    expect(helpers?.visible).toBe(true);
    const { xml: out } = exportToW3D(imported.blueprint);
    expect(out).toContain('Enable="False"');
  });

  it("flips Enable to True when the user explicitly hid then re-shows the node", () => {
    // Untouched promotion = preserve original. But the user toggling
    // visibility OFF then ON should land at Enable='True' — we treat any
    // departure from the design-view default as an intentional override.
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Id="r" Name="T"><SceneLayer><SceneNode><Children>' +
      '<Group Id="g1" Name="HELPERS" Enable="False"><Children/></Group>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const imported = parseW3D(xml, { sceneName: "T" });
    const helpers = imported.blueprint.nodes.find((n) => n.name === "HELPERS");
    if (!helpers) throw new Error("missing HELPERS");
    // Simulate "user toggles visibility off then back on" by clearing the
    // initial-disabled marker — that's what the editor will do when the
    // user changes visibility through the inspector.
    const w3d = imported.blueprint.metadata?.w3d as { initialDisabledNodeIds?: string[] };
    w3d.initialDisabledNodeIds = w3d.initialDisabledNodeIds?.filter((id) => id !== helpers.id);
    const { xml: out } = exportToW3D(imported.blueprint);
    expect(out).not.toContain('Enable="False"');
  });

  it("emits a parseable scaffold when no shadow data is available", () => {
    const blueprint = createDefaultBlueprint();
    const { xml, warnings } = exportToW3D(blueprint);
    expect(warnings.some((w) => w.toLowerCase().includes("partial export"))).toBe(true);

    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
    expect(doc.documentElement.tagName).toBe("Scene");
  });
});
