import { describe, expect, it } from "vitest";
import { EditorStore, createDefaultBlueprint, createNode, getPropertyDefinitions } from "./state";
import type { BoxNode, ComponentBlueprint } from "./types";

function buildBlueprintWithBoxes(): ComponentBlueprint {
  const blueprint = createDefaultBlueprint();
  const boxA = createNode("box", "root", "box-a");
  const boxB = createNode("box", "root", "box-b");
  blueprint.nodes.push(boxA, boxB);
  return blueprint;
}

describe("materials registry", () => {
  it("creates a material asset and assigns it to multiple nodes", () => {
    const store = new EditorStore(buildBlueprintWithBoxes());
    const materialId = store.createMaterial({ name: "Red Plastic" });

    const assigned = store.assignMaterialToNodes(["box-a", "box-b"], materialId);
    expect(assigned).toBe(2);

    const boxA = store.getNode("box-a") as BoxNode;
    const boxB = store.getNode("box-b") as BoxNode;
    expect(boxA.materialId).toBe(materialId);
    expect(boxB.materialId).toBe(materialId);
  });

  it("editing a registry material propagates to all bound nodes", () => {
    const store = new EditorStore(buildBlueprintWithBoxes());
    const materialId = store.createMaterial({ name: "Shared" });
    store.assignMaterialToNodes(["box-a", "box-b"], materialId);

    const boxA = store.getNode("box-a") as BoxNode;
    const definition = getPropertyDefinitions(boxA).find((entry) => entry.path === "material.color");
    expect(definition).toBeDefined();

    const ok = store.updateMaterialAsset(materialId, definition!, "#aabbcc");
    expect(ok).toBe(true);

    const updatedA = store.getNode("box-a") as BoxNode;
    const updatedB = store.getNode("box-b") as BoxNode;
    expect(updatedA.material.color).toBe("#aabbcc");
    expect(updatedB.material.color).toBe("#aabbcc");
    expect(store.getMaterial(materialId)?.spec.color).toBe("#aabbcc");
  });

  it("inspector edits on a bound node redirect through the registry", () => {
    const store = new EditorStore(buildBlueprintWithBoxes());
    const materialId = store.createMaterial({ name: "Shared" });
    store.assignMaterialToNodes(["box-a", "box-b"], materialId);

    const boxA = store.getNode("box-a") as BoxNode;
    const definition = getPropertyDefinitions(boxA).find((entry) => entry.path === "material.color")!;
    store.updateNodeProperty("box-a", definition, "#112233");

    const updatedA = store.getNode("box-a") as BoxNode;
    const updatedB = store.getNode("box-b") as BoxNode;
    expect(updatedA.material.color).toBe("#112233");
    expect(updatedB.material.color).toBe("#112233");
  });

  it("editing an unbound node only mutates its own inline material", () => {
    const store = new EditorStore(buildBlueprintWithBoxes());
    const boxA = store.getNode("box-a") as BoxNode;
    const definition = getPropertyDefinitions(boxA).find((entry) => entry.path === "material.color")!;

    store.updateNodeProperty("box-a", definition, "#445566");

    const updatedA = store.getNode("box-a") as BoxNode;
    const updatedB = store.getNode("box-b") as BoxNode;
    expect(updatedA.material.color).toBe("#445566");
    expect(updatedB.material.color).not.toBe("#445566");
  });

  it("unassigning a material keeps the inline spec but drops the materialId", () => {
    const store = new EditorStore(buildBlueprintWithBoxes());
    const materialId = store.createMaterial({ name: "Shared" });
    store.assignMaterialToNodes(["box-a"], materialId);

    const beforeColor = (store.getNode("box-a") as BoxNode).material.color;
    store.unassignMaterialFromNodes(["box-a"]);

    const afterNode = store.getNode("box-a") as BoxNode;
    expect(afterNode.materialId).toBeUndefined();
    expect(afterNode.material.color).toBe(beforeColor);
  });

  it("removing a material clears the binding from all nodes", () => {
    const store = new EditorStore(buildBlueprintWithBoxes());
    const materialId = store.createMaterial({ name: "Shared" });
    store.assignMaterialToNodes(["box-a", "box-b"], materialId);

    store.removeMaterial(materialId);

    expect(store.getMaterial(materialId)).toBeUndefined();
    expect((store.getNode("box-a") as BoxNode).materialId).toBeUndefined();
    expect((store.getNode("box-b") as BoxNode).materialId).toBeUndefined();
  });

  it("loads blueprints with materials and re-syncs node specs to the registry", () => {
    const blueprint = buildBlueprintWithBoxes();
    blueprint.materials = [
      {
        id: "mat-1",
        name: "Imported",
        spec: {
          type: "standard",
          color: "#abcdef",
          emissive: "#000000",
          roughness: 0.5,
          metalness: 0.2,
          opacity: 1,
          transparent: true,
          visible: true,
          alphaTest: 0,
          depthTest: true,
          depthWrite: true,
          wireframe: false,
          castShadow: true,
          receiveShadow: true,
        },
      },
    ];
    (blueprint.nodes.find((node) => node.id === "box-a") as BoxNode).materialId = "mat-1";
    (blueprint.nodes.find((node) => node.id === "box-a") as BoxNode).material.color = "#000000";

    const store = new EditorStore(blueprint);

    const loadedA = store.getNode("box-a") as BoxNode;
    expect(loadedA.materialId).toBe("mat-1");
    expect(loadedA.material.color).toBe("#abcdef");
  });

  it("strips dangling materialIds when the asset is missing on import", () => {
    const blueprint = buildBlueprintWithBoxes();
    (blueprint.nodes.find((node) => node.id === "box-a") as BoxNode).materialId = "missing";
    const store = new EditorStore(blueprint);
    expect((store.getNode("box-a") as BoxNode).materialId).toBeUndefined();
  });

  it("tolerates blueprints without a materials field for backward compatibility", () => {
    const blueprint = buildBlueprintWithBoxes() as Partial<ComponentBlueprint>;
    delete blueprint.materials;
    const store = new EditorStore(blueprint as ComponentBlueprint);
    expect(store.materials).toEqual([]);
    expect(store.getNode("box-a")).toBeDefined();
  });
});
