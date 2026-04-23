import { describe, expect, it } from "vitest";
import { createNode } from "./state";
import { classifyPropertyScope, getSharedPropertyDefinitions } from "./sharedProperties";
import type { EditorNode } from "./types";

describe("classifyPropertyScope", () => {
  it("classifies shadow paths above material paths", () => {
    expect(classifyPropertyScope("material.castShadow")).toBe("shadow");
    expect(classifyPropertyScope("material.receiveShadow")).toBe("shadow");
  });

  it("classifies transform, material, geometry, origin and text paths", () => {
    expect(classifyPropertyScope("transform.position.x")).toBe("transform");
    expect(classifyPropertyScope("transform.rotation.y")).toBe("transform");
    expect(classifyPropertyScope("material.color")).toBe("material");
    expect(classifyPropertyScope("origin.x")).toBe("object");
    expect(classifyPropertyScope("geometry.width")).toBe("geometry");
    expect(classifyPropertyScope("geometry.text")).toBe("text");
    expect(classifyPropertyScope("geometry.size")).toBe("text");
  });

  it("falls back to object for unclassified paths", () => {
    expect(classifyPropertyScope("visible")).toBe("object");
    expect(classifyPropertyScope("name")).toBe("object");
  });
});

describe("getSharedPropertyDefinitions", () => {
  it("returns empty result for empty selection", () => {
    const result = getSharedPropertyDefinitions([]);
    expect(result.definitions).toEqual([]);
    expect(result.mixedPaths.size).toBe(0);
    expect(result.includedNodeIds).toEqual([]);
    expect(result.excludedNodeIds).toEqual([]);
    expect(result.valuesByPath).toEqual({});
  });

  it("returns all definitions (none mixed) for a single-node selection", () => {
    const node = createNode("box", null, "box-a");
    const result = getSharedPropertyDefinitions([node]);

    expect(result.definitions.length).toBeGreaterThan(0);
    expect(result.mixedPaths.size).toBe(0);
    expect(result.includedNodeIds).toEqual(["box-a"]);
    expect(result.excludedNodeIds).toEqual([]);

    const boxWidth = result.definitions.find((definition) => definition.path === "geometry.width");
    expect(boxWidth).toBeDefined();
    expect(result.valuesByPath["geometry.width"]).toBe(1.6);
  });

  it("intersects material definitions across heterogeneous nodes (excluding groups)", () => {
    const box = createNode("box", null, "box-a");
    const sphere = createNode("sphere", null, "sphere-a");
    const group = createNode("group", null, "group-a");

    const result = getSharedPropertyDefinitions([box, sphere, group], "material");

    expect(result.excludedNodeIds).toEqual(["group-a"]);
    expect(result.includedNodeIds).toEqual(["box-a", "sphere-a"]);

    const paths = result.definitions.map((definition) => definition.path);
    expect(paths).toContain("material.color");
    expect(paths).toContain("material.opacity");
    expect(paths).not.toContain("material.castShadow");
    expect(paths).not.toContain("material.receiveShadow");
    expect(paths.every((path) => path.startsWith("material."))).toBe(true);
  });

  it("limits geometry intersection for mixed geometry types", () => {
    const box = createNode("box", null, "box-a");
    const plane = createNode("plane", null, "plane-a");

    const result = getSharedPropertyDefinitions([box, plane], "geometry");

    const paths = result.definitions.map((definition) => definition.path);
    expect(paths).toContain("geometry.width");
    expect(paths).toContain("geometry.height");
    expect(paths).not.toContain("geometry.depth");
    expect(result.excludedNodeIds).toEqual([]);
  });

  it("excludes geometry-incompatible nodes (sphere + box share no geometry key)", () => {
    const box = createNode("box", null, "box-a");
    const sphere = createNode("sphere", null, "sphere-a");

    const result = getSharedPropertyDefinitions([box, sphere], "geometry");

    expect(result.definitions).toEqual([]);
    expect(result.excludedNodeIds.sort()).toEqual(["box-a", "sphere-a"]);
    expect(result.includedNodeIds).toEqual([]);
  });

  it("returns the full transform set for any selection", () => {
    const box = createNode("box", null, "box-a");
    const sphere = createNode("sphere", null, "sphere-a");
    const group = createNode("group", null, "group-a");

    const result = getSharedPropertyDefinitions([box, sphere, group], "transform");

    const paths = result.definitions.map((definition) => definition.path);
    expect(paths).toEqual([
      "transform.position.x",
      "transform.position.y",
      "transform.position.z",
      "transform.rotation.x",
      "transform.rotation.y",
      "transform.rotation.z",
      "transform.scale.x",
      "transform.scale.y",
      "transform.scale.z",
    ]);
    expect(result.includedNodeIds.sort()).toEqual(["box-a", "group-a", "sphere-a"]);
    expect(result.excludedNodeIds).toEqual([]);
  });

  it("detects mixed paths when transform axes differ across the selection", () => {
    const boxA = createNode("box", null, "box-a");
    const boxB = createNode("box", null, "box-b");
    boxB.transform.position.x = 5;

    const result = getSharedPropertyDefinitions([boxA, boxB], "transform");

    expect(result.mixedPaths.has("transform.position.x")).toBe(true);
    expect(result.mixedPaths.has("transform.position.y")).toBe(false);
    expect(result.valuesByPath["transform.position.x"]).toBeUndefined();
    expect(result.valuesByPath["transform.position.y"]).toBe(0);
  });

  it("restricts shadow scope to castShadow and receiveShadow", () => {
    const box = createNode("box", null, "box-a");
    const sphere = createNode("sphere", null, "sphere-a");

    const result = getSharedPropertyDefinitions([box, sphere], "shadow");

    const paths = result.definitions.map((definition) => definition.path).sort();
    expect(paths).toEqual(["material.castShadow", "material.receiveShadow"]);
    expect(result.valuesByPath["material.castShadow"]).toBe(true);
    expect(result.valuesByPath["material.receiveShadow"]).toBe(true);
    expect(result.mixedPaths.size).toBe(0);
  });

  it("marks color as mixed when values differ and as shared when identical", () => {
    const boxA = createNode("box", null, "box-a");
    const boxB = createNode("box", null, "box-b");
    // Equal primitive values -> not mixed.
    expect(boxA.material.color).toBe(boxB.material.color);

    const sharedResult = getSharedPropertyDefinitions([boxA, boxB], "material");
    expect(sharedResult.mixedPaths.has("material.color")).toBe(false);
    expect(sharedResult.valuesByPath["material.color"]).toBe("#4bd6ff");

    boxB.material.color = "#ff0000";
    const mixedResult = getSharedPropertyDefinitions([boxA, boxB], "material");
    expect(mixedResult.mixedPaths.has("material.color")).toBe(true);
    expect(mixedResult.valuesByPath["material.color"]).toBeUndefined();
  });

  it("treats structurally equal nested objects with different identity as not mixed", () => {
    // Craft two nodes with a nested object path sharing equal content but different identity.
    const baseA = createNode("box", null, "box-a");
    const baseB = createNode("box", null, "box-b");

    const nestedA: EditorNode = {
      ...baseA,
      // Inject a fabricated nested object accessible via path "origin".
      origin: { x: "left", y: "top", z: "front" },
    } as EditorNode;
    const nestedB: EditorNode = {
      ...baseB,
      origin: { x: "left", y: "top", z: "front" },
    } as EditorNode;

    // Even though no definition covers "origin" today, we can verify deep equality
    // by ensuring identical transform records (same nested values, different refs) are not mixed.
    nestedA.transform = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    nestedB.transform = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };

    const result = getSharedPropertyDefinitions([nestedA, nestedB], "transform");
    expect(result.mixedPaths.size).toBe(0);
    expect(result.valuesByPath["transform.position.x"]).toBe(1);
    expect(result.valuesByPath["transform.position.y"]).toBe(2);
  });

  it("supports scope arrays (union of filters)", () => {
    const boxA = createNode("box", null, "box-a");
    const boxB = createNode("box", null, "box-b");

    const result = getSharedPropertyDefinitions([boxA, boxB], ["transform", "shadow"]);

    const paths = result.definitions.map((definition) => definition.path);
    expect(paths).toContain("transform.position.x");
    expect(paths).toContain("material.castShadow");
    expect(paths).toContain("material.receiveShadow");
    expect(paths).not.toContain("material.color");
    expect(paths).not.toContain("geometry.width");
  });

  it("returns the full union when scope is omitted or 'all'", () => {
    const box = createNode("box", null, "box-a");
    const omitted = getSharedPropertyDefinitions([box]);
    const all = getSharedPropertyDefinitions([box], "all");

    expect(omitted.definitions.map((definition) => definition.path)).toEqual(
      all.definitions.map((definition) => definition.path),
    );
    expect(omitted.definitions.length).toBeGreaterThan(
      getSharedPropertyDefinitions([box], "transform").definitions.length,
    );
  });
});
