// playgrounds/w3d-translation/src/nodes/diagnostics.test.ts
import { describe, expect, test } from "vitest";
import { dumpNodes } from "./diagnostics";
import type { W3DGroupData, W3DQuadData } from "./data";
import type { W3DResourceRegistry, W3DBaseMaterialData, W3DTextureLayerData, W3DTextureData } from "./resources";

function tx() {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function quad(p: Partial<W3DQuadData>): W3DQuadData {
  return {
    kind: "Quad",
    id: "q",
    name: "Q",
    enable: true,
    alpha: 1,
    speedScale: 1,
    isMask: false,
    maskIds: [],
    geometry: { size: { x: 1, y: 1 } },
    transform: tx(),
    children: [],
    ...p,
  };
}

describe("dumpNodes", () => {
  test("computes visibility flags", () => {
    const rows = dumpNodes([
      quad({ id: "a", name: "A", enable: true, alpha: 1 }),
      quad({ id: "b", name: "B", enable: false, alpha: 1 }),
      quad({ id: "c", name: "C", enable: true, alpha: 0 }),
      quad({ id: "d", name: "D", enable: true, alpha: 0.5 }),
    ]);
    const map = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(map.a).toMatchObject({ enabled: true, disabledByEnable: false, transparentByAlpha0: false, effectiveVisible: true });
    expect(map.b).toMatchObject({ enabled: false, disabledByEnable: true, effectiveVisible: false });
    expect(map.c).toMatchObject({ transparentByAlpha0: true, effectiveVisible: false });
    expect(map.d).toMatchObject({ effectiveVisible: true });
  });

  test("emits Group rows with path and depth", () => {
    const child: W3DQuadData = quad({ id: "qc", name: "Child" });
    const parent: W3DGroupData = {
      kind: "Group",
      id: "g1",
      name: "Parent",
      speedScale: 1,
      maskIds: [],
      transform: tx(),
      children: [child],
    };
    const rows = dumpNodes([parent]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "Group", depth: 0, path: "Parent" });
    expect(rows[1]).toMatchObject({ kind: "Quad", depth: 1, path: "Parent > Child" });
  });
});

function makeReg(
  mats: W3DBaseMaterialData[] = [],
  layers: W3DTextureLayerData[] = [],
  textures: W3DTextureData[] = [],
): W3DResourceRegistry {
  return {
    baseMaterials: new Map(mats.map(m => [m.id, m])),
    textureLayers: new Map(layers.map(l => [l.id, l])),
    textures: new Map(textures.map(t => [t.id, t])),
  };
}

const PRIMARY_MAT: W3DBaseMaterialData = {
  kind: "BaseMaterial", id: "primary-id", name: "PRIMARY",
  hasEmissive: true, hasDiffuse: false, emissive: "663087", diffuse: "ffffff", alpha: 1,
};

const BG_TEX: W3DTextureData = {
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
  mapping: { isEmissive: false, useMipMapping: false }, // no textureGuid
};

describe("dumpNodes — with registry", () => {
  test("without registry: materialName='—', textureLayerName='—', textureFilename='—', resolved=false", () => {
    const node = quad({ id: "q1", name: "Q1" });
    const [row] = dumpNodes([node]);
    expect(row.materialName).toBe("—");
    expect(row.textureLayerName).toBe("—");
    expect(row.textureFilename).toBe("—");
    expect(row.hasMaterialResolved).toBe(false);
    expect(row.hasTextureLayerResolved).toBe(false);
  });

  test("with registry: resolves materialName from faceMapping.materialId", () => {
    const node = quad({
      faceMapping: { surfaceName: "All", materialId: "primary-id", textureLayerId: "Standard", baseMaterialInherited: false, textureInherited: false },
    });
    const [row] = dumpNodes([node], makeReg([PRIMARY_MAT]));
    expect(row.materialName).toBe("PRIMARY");
    expect(row.hasMaterialResolved).toBe(true);
  });

  test("with registry: resolves textureLayerName from faceMapping.textureLayerId", () => {
    const node = quad({
      faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "bg-layer-id", baseMaterialInherited: false, textureInherited: false },
    });
    const [row] = dumpNodes([node], makeReg([], [BG_LAYER]));
    expect(row.textureLayerName).toBe("BACKGROUND");
  });

  test("with registry: resolves textureFilename from textureGuid chain", () => {
    const node = quad({
      faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "bg-layer-id", baseMaterialInherited: false, textureInherited: false },
    });
    const [row] = dumpNodes([node], makeReg([], [BG_LAYER], [BG_TEX]));
    expect(row.textureFilename).toBe("BASKETBALL_BACKGROUND.png");
    expect(row.hasTextureLayerResolved).toBe(true);
  });

  test("textureLayerId='Standard' does not crash, textureLayerName='Standard'", () => {
    const node = quad({
      faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "Standard", baseMaterialInherited: false, textureInherited: false },
    });
    const [row] = dumpNodes([node], makeReg([], [BG_LAYER]));
    // Should not crash; textureLayerName is either "Standard" or "—"
    expect(row.textureLayerName).toSatisfy((v: string) => v === "Standard" || v === "—");
    expect(row.hasTextureLayerResolved).toBe(false);
  });

  test("TextureLayer without textureGuid shows no texture (dynamic slot)", () => {
    const node = quad({
      faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "photo-layer-id", baseMaterialInherited: false, textureInherited: false },
    });
    const [row] = dumpNodes([node], makeReg([], [PHOTO_LAYER]));
    expect(row.textureLayerName).toBe("PHOTO_01");
    expect(row.textureFilename).toBe("—");
    expect(row.hasTextureLayerResolved).toBe(false);
  });
});
