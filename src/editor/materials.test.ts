import { describe, expect, it } from "vitest";
import {
  createMaterialSpec,
  getMaterialPropertyDefinitions,
  isMaterialSide,
  isMaterialType,
  normalizeMaterialSpec,
} from "./materials";

describe("material helpers", () => {
  it("creates the default material spec", () => {
    expect(createMaterialSpec()).toEqual({
      type: "standard",
      color: "#5ad3ff",
      mapImageId: undefined,
      side: "front",
      emissive: "#000000",
      emissiveIntensity: 1,
      roughness: 0.4,
      metalness: 0.1,
      opacity: 1,
      transparent: true,
      visible: true,
      alphaTest: 0,
      depthTest: true,
      depthWrite: true,
      colorWrite: true,
      dithering: false,
      flatShading: false,
      fog: true,
      toneMapped: true,
      premultipliedAlpha: false,
      polygonOffset: false,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 0,
      wireframe: false,
      wireframeLinewidth: 1,
      castShadow: true,
      receiveShadow: true,
      envMapIntensity: 1,
      ior: 1.5,
      transmission: 0,
      clearcoat: 0,
      clearcoatRoughness: 0.1,
      thickness: 0,
      reflectivity: 0.5,
      iridescence: 0,
      iridescenceIOR: 1.3,
      iridescenceThicknessRangeStart: 100,
      iridescenceThicknessRangeEnd: 400,
      sheen: 0,
      sheenRoughness: 1,
      sheenColor: "#000000",
      specularIntensity: 1,
      specularColor: "#ffffff",
      attenuationDistance: 0,
      attenuationColor: "#ffffff",
      dispersion: 0,
      anisotropy: 0,
      specular: "#111111",
      shininess: 30,
      depthPacking: "basic",
    });
  });

  it("recognises every material type", () => {
    expect(isMaterialType("physical")).toBe(true);
    expect(isMaterialType("toon")).toBe(true);
    expect(isMaterialType("lambert")).toBe(true);
    expect(isMaterialType("phong")).toBe(true);
    expect(isMaterialType("normal")).toBe(true);
    expect(isMaterialType("depth")).toBe(true);
    expect(isMaterialType("metallic")).toBe(false);

    const physicalDefs = getMaterialPropertyDefinitions("physical").map((definition) => definition.path);
    expect(physicalDefs).toContain("material.side");
    expect(physicalDefs).toContain("material.mapImageId");
    expect(physicalDefs).toContain("material.roughness");
    expect(physicalDefs).toContain("material.transmission");
    expect(physicalDefs).toContain("material.clearcoatRoughness");
    expect(physicalDefs).toContain("material.ior");
    expect(physicalDefs).not.toContain("material.iridescence");
    expect(physicalDefs).not.toContain("material.sheenColor");
    expect(physicalDefs).not.toContain("material.anisotropy");

    const phongDefs = getMaterialPropertyDefinitions("phong").map((definition) => definition.path);
    expect(phongDefs).toContain("material.emissiveIntensity");
    expect(phongDefs).toContain("material.flatShading");
    expect(phongDefs).not.toContain("material.specular");
    expect(phongDefs).not.toContain("material.shininess");
    expect(phongDefs).not.toContain("material.roughness");

    const lambertDefs = getMaterialPropertyDefinitions("lambert").map((definition) => definition.path);
    expect(lambertDefs).toContain("material.emissive");
    expect(lambertDefs).not.toContain("material.specular");

    const normalDefs = getMaterialPropertyDefinitions("normal").map((definition) => definition.path);
    expect(normalDefs).not.toContain("material.emissive");
    expect(normalDefs).not.toContain("material.roughness");
    expect(normalDefs).toContain("material.flatShading");

    const depthDefs = getMaterialPropertyDefinitions("depth").map((definition) => definition.path);
    expect(depthDefs).not.toContain("material.emissive");
    expect(depthDefs).not.toContain("material.roughness");
    expect(depthDefs).not.toContain("material.depthPacking");
  });

  it("recognizes and normalizes material side values", () => {
    expect(isMaterialSide("front")).toBe(true);
    expect(isMaterialSide("back")).toBe(true);
    expect(isMaterialSide("double")).toBe(true);
    expect(isMaterialSide("outside")).toBe(false);

    const fallback = createMaterialSpec();
    fallback.side = "back";

    expect(normalizeMaterialSpec({ side: "double" }, fallback).side).toBe("double");
    expect(normalizeMaterialSpec({ side: "invalid" }, fallback).side).toBe("back");
  });

  it("clamps physical-only fields through normalize", () => {
    const fallback = createMaterialSpec();
    const normalized = normalizeMaterialSpec(
      {
        type: "physical",
        ior: 9,
        transmission: -2,
        clearcoat: 5,
        clearcoatRoughness: 1.5,
        thickness: -3,
        reflectivity: 2,
        iridescence: -1,
        iridescenceIOR: 9,
        iridescenceThicknessRangeStart: -10,
        iridescenceThicknessRangeEnd: 250,
        sheen: 4,
        sheenRoughness: -2,
        sheenColor: "#abc",
        specularIntensity: 3,
        specularColor: "invalid",
        attenuationDistance: -5,
        attenuationColor: "#123",
        dispersion: -0.5,
        anisotropy: 9,
      },
      fallback,
    );
    expect(normalized.type).toBe("physical");
    expect(normalized.ior).toBe(2.333);
    expect(normalized.transmission).toBe(0);
    expect(normalized.clearcoat).toBe(1);
    expect(normalized.clearcoatRoughness).toBe(1);
    expect(normalized.thickness).toBe(0);
    expect(normalized.reflectivity).toBe(1);
    expect(normalized.iridescence).toBe(0);
    expect(normalized.iridescenceIOR).toBe(2.333);
    expect(normalized.iridescenceThicknessRangeStart).toBe(0);
    expect(normalized.iridescenceThicknessRangeEnd).toBe(250);
    expect(normalized.sheen).toBe(1);
    expect(normalized.sheenRoughness).toBe(0);
    expect(normalized.sheenColor).toBe("#aabbcc");
    expect(normalized.specularIntensity).toBe(1);
    expect(normalized.specularColor).toBe("#ffffff");
    expect(normalized.attenuationDistance).toBe(0);
    expect(normalized.attenuationColor).toBe("#112233");
    expect(normalized.dispersion).toBe(0);
    expect(normalized.anisotropy).toBe(1);
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
      "material.side",
      "material.mapImageId",
      "material.color",
      "material.opacity",
      "material.transparent",
      "material.visible",
      "material.alphaTest",
      "material.depthTest",
      "material.depthWrite",
      "material.toneMapped",
      "material.wireframe",
      "material.fog",
    ]);
    expect(getMaterialPropertyDefinitions("standard").map((definition) => definition.path)).toContain("material.roughness");
  });
});
