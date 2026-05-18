import { describe, expect, test } from "vitest";
import { resolveMaterial } from "./materialResolver";
import type { W3DResourceRegistry, W3DBaseMaterialData } from "./resources";

function makeRegistry(mats: W3DBaseMaterialData[] = []): W3DResourceRegistry {
  return {
    baseMaterials: new Map(mats.map(m => [m.id, m])),
    textures: new Map(),
    textureLayers: new Map(),
  };
}

const PRIMARY: W3DBaseMaterialData = {
  kind: "BaseMaterial", id: "primary-id", name: "PRIMARY",
  hasEmissive: true, hasDiffuse: false, emissive: "663087", diffuse: "ffffff", alpha: 1,
};

const SECONDARY: W3DBaseMaterialData = {
  kind: "BaseMaterial", id: "secondary-id", name: "SECONDARY",
  hasEmissive: true, hasDiffuse: false, emissive: "fdcc71", diffuse: "ffffff", alpha: 1,
};

const DIFFUSE_MAT: W3DBaseMaterialData = {
  kind: "BaseMaterial", id: "diffuse-id", name: "BaseMaterial",
  hasEmissive: false, hasDiffuse: true, emissive: "ffffff", diffuse: "aabbcc", alpha: 1,
};

describe("resolveMaterial — colour", () => {
  test("PRIMARY (HasEmissive=True) → color #663087, hasMaterialResolved true", () => {
    const ctx = { registry: makeRegistry([PRIMARY]), textureUrlsByFilename: new Map() };
    const r = resolveMaterial("primary-id", undefined, undefined, 1, ctx, []);
    expect(r.color).toBe("#663087");
    expect(r.hasMaterialResolved).toBe(true);
    expect(r.materialName).toBe("PRIMARY");
  });

  test("SECONDARY → color #fdcc71", () => {
    const ctx = { registry: makeRegistry([SECONDARY]), textureUrlsByFilename: new Map() };
    const r = resolveMaterial("secondary-id", undefined, undefined, 1, ctx, []);
    expect(r.color).toBe("#fdcc71");
  });

  test("HasDiffuse=True, HasEmissive=False → uses diffuse", () => {
    const ctx = { registry: makeRegistry([DIFFUSE_MAT]), textureUrlsByFilename: new Map() };
    const r = resolveMaterial("diffuse-id", undefined, undefined, 1, ctx, []);
    expect(r.color).toBe("#aabbcc");
    expect(r.hasMaterialResolved).toBe(true);
  });

  test("unknown materialId + displayColor '11119017' → converts to hex, hasMaterialResolved false, emits warning", () => {
    const warnings: string[] = [];
    const ctx = { registry: makeRegistry(), textureUrlsByFilename: new Map() };
    const r = resolveMaterial("unknown-id", undefined, "11119017", 1, ctx, warnings);
    expect(r.hasMaterialResolved).toBe(false);
    expect(r.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("unknown-id");
  });

  test("unknown materialId + no displayColor → magenta fallback '#ff00ff'", () => {
    const warnings: string[] = [];
    const ctx = { registry: makeRegistry(), textureUrlsByFilename: new Map() };
    const r = resolveMaterial("unknown-id", undefined, undefined, 1, ctx, warnings);
    expect(r.color).toBe("#ff00ff");
    expect(r.hasMaterialResolved).toBe(false);
  });

  test("opacity = quadAlpha * baseMaterial.alpha", () => {
    const mat = { ...PRIMARY, alpha: 0.5 };
    const ctx = { registry: makeRegistry([mat]), textureUrlsByFilename: new Map() };
    const r = resolveMaterial("primary-id", undefined, undefined, 0.8, ctx, []);
    expect(r.opacity).toBeCloseTo(0.4, 5);
    expect(r.transparent).toBe(true);
  });

  test("transparent = false when opacity = 1", () => {
    const ctx = { registry: makeRegistry([PRIMARY]), textureUrlsByFilename: new Map() };
    const r = resolveMaterial("primary-id", undefined, undefined, 1, ctx, []);
    expect(r.opacity).toBe(1);
    expect(r.transparent).toBe(false);
  });
});

import type { W3DTextureLayerData, W3DTextureData } from "./resources";

function makeFullRegistry(
  mats: W3DBaseMaterialData[] = [],
  textures: W3DTextureData[] = [],
  layers: W3DTextureLayerData[] = [],
): W3DResourceRegistry {
  return {
    baseMaterials: new Map(mats.map(m => [m.id, m])),
    textures: new Map(textures.map(t => [t.id, t])),
    textureLayers: new Map(layers.map(l => [l.id, l])),
  };
}

const BG_TEXTURE: W3DTextureData = {
  kind: "Texture", id: "bg-tex-id", name: "BASKETBALL_BACKGROUND.png",
  filename: "BASKETBALL_BACKGROUND.png", folderPath: "",
};

const BG_LAYER: W3DTextureLayerData = {
  kind: "TextureLayer", id: "bg-layer-id", name: "BACKGROUND",
  textureBlending: "Multiply",
  mapping: { textureGuid: "bg-tex-id", keyType: "AlphaKey", isEmissive: false, useMipMapping: true },
};

const PHOTO_LAYER: W3DTextureLayerData = {
  kind: "TextureLayer", id: "photo-layer-id", name: "PHOTO_01",
  textureBlending: "Multiply",
  mapping: { isEmissive: false, useMipMapping: false },  // no textureGuid
};

describe("resolveMaterial — texture", () => {
  test("textureLayerId='Standard' → hasTextureLayerResolved=false, no warning, no crash", () => {
    const ctx = { registry: makeFullRegistry(), textureUrlsByFilename: new Map() };
    const warnings: string[] = [];
    const r = resolveMaterial(undefined, "Standard", undefined, 1, ctx, warnings);
    expect(r.hasTextureLayerResolved).toBe(false);
    expect(r.mapUrl).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test("BACKGROUND + URL in ctx → mapUrl set, hasTextureLayerResolved=true, transparent=true", () => {
    const urls = new Map([["BASKETBALL_BACKGROUND.png", "blob:fake-url-1"]]);
    const reg = makeFullRegistry([], [BG_TEXTURE], [BG_LAYER]);
    const ctx = { registry: reg, textureUrlsByFilename: urls };
    const r = resolveMaterial(undefined, "bg-layer-id", undefined, 1, ctx, []);
    expect(r.hasTextureLayerResolved).toBe(true);
    expect(r.mapUrl).toBe("blob:fake-url-1");
    expect(r.transparent).toBe(true);
    expect(r.textureLayerName).toBe("BACKGROUND");
    expect(r.textureFilename).toBe("BASKETBALL_BACKGROUND.png");
  });

  test("BACKGROUND + file not in ctx → warning, hasTextureLayerResolved=false", () => {
    const reg = makeFullRegistry([], [BG_TEXTURE], [BG_LAYER]);
    const ctx = { registry: reg, textureUrlsByFilename: new Map() };
    const warnings: string[] = [];
    const r = resolveMaterial(undefined, "bg-layer-id", undefined, 1, ctx, warnings);
    expect(r.hasTextureLayerResolved).toBe(false);
    expect(r.mapUrl).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("PHOTO_01 dynamic slot (no textureGuid) → hasTextureLayerResolved=false, no warning", () => {
    const reg = makeFullRegistry([], [], [PHOTO_LAYER]);
    const ctx = { registry: reg, textureUrlsByFilename: new Map() };
    const warnings: string[] = [];
    const r = resolveMaterial(undefined, "photo-layer-id", undefined, 1, ctx, warnings);
    expect(r.hasTextureLayerResolved).toBe(false);
    expect(r.mapUrl).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test("keyGuid present + resolved → alphaMapUrl set separately from mapUrl", () => {
    const alphaTexture: W3DTextureData = {
      kind: "Texture", id: "ramp-tex-id", name: "VERTICAL_RAMP.png",
      filename: "VERTICAL_RAMP.png", folderPath: "",
    };
    const layerWithKey: W3DTextureLayerData = {
      kind: "TextureLayer", id: "sep-alpha-id", name: "SEP_ALPHA",
      textureBlending: "Normal",
      mapping: { textureGuid: "bg-tex-id", keyGuid: "ramp-tex-id", keyType: "AlphaKey", isEmissive: false, useMipMapping: false },
    };
    const urls = new Map([
      ["BASKETBALL_BACKGROUND.png", "blob:map-url"],
      ["VERTICAL_RAMP.png", "blob:alpha-url"],
    ]);
    const reg = makeFullRegistry([], [BG_TEXTURE, alphaTexture], [layerWithKey]);
    const ctx = { registry: reg, textureUrlsByFilename: urls };
    const r = resolveMaterial(undefined, "sep-alpha-id", undefined, 1, ctx, []);
    expect(r.mapUrl).toBe("blob:map-url");
    expect(r.alphaMapUrl).toBe("blob:alpha-url");
  });

  test("keyGuid absent + KeyType=AlphaKey → alphaMapUrl undefined (NOT auto-assigned from mapUrl)", () => {
    const urls = new Map([["BASKETBALL_BACKGROUND.png", "blob:map-url"]]);
    const reg = makeFullRegistry([], [BG_TEXTURE], [BG_LAYER]);
    const ctx = { registry: reg, textureUrlsByFilename: urls };
    const r = resolveMaterial(undefined, "bg-layer-id", undefined, 1, ctx, []);
    expect(r.mapUrl).toBe("blob:map-url");
    expect(r.alphaMapUrl).toBeUndefined();
  });

  test("textureLayerName and textureFilename populated when resolved", () => {
    const urls = new Map([["BASKETBALL_BACKGROUND.png", "blob:url"]]);
    const reg = makeFullRegistry([], [BG_TEXTURE], [BG_LAYER]);
    const ctx = { registry: reg, textureUrlsByFilename: urls };
    const r = resolveMaterial(undefined, "bg-layer-id", undefined, 1, ctx, []);
    expect(r.textureLayerName).toBe("BACKGROUND");
    expect(r.textureFilename).toBe("BASKETBALL_BACKGROUND.png");
  });
});

const DE1A3E3C = "DE1A3E3C-AE85-4B7B-BA86-056463611630";

describe("resolveMaterial — DE1A3E3C project-default-transparent", () => {
  test("DE1A3E3C + Standard → opacity=0, transparent=true, no warning", () => {
    const warnings: string[] = [];
    const ctx = { registry: makeFullRegistry(), textureUrlsByFilename: new Map() };
    const r = resolveMaterial(DE1A3E3C, "Standard", undefined, 1, ctx, warnings);
    expect(r.opacity).toBe(0);
    expect(r.transparent).toBe(true);
    expect(r.hasMaterialResolved).toBe(false);
    expect(r.materialName).toBe("(project-default-transparent)");
    expect(warnings).toEqual([]);
  });

  test("DE1A3E3C + dynamic TextureLayer (no textureGuid) → opacity=0, no warning", () => {
    const reg = makeFullRegistry([], [], [PHOTO_LAYER]);
    const ctx = { registry: reg, textureUrlsByFilename: new Map() };
    const warnings: string[] = [];
    const r = resolveMaterial(DE1A3E3C, "photo-layer-id", undefined, 1, ctx, warnings);
    expect(r.opacity).toBe(0);
    expect(r.transparent).toBe(true);
    expect(warnings).toEqual([]);
  });

  test("unknown materialId (different) → DisplayColor fallback + warning (unchanged)", () => {
    const warnings: string[] = [];
    const ctx = { registry: makeFullRegistry(), textureUrlsByFilename: new Map() };
    const r = resolveMaterial("totally-unknown-guid", undefined, "11119017", 1, ctx, warnings);
    expect(r.hasMaterialResolved).toBe(false);
    expect(r.opacity).toBeGreaterThan(0);
    expect(r.color).not.toBe("#ff00ff"); // should be displayColor, not magenta
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("totally-unknown-guid");
  });

  test("DE1A3E3C + resolved textureLayer with mapUrl → texture stays, opacity normal", () => {
    const urls = new Map([["BASKETBALL_BACKGROUND.png", "blob:bg-url"]]);
    const reg = makeFullRegistry([], [BG_TEXTURE], [BG_LAYER]);
    const ctx = { registry: reg, textureUrlsByFilename: urls };
    const r = resolveMaterial(DE1A3E3C, "bg-layer-id", undefined, 1, ctx, []);
    expect(r.mapUrl).toBe("blob:bg-url");
    // opacity NOT forced to 0 because mapUrl is present
    expect(r.opacity).toBeGreaterThan(0);
    expect(r.transparent).toBe(true); // true because PNG has alpha
  });
});
