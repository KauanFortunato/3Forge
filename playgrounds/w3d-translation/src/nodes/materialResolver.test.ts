import { describe, expect, test } from "vitest";
import { resolveMaterial } from "./materialResolver";
import type { W3DResourceRegistry, W3DBaseMaterialData } from "./resources";

function makeRegistry(mats: W3DBaseMaterialData[] = []): W3DResourceRegistry {
  return {
    baseMaterials: new Map(mats.map(m => [m.id, m])),
    textures: new Map(),
    textureLayers: new Map(),
    dynamicTextureFilenameByLayerId: new Map(),
    fontStyles: new Map(),
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
    dynamicTextureFilenameByLayerId: new Map(),
    fontStyles: new Map(),
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

describe("resolveMaterial — dynamic texture binding (Phase H)", () => {
  const PHOTO_LAYER_NO_GUID: W3DTextureLayerData = {
    kind: "TextureLayer", id: "photo-01-layer-id", name: "PHOTO_01",
    textureBlending: "Multiply",
    mapping: { isEmissive: false, useMipMapping: false }, // no textureGuid
  };

  function makeRegistryWithDynamic(
    layers: W3DTextureLayerData[],
    dynMap: [string, string][],
  ): W3DResourceRegistry {
    return {
      baseMaterials: new Map(),
      textures: new Map(),
      textureLayers: new Map(layers.map(l => [l.id, l])),
      dynamicTextureFilenameByLayerId: new Map(dynMap),
      fontStyles: new Map(),
    };
  }

  test("dynamic binding resolves mapUrl when filename in ctx.textureUrlsByFilename", () => {
    const reg = makeRegistryWithDynamic(
      [PHOTO_LAYER_NO_GUID],
      [["photo-01-layer-id", "Player 1.png"]],
    );
    const urls = new Map([["Player 1.png", "blob:player1-url"]]);
    const ctx = { registry: reg, textureUrlsByFilename: urls };
    const r = resolveMaterial(undefined, "photo-01-layer-id", undefined, 1, ctx, []);
    expect(r.mapUrl).toBe("blob:player1-url");
    expect(r.hasTextureLayerResolved).toBe(true);
    expect(r.textureFilename).toBe("Player 1.png");
    expect(r.transparent).toBe(true);
  });

  test("dynamic binding with filename not in ctx → warning, no mapUrl", () => {
    const reg = makeRegistryWithDynamic(
      [PHOTO_LAYER_NO_GUID],
      [["photo-01-layer-id", "Player 1.png"]],
    );
    const ctx = { registry: reg, textureUrlsByFilename: new Map() };
    const warnings: string[] = [];
    const r = resolveMaterial(undefined, "photo-01-layer-id", undefined, 1, ctx, warnings);
    expect(r.mapUrl).toBeUndefined();
    expect(r.hasTextureLayerResolved).toBe(false);
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("dynamic slot without binding (FF_PHOTO) → no warning, no mapUrl", () => {
    const FF_PHOTO: W3DTextureLayerData = {
      kind: "TextureLayer", id: "ff-photo-id", name: "FF_PHOTO",
      textureBlending: "Multiply",
      mapping: { isEmissive: false, useMipMapping: false },
    };
    const reg = makeRegistryWithDynamic([FF_PHOTO], []);
    const ctx = { registry: reg, textureUrlsByFilename: new Map() };
    const warnings: string[] = [];
    const r = resolveMaterial(undefined, "ff-photo-id", undefined, 1, ctx, warnings);
    expect(r.mapUrl).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test("DE1A3E3C + PHOTO_01 dynamic binding resolvido → mapUrl existe, opacity não é 0", () => {
    // Critical: order must be: static texGuid → dynamic map → DE1A3E3C opacity guard
    // The DE1A3E3C guard checks !mapUrl AFTER both texture attempts, so with mapUrl=resolved → opacity>0
    const DE1A3E3C = "DE1A3E3C-AE85-4B7B-BA86-056463611630";
    const reg = makeRegistryWithDynamic(
      [PHOTO_LAYER_NO_GUID],
      [["photo-01-layer-id", "Player 1.png"]],
    );
    const urls = new Map([["Player 1.png", "blob:player1-url"]]);
    const ctx = { registry: reg, textureUrlsByFilename: urls };
    const r = resolveMaterial(DE1A3E3C, "photo-01-layer-id", undefined, 1, ctx, []);
    expect(r.mapUrl).toBe("blob:player1-url");
    // DE1A3E3C transparent rule must NOT apply because mapUrl was resolved
    expect(r.opacity).toBeGreaterThan(0);
    expect(r.transparent).toBe(true); // true because PNG has alpha, not because of DE1A3E3C rule
  });
});

// -------------------------------------------------------------------------
// Phase 2C — UV transform exposure on ResolvedMaterial.
// -------------------------------------------------------------------------
describe("resolveMaterial — Phase 2C UV transform exposure", () => {
  const TEX: W3DTextureData = {
    kind: "Texture", id: "tex-id", name: "T.png", filename: "T.png", folderPath: "",
  };
  const KEY_TEX: W3DTextureData = {
    kind: "Texture", id: "key-id", name: "VERTICAL_RAMP.png", filename: "VERTICAL_RAMP.png", folderPath: "",
  };

  function ctxFor(layer: W3DTextureLayerData, withKey = false) {
    const textures = withKey ? [TEX, KEY_TEX] : [TEX];
    const reg = makeFullRegistry([], textures, [layer]);
    const urls = new Map<string, string>([["T.png", "blob:T"]]);
    if (withKey) urls.set("VERTICAL_RAMP.png", "blob:RAMP");
    return { registry: reg, textureUrlsByFilename: urls };
  }

  test("Offset X=-0.07 → mapTransform.offset.x=-0.07, mapTransform.offset.y=0", async () => {
    const { ClampToEdgeWrapping } = await import("three");
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-id", isEmissive: false, useMipMapping: false },
      offset: { x: -0.07, y: 0 },
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer), []);
    expect(r.mapTransform).toBeDefined();
    expect(r.mapTransform!.offset.x).toBeCloseTo(-0.07, 5);
    expect(r.mapTransform!.offset.y).toBeCloseTo(0, 5);
    expect(r.mapTransform!.repeat.x).toBe(1);
    expect(r.mapTransform!.repeat.y).toBe(1);
    expect(r.mapTransform!.rotationDeg).toBe(0);
    expect(r.mapTransform!.wrapS).toBe(ClampToEdgeWrapping);
    expect(r.mapTransform!.wrapT).toBe(ClampToEdgeWrapping);
  });

  test("Scale X=1.7 Y=0.82 → mapTransform.repeat = (1.7, 0.82)", () => {
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-id", isEmissive: false, useMipMapping: false },
      scale: { x: 1.7, y: 0.82 },
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer), []);
    expect(r.mapTransform!.repeat.x).toBeCloseTo(1.7, 5);
    expect(r.mapTransform!.repeat.y).toBeCloseTo(0.82, 5);
  });

  test("Rotation Z=45 → mapTransform.rotationDeg=45 (degrees, not radians)", () => {
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-id", isEmissive: false, useMipMapping: false },
      rotationDeg: 45,
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer), []);
    expect(r.mapTransform!.rotationDeg).toBe(45);
  });

  test("OffsetKey Y=-0.2 + ScaleKey Y=0.5 → alphaMapTransform independent from mapTransform", () => {
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "PHOTO_01", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-id", keyGuid: "key-id", keyType: "AlphaKey", isEmissive: false, useMipMapping: false },
      offset: { x: -0.07, y: 0 },
      offsetKey: { y: -0.2 },
      scaleKey: { y: 0.5 },
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer, true), []);
    // map transform — driven by Offset, untouched by OffsetKey/ScaleKey
    expect(r.mapTransform!.offset.x).toBeCloseTo(-0.07, 5);
    expect(r.mapTransform!.offset.y).toBeCloseTo(0, 5);
    expect(r.mapTransform!.repeat.y).toBe(1);
    // alphaMap transform — driven by OffsetKey/ScaleKey, untouched by Offset
    expect(r.alphaMapTransform).toBeDefined();
    expect(r.alphaMapTransform!.offset.x).toBeCloseTo(0, 5);
    expect(r.alphaMapTransform!.offset.y).toBeCloseTo(-0.2, 5);
    expect(r.alphaMapTransform!.repeat.x).toBe(1);
    expect(r.alphaMapTransform!.repeat.y).toBeCloseTo(0.5, 5);
  });

  test('TextureAddressModeU="Repeat" → wrapS=RepeatWrapping', async () => {
    const { RepeatWrapping, ClampToEdgeWrapping } = await import("three");
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-id", isEmissive: false, useMipMapping: false, textureAddressModeU: "Repeat" },
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer), []);
    expect(r.mapTransform!.wrapS).toBe(RepeatWrapping);
    expect(r.mapTransform!.wrapT).toBe(ClampToEdgeWrapping); // V default
  });

  test('TextureAddressModeV="Mirror" → wrapT=MirroredRepeatWrapping', async () => {
    const { MirroredRepeatWrapping, ClampToEdgeWrapping } = await import("three");
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-id", isEmissive: false, useMipMapping: false, textureAddressModeV: "Mirror" },
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer), []);
    expect(r.mapTransform!.wrapT).toBe(MirroredRepeatWrapping);
    expect(r.mapTransform!.wrapS).toBe(ClampToEdgeWrapping);
  });

  test('TextureAddressMode missing → both wrap modes default to ClampToEdgeWrapping', async () => {
    const { ClampToEdgeWrapping } = await import("three");
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-id", isEmissive: false, useMipMapping: false },
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer), []);
    expect(r.mapTransform!.wrapS).toBe(ClampToEdgeWrapping);
    expect(r.mapTransform!.wrapT).toBe(ClampToEdgeWrapping);
  });

  test("no Offset/Scale/Rotation present → mapTransform is identity (offset 0, repeat 1, rotation 0)", () => {
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-id", isEmissive: false, useMipMapping: false },
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer), []);
    expect(r.mapTransform).toEqual({
      offset: { x: 0, y: 0 },
      repeat: { x: 1, y: 1 },
      rotationDeg: 0,
      wrapS: 1001, // ClampToEdgeWrapping numeric constant
      wrapT: 1001,
    });
  });

  test("layer with Key (alphaMap) but no Offset → alphaMapTransform present, mapTransform identity", () => {
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-id", keyGuid: "key-id", keyType: "AlphaKey", isEmissive: false, useMipMapping: false },
      offsetKey: { y: -0.2 },
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer, true), []);
    expect(r.mapTransform!.offset).toEqual({ x: 0, y: 0 });
    expect(r.alphaMapTransform!.offset.y).toBeCloseTo(-0.2, 5);
  });

  test("PHOTO_01-like LINEUP_LEFT layer — full Offset/OffsetKey/ScaleKey combo populated independently", () => {
    // Mirror the exact authored values from LINEUP_LEFT scene PHOTO_01 layer.
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "PHOTO_01", textureBlending: "Multiply",
      mapping: {
        textureGuid: "tex-id", keyGuid: "key-id", keyType: "AlphaKey",
        isEmissive: true, useMipMapping: true,
        textureAddressModeU: "Clamp", textureAddressModeV: "Clamp",
      },
      offset: { x: -0.07, y: 0 },
      offsetKey: { y: -0.2 },
      scaleKey: { y: 0.5 },
    };
    const r = resolveMaterial(undefined, "L", undefined, 1, ctxFor(layer, true), []);
    expect(r.mapTransform!.offset.x).toBeCloseTo(-0.07, 5);
    expect(r.mapTransform!.repeat.x).toBe(1);
    expect(r.mapTransform!.repeat.y).toBe(1);
    expect(r.alphaMapTransform!.offset.x).toBe(0);
    expect(r.alphaMapTransform!.offset.y).toBeCloseTo(-0.2, 5);
    expect(r.alphaMapTransform!.repeat.x).toBe(1);
    expect(r.alphaMapTransform!.repeat.y).toBeCloseTo(0.5, 5);
  });
});
