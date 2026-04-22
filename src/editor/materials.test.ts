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
      castShadow: true,
      receiveShadow: true,
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

  it("defaults castShadow and receiveShadow to true when missing from a partial source", () => {
    const fallback = createMaterialSpec();
    const normalized = normalizeMaterialSpec({ color: "#abcdef" }, fallback);

    expect(normalized.castShadow).toBe(true);
    expect(normalized.receiveShadow).toBe(true);
  });

  it("preserves explicit castShadow and receiveShadow false values through normalization", () => {
    const fallback = createMaterialSpec();
    const normalized = normalizeMaterialSpec(
      { castShadow: false, receiveShadow: false },
      fallback,
    );

    expect(normalized.castShadow).toBe(false);
    expect(normalized.receiveShadow).toBe(false);
  });

  it("round-trips castShadow and receiveShadow through JSON stringify/parse + normalize", () => {
    const fallback = createMaterialSpec();
    const source = createMaterialSpec();
    source.castShadow = false;
    source.receiveShadow = true;

    const roundTripped = JSON.parse(JSON.stringify(source));
    const normalized = normalizeMaterialSpec(roundTripped, fallback);

    expect(normalized.castShadow).toBe(false);
    expect(normalized.receiveShadow).toBe(true);

    const bothTrue = normalizeMaterialSpec(JSON.parse(JSON.stringify(createMaterialSpec())), fallback);
    expect(bothTrue.castShadow).toBe(true);
    expect(bothTrue.receiveShadow).toBe(true);
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
