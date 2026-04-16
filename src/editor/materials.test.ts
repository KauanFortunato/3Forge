import { describe, expect, it } from "vitest";
import { createMaterialSpec, getMaterialPropertyDefinitions, isMaterialType, normalizeMaterialSpec } from "./materials";

describe("material helpers", () => {
  it("creates the default material spec", () => {
    expect(createMaterialSpec()).toEqual({
      type: "standard",
      color: "#5ad3ff",
      emissive: "#000000",
      roughness: 0.4,
      metalness: 0.1,
      opacity: 1,
      transparent: true,
      visible: true,
      alphaTest: 0,
      depthTest: true,
      depthWrite: true,
      wireframe: false,
    });
  });

  it("normalizes material values and clamps numeric ranges", () => {
    const fallback = createMaterialSpec("#abcdef", "standard");
    const normalized = normalizeMaterialSpec(
      {
        type: "basic",
        color: "#abc",
        emissive: "invalid",
        roughness: 2,
        metalness: -1,
        opacity: 0.25,
        transparent: undefined,
        visible: false,
        alphaTest: 1.8,
        depthTest: undefined,
        depthWrite: false,
        wireframe: true,
      },
      fallback,
    );

    expect(normalized).toMatchObject({
      type: "basic",
      color: "#aabbcc",
      emissive: "#000000",
      roughness: 1,
      metalness: 0,
      opacity: 0.25,
      transparent: true,
      visible: false,
      alphaTest: 1,
      depthWrite: false,
      wireframe: true,
    });
  });

  it("exposes material definitions for each material kind", () => {
    expect(isMaterialType("standard")).toBe(true);
    expect(isMaterialType("metallic")).toBe(false);
    expect(getMaterialPropertyDefinitions("basic").map((definition) => definition.path)).toEqual([
      "material.type",
      "material.color",
      "material.opacity",
      "material.transparent",
      "material.visible",
      "material.alphaTest",
      "material.depthTest",
      "material.depthWrite",
      "material.wireframe",
    ]);
    expect(getMaterialPropertyDefinitions("standard").map((definition) => definition.path)).toContain("material.roughness");
  });
});
