import { describe, expect, it } from "vitest";
import { compareComponentBlueprints } from "./blueprintDiff";
import { createDefaultBlueprint, createNode } from "./state";

describe("compareComponentBlueprints", () => {
  it("summarizes added objects", () => {
    const before = createDefaultBlueprint();
    const after = createDefaultBlueprint();
    const addedNode = createNode("sphere", after.nodes[0].id, "added-sphere");
    addedNode.name = "Added Sphere";
    after.nodes.push(addedNode);

    expect(compareComponentBlueprints(before, after)).toEqual({
      added: [
        {
          key: "sphere:added sphere",
          id: "added-sphere",
          name: "Added Sphere",
          type: "sphere",
        },
      ],
      removed: [],
      changed: [],
    });
  });

  it("summarizes removed objects", () => {
    const before = createDefaultBlueprint();
    const after = createDefaultBlueprint();
    const removedNode = createNode("box", before.nodes[0].id, "removed-box");
    removedNode.name = "Removed Box";
    before.nodes.push(removedNode);

    expect(compareComponentBlueprints(before, after).removed).toEqual([
      {
        key: "box:removed box",
        id: "removed-box",
        name: "Removed Box",
        type: "box",
      },
    ]);
  });

  it("summarizes changed object fields relevant to AI chat", () => {
    const before = createDefaultBlueprint();
    const after = createDefaultBlueprint();
    const beforeText = before.nodes.find((node) => node.type === "text");
    const afterText = after.nodes.find((node) => node.type === "text");

    expect(beforeText?.type).toBe("text");
    expect(afterText?.type).toBe("text");
    if (!beforeText || beforeText.type !== "text" || !afterText || afterText.type !== "text") {
      throw new Error("Expected default text node.");
    }

    afterText.visible = false;
    afterText.transform.position.x = 1.25;
    afterText.transform.rotation.y = 0.5;
    afterText.transform.scale.z = 2;
    afterText.geometry.text = "Updated headline";
    afterText.geometry.size = 0.42;
    afterText.material.color = "#ff0000";
    afterText.material.opacity = 0.5;

    expect(compareComponentBlueprints(before, after).changed).toEqual([
      {
        key: "text:headline",
        id: afterText.id,
        name: "Headline",
        type: "text",
        changes: [
          { path: "visible", before: true, after: false },
          { path: "transform.position", before: { x: 0, y: 0.5535, z: 0.1584 }, after: { x: 1.25, y: 0.5535, z: 0.1584 } },
          { path: "transform.rotation", before: { x: 0, y: 0, z: 0 }, after: { x: 0, y: 0.5, z: 0 } },
          { path: "transform.scale", before: { x: 1, y: 1, z: 1 }, after: { x: 1, y: 1, z: 2 } },
          { path: "geometry.text", before: "3Forge", after: "Updated headline" },
          { path: "geometry.size", before: 0.28, after: 0.42 },
          { path: "material.color", before: "#333333", after: "#ff0000" },
          { path: "material.opacity", before: 1, after: 0.5 },
        ],
      },
    ]);
  });

  it("returns an empty summary when there are no object changes", () => {
    const before = createDefaultBlueprint();
    const after = createDefaultBlueprint();

    expect(compareComponentBlueprints(before, after)).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  it("matches AI-generated objects by type and name instead of regenerated ids", () => {
    const before = createDefaultBlueprint();
    const after = createDefaultBlueprint();
    const beforePanel = before.nodes.find((node) => node.name === "Hero Panel");
    const afterPanel = after.nodes.find((node) => node.name === "Hero Panel");

    expect(beforePanel?.type).toBe("box");
    expect(afterPanel?.type).toBe("box");
    if (!beforePanel || beforePanel.type !== "box" || !afterPanel || afterPanel.type !== "box") {
      throw new Error("Expected default hero panel box.");
    }

    afterPanel.id = "ai-regenerated-panel-id";
    afterPanel.material.color = "#7c3aed";

    const diff = compareComponentBlueprints(before, after);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([
      {
        key: "box:hero panel",
        id: "ai-regenerated-panel-id",
        name: "Hero Panel",
        type: "box",
        changes: [
          { path: "material.color", before: beforePanel.material.color, after: "#7c3aed" },
        ],
      },
    ]);
  });
});
