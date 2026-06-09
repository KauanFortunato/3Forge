import { describe, expect, it } from "vitest";
import { createMaterialSpec } from "./materials";
import { shouldApplyModelNodeMaterial, shouldAttachTransformGizmo } from "./scene";

describe("shouldAttachTransformGizmo", () => {
  it("does not attach when the current tool is select", () => {
    expect(shouldAttachTransformGizmo("select", 1, true)).toBe(false);
    expect(shouldAttachTransformGizmo("select", 3, true)).toBe(false);
  });

  it("does not attach when there is no selection", () => {
    expect(shouldAttachTransformGizmo("translate", 0, false)).toBe(false);
  });

  it("attaches to the primary object in a single selection", () => {
    expect(shouldAttachTransformGizmo("translate", 1, true)).toBe(true);
    expect(shouldAttachTransformGizmo("rotate", 1, true)).toBe(true);
    expect(shouldAttachTransformGizmo("scale", 1, true)).toBe(true);
  });

  it("attaches to the primary object when multi-selection is active", () => {
    expect(shouldAttachTransformGizmo("translate", 3, true)).toBe(true);
    expect(shouldAttachTransformGizmo("rotate", 2, true)).toBe(true);
  });

  it("does not attach when the primary object is missing from the scene graph", () => {
    expect(shouldAttachTransformGizmo("translate", 2, false)).toBe(false);
  });
});

describe("shouldApplyModelNodeMaterial", () => {
  it("preserves imported model materials while the model node has its default material", () => {
    expect(shouldApplyModelNodeMaterial(createMaterialSpec("#ffffff"))).toBe(false);
  });

  it("applies the model node material after the user changes material state", () => {
    const material = createMaterialSpec("#ffffff", "physical");
    material.transmission = 0.85;
    material.thickness = 0.2;

    expect(shouldApplyModelNodeMaterial(material)).toBe(true);
  });

  it("applies a linked material asset even when its current values match the default", () => {
    expect(shouldApplyModelNodeMaterial(createMaterialSpec("#ffffff"), "mat-glass")).toBe(true);
  });
});
