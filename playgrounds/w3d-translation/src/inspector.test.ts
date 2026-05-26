import { describe, expect, test } from "vitest";
import {
  AlwaysStencilFunc,
  ClampToEdgeWrapping,
  EqualStencilFunc,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ReplaceStencilOp,
} from "three";
import { buildInspectorReport, resolveInspectorTarget } from "./inspector";
import type { W3DResourceRegistry } from "./nodes/resources";

function quadMesh(name: string, w3d: Record<string, unknown>): Mesh {
  const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  mesh.name = name;
  mesh.userData.w3d = w3d;
  return mesh;
}

function groupOf(name: string, w3d: Record<string, unknown>): Group {
  const g = new Group();
  g.name = name;
  g.userData.w3d = w3d;
  return g;
}

function emptyRegistry(): W3DResourceRegistry {
  return {
    baseMaterials: new Map(),
    textures: new Map(),
    textureLayers: new Map(),
    dynamicTextureFilenameByLayerId: new Map(),
    fontStyles: new Map(),
  };
}

describe("inspector — resolveInspectorTarget", () => {
  test("returns the object itself when it already has a real w3d node", () => {
    const m = quadMesh("Q", { kind: "Quad", id: "q", name: "Q" });
    expect(resolveInspectorTarget(m)).toBe(m);
  });

  test("walks up past (pivot helper) ancestors to the real W3D node", () => {
    const real = groupOf("REAL", { kind: "Group", id: "r", name: "REAL" });
    const pivot = groupOf("REAL (pivot)", { kind: "(pivot helper)", forNodeId: "r" });
    const mesh = quadMesh("PHOTO_01", { kind: "Quad", id: "p1", name: "PHOTO_01" });
    real.add(pivot);
    pivot.add(mesh);
    // Hit on mesh resolves to mesh (it has a real Quad kind).
    expect(resolveInspectorTarget(mesh)).toBe(mesh);
    // Hit on the pivot helper resolves up to the parent Group.
    expect(resolveInspectorTarget(pivot)).toBe(real);
  });

  test("returns null when no ancestor has a real W3D node", () => {
    const top = new Group(); // no userData
    const helper = groupOf("X (pivot)", { kind: "(pivot helper)", forNodeId: "" });
    top.add(helper);
    expect(resolveInspectorTarget(helper)).toBeNull();
  });
});

describe("inspector — buildInspectorReport", () => {
  test("identity carries name/id/kind and hierarchy path with pivot helpers skipped", () => {
    const root = groupOf("ROOT", { kind: "Group", id: "root", name: "ROOT" });
    const players = groupOf("PLAYERS", {
      kind: "Group", id: "PLAYERS", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
    });
    const player02 = groupOf("PLAYER_02", { kind: "Group", id: "p2", name: "PLAYER_02" });
    const pivot = groupOf("PLAYER_02 (pivot)", { kind: "(pivot helper)", forNodeId: "p2" });
    const photo = quadMesh("PHOTO_02", {
      kind: "Quad", id: "photo-02", name: "PHOTO_02",
      enable: true, alpha: 1, isMask: false, maskIds: [],
      geometry: { alignmentY: "Bottom", size: { x: 2.3, y: 2.3 } },
      transform: { position: { x: 0, y: -1.235, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    root.add(players);
    players.add(player02);
    player02.add(pivot);
    pivot.add(photo);

    const r = buildInspectorReport(photo);
    expect(r).not.toBeNull();
    expect(r!.identity.name).toBe("PHOTO_02");
    expect(r!.identity.kind).toBe("Quad");
    expect(r!.identity.id).toBe("photo-02");
    // Pivot helper does NOT appear in the hierarchy.
    expect(r!.identity.hierarchyPath).toBe("ROOT > PLAYERS > PLAYER_02 > PHOTO_02");
  });

  test("effective maskIds inherit from the nearest ancestor with non-empty maskIds", () => {
    const root = groupOf("ROOT", { kind: "Group", id: "r", name: "ROOT" });
    const fill = groupOf("PHOTO_FILL_01", {
      kind: "Group", id: "fill", name: "PHOTO_FILL_01",
      maskIds: ["dummy-1"],
    });
    const color = quadMesh("PHOTO_COLOR_01", {
      kind: "Quad", id: "color-1", name: "PHOTO_COLOR_01",
      maskIds: [], // own list empty → inherits from fill
    });
    root.add(fill);
    fill.add(color);

    const r = buildInspectorReport(color);
    expect(r!.mask.ownMaskIds).toEqual([]);
    expect(r!.mask.effectiveMaskIds).toEqual(["dummy-1"]);
  });

  test('hiddenReason: "Enable=False" wins over alpha and material checks', () => {
    const mesh = quadMesh("X", {
      kind: "Quad", id: "x", name: "X",
      enable: false, alpha: 1,
    });
    const r = buildInspectorReport(mesh);
    expect(r!.visibility.hiddenReason).toBe("Enable=False");
  });

  test('hiddenReason: "Alpha=0 (static)" when alpha=0 but enable=true', () => {
    const mesh = quadMesh("X", {
      kind: "Quad", id: "x", name: "X",
      enable: true, alpha: 0,
    });
    const r = buildInspectorReport(mesh);
    expect(r!.visibility.hiddenReason).toBe("Alpha=0 (static)");
  });

  test('hiddenReason: pure stencil writer for isMask + IsColoredMask=False', () => {
    const mesh = quadMesh("PHOTO_MASK_01", {
      kind: "Quad", id: "m1", name: "PHOTO_MASK_01",
      enable: true, alpha: 1, isMask: true,
      maskProperties: { isColoredMask: false, isInvertedMask: true },
    });
    const r = buildInspectorReport(mesh);
    expect(r!.visibility.hiddenReason).toBe("pure stencil writer (IsColoredMask=False)");
  });

  test("flow context exposes underFlowParent, slotIndex, and authored LeadingSpace=-1.26", () => {
    const players = groupOf("PLAYERS", {
      kind: "Group", id: "PLAYERS", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
    });
    const p1 = groupOf("PLAYER_01", { kind: "Group", id: "p1", name: "PLAYER_01" });
    const p2 = groupOf("PLAYER_02", { kind: "Group", id: "p2", name: "PLAYER_02" });
    const p3 = groupOf("PLAYER_03", { kind: "Group", id: "p3", name: "PLAYER_03" });
    players.add(p1);
    players.add(p2);
    players.add(p3);

    const r = buildInspectorReport(p2);
    expect(r!.flow.underFlowParent).toBe("PLAYERS");
    expect(r!.flow.slotIndex).toBe(1);
    expect(r!.flow.parentLeadingSpace).toBe(-1.26);
  });

  test("flow.underFlowParent is null when the node is not under a flow-children group", () => {
    const root = groupOf("ROOT", { kind: "Group", id: "r", name: "ROOT" });
    const child = groupOf("CHILD", { kind: "Group", id: "c", name: "CHILD" });
    root.add(child);
    const r = buildInspectorReport(child);
    expect(r!.flow.underFlowParent).toBeNull();
  });

  test("stencil section reads stencilRef/writeMask/funcMask/colorWrite from MeshBasicMaterial", () => {
    const mesh = quadMesh("PHOTO_MASK_01", {
      kind: "Quad", id: "m1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { isColoredMask: false, isInvertedMask: true },
    });
    const mat = mesh.material as MeshBasicMaterial;
    // Mimic the Phase 2J writer setup for player 1 MASK
    mat.stencilWrite = true;
    mat.stencilWriteMask = 7;
    mat.stencilRef = 1;
    mat.stencilFunc = AlwaysStencilFunc;
    mat.stencilFuncMask = 0xff;
    mat.stencilZPass = ReplaceStencilOp;
    mat.colorWrite = false;

    const r = buildInspectorReport(mesh);
    expect(r!.stencil).not.toBeNull();
    expect(r!.stencil!.stencilWrite).toBe(true);
    expect(r!.stencil!.stencilRef).toBe(1);
    expect(r!.stencil!.stencilWriteMask).toBe(7);
    expect(r!.stencil!.stencilFunc).toBe(AlwaysStencilFunc);
    expect(r!.stencil!.colorWrite).toBe(false);
  });

  test("UV section reads map.offset/repeat/rotation/wrap from material.map", () => {
    const mesh = quadMesh("PHOTO_01", {
      kind: "Quad", id: "p1", name: "PHOTO_01",
      faceMapping: { materialId: "M", textureLayerId: "L" },
    });
    const mat = mesh.material as MeshBasicMaterial;
    // Simulate Phase 2C acquireTexture output (mocked Three.js Texture).
    mat.map = {
      offset: { x: -0.07, y: 0 },
      repeat: { x: 1, y: 1 },
      rotation: 0,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
    } as unknown as MeshBasicMaterial["map"];

    const r = buildInspectorReport(mesh);
    expect(r!.uv.mapOffset).toEqual({ x: -0.07, y: 0 });
    expect(r!.uv.mapRepeat).toEqual({ x: 1, y: 1 });
    expect(r!.uv.mapRotationRad).toBe(0);
    expect(r!.uv.mapWrapS).toBe(ClampToEdgeWrapping);
  });

  test("UV section reports alphaMap independently from map when both are present", () => {
    const mesh = quadMesh("PHOTO_01", {
      kind: "Quad", id: "p1", name: "PHOTO_01",
    });
    const mat = mesh.material as MeshBasicMaterial;
    mat.map = {
      offset: { x: -0.07, y: 0 }, repeat: { x: 1, y: 1 }, rotation: 0,
      wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
    } as unknown as MeshBasicMaterial["map"];
    mat.alphaMap = {
      offset: { x: 0, y: -0.2 }, repeat: { x: 1, y: 0.5 }, rotation: 0,
      wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
    } as unknown as MeshBasicMaterial["alphaMap"];

    const r = buildInspectorReport(mesh);
    expect(r!.uv.mapOffset).toEqual({ x: -0.07, y: 0 });
    expect(r!.uv.alphaMapOffset).toEqual({ x: 0, y: -0.2 });
    expect(r!.uv.alphaMapRepeat).toEqual({ x: 1, y: 0.5 });
  });

  test("worldPosition includes parent transforms", () => {
    const parent = groupOf("PARENT", { kind: "Group", id: "p", name: "PARENT" });
    parent.position.set(10, 20, 30);
    const mesh = quadMesh("CHILD", {
      kind: "Quad", id: "c", name: "CHILD",
      transform: { position: { x: 1, y: 2, z: 3 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    mesh.position.set(1, 2, 3);
    parent.add(mesh);
    parent.updateMatrixWorld(true);

    const r = buildInspectorReport(mesh);
    expect(r!.transform.worldPosition.x).toBeCloseTo(11, 5);
    expect(r!.transform.worldPosition.y).toBeCloseTo(22, 5);
    expect(r!.transform.worldPosition.z).toBeCloseTo(33, 5);
    expect(r!.transform.localPosition).toEqual({ x: 1, y: 2, z: 3 });
  });

  test("worldBounds returns a non-zero box for a 2x2 plane", () => {
    const mesh = quadMesh("Q", {
      kind: "Quad", id: "q", name: "Q",
      geometry: { size: { x: 2, y: 2 } },
    });
    mesh.geometry = new PlaneGeometry(2, 2);
    mesh.updateMatrixWorld(true);

    const r = buildInspectorReport(mesh);
    expect(r!.geometry.worldBounds.width).toBeCloseTo(2, 5);
    expect(r!.geometry.worldBounds.height).toBeCloseTo(2, 5);
  });

  test("alphaMapFilename resolved via registry (PHOTO_01-like keyGuid → VERTICAL_RAMP.png)", () => {
    const registry = emptyRegistry();
    registry.textures.set("ramp-id", {
      kind: "Texture", id: "ramp-id", name: "VERTICAL_RAMP.png",
      filename: "VERTICAL_RAMP.png", folderPath: "",
    });
    registry.textureLayers.set("photo-01-layer", {
      kind: "TextureLayer", id: "photo-01-layer", name: "PHOTO_01", textureBlending: "Multiply",
      mapping: { textureGuid: "p1tex", keyGuid: "ramp-id", isEmissive: true, useMipMapping: false },
    });
    const mesh = quadMesh("PHOTO_01", {
      kind: "Quad", id: "p1", name: "PHOTO_01",
      faceMapping: { materialId: "M", textureLayerId: "photo-01-layer" },
    });
    const r = buildInspectorReport(mesh, registry);
    expect(r!.material.alphaMapFilename).toBe("VERTICAL_RAMP.png");
  });

  test("returns null when start has no real W3D ancestor", () => {
    const root = new Group(); // no userData
    const helper = groupOf("X (pivot)", { kind: "(pivot helper)", forNodeId: "" });
    root.add(helper);
    expect(buildInspectorReport(helper)).toBeNull();
  });

  test("Phase H2: material.textureBlending appears when stamped on userData", () => {
    const mesh = quadMesh("GRADIENT", {
      kind: "Quad", id: "g", name: "GRADIENT",
      faceMapping: { materialId: "M", textureLayerId: "L" },
      textureLayerName: "GRADIENT",
      textureBlending: "Multiply",
    });
    const r = buildInspectorReport(mesh);
    expect(r!.material.textureBlending).toBe("Multiply");
  });

  test("Phase H2: material.textureBlending absent when userData lacks it", () => {
    const mesh = quadMesh("Q", { kind: "Quad", id: "q", name: "Q" });
    const r = buildInspectorReport(mesh);
    expect(r!.material.textureBlending).toBeUndefined();
  });
});
