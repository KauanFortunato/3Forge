// playgrounds/w3d-translation/src/nodes/builder.test.ts
import { describe, expect, test } from "vitest";
import { Group, Mesh, MeshBasicMaterial } from "three";
import { buildNode, buildNodeTree } from "./builder";
import type { BuildContext } from "./builder";
import type { W3DGroupData, W3DQuadData } from "./data";
import type { W3DResourceRegistry, W3DBaseMaterialData, W3DTextureLayerData, W3DTextureData } from "./resources";

function groupData(overrides: Partial<W3DGroupData> = {}): W3DGroupData {
  return {
    kind: "Group",
    id: "g",
    name: "G",
    speedScale: 1,
    maskIds: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    children: [],
    ...overrides,
  };
}

describe("builder — Group", () => {
  test("Group becomes a THREE.Group with position and rotation in radians", () => {
    const data = groupData({
      transform: {
        position: { x: 1, y: 2, z: 3 },
        rotationDeg: { x: 0, y: 90, z: 0 },
        scale: { x: 2, y: 2, z: 2 },
      },
    });
    const obj = buildNode(data);
    expect(obj).toBeInstanceOf(Group);
    expect(obj.position.toArray()).toEqual([1, 2, 3]);
    expect(obj.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    expect(obj.scale.toArray()).toEqual([2, 2, 2]);
    expect(obj.userData.w3d).toMatchObject({ id: "g", name: "G", kind: "Group" });
  });

  test("buildNodeTree wraps roots in a top-level Group", () => {
    const root = buildNodeTree([groupData({ id: "g1" }), groupData({ id: "g2" })]);
    expect(root).toBeInstanceOf(Group);
    expect(root.children).toHaveLength(2);
  });
});

function quadData(overrides: Partial<W3DQuadData> = {}): W3DQuadData {
  return {
    kind: "Quad",
    id: "q",
    name: "Q",
    enable: true,
    alpha: 1,
    speedScale: 1,
    isMask: false,
    maskIds: [],
    geometry: { size: { x: 2, y: 1 } },
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    children: [],
    ...overrides,
  };
}

describe("builder — Quad without children", () => {
  test("produces a Mesh with PlaneGeometry sized to data", () => {
    const obj = buildNode(quadData({ geometry: { size: { x: 7.36, y: 4.14 } } }));
    expect(obj).toBeInstanceOf(Mesh);
    const m = obj as Mesh;
    const params = (m.geometry as InstanceType<typeof import("three").PlaneGeometry>).parameters;
    expect(params.width).toBeCloseTo(7.36, 5);
    expect(params.height).toBeCloseTo(4.14, 5);
  });

  test("default alignment leaves geometry centered at origin", () => {
    const m = buildNode(quadData({ geometry: { size: { x: 2, y: 1 } } })) as Mesh;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    expect(bb.min.x).toBeCloseTo(-1, 5);
    expect(bb.max.x).toBeCloseTo(+1, 5);
    expect(bb.min.y).toBeCloseTo(-0.5, 5);
    expect(bb.max.y).toBeCloseTo(+0.5, 5);
  });

  test("AlignmentX=Left translates geometry X into [0, width]", () => {
    const m = buildNode(quadData({ geometry: { size: { x: 2, y: 1 }, alignmentX: "Left" } })) as Mesh;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    expect(bb.min.x).toBeCloseTo(0, 5);
    expect(bb.max.x).toBeCloseTo(+2, 5);
    expect(bb.min.y).toBeCloseTo(-0.5, 5);
    expect(bb.max.y).toBeCloseTo(+0.5, 5);
  });

  test("AlignmentX=Right translates geometry X into [-width, 0]", () => {
    const m = buildNode(quadData({ geometry: { size: { x: 2, y: 1 }, alignmentX: "Right" } })) as Mesh;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    expect(bb.min.x).toBeCloseTo(-2, 5);
    expect(bb.max.x).toBeCloseTo(0, 5);
  });

  test("AlignmentY=Bottom translates geometry Y into [0, height]", () => {
    const m = buildNode(quadData({ geometry: { size: { x: 2, y: 3 }, alignmentY: "Bottom" } })) as Mesh;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    expect(bb.min.x).toBeCloseTo(-1, 5);
    expect(bb.max.x).toBeCloseTo(+1, 5);
    expect(bb.min.y).toBeCloseTo(0, 5);
    expect(bb.max.y).toBeCloseTo(+3, 5);
  });

  test("AlignmentY=Top translates geometry Y into [-height, 0]", () => {
    const m = buildNode(quadData({ geometry: { size: { x: 2, y: 3 }, alignmentY: "Top" } })) as Mesh;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    expect(bb.min.y).toBeCloseTo(-3, 5);
    expect(bb.max.y).toBeCloseTo(0, 5);
  });

  test("Left+Bottom combination — PHOTO_MASK_01-like (1.06 × 3 Left)", () => {
    // Real PHOTO_MASK_01 has AlignmentX=Left only, but combo verifies independence
    const m = buildNode(quadData({ geometry: { size: { x: 1.06, y: 3 }, alignmentX: "Left", alignmentY: "Bottom" } })) as Mesh;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    expect(bb.min.x).toBeCloseTo(0, 5);
    expect(bb.max.x).toBeCloseTo(1.06, 5);
    expect(bb.min.y).toBeCloseTo(0, 5);
    expect(bb.max.y).toBeCloseTo(3, 5);
  });

  test("Enable=false sets mesh.visible to false", () => {
    const obj = buildNode(quadData({ enable: false }));
    expect(obj.visible).toBe(false);
  });

  test("Alpha=0.5 sets material transparent and opacity", () => {
    const m = buildNode(quadData({ alpha: 0.5 })) as Mesh;
    const mat = m.material as InstanceType<typeof import("three").MeshBasicMaterial>;
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBe(0.5);
  });

  test("userData.w3d carries id, name and resolution flags", () => {
    const m = buildNode(quadData({ id: "q-1", name: "BG" })) as Mesh;
    expect(m.userData.w3d).toMatchObject({
      id: "q-1",
      name: "BG",
      kind: "Quad",
      hasMaterialResolved: false,
      hasTextureLayerResolved: false,
    });
  });

  test("transform is applied directly on the Mesh (no children)", () => {
    const m = buildNode(quadData({ transform: {
      position: { x: 5, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }})) as Mesh;
    expect(m.position.x).toBe(5);
  });
});

describe("builder — Quad with children", () => {
  test("returns a Group carrying the transform; mesh is identity", () => {
    const parent = quadData({
      id: "p",
      transform: {
        position: { x: 4, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [quadData({ id: "c", transform: {
        position: { x: 0, y: 1, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      }})],
    });
    const obj = buildNode(parent);
    expect(obj).toBeInstanceOf(Group);
    const wrapper = obj as Group;
    expect(wrapper.position.x).toBe(4);
    // First child is the Quad's own mesh at identity
    expect(wrapper.children).toHaveLength(2);
    const mesh = wrapper.children[0];
    expect(mesh.position.toArray()).toEqual([0, 0, 0]);
    expect(mesh.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
    // Second child is the recursive Quad child (built as its own Mesh)
    const childMesh = wrapper.children[1];
    expect(childMesh.position.y).toBe(1);
  });

  test("Enable=false on parent Quad hides the wrapper Group", () => {
    const parent = quadData({
      enable: false,
      children: [quadData({ id: "c" })],
    });
    const wrapper = buildNode(parent) as Group;
    expect(wrapper.visible).toBe(false);
  });
});

function makeCtx(overrides: Partial<BuildContext> = {}): BuildContext {
  const registry: W3DResourceRegistry = {
    baseMaterials: new Map(),
    textures: new Map(),
    textureLayers: new Map(),
    dynamicTextureFilenameByLayerId: new Map(),
  };
  return {
    registry,
    textureUrlsByFilename: new Map(),
    textureCache: new Map(),
    warnings: [],
    ...overrides,
  };
}

function makePrimaryMat(): W3DBaseMaterialData {
  return {
    kind: "BaseMaterial", id: "primary-id", name: "PRIMARY",
    hasEmissive: true, hasDiffuse: false, emissive: "663087", diffuse: "ffffff", alpha: 1,
  };
}

describe("builder — BuildContext", () => {
  test("buildNode without ctx falls back to DisplayColor (Phase F behaviour)", () => {
    const node = quadData({ displayColor: undefined });
    const mesh = buildNode(node) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    // No ctx = magenta fallback
    expect(mat.color.getHexString()).toBe("ff00ff");
  });

  test("buildNode with ctx + PRIMARY materialId → color #663087", () => {
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map([["primary-id", makePrimaryMat()]]),
      textures: new Map(),
      textureLayers: new Map(),
      dynamicTextureFilenameByLayerId: new Map(),
    };
    const ctx = makeCtx({ registry });
    const node = quadData({
      faceMapping: {
        surfaceName: "All", materialId: "primary-id", textureLayerId: "Standard",
        baseMaterialInherited: false, textureInherited: false,
      },
    });
    const mesh = buildNode(node, ctx) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.color.getHexString()).toBe("663087");
  });

  test("buildNode with ctx + unknown materialId falls back to DisplayColor", () => {
    const ctx = makeCtx();
    const node = quadData({ displayColor: "11119017", faceMapping: {
      surfaceName: "All", materialId: "unknown-id", textureLayerId: "Standard",
      baseMaterialInherited: false, textureInherited: false,
    }});
    const mesh = buildNode(node, ctx) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    // DisplayColor 11119017 is not magenta — should be some grey-ish hex
    expect(mat.color.getHexString()).not.toBe("ff00ff");
  });

  test("textureCache reuses same Texture instance for same URL", () => {
    const bgTex: W3DTextureData = {
      kind: "Texture", id: "bg-id", name: "BG.png", filename: "BG.png", folderPath: "",
    };
    const bgLayer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "bg-layer", name: "BACKGROUND", textureBlending: "Multiply",
      mapping: { textureGuid: "bg-id", keyType: "AlphaKey", isEmissive: false, useMipMapping: false },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["bg-id", bgTex]]),
      textureLayers: new Map([["bg-layer", bgLayer]]),
      dynamicTextureFilenameByLayerId: new Map(),
    };
    const urls = new Map([["BG.png", "blob:fake-bg"]]);
    const ctx = makeCtx({ registry, textureUrlsByFilename: urls });

    const node1 = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "bg-layer", baseMaterialInherited: false, textureInherited: false } });
    const node2 = quadData({ id: "q2", faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "bg-layer", baseMaterialInherited: false, textureInherited: false } });

    buildNode(node1, ctx);
    buildNode(node2, ctx);

    // Same URL should produce only 1 entry in textureCache
    expect(ctx.textureCache.size).toBe(1);
    const cachedTex = ctx.textureCache.get("blob:fake-bg");
    expect(cachedTex).toBeDefined();

    // Both meshes share the same Texture instance
    const mesh1 = buildNode(node1, ctx) as Mesh;
    const mesh2 = buildNode(node2, ctx) as Mesh;
    expect((mesh1.material as MeshBasicMaterial).map).toBe(ctx.textureCache.get("blob:fake-bg"));
    expect((mesh2.material as MeshBasicMaterial).map).toBe(ctx.textureCache.get("blob:fake-bg"));
  });

  test("resolved texture sets material.map, transparent=true, hasMaterialResolved in userData", () => {
    const bgTex: W3DTextureData = {
      kind: "Texture", id: "bg-id", name: "BG.png", filename: "BG.png", folderPath: "",
    };
    const bgLayer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "bg-layer", name: "BACKGROUND", textureBlending: "Multiply",
      mapping: { textureGuid: "bg-id", keyType: "AlphaKey", isEmissive: false, useMipMapping: false },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["bg-id", bgTex]]),
      textureLayers: new Map([["bg-layer", bgLayer]]),
      dynamicTextureFilenameByLayerId: new Map(),
    };
    const urls = new Map([["BG.png", "blob:fake-bg"]]);
    const ctx = makeCtx({ registry, textureUrlsByFilename: urls });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "bg-layer", baseMaterialInherited: false, textureInherited: false } });
    const mesh = buildNode(node, ctx) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.map).toBeDefined();
    expect(mat.transparent).toBe(true);
    expect(mesh.userData.w3d.hasTextureLayerResolved).toBe(true);
  });

  test("texture.colorSpace is SRGBColorSpace", async () => {
    const { SRGBColorSpace } = await import("three");
    const bgTex: W3DTextureData = {
      kind: "Texture", id: "bg-id", name: "BG.png", filename: "BG.png", folderPath: "",
    };
    const bgLayer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "bg-layer", name: "BACKGROUND", textureBlending: "Multiply",
      mapping: { textureGuid: "bg-id", isEmissive: false, useMipMapping: false },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["bg-id", bgTex]]),
      textureLayers: new Map([["bg-layer", bgLayer]]),
      dynamicTextureFilenameByLayerId: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["BG.png", "blob:fake-bg"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "bg-layer", baseMaterialInherited: false, textureInherited: false } });
    buildNode(node, ctx);
    const tex = ctx.textureCache.get("blob:fake-bg");
    expect(tex?.colorSpace).toBe(SRGBColorSpace);
  });

  test("Phase 2J: PHOTO_MASK_01 writer encodes MASK owner player index 1 (bits 0-2)", async () => {
    const { AlwaysStencilFunc, ReplaceStencilOp } = await import("three");
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([mask], ctx);
    const m = root.children[0] as Mesh;
    const mat = m.material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilFunc).toBe(AlwaysStencilFunc);
    expect(mat.stencilZPass).toBe(ReplaceStencilOp);
    expect(mat.stencilFail).toBe(ReplaceStencilOp);
    expect(mat.stencilZFail).toBe(ReplaceStencilOp);
    // ref = playerIndex = 1 (occupies MASK owner field, bits 0-2)
    expect(mat.stencilRef).toBe(1);
    // writeMask = MASK_OWNER_FIELD = 0b00000111 = 7
    expect(mat.stencilWriteMask).toBe(7);
    expect(mat.colorWrite).toBe(false);
    expect(m.visible).toBe(true);
  });

  test("Phase 2J: PHOTO_DUMMY_01 writer encodes DUMMY owner player index 1 (bits 3-5)", async () => {
    const { AlwaysStencilFunc, ReplaceStencilOp } = await import("three");
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([dummy], ctx);
    const m = root.children[0] as Mesh;
    const mat = m.material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilFunc).toBe(AlwaysStencilFunc);
    expect(mat.stencilZPass).toBe(ReplaceStencilOp);
    // ref = playerIndex << 3 = 1 << 3 = 8 (occupies DUMMY owner field, bits 3-5)
    expect(mat.stencilRef).toBe(8);
    // writeMask = DUMMY_OWNER_FIELD = 0b00111000 = 56
    expect(mat.stencilWriteMask).toBe(56);
    expect(mat.colorWrite).toBe(false);
    expect(m.visible).toBe(true);
  });

  test("Phase 2J: PHOTO_DUMMY_03 writer encodes DUMMY owner player index 3", () => {
    const dummy = quadData({
      id: "dummy-3", name: "PHOTO_DUMMY_03", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([dummy], ctx);
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    // ref = playerIndex << 3 = 3 << 3 = 24
    expect(mat.stencilRef).toBe(24);
    expect(mat.stencilWriteMask).toBe(56); // DUMMY owner field only
  });

  test("Phase 2J: PHOTO_MASK and PHOTO_DUMMY writer fields are disjoint (no overlap, no shared bits)", () => {
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([mask, dummy], ctx);
    const maskMat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    const dummyMat = (root.children[1] as Mesh).material as MeshBasicMaterial;
    expect(maskMat.stencilRef).toBe(1);   // playerIndex in MASK owner field
    expect(dummyMat.stencilRef).toBe(8);  // playerIndex << 3 in DUMMY owner field
    // Owner fields are fully disjoint — writers cannot contaminate each other.
    expect(maskMat.stencilWriteMask).toBe(0b00000111);
    expect(dummyMat.stencilWriteMask).toBe(0b00111000);
    expect(maskMat.stencilWriteMask & dummyMat.stencilWriteMask).toBe(0);
  });

  test("Phase 2J: mixed-player effective maskIds skip stencil setup safely (warning + no leakage)", () => {
    // A client whose effective maskIds resolve to two different player indices
    // (e.g. PHOTO_DUMMY_01 + PHOTO_MASK_02) is an authoring error — combining
    // them would test a player-bit ref that's neither player's, garbling the
    // result and leaking across players. Translator must skip stencil setup
    // and emit a warning instead.
    const dummy1 = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const mask2 = quadData({
      id: "mask-2", name: "PHOTO_MASK_02", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const mixedClient = quadData({ id: "mixed", name: "MIXED_CLIENT", maskIds: ["dummy-1", "mask-2"] });
    const ctx = makeCtx();
    const root = buildNodeTree([dummy1, mask2, mixedClient], ctx);
    const mat = (root.children[2] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(false);
    expect(ctx.warnings.some(w => w.includes("MASK owner") && w.includes("disagrees with DUMMY owner"))).toBe(true);
  });

  test("Phase 2J: MASK_M + DUMMY_N pixel cannot pass PHOTO_N or FILL_N when M !== N (no cross-player leakage)", () => {
    // Simulate a pixel that was written by PHOTO_MASK_01 (player 1) then by
    // PHOTO_DUMMY_02 (player 2). With Phase 2J's disjoint owner fields, the
    // resulting stencil byte is M | (N << 3) — PHOTO_2 / FILL_2 readers must
    // reject it because the MASK owner field is 1 (not 2). This is the
    // structural guarantee Phase 2I lacked.
    const M = 1; // MASK_01 owner
    const N = 2; // DUMMY_02 owner
    const pixelStencil = M | (N << 3); // = 1 | 16 = 17

    // PHOTO_2 reader with [MASK_2]: ref = 2, funcMask = 0b00000111
    const photoN_ref = N;
    const photoN_funcMask = 0b00000111;
    expect((pixelStencil & photoN_funcMask) === photoN_ref).toBe(false);

    // FILL_2 reader with [DUMMY_2, MASK_2]: ref = 2 | (2<<3) = 18, funcMask = 0b00111111
    const fillN_ref = N | (N << 3);
    const fillN_funcMask = 0b00111111;
    expect((pixelStencil & fillN_funcMask) === fillN_ref).toBe(false);

    // Sanity: PHOTO_1 with [MASK_1] would correctly pass this pixel.
    const photoM_ref = M;
    expect((pixelStencil & photoN_funcMask) === photoM_ref).toBe(true);
  });

  test("Phase 1a: PHOTO_01 client reads stencil with KeepStencilOp", async () => {
    const { KeepStencilOp } = await import("three");
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photo = quadData({ id: "p1", name: "PHOTO_01", maskIds: ["mask-1"], alpha: 0.5 });
    const ctx = makeCtx();
    const root = buildNodeTree([mask, photo], ctx);
    const photoMesh = root.children[1] as Mesh;
    const mat = photoMesh.material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilFail).toBe(KeepStencilOp);
    expect(mat.stencilZFail).toBe(KeepStencilOp);
    expect(mat.stencilZPass).toBe(KeepStencilOp);
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(false);
  });

  test("Phase 2J: IsInvertedMask=True on PHOTO_MASK_01 → PHOTO_01 reads MASK owner field == 1", async () => {
    const { EqualStencilFunc } = await import("three");
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photo = quadData({ id: "p1", name: "PHOTO_01", maskIds: ["mask-1"] });
    const ctx = makeCtx();
    const root = buildNodeTree([mask, photo], ctx);
    const mat = (root.children[1] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilFunc).toBe(EqualStencilFunc);
    // ref = MASK owner playerIndex = 1 (in bits 0-2)
    expect(mat.stencilRef).toBe(1);
    // funcMask = MASK_OWNER_FIELD = 0b00000111 = 7
    expect(mat.stencilFuncMask).toBe(7);
  });

  test("Phase 1a: IsInvertedMask=False on PHOTO_MASK → client uses NotEqualStencilFunc", async () => {
    const { NotEqualStencilFunc } = await import("three");
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: false },
    });
    const photo = quadData({ id: "p1", name: "PHOTO_01", maskIds: ["mask-1"] });
    const ctx = makeCtx();
    const root = buildNodeTree([mask, photo], ctx);
    const mat = (root.children[1] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilFunc).toBe(NotEqualStencilFunc);
  });

  test("Phase 1a: mask renderOrder (10) is less than client renderOrder (20)", () => {
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photo = quadData({ id: "p1", name: "PHOTO_01", maskIds: ["mask-1"] });
    const ctx = makeCtx();
    const root = buildNodeTree([mask, photo], ctx);
    const maskMesh = root.children[0] as Mesh;
    const photoMesh = root.children[1] as Mesh;
    expect(maskMesh.renderOrder).toBe(10);
    expect(photoMesh.renderOrder).toBe(20);
    expect(maskMesh.renderOrder).toBeLessThan(photoMesh.renderOrder);
  });

  test("Phase 1a scope: non-PHOTO_MASK isMask quad (e.g. BASE_MAIN) is NOT stenciled", () => {
    const baseMask = quadData({
      id: "base-1", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([baseMask], ctx);
    const m = root.children[0] as Mesh;
    const mat = m.material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(false); // untouched by Phase 1a
    expect(m.visible).toBe(false); // still hidden by the old "isMask = hide" default
  });

  test("Phase 2E: PHOTO_FILL-like client with [DUMMY, MASK] reads via bitMask=3 (intersection)", async () => {
    // Simulates PHOTO_FILL_02..05 with [PHOTO_DUMMY_0X, PHOTO_MASK_0X]. The
    // reader OR's both bits (DUMMY=2, MASK=1) into bitMask=3 and tests it with
    // Equal, so the client is visible only where BOTH masks wrote — i.e. the
    // intersection of the DUMMY contour with the PHOTO_MASK slit.
    const { EqualStencilFunc } = await import("three");
    const photoMask = quadData({
      id: "mask-2", name: "PHOTO_MASK_02", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photoDummy = quadData({
      id: "dummy-2", name: "PHOTO_DUMMY_02", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const fillClient = quadData({ id: "fill-2", name: "FILL_2_LIKE_QUAD", maskIds: ["dummy-2", "mask-2"] });
    const ctx = makeCtx();
    const root = buildNodeTree([photoMask, photoDummy, fillClient], ctx);
    const fillMat = (root.children[2] as Mesh).material as MeshBasicMaterial;
    expect(fillMat.stencilWrite).toBe(true);
    expect(fillMat.stencilFunc).toBe(EqualStencilFunc);
    // Phase 2J: ref = MASK owner (2) | (DUMMY owner (2) << 3) = 2 | 16 = 18
    expect(fillMat.stencilRef).toBe(18);
    // funcMask = MASK_OWNER_FIELD | DUMMY_OWNER_FIELD = 7 | 56 = 63
    expect(fillMat.stencilFuncMask).toBe(63);
  });

  test("Patch A: PHOTO_FILL Group with maskIds=[DUMMY] propagates stencil to child quads", async () => {
    // PHOTO_FILL_01 (Group) has maskIds=[PHOTO_DUMMY_01]. Its children
    // PHOTO_COLOR_01 and TEXTURE_PHOTO_01 have no maskIds of their own — they
    // must inherit the parent Group's maskIds for clipping.
    const { EqualStencilFunc, KeepStencilOp } = await import("three");
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const color = quadData({ id: "color-1", name: "PHOTO_COLOR_01" });
    const texture = quadData({ id: "tex-1", name: "TEXTURE_PHOTO_01" });
    const fill = groupData({
      id: "fill-1", name: "PHOTO_FILL_01",
      maskIds: ["dummy-1"],
      children: [color, texture],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([dummy, fill], ctx);
    const fillGroup = root.children[1] as Group;
    const colorMesh = fillGroup.children[0] as Mesh;
    const textureMesh = fillGroup.children[1] as Mesh;

    for (const mesh of [colorMesh, textureMesh]) {
      const mat = mesh.material as MeshBasicMaterial;
      expect(mat.stencilWrite).toBe(true);
      expect(mat.stencilFunc).toBe(EqualStencilFunc);
      // Phase 2J: no PHOTO_MASK_01 in this fixture → no 2H fallback applied,
      // so reader sees only DUMMY_01. ref = playerIndex << 3 = 8.
      expect(mat.stencilRef).toBe(8);
      expect(mat.stencilFuncMask).toBe(56); // DUMMY_OWNER_FIELD only
      expect(mat.stencilFail).toBe(KeepStencilOp);
      expect(mat.stencilZFail).toBe(KeepStencilOp);
      expect(mat.stencilZPass).toBe(KeepStencilOp);
      expect(mat.depthWrite).toBe(false);
      expect(mat.depthTest).toBe(false);
    }
    // Patch D2: renderOrder is granular by node name (TEXTURE behind COLOR).
    expect(colorMesh.renderOrder).toBe(19);
    expect(textureMesh.renderOrder).toBe(18);
  });

  test("Patch A: own maskIds on a Quad override inherited from parent Group", () => {
    // A child with explicit maskIds should NOT inherit from the parent Group.
    const photoMask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ownChild = quadData({ id: "own", name: "OWN_CLIENT", maskIds: ["mask-1"] }); // explicit
    const fill = groupData({
      id: "fill-1", name: "PHOTO_FILL_01",
      maskIds: ["dummy-1"],
      children: [ownChild],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([photoMask, dummy, fill], ctx);
    const fillGroup = root.children[2] as Group;
    const ownMesh = fillGroup.children[0] as Mesh;
    const mat = ownMesh.material as MeshBasicMaterial;
    // Reader uses only own MASK_01: ref = MASK owner playerIndex = 1
    expect(mat.stencilRef).toBe(1);
  });

  test("Patch D2: TEXTURE_PHOTO_0X gets lower renderOrder than PHOTO_COLOR_0X (TEXTURE behind COLOR)", () => {
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const color = quadData({ id: "color-1", name: "PHOTO_COLOR_01" });
    const texture = quadData({ id: "tex-1", name: "TEXTURE_PHOTO_01" });
    const fill = groupData({
      id: "fill-1", name: "PHOTO_FILL_01",
      maskIds: ["dummy-1"],
      children: [color, texture],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([dummy, fill], ctx);
    const fillGroup = root.children[1] as Group;
    const colorMesh = fillGroup.children[0] as Mesh;
    const textureMesh = fillGroup.children[1] as Mesh;
    expect(textureMesh.renderOrder).toBeLessThan(colorMesh.renderOrder);
    expect(textureMesh.renderOrder).toBe(18);
    expect(colorMesh.renderOrder).toBe(19);
  });

  test("Patch D2: PHOTO_COLOR_0X gets lower renderOrder than PHOTO_0X (COLOR behind PHOTO)", () => {
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photo = quadData({ id: "p1", name: "PHOTO_01", maskIds: ["mask-1"], alpha: 0.5 });
    const color = quadData({ id: "color-1", name: "PHOTO_COLOR_01" });
    const fill = groupData({
      id: "fill-1", name: "PHOTO_FILL_01",
      maskIds: ["dummy-1"],
      children: [color],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([mask, dummy, photo, fill], ctx);
    const photoMesh = root.children[2] as Mesh;
    const colorMesh = (root.children[3] as Group).children[0] as Mesh;
    expect(colorMesh.renderOrder).toBeLessThan(photoMesh.renderOrder);
    expect(colorMesh.renderOrder).toBe(19);
    expect(photoMesh.renderOrder).toBe(20);
  });

  test("Patch D2: non-photo-card stencil reader keeps authored transparency (scope guard)", () => {
    // A hypothetical future client that reads PHOTO_MASK/PHOTO_DUMMY but is
    // not a photo-card node (PHOTO/PHOTO_COLOR/TEXTURE_PHOTO) must retain its
    // material's authored transparent flag. The transparent override is
    // scoped to photo-card names only.
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const otherClient = quadData({
      id: "other", name: "OTHER_CLIENT", maskIds: ["mask-1"], alpha: 1, // alpha=1, no texture → opaque
    });
    const ctx = makeCtx();
    const root = buildNodeTree([mask, otherClient], ctx);
    const mat = (root.children[1] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);  // still stenciled
    expect(mat.transparent).toBe(false);  // NOT forced — opaque preserved
  });

  test("Patch D2: photo-card stencil readers forced to transparent (so renderOrder sorts across pass)", () => {
    // PHOTO_COLOR_0X has no texture and opacity=1, so by default the material
    // is opaque. With opaque + transparent meshes split into separate passes,
    // renderOrder alone cannot put a transparent TEXTURE_PHOTO behind an
    // opaque PHOTO_COLOR. Forcing transparent=true on the reader unifies them
    // into the transparent pass where renderOrder sorting is respected.
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const color = quadData({ id: "color-1", name: "PHOTO_COLOR_01" }); // alpha=1 default
    const fill = groupData({
      id: "fill-1", name: "PHOTO_FILL_01",
      maskIds: ["dummy-1"],
      children: [color],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([dummy, fill], ctx);
    const colorMesh = (root.children[1] as Group).children[0] as Mesh;
    const mat = colorMesh.material as MeshBasicMaterial;
    expect(mat.transparent).toBe(true); // overridden by Patch D2 even though source is opaque
  });

  test("Patch D2: stencil writers (PHOTO_MASK / PHOTO_DUMMY) keep renderOrder 10 (unchanged)", () => {
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([mask, dummy], ctx);
    expect((root.children[0] as Mesh).renderOrder).toBe(10);
    expect((root.children[1] as Mesh).renderOrder).toBe(10);
  });

  test("Phase 2A: PLAYERS with 5 children + leadingSpace=-1.26 → reverse-index distribution", () => {
    // Expected per R3: PLAYER_01 leftmost (most negative X), PLAYER_05 at origin.
    const p1 = groupData({ id: "p1", name: "PLAYER_01" });
    const p2 = groupData({ id: "p2", name: "PLAYER_02" });
    const p3 = groupData({ id: "p3", name: "PLAYER_03" });
    const p4 = groupData({ id: "p4", name: "PLAYER_04" });
    const p5 = groupData({ id: "p5", name: "PLAYER_05" });
    const players = groupData({
      id: "players", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
      children: [p1, p2, p3, p4, p5],
    });
    const root = buildNodeTree([players]);
    const playersGroup = root.children[0] as Group;
    expect(playersGroup.children[0].position.x).toBeCloseTo(-5.04, 5); // PLAYER_01
    expect(playersGroup.children[1].position.x).toBeCloseTo(-3.78, 5); // PLAYER_02
    expect(playersGroup.children[2].position.x).toBeCloseTo(-2.52, 5); // PLAYER_03
    expect(playersGroup.children[3].position.x).toBeCloseTo(-1.26, 5); // PLAYER_04
    expect(playersGroup.children[4].position.x).toBeCloseTo(0, 5);      // PLAYER_05
  });

  test("Phase 2A: PLAYERS flow is additive — preserves authored child position.x", () => {
    const transform = {
      position: { x: 0.5, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const p1 = groupData({ id: "p1", name: "PLAYER_01", transform });
    const p2 = groupData({ id: "p2", name: "PLAYER_02", transform });
    const players = groupData({
      id: "players", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
      children: [p1, p2],
    });
    const root = buildNodeTree([players]);
    const g = root.children[0] as Group;
    // n=2 → child[0].x += (2-1-0)*-1.26 = -1.26 → 0.5-1.26 = -0.76
    // child[1].x += (2-1-1)*-1.26 = 0 → 0.5
    expect(g.children[0].position.x).toBeCloseTo(0.5 - 1.26, 5);
    expect(g.children[1].position.x).toBeCloseTo(0.5, 5);
  });

  test("Phase 2A gate: non-PLAYERS group with flow.children=true is NOT distributed", () => {
    // BENCH_LIST has the same flow attrs in the scene, but Phase 2A scope is
    // intentionally limited to the PLAYERS group. Other named groups stay at
    // their authored child positions until Phase 2F.
    const c1 = groupData({ id: "c1", name: "CHILD_01" });
    const c2 = groupData({ id: "c2", name: "CHILD_02" });
    const bench = groupData({
      id: "bench", name: "BENCH_LIST",
      flow: { children: true, leadingSpace: -0.084, direction: "YMinus" },
      children: [c1, c2],
    });
    const root = buildNodeTree([bench]);
    const g = root.children[0] as Group;
    expect(g.children[0].position.x).toBe(0);
    expect(g.children[1].position.x).toBe(0);
    expect(g.children[0].position.y).toBe(0);
    expect(g.children[1].position.y).toBe(0);
  });

  test("Phase 2A: PLAYERS group without flow set is unchanged", () => {
    const c1 = groupData({ id: "c1", name: "PLAYER_01" });
    const c2 = groupData({ id: "c2", name: "PLAYER_02" });
    const players = groupData({
      id: "players", name: "PLAYERS",
      children: [c1, c2], // no flow
    });
    const root = buildNodeTree([players]);
    const g = root.children[0] as Group;
    expect(g.children[0].position.x).toBe(0);
    expect(g.children[1].position.x).toBe(0);
  });

  test("Phase 2A regression: PHOTO_MASK_05 keeps authored Size.X=1.55 (not normalized)", () => {
    const mask = quadData({
      id: "mask-5", name: "PHOTO_MASK_05", isMask: true,
      geometry: { alignmentX: "Left", size: { x: 1.55, y: 3 } },
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([mask], ctx);
    const m = root.children[0] as Mesh;
    const params = (m.geometry as InstanceType<typeof import("three").PlaneGeometry>).parameters;
    expect(params.width).toBeCloseTo(1.55, 5);
    expect(params.height).toBeCloseTo(3, 5);
  });

  test("Phase 2H+2I: PHOTO_FILL_01 with only PHOTO_DUMMY_01 → infers PHOTO_MASK_01 → children read (MASK|DUMMY) + player 1", async () => {
    // PHOTO_FILL_01 in LINEUP_LEFT is authored with a single maskId
    // [PHOTO_DUMMY_01]. The paired-mask fallback adds PHOTO_MASK_01 when it
    // exists in the registry, so the FILL children clip to the intersection
    // (bitMask=3) just like PHOTO_FILL_02..05 which carry both maskIds
    // explicitly.
    const { EqualStencilFunc } = await import("three");
    const photoMask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const color = quadData({ id: "color-1", name: "PHOTO_COLOR_01" });
    const fill = groupData({
      id: "fill-1", name: "PHOTO_FILL_01",
      maskIds: ["dummy-1"], // single-mask authoring
      children: [color],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([photoMask, dummy, fill], ctx);
    const fillGroup = root.children[2] as Group;
    const colorMesh = fillGroup.children[0] as Mesh;
    const mat = colorMesh.material as MeshBasicMaterial;
    expect(mat.stencilFunc).toBe(EqualStencilFunc);
    expect(mat.stencilRef).toBe(9);       // MASK owner=1 | (DUMMY owner=1 << 3) = 1 | 8 = 9
    expect(mat.stencilFuncMask).toBe(63); // MASK_OWNER_FIELD | DUMMY_OWNER_FIELD
  });

  test("Phase 2H: PHOTO_FILL_01 with no matching PHOTO_MASK_01 keeps single-mask behavior", async () => {
    // If the paired PHOTO_MASK_XX is missing from the registry, fall back to
    // the original single-mask clipping (no inferred MASK).
    const { EqualStencilFunc } = await import("three");
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const color = quadData({ id: "color-1", name: "PHOTO_COLOR_01" });
    const fill = groupData({
      id: "fill-1", name: "PHOTO_FILL_01",
      maskIds: ["dummy-1"],
      children: [color],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([dummy, fill], ctx);
    const fillGroup = root.children[1] as Group;
    const mat = (fillGroup.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilFunc).toBe(EqualStencilFunc);
    expect(mat.stencilRef).toBe(8);       // DUMMY owner=1 << 3 = 8
    expect(mat.stencilFuncMask).toBe(56); // DUMMY_OWNER_FIELD only
  });

  test("Phase 2H: PHOTO_FILL_02 with explicit [DUMMY, MASK] is unchanged (no double-add)", async () => {
    const { EqualStencilFunc } = await import("three");
    const photoMask = quadData({
      id: "mask-2", name: "PHOTO_MASK_02", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const dummy = quadData({
      id: "dummy-2", name: "PHOTO_DUMMY_02", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const color = quadData({ id: "color-2", name: "PHOTO_COLOR_02" });
    const fill = groupData({
      id: "fill-2", name: "PHOTO_FILL_02",
      maskIds: ["dummy-2", "mask-2"], // already paired
      children: [color],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([photoMask, dummy, fill], ctx);
    const fillGroup = root.children[2] as Group;
    const mat = (fillGroup.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilFunc).toBe(EqualStencilFunc);
    expect(mat.stencilRef).toBe(18);      // MASK owner=2 | (DUMMY owner=2 << 3) = 2 | 16 = 18
    expect(mat.stencilFuncMask).toBe(63); // MASK_OWNER_FIELD | DUMMY_OWNER_FIELD
  });

  test("Phase 2H: non-PHOTO_FILL group with single mask does NOT get fallback", async () => {
    // The fallback is scoped strictly to PHOTO_FILL_XX names. A different
    // group (e.g. SOME_OTHER) with a single maskId stays single-mask.
    const { EqualStencilFunc } = await import("three");
    const photoMask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const child = quadData({ id: "child", name: "SOME_CHILD" });
    const other = groupData({
      id: "other", name: "SOME_OTHER_GROUP",
      maskIds: ["dummy-1"],
      children: [child],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([photoMask, dummy, other], ctx);
    const grp = root.children[2] as Group;
    const mat = (grp.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilFunc).toBe(EqualStencilFunc);
    expect(mat.stencilRef).toBe(8);       // DUMMY owner=1 << 3 = 8 — no fallback
    expect(mat.stencilFuncMask).toBe(56); // DUMMY_OWNER_FIELD only
  });

  test("Phase 2H: mismatched FILL index (FILL_01 with DUMMY_02) does NOT trigger fallback", async () => {
    // If FILL_XX's single maskId resolves to a DUMMY whose index doesn't match
    // (e.g. FILL_01 pointing to DUMMY_02), the fallback skips — we never
    // synthesise a mask that doesn't align with the authored intent.
    const { EqualStencilFunc } = await import("three");
    const photoMask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const dummy2 = quadData({
      id: "dummy-2", name: "PHOTO_DUMMY_02", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const color = quadData({ id: "color", name: "PHOTO_COLOR_01" });
    const fill = groupData({
      id: "fill-1", name: "PHOTO_FILL_01",
      maskIds: ["dummy-2"], // index mismatch
      children: [color],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([photoMask, dummy2, fill], ctx);
    const fillGroup = root.children[2] as Group;
    const mat = (fillGroup.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilFunc).toBe(EqualStencilFunc);
    expect(mat.stencilRef).toBe(16);      // DUMMY owner=2 << 3 = 16; no synthetic MASK_01 added
    expect(mat.stencilFuncMask).toBe(56); // DUMMY_OWNER_FIELD only
  });

  test("Phase 2E: single-mask client [DUMMY] keeps bitMask=2 (regression — FILL_01 case)", async () => {
    // PHOTO_FILL_01 has only one maskId (PHOTO_DUMMY_01). Multi-mask
    // intersection degenerates to a single bit in this case.
    const { EqualStencilFunc } = await import("three");
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const fillClient = quadData({ id: "fill-1", name: "FILL_1_LIKE_QUAD", maskIds: ["dummy-1"] });
    const ctx = makeCtx();
    const root = buildNodeTree([dummy, fillClient], ctx);
    const mat = (root.children[1] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilFunc).toBe(EqualStencilFunc);
    expect(mat.stencilRef).toBe(8);       // DUMMY owner=1 << 3 = 8
    expect(mat.stencilFuncMask).toBe(56); // DUMMY_OWNER_FIELD only
  });

  test("Phase 2E: Group with two maskIds propagates combined bitMask to child quads", async () => {
    // PHOTO_FILL_02 (Group) has maskIds=[PHOTO_DUMMY_02, PHOTO_MASK_02]. Its
    // children PHOTO_COLOR_02 and TEXTURE_PHOTO_02 inherit the FULL list and
    // must read the intersection (bitMask=3).
    const { EqualStencilFunc } = await import("three");
    const photoMask = quadData({
      id: "mask-2", name: "PHOTO_MASK_02", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const dummy = quadData({
      id: "dummy-2", name: "PHOTO_DUMMY_02", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const color = quadData({ id: "color-2", name: "PHOTO_COLOR_02" });
    const texture = quadData({ id: "tex-2", name: "TEXTURE_PHOTO_02" });
    const fill = groupData({
      id: "fill-2", name: "PHOTO_FILL_02",
      maskIds: ["dummy-2", "mask-2"],
      children: [color, texture],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([photoMask, dummy, fill], ctx);
    const fillGroup = root.children[2] as Group;
    const colorMesh = fillGroup.children[0] as Mesh;
    const textureMesh = fillGroup.children[1] as Mesh;
    for (const mesh of [colorMesh, textureMesh]) {
      const mat = mesh.material as MeshBasicMaterial;
      expect(mat.stencilFunc).toBe(EqualStencilFunc);
      expect(mat.stencilRef).toBe(18);      // MASK owner=2 | (DUMMY owner=2 << 3) = 18
      expect(mat.stencilFuncMask).toBe(63); // MASK_OWNER_FIELD | DUMMY_OWNER_FIELD
    }
  });

  test("Phase 2E: maskIds with unknown ids fall through (bitMask=0 → no stencil)", () => {
    // Anti-regression: a client whose maskIds reference no known writer must
    // NOT acquire any stencil state.
    const orphan = quadData({ id: "x", name: "WHATEVER", maskIds: ["bogus-id"] });
    const ctx = makeCtx();
    const root = buildNodeTree([orphan], ctx);
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(false);
  });

  test("Phase 2F: PHOTO_DUMMY-like writer with map+alphaMap and DisableBinaryAlpha=True → alphaTest=0.5", () => {
    // PHOTO_DUMMY_0X carries the player layer (Player N.png + VERTICAL_RAMP)
    // and DisableBinaryAlpha="True". Stencil contour should follow texture
    // alpha, not the geometric rectangle.
    const playerTex: W3DTextureData = {
      kind: "Texture", id: "player-tex", name: "Player 1.png", filename: "Player 1.png", folderPath: "",
    };
    const vrampTex: W3DTextureData = {
      kind: "Texture", id: "vramp-tex", name: "VERTICAL_RAMP.png", filename: "VERTICAL_RAMP.png", folderPath: "",
    };
    const photoLayer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "photo-01-layer", name: "PHOTO_01", textureBlending: "Multiply",
      mapping: {
        textureGuid: "player-tex", keyGuid: "vramp-tex", keyType: "AlphaKey",
        isEmissive: true, useMipMapping: true,
      },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["player-tex", playerTex], ["vramp-tex", vrampTex]]),
      textureLayers: new Map([["photo-01-layer", photoLayer]]),
      dynamicTextureFilenameByLayerId: new Map(),
    };
    const ctx = makeCtx({
      registry,
      textureUrlsByFilename: new Map([
        ["Player 1.png", "blob:p"],
        ["VERTICAL_RAMP.png", "blob:v"],
      ]),
    });
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "photo-01-layer", baseMaterialInherited: false, textureInherited: false },
    });
    const root = buildNodeTree([dummy], ctx);
    const m = root.children[0] as Mesh;
    const mat = m.material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.colorWrite).toBe(false);
    expect(mat.alphaTest).toBeCloseTo(0.5, 5);
    expect(mat.map).toBeDefined();
    expect(mat.alphaMap).toBeDefined();
  });

  test("Phase 2F: textured writer with only map (no alphaMap) still gets alphaTest", () => {
    const tex: W3DTextureData = {
      kind: "Texture", id: "t-id", name: "T.png", filename: "T.png", folderPath: "",
    };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "t-id", isEmissive: false, useMipMapping: false },
    };
    const ctx = makeCtx({
      registry: {
        baseMaterials: new Map(),
        textures: new Map([["t-id", tex]]),
        textureLayers: new Map([["L", layer]]),
        dynamicTextureFilenameByLayerId: new Map(),
      },
      textureUrlsByFilename: new Map([["T.png", "blob:t"]]),
    });
    const dummy = quadData({
      id: "d", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false },
    });
    const root = buildNodeTree([dummy], ctx);
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.map).toBeDefined();
    expect(mat.alphaMap).toBeNull();
    expect(mat.alphaTest).toBeCloseTo(0.5, 5);
  });

  test("Phase 2F: PHOTO_MASK-like writer (no texture, DisableBinaryAlpha=False) keeps alphaTest=0", () => {
    // PHOTO_MASK_0X uses TextureLayer="Standard" — no map, no alphaMap.
    // alphaTest must remain at the default (0) so the stencil follows the full
    // geometric quad.
    const mask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([mask], ctx);
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.colorWrite).toBe(false);
    expect(mat.alphaTest).toBe(0);   // default
    expect(mat.map).toBeNull();
    expect(mat.alphaMap).toBeNull();
  });

  test("Phase 2F: textured writer but DisableBinaryAlpha=False → alphaTest stays at default 0", () => {
    // Defensive: a future mask with a texture but the binary-alpha flag NOT
    // set must keep authored binary semantics (no alphaTest). Equivalent to
    // a geometric rectangle stencil.
    const tex: W3DTextureData = {
      kind: "Texture", id: "t-id", name: "T.png", filename: "T.png", folderPath: "",
    };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "t-id", isEmissive: false, useMipMapping: false },
    };
    const ctx = makeCtx({
      registry: {
        baseMaterials: new Map(),
        textures: new Map([["t-id", tex]]),
        textureLayers: new Map([["L", layer]]),
        dynamicTextureFilenameByLayerId: new Map(),
      },
      textureUrlsByFilename: new Map([["T.png", "blob:t"]]),
    });
    const dummy = quadData({
      id: "d", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false },
    });
    const root = buildNodeTree([dummy], ctx);
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.map).toBeDefined();
    expect(mat.alphaTest).toBe(0); // not set because flag is False
  });

  test("Phase 2F: PHOTO_DUMMY writer still has colorWrite=false and stencilWrite=true", () => {
    // Anti-regression — alphaTest must not flip colorWrite or stencilWrite.
    const tex: W3DTextureData = {
      kind: "Texture", id: "t-id", name: "T.png", filename: "T.png", folderPath: "",
    };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "t-id", isEmissive: false, useMipMapping: false },
    };
    const ctx = makeCtx({
      registry: {
        baseMaterials: new Map(),
        textures: new Map([["t-id", tex]]),
        textureLayers: new Map([["L", layer]]),
        dynamicTextureFilenameByLayerId: new Map(),
      },
      textureUrlsByFilename: new Map([["T.png", "blob:t"]]),
    });
    const dummy = quadData({
      id: "d", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false },
    });
    const root = buildNodeTree([dummy], ctx);
    const mesh = root.children[0] as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.colorWrite).toBe(false);
    expect(mat.stencilWriteMask).toBe(56); // DUMMY_OWNER_FIELD (bits 3-5)
    expect(mesh.renderOrder).toBe(10);
  });

  test("material.needsUpdate = true when map is applied (version incremented)", () => {
    const bgTex: W3DTextureData = {
      kind: "Texture", id: "bg-id", name: "BG.png", filename: "BG.png", folderPath: "",
    };
    const bgLayer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "bg-layer", name: "BACKGROUND", textureBlending: "Multiply",
      mapping: { textureGuid: "bg-id", isEmissive: false, useMipMapping: false },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["bg-id", bgTex]]),
      textureLayers: new Map([["bg-layer", bgLayer]]),
      dynamicTextureFilenameByLayerId: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["BG.png", "blob:fake-bg"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "bg-layer", baseMaterialInherited: false, textureInherited: false } });
    const mesh = buildNode(node, ctx) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    // In Three.js, needsUpdate is a write-only setter that increments mat.version.
    // A freshly constructed material has version=0; after needsUpdate=true it becomes 1.
    expect(mat.version).toBeGreaterThan(0);
  });
});
