import { describe, expect, it } from "vitest";
import { resolveMaskInversion, shouldAttachTransformGizmo } from "./scene";
import { createNode } from "./state";
import type { ComponentBlueprint, EditorNode } from "./types";

function makeBlueprint(nodes: EditorNode[]): ComponentBlueprint {
  return {
    version: 1,
    componentName: "test",
    sceneMode: "2d",
    nodes,
    fonts: [],
    images: [],
    materials: [],
    animation: { clips: [] },
  } as unknown as ComponentBlueprint;
}

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

describe("resolveMaskInversion", () => {
  it("returns true when the mask node is marked inverted", () => {
    const mask = createNode("plane", { name: "Mask", parentId: null });
    mask.isMask = true;
    mask.maskInverted = true;
    const target = createNode("plane", { name: "Target", parentId: null });
    target.maskId = mask.id;
    const bp = makeBlueprint([mask, target]);

    expect(resolveMaskInversion(bp, mask.id, target)).toBe(true);
  });

  it("returns false when the mask node is not inverted", () => {
    const mask = createNode("plane", { name: "Mask", parentId: null });
    mask.isMask = true;
    const target = createNode("plane", { name: "Target", parentId: null });
    target.maskId = mask.id;
    const bp = makeBlueprint([mask, target]);

    expect(resolveMaskInversion(bp, mask.id, target)).toBe(false);
  });

  it("ignores a maskInverted flag on the target — inversion is a property of the mask", () => {
    // Older blueprints (or hand-edited data) might still set maskInverted on
    // the target. The new contract treats only the mask as authoritative so
    // a target-only flag MUST NOT flip clipping.
    const mask = createNode("plane", { name: "Mask", parentId: null });
    mask.isMask = true;
    const target = createNode("plane", { name: "Target", parentId: null });
    target.maskId = mask.id;
    target.maskInverted = true; // stale, must be ignored
    const bp = makeBlueprint([mask, target]);

    expect(resolveMaskInversion(bp, mask.id, target)).toBe(false);
  });

  it("returns false when the mask id does not resolve to any node", () => {
    const target = createNode("plane", { name: "Target", parentId: null });
    target.maskId = "missing-mask-id";
    const bp = makeBlueprint([target]);

    expect(resolveMaskInversion(bp, "missing-mask-id", target)).toBe(false);
  });
});
