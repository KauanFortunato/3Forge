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

  it("emits a parseable scaffold when no shadow data is available", () => {
    const blueprint = createDefaultBlueprint();
    const { xml, warnings } = exportToW3D(blueprint);
    expect(warnings.some((w) => w.toLowerCase().includes("partial export"))).toBe(true);

    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
    expect(doc.documentElement.tagName).toBe("Scene");
  });
});
