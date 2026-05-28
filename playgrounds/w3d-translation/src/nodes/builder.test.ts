// playgrounds/w3d-translation/src/nodes/builder.test.ts
import { describe, expect, test } from "vitest";
import { Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
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
    fontStyles: new Map(),
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
      fontStyles: new Map(),
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
      fontStyles: new Map(),
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

  test("Phase H2: TextureBlending='Multiply' does NOT change material.blending (stays at Three.js default)", async () => {
    const { NormalBlending, MultiplyBlending } = await import("three");
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
      fontStyles: new Map(),
    };
    const urls = new Map([["BG.png", "blob:fake-bg"]]);
    const ctx = makeCtx({ registry, textureUrlsByFilename: urls });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "bg-layer", baseMaterialInherited: false, textureInherited: false } });
    const mesh = buildNode(node, ctx) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    // R3 Multiply == color × map, which MeshBasicMaterial does at default
    // NormalBlending. THREE.MultiplyBlending is a framebuffer screen-blend
    // and must NOT be used here — see materialResolver.ts doc-comment.
    expect(mat.blending).toBe(NormalBlending);
    expect(mat.blending).not.toBe(MultiplyBlending);
    expect((mesh.userData.w3d as { textureBlending?: string }).textureBlending).toBe("Multiply");
  });

  test("Phase H2: unknown TextureBlending value surfaces in warnings but does not crash", () => {
    const bgTex: W3DTextureData = {
      kind: "Texture", id: "tx", name: "X.png", filename: "X.png", folderPath: "",
    };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "ODD",
      textureBlending: "Add", // not in known set
      mapping: { textureGuid: "tx", keyType: "AlphaKey", isEmissive: false, useMipMapping: false },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["tx", bgTex]]),
      textureLayers: new Map([["L", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["X.png", "blob:url"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false } });
    const mesh = buildNode(node, ctx) as Mesh;
    expect(mesh).toBeDefined();
    expect((mesh.userData.w3d as { textureBlending?: string }).textureBlending).toBe("Add");
    expect(ctx.warnings.some((w) => w.includes('"Add"') && w.includes("not recognised"))).toBe(true);
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
      fontStyles: new Map(),
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
      fontStyles: new Map(),
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

  test("Phase 1a: mask renderOrder (10) is less than client renderOrder (22)", () => {
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
    expect(photoMesh.renderOrder).toBe(22); // Phase A1 — PHOTO_NN default reader (was 20)
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
    expect(mat.stencilWrite).toBe(false); // untouched by Phase 1a — name not in PHOTO_* scope
    // Phase 2D.1 — IsColoredMask=true makes the mesh visible. The stencil
    // writer is still NOT attached (Phase 1a's PHOTO_* name gate stays
    // intact), so this asserts visibility ONLY changed for colored masks
    // and the stencil pipeline is genuinely orthogonal.
    expect(m.visible).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Phase 2D.1 — colored-mask visibility (BASE_MAIN / BASE_TEAM class).
  // R3 carries some IsMask=True nodes that are ALSO meant to render as
  // colored bands (IsColoredMask=True). Pure stencil masks (PHOTO_MASK_0X,
  // PHOTO_DUMMY_0X) stay hidden because they carry IsColoredMask=False.
  // -----------------------------------------------------------------------

  test("Phase 2D.1: IsMask=true + IsColoredMask=true + non-PHOTO name → mesh visible when enable=true", () => {
    const baseMain = quadData({
      id: "base-main", name: "BASE_MAIN", enable: true, isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const root = buildNodeTree([baseMain], makeCtx());
    const m = root.children[0] as Mesh;
    expect(m.visible).toBe(true);
  });

  test("Phase 2D.1: IsMask=true + IsColoredMask=false → mesh hidden (pure stencil mask)", () => {
    const pureMask = quadData({
      id: "p", name: "SOME_STENCIL_ONLY", enable: true, isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const root = buildNodeTree([pureMask], makeCtx());
    const m = root.children[0] as Mesh;
    expect(m.visible).toBe(false);
  });

  test("Phase 2D.1: IsMask=true + IsColoredMask=true + Enable=false → mesh hidden (enable always wins)", () => {
    const disabled = quadData({
      id: "d", name: "BASE_MAIN", enable: false, isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const root = buildNodeTree([disabled], makeCtx());
    const m = root.children[0] as Mesh;
    expect(m.visible).toBe(false);
  });

  test("Phase 2D.1 regression: PHOTO_MASK_01 / PHOTO_DUMMY_01 (IsColoredMask=false) stay hidden as stencil writers", () => {
    const photoMask = quadData({
      id: "mask-1", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photoDummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([photoMask, photoDummy], ctx);
    const maskMesh = root.children[0] as Mesh;
    const dummyMesh = root.children[1] as Mesh;
    // Stencil writer branch sets mesh.visible = node.enable (= true here),
    // but stencilDebugShowMask is off and colorWrite is false, so the mesh
    // is effectively invisible despite mesh.visible=true. Confirm both the
    // stencil setup and the "no colored mask visibility" invariant.
    expect((maskMesh.material as MeshBasicMaterial).stencilWrite).toBe(true);
    expect((maskMesh.material as MeshBasicMaterial).colorWrite).toBe(false);
    expect((dummyMesh.material as MeshBasicMaterial).stencilWrite).toBe(true);
    expect((dummyMesh.material as MeshBasicMaterial).colorWrite).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Phase 2D.3 — generic colored-mask stencil writers + clipped clients.
  // Bits 6-7 are reserved for non-PHOTO IsColoredMask=True masks (BASE_MAIN,
  // BASE_TEAM, ...). Disjoint from the Phase 2J PHOTO owner fields.
  // -----------------------------------------------------------------------

  test("Phase 2D.3: BASE_MAIN-like writer WITH a client gets stencilWrite=true AND colorWrite=true", async () => {
    const { AlwaysStencilFunc, ReplaceStencilOp } = await import("three");
    const baseMain = quadData({
      id: "base-main", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const client = quadData({ id: "ff-main", name: "TEXTURE_FULLFRAME_MAIN", maskIds: ["base-main"] });
    const ctx = makeCtx();
    const root = buildNodeTree([baseMain, client], ctx);
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilFunc).toBe(AlwaysStencilFunc);
    expect(mat.stencilZPass).toBe(ReplaceStencilOp);
    expect(mat.colorWrite).toBe(true); // KEY difference from PHOTO_* writers
  });

  test("Phase 2D.3: first generic writer uses ref=64 (1<<6); second uses ref=128 (2<<6)", () => {
    const m1 = quadData({
      id: "base-main", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const m2 = quadData({
      id: "base-team", name: "BASE_TEAM", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const c1 = quadData({ id: "c1", name: "FF_MAIN", maskIds: ["base-main"] });
    const c2 = quadData({ id: "c2", name: "FF_BENCH", maskIds: ["base-team"] });
    const root = buildNodeTree([m1, m2, c1, c2], makeCtx());
    const mat1 = (root.children[0] as Mesh).material as MeshBasicMaterial;
    const mat2 = (root.children[1] as Mesh).material as MeshBasicMaterial;
    expect(mat1.stencilRef).toBe(64);  // 1 << 6
    expect(mat2.stencilRef).toBe(128); // 2 << 6
  });

  test("Phase 2D.3: generic writer writeMask = STENCIL_GENERIC_OWNER_FIELD (0b11000000 = 192)", () => {
    const m1 = quadData({
      id: "base-main", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const client = quadData({ id: "c", name: "FF", maskIds: ["base-main"] });
    const root = buildNodeTree([m1, client], makeCtx());
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilWriteMask).toBe(0b11000000); // 192
  });

  test("Phase 2D.3: generic field is disjoint from PHOTO_MASK and PHOTO_DUMMY fields", () => {
    const photoMask = quadData({
      id: "pmask", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photoDummy = quadData({
      id: "pdummy", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const baseMain = quadData({
      id: "bmain", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const client = quadData({ id: "c", name: "FF", maskIds: ["bmain"] });
    const root = buildNodeTree([photoMask, photoDummy, baseMain, client], makeCtx());
    const pMaskMat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    const pDummyMat = (root.children[1] as Mesh).material as MeshBasicMaterial;
    const genMat = (root.children[2] as Mesh).material as MeshBasicMaterial;
    // All three writer writeMasks are mutually disjoint.
    expect(pMaskMat.stencilWriteMask & pDummyMat.stencilWriteMask).toBe(0);
    expect(pMaskMat.stencilWriteMask & genMat.stencilWriteMask).toBe(0);
    expect(pDummyMat.stencilWriteMask & genMat.stencilWriteMask).toBe(0);
    // And union covers bits 0-7 used so far.
    expect(pMaskMat.stencilWriteMask | pDummyMat.stencilWriteMask | genMat.stencilWriteMask).toBe(0b11111111);
  });

  test("Phase 2D.3: generic reader (MaskId=BASE_MAIN, IsInvertedMask=True) → Equal func, ref=64, funcMask=0b11000000", async () => {
    const { EqualStencilFunc, KeepStencilOp } = await import("three");
    const baseMain = quadData({
      id: "base-main", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const client = quadData({ id: "ff-main", name: "TEXTURE_FULLFRAME_MAIN", maskIds: ["base-main"] });
    const root = buildNodeTree([baseMain, client], makeCtx());
    const mat = (root.children[1] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilFunc).toBe(EqualStencilFunc);
    expect(mat.stencilRef).toBe(64);
    expect(mat.stencilFuncMask).toBe(0b11000000); // 192
    expect(mat.stencilFail).toBe(KeepStencilOp);
    expect(mat.stencilZFail).toBe(KeepStencilOp);
    expect(mat.stencilZPass).toBe(KeepStencilOp);
    expect(mat.depthTest).toBe(false);
  });

  test("Phase 2D.3: generic reader's ref/funcMask does NOT touch PHOTO bits", () => {
    const baseMain = quadData({
      id: "bmain", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const client = quadData({ id: "c", name: "FF", maskIds: ["bmain"] });
    const root = buildNodeTree([baseMain, client], makeCtx());
    const mat = (root.children[1] as Mesh).material as MeshBasicMaterial;
    // ref and funcMask only have bits inside the generic field (6-7).
    expect(mat.stencilRef & 0b00111111).toBe(0);     // no PHOTO bits set
    expect(mat.stencilFuncMask & 0b00111111).toBe(0); // PHOTO fields not queried
  });

  test("Phase 2D.3: mixed PHOTO_DUMMY + generic reader combines bits without contamination", () => {
    // A hypothetical client with maskIds=[PHOTO_DUMMY_01, BASE_MAIN] should
    // emit ref = (1<<3) | (1<<6) = 8 | 64 = 72 and funcMask = 0b00111000 |
    // 0b11000000 = 0b11111000. Each field is tested independently.
    const photoDummy = quadData({
      id: "pdummy", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const baseMain = quadData({
      id: "bmain", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const mixedClient = quadData({ id: "c", name: "MIXED", maskIds: ["pdummy", "bmain"] });
    const root = buildNodeTree([photoDummy, baseMain, mixedClient], makeCtx());
    const mat = (root.children[2] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilRef).toBe(72);            // (1<<3) | (1<<6)
    expect(mat.stencilFuncMask).toBe(0b11111000); // DUMMY | GENERIC
  });

  test("Phase 2D.3: 4th generic mask gets warning and skipped (limit = 3)", () => {
    const mk = (id: string, name: string) => quadData({
      id, name, isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const clientFor = (id: string, n: number) => quadData({ id: `c${n}`, name: `C${n}`, maskIds: [id] });
    const ctx = makeCtx();
    const root = buildNodeTree(
      [mk("g1", "G1"), mk("g2", "G2"), mk("g3", "G3"), mk("g4", "G4"),
       clientFor("g1", 1), clientFor("g2", 2), clientFor("g3", 3), clientFor("g4", 4)],
      ctx,
    );
    // First three get stencilWrite=true; fourth does NOT
    expect(((root.children[0] as Mesh).material as MeshBasicMaterial).stencilWrite).toBe(true);
    expect(((root.children[1] as Mesh).material as MeshBasicMaterial).stencilWrite).toBe(true);
    expect(((root.children[2] as Mesh).material as MeshBasicMaterial).stencilWrite).toBe(true);
    expect(((root.children[3] as Mesh).material as MeshBasicMaterial).stencilWrite).toBe(false);
    expect(ctx.warnings.some(w => w.includes("G4") && w.includes("exceeds"))).toBe(true);
  });

  test("Phase 2D.3: generic mask without any client does NOT consume an index", () => {
    const orphan = quadData({
      id: "orphan", name: "ORPHAN_MASK", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    // Three "real" generic masks WITH clients should still get indices 1,2,3
    // (orphan in front does not steal the first slot).
    const g1 = quadData({
      id: "g1", name: "G1", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const c1 = quadData({ id: "c1", name: "C1", maskIds: ["g1"] });
    const root = buildNodeTree([orphan, g1, c1], makeCtx());
    const orphanMat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    const g1Mat = (root.children[1] as Mesh).material as MeshBasicMaterial;
    expect(orphanMat.stencilWrite).toBe(false); // orphan stays as a non-writer
    expect(g1Mat.stencilWrite).toBe(true);
    expect(g1Mat.stencilRef).toBe(64); // index 1, not 2
  });

  test("Phase 2D.3 + A1: first generic writer renderOrder=11, generic-only reader renderOrder=12", () => {
    // Single generic mask (BASE_MAIN) → discovery index 1 → block lanes 11/12/13.
    const baseMain = quadData({
      id: "bmain", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const client = quadData({ id: "c", name: "TEXTURE_FULLFRAME_MAIN", maskIds: ["bmain"] });
    const root = buildNodeTree([baseMain, client], makeCtx());
    const writer = root.children[0] as Mesh;
    const reader = root.children[1] as Mesh;
    expect(writer.renderOrder).toBe(11);
    expect(reader.renderOrder).toBe(12);
    expect(writer.renderOrder).toBeLessThan(reader.renderOrder);
  });

  test("Phase 2D.3 regression: existing 'non-PHOTO_MASK isMask quad' WITHOUT clients still has stencilWrite=false", () => {
    // The orphan-mask path: BASE_MAIN-like quad with NO client should NOT
    // become a generic writer (no index consumed, no stencil setup applied).
    // This mirrors the existing "Phase 1a scope" test invariant.
    const baseMain = quadData({
      id: "bmain", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([baseMain], ctx);
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(false);
    expect((root.children[0] as Mesh).visible).toBe(true); // Phase 2D.1 visibility preserved
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
    // Patch D2 + A1: renderOrder is granular by node name (TEXTURE behind COLOR).
    expect(colorMesh.renderOrder).toBe(21);   // PHOTO_COLOR (was 19)
    expect(textureMesh.renderOrder).toBe(20); // TEXTURE_PHOTO (was 18)
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
    expect(textureMesh.renderOrder).toBe(20); // Phase A1 — TEXTURE_PHOTO (was 18)
    expect(colorMesh.renderOrder).toBe(21);   // Phase A1 — PHOTO_COLOR (was 19)
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
    expect(colorMesh.renderOrder).toBe(21); // Phase A1 — PHOTO_COLOR (was 19)
    expect(photoMesh.renderOrder).toBe(22); // Phase A1 — PHOTO_NN default (was 20)
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

  test("Phase 2F-flow: PLAYERS lays children +X by measuredWidth+leadingSpace, first child at origin", () => {
    // R3 FlowChildren: stride = childWidth + leadingSpace. Equal-width cards
    // (size 2) with leadingSpace -1.26 → stride 0.74. PLAYER_01 anchored at the
    // origin, PLAYER_05 rightmost — visual order left→right preserved.
    const mk = (i: number) => quadData({ id: `p${i}`, name: `PLAYER_0${i}`, geometry: { size: { x: 2, y: 1 } } });
    const players = groupData({
      id: "players", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
      children: [mk(1), mk(2), mk(3), mk(4), mk(5)],
    });
    const root = buildNodeTree([players]);
    const playersGroup = root.children[0] as Group;
    const stride = 2 + (-1.26); // 0.74
    expect(playersGroup.children[0].position.x).toBeCloseTo(0, 5);          // PLAYER_01 at origin
    expect(playersGroup.children[1].position.x).toBeCloseTo(stride, 5);     // 0.74
    expect(playersGroup.children[2].position.x).toBeCloseTo(2 * stride, 5); // 1.48
    expect(playersGroup.children[3].position.x).toBeCloseTo(3 * stride, 5); // 2.22
    expect(playersGroup.children[4].position.x).toBeCloseTo(4 * stride, 5); // 2.96
    // Visual order strictly left→right.
    const xs = playersGroup.children.map((c) => c.position.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  test("Phase 2F-flow: PLAYERS flow is additive on authored child X; node data and leadingSpace not mutated", () => {
    const transform = () => ({
      position: { x: 0.5, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    const p1 = quadData({ id: "p1", name: "PLAYER_01", geometry: { size: { x: 2, y: 1 } }, transform: transform() });
    const p2 = quadData({ id: "p2", name: "PLAYER_02", geometry: { size: { x: 2, y: 1 } }, transform: transform() });
    const players = groupData({
      id: "players", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
      children: [p1, p2],
    });
    const root = buildNodeTree([players]);
    const g = root.children[0] as Group;
    const stride = 2 + (-1.26); // 0.74
    // child[0] = authored 0.5 + cursor 0; child[1] = authored 0.5 + stride.
    expect(g.children[0].position.x).toBeCloseTo(0.5, 5);
    expect(g.children[1].position.x).toBeCloseTo(0.5 + stride, 5);
    // Node data is never mutated by layout (only the built Object3D moves).
    expect(p1.transform.position.x).toBe(0.5);
    expect(p2.transform.position.x).toBe(0.5);
    // LeadingSpace value stays authored.
    expect(players.flow!.leadingSpace).toBe(-1.26);
  });

  test("Phase G: flow is applied generically regardless of group name (no PLAYERS gate)", () => {
    // BENCH_LIST authors FlowChildren=True Direction=YMinus LeadingSpace=-0.084
    // FlowChildrenAlignment=Trailing in the real fixture. Phase G removes the
    // PLAYERS-only gate so any flow-flagged group is laid out.
    const mk = (i: number) => quadData({
      id: `b${i}`, name: `BENCH_PLAYER_0${i}`, geometry: { size: { x: 2, y: 0.4 } },
      transform: { position: { x: 9, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const bench = groupData({
      id: "bench", name: "BENCH_LIST",
      flow: { children: true, leadingSpace: -0.084, direction: "YMinus", alignment: "Trailing" },
      children: [mk(1), mk(2), mk(3)],
    });
    const root = buildNodeTree([bench]);
    const g = root.children[0] as Group;
    // YMinus: cursor advances -Y by (childHeight + leadingSpace) per child.
    // Height = 0.4, LeadingSpace = -0.084 → stride = -(0.4 + (-0.084)) = -0.316.
    const stride = -(0.4 + (-0.084)); // -0.316
    expect(g.children[0].position.y).toBeCloseTo(0, 5);
    expect(g.children[1].position.y).toBeCloseTo(stride, 5);
    expect(g.children[2].position.y).toBeCloseTo(2 * stride, 5);
    // Phase P2 — FlowChildrenAlignment="Trailing" is applied as a cross-axis
    // shift. With equal-width siblings (all 2 wide here), the per-child delta
    // (maxCross - ownCross) is 0 → no shift, authored X=9 preserved. The real
    // BENCH_LIST in LINEUP_LEFT also uses equal-width slot geometry, so this
    // matches both the test fixture and the corpus's no-shift outcome.
    expect(g.children[0].position.x).toBeCloseTo(9, 5);
    expect(g.children[1].position.x).toBeCloseTo(9, 5);
    expect(g.children[2].position.x).toBeCloseTo(9, 5);
  });

  test("Phase G: YMinus without alignment leaves cross-axis untouched (positive LeadingSpace = gap)", () => {
    const mk = (i: number) => quadData({ id: `r${i}`, name: `ROW_0${i}`, geometry: { size: { x: 2, y: 0.4 } } });
    const stack = groupData({
      id: "stack", name: "STACK",
      flow: { children: true, leadingSpace: 0.1, direction: "YMinus" },
      children: [mk(1), mk(2)],
    });
    const root = buildNodeTree([stack]);
    const g = root.children[0] as Group;
    // stride = -(0.4 + 0.1) = -0.5
    expect(g.children[0].position.y).toBeCloseTo(0, 5);
    expect(g.children[1].position.y).toBeCloseTo(-0.5, 5);
    // Cross-axis untouched (no alignment): authored X=0 preserved.
    expect(g.children[0].position.x).toBe(0);
    expect(g.children[1].position.x).toBe(0);
  });

  test("Phase P2: Center alignment shifts narrower siblings by (maxCross - ownCross)/2", () => {
    // c1 cross-extent (X) = 2; c2 cross-extent = 1. maxCross = 2.
    // c1 delta = 0 → no shift, X stays 0.5.
    // c2 delta = 1 → shift = 0.5 → X moves from 0.5 to 1.0.
    const c1 = quadData({
      id: "c1", name: "C1", geometry: { alignmentX: "Left", size: { x: 2, y: 0.4 } },
      transform: { position: { x: 0.5, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const c2 = quadData({
      id: "c2", name: "C2", geometry: { alignmentX: "Left", size: { x: 1, y: 0.4 } },
      transform: { position: { x: 0.5, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const stack = groupData({
      id: "stack", name: "STACK",
      flow: { children: true, leadingSpace: 0, direction: "YMinus", alignment: "Center" },
      children: [c1, c2],
    });
    const root = buildNodeTree([stack]);
    const g = root.children[0] as Group;
    expect(g.children[0].position.x).toBeCloseTo(0.5, 5);
    expect(g.children[1].position.x).toBeCloseTo(1.0, 5);
    expect((g.userData.w3d as { flow?: { alignment?: string } } | undefined)?.flow?.alignment).toBe("Center");
  });

  test("Phase P2: Trailing alignment shifts narrower siblings by (maxCross - ownCross)", () => {
    // Three YMinus stack children with mixed cross-extents (X widths 2, 1, 1.5).
    // maxCross = 2. Per-child deltas: 0, 1, 0.5 → Trailing shifts narrower
    // children rightward so their trailing edges line up with the widest's.
    const c1 = quadData({
      id: "c1", name: "C1", geometry: { alignmentX: "Left", size: { x: 2, y: 0.4 } },
      transform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const c2 = quadData({
      id: "c2", name: "C2", geometry: { alignmentX: "Left", size: { x: 1, y: 0.4 } },
      transform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const c3 = quadData({
      id: "c3", name: "C3", geometry: { alignmentX: "Left", size: { x: 1.5, y: 0.4 } },
      transform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const stack = groupData({
      id: "stack", name: "STACK",
      flow: { children: true, leadingSpace: 0, direction: "YMinus", alignment: "Trailing" },
      children: [c1, c2, c3],
    });
    const root = buildNodeTree([stack]);
    const g = root.children[0] as Group;
    expect(g.children[0].position.x).toBeCloseTo(0, 5);    // widest, delta=0
    expect(g.children[1].position.x).toBeCloseTo(1, 5);    // delta=1, full shift
    expect(g.children[2].position.x).toBeCloseTo(0.5, 5);  // delta=0.5, full shift
  });

  test("Phase P2: Leading (default / unspecified) preserves authored cross-axis positions", () => {
    const c1 = quadData({
      id: "c1", name: "C1", geometry: { alignmentX: "Left", size: { x: 2, y: 0.4 } },
      transform: { position: { x: 0.5, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const c2 = quadData({
      id: "c2", name: "C2", geometry: { alignmentX: "Left", size: { x: 1, y: 0.4 } },
      transform: { position: { x: 0.5, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const stack = groupData({
      id: "stack", name: "STACK",
      // No alignment authored → defaults to Leading (no-op).
      flow: { children: true, leadingSpace: 0, direction: "YMinus" },
      children: [c1, c2],
    });
    const root = buildNodeTree([stack]);
    const g = root.children[0] as Group;
    expect(g.children[0].position.x).toBeCloseTo(0.5, 5);
    expect(g.children[1].position.x).toBeCloseTo(0.5, 5);
  });

  test("Phase P2: XPlus + Center uses Y as cross axis", () => {
    // Row across X: cross axis = Y. Mixed Y heights 1, 0.5 → maxCross=1.
    // c2 delta = 0.5, Center shift = 0.25 → Y moves from 0 to +0.25.
    const c1 = quadData({
      id: "c1", name: "C1", geometry: { alignmentX: "Left", alignmentY: "Bottom", size: { x: 1, y: 1 } },
      transform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const c2 = quadData({
      id: "c2", name: "C2", geometry: { alignmentX: "Left", alignmentY: "Bottom", size: { x: 1, y: 0.5 } },
      transform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const row = groupData({
      id: "row", name: "ROW",
      flow: { children: true, leadingSpace: 0, direction: "XPlus", alignment: "Center" },
      children: [c1, c2],
    });
    const root = buildNodeTree([row]);
    const g = root.children[0] as Group;
    // Main axis (X) advances by stride 1+0=1.
    expect(g.children[0].position.x).toBeCloseTo(0, 5);
    expect(g.children[1].position.x).toBeCloseTo(1, 5);
    // Cross axis (Y) center shift on c2: delta=0.5, /2=0.25.
    expect(g.children[0].position.y).toBeCloseTo(0, 5);
    expect(g.children[1].position.y).toBeCloseTo(0.25, 5);
  });

  test("Phase P2: explicit alignment='Leading' is a cross-axis no-op", () => {
    const c1 = quadData({ id: "c1", name: "C1", geometry: { alignmentX: "Left", size: { x: 2, y: 0.4 } } });
    const c2 = quadData({ id: "c2", name: "C2", geometry: { alignmentX: "Left", size: { x: 1, y: 0.4 } } });
    const stack = groupData({
      id: "stack", name: "STACK",
      flow: { children: true, leadingSpace: 0, direction: "YMinus", alignment: "Leading" },
      children: [c1, c2],
    });
    const root = buildNodeTree([stack]);
    const g = root.children[0] as Group;
    expect(g.children[0].position.x).toBeCloseTo(0, 5);
    expect(g.children[1].position.x).toBeCloseTo(0, 5);
  });

  test("Phase P2: BENCH_LIST-shaped fixture — equal-width siblings under Trailing keep X positions (no false shifts)", () => {
    // Mirrors the real LINEUP_LEFT BENCH_LIST geometry: 10 equal-width slots
    // (here we use 3 for the test) authored at the same X. With Trailing
    // alignment and equal extents the per-child delta is 0 — exactly the
    // BENCH_LIST snapshot's expected outcome.
    const mk = (i: number) => quadData({
      id: `b${i}`, name: `BENCH_PLAYER_0${i}`, geometry: { alignmentX: "Left", size: { x: 0.86, y: 0.15 } },
      transform: { position: { x: 7.15, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const bench = groupData({
      id: "bench", name: "BENCH_LIST",
      flow: { children: true, leadingSpace: -0.084, direction: "YMinus", alignment: "Trailing" },
      children: [mk(1), mk(2), mk(3)],
    });
    const root = buildNodeTree([bench]);
    const g = root.children[0] as Group;
    // All children share max-X (=7.15+0.86 = 8.01 for AlignmentX=Left at X=7.15).
    expect(g.children[0].position.x).toBeCloseTo(7.15, 5);
    expect(g.children[1].position.x).toBeCloseTo(7.15, 5);
    expect(g.children[2].position.x).toBeCloseTo(7.15, 5);
    // Main-axis stacking preserved.
    const stride = -(0.15 + (-0.084));
    expect(g.children[0].position.y).toBeCloseTo(0, 5);
    expect(g.children[1].position.y).toBeCloseTo(stride, 5);
    expect(g.children[2].position.y).toBeCloseTo(2 * stride, 5);
  });

  test("Phase G: XMinus reverses cursor sign (right→left)", () => {
    const mk = (i: number) => quadData({ id: `p${i}`, name: `P_${i}`, geometry: { size: { x: 2, y: 1 } } });
    const row = groupData({
      id: "row", name: "ROW",
      flow: { children: true, leadingSpace: 0, direction: "XMinus" },
      children: [mk(1), mk(2), mk(3)],
    });
    const root = buildNodeTree([row]);
    const g = root.children[0] as Group;
    // stride = -(2 + 0) = -2; first child at origin, others at -2, -4.
    expect(g.children[0].position.x).toBeCloseTo(0, 5);
    expect(g.children[1].position.x).toBeCloseTo(-2, 5);
    expect(g.children[2].position.x).toBeCloseTo(-4, 5);
  });

  test("Phase G: flow.children=false group is not distributed (FlowChildren must be true)", () => {
    // GeometryOptions present with Direction/Alignment but FlowChildren absent or False.
    const c1 = quadData({ id: "c1", name: "C1", geometry: { size: { x: 1, y: 1 } } });
    const c2 = quadData({ id: "c2", name: "C2", geometry: { size: { x: 1, y: 1 } } });
    const g = groupData({
      id: "g", name: "G",
      flow: { children: false, direction: "YMinus", alignment: "Center" },
      children: [c1, c2],
    });
    const root = buildNodeTree([g]);
    const built = root.children[0] as Group;
    // No flow distribution applied.
    expect(built.children[0].position.x).toBe(0);
    expect(built.children[0].position.y).toBe(0);
    expect(built.children[1].position.x).toBe(0);
    expect(built.children[1].position.y).toBe(0);
  });

  test("Phase G: group without flow attribute is unchanged (no layout pass runs)", () => {
    const c1 = quadData({ id: "c1", name: "C1", geometry: { size: { x: 1, y: 1 } } });
    const c2 = quadData({ id: "c2", name: "C2", geometry: { size: { x: 1, y: 1 } } });
    const g = groupData({
      id: "g", name: "ANY_GROUP",
      children: [c1, c2], // no flow
    });
    const root = buildNodeTree([g]);
    const built = root.children[0] as Group;
    expect(built.children[0].position.x).toBe(0);
    expect(built.children[1].position.x).toBe(0);
    expect(built.children[0].position.y).toBe(0);
    expect(built.children[1].position.y).toBe(0);
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

  // -----------------------------------------------------------------------
  // Phase 2B — NodeTransform Pivot (R3 "Absolute" anchor semantics).
  //
  // Builder applies M = T(position) × R × S × T(-pivot): the outer Group
  // carries position/rotation/scale; an inner Group at -pivot is inserted
  // when pivot is non-zero so the pivot point lands at `position` and
  // rotation/scale apply around it (Maya-style anchor). All tests below use
  // pivot via groupData/quadData transform overrides — fixtures without
  // pivot must continue to skip the wrapper entirely.
  // -----------------------------------------------------------------------

  test("Phase 2B: Group without pivot has no inner anchor wrapper (regression)", () => {
    const g = groupData({ id: "no-pivot", name: "G_NO_PIVOT", children: [
      groupData({ id: "child", name: "CHILD" }),
    ] });
    const root = buildNodeTree([g]);
    const outer = root.children[0] as Group;
    // outer.children should be the actual child Group, NOT a synthetic
    // "(pivot)" wrapper — confirms the no-pivot path is unchanged.
    expect(outer.children).toHaveLength(1);
    expect((outer.children[0] as Group).name).toBe("CHILD");
  });

  test("Phase 2B: Group with non-zero Pivot wraps via outer.position += pivot + inner at -pivot", () => {
    const g = groupData({
      id: "with-pivot", name: "PLAYER_01",
      transform: {
        position: { x: 0, y: -3.5, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        pivot: { x: 0, y: -1.4, z: 0 },
      },
      children: [groupData({ id: "child", name: "CHILD" })],
    });
    const root = buildNodeTree([g]);
    const outer = root.children[0] as Group;
    // Formula B: outer.position = position + pivot = (0, -4.9, 0).
    expect(outer.position.x).toBeCloseTo(0, 5);
    expect(outer.position.y).toBeCloseTo(-4.9, 5);
    expect(outer.position.z).toBeCloseTo(0, 5);
    expect(outer.children).toHaveLength(1);
    const inner = outer.children[0] as Group;
    expect(inner.name).toBe("PLAYER_01 (pivot)");
    // inner.position = -pivot. With R=I and S=I the outer's +pivot cancels
    // exactly with inner's -pivot, so pivot has zero net visual effect.
    expect(inner.position.x).toBeCloseTo(0, 5);
    expect(inner.position.y).toBeCloseTo(1.4, 5);
    expect(inner.position.z).toBeCloseTo(0, 5);
    expect(inner.children).toHaveLength(1);
    expect((inner.children[0] as Group).name).toBe("CHILD");
  });

  test("Phase 2B: PLAYER_01-like fixture — pivot Y=-1.4, position Y=-3.5, scale 0.95 → child world Y = position + (1−S)×pivot = -3.57", async () => {
    // Formula B world-space: a child authored at local origin in PLAYER_01
    // lands at position.y + (1 − S.y) × pivot.y = -3.5 + 0.05 × (-1.4) = -3.57.
    // The visual shift relative to no-pivot is (1−S) × pivot — TINY for
    // S≈1, which is exactly what "rotate/scale around the pivot" means.
    const child = groupData({ id: "c", name: "CHILD" });
    const player = groupData({
      id: "p1", name: "PLAYER_01",
      transform: {
        position: { x: 0, y: -3.5, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.85 },
        pivot: { x: 0, y: -1.4, z: 0 },
      },
      children: [child],
    });
    const { Vector3 } = await import("three");
    const root = buildNodeTree([player]);
    const outer = root.children[0] as Group;
    const inner = outer.children[0] as Group;
    const c = inner.children[0] as Group;
    outer.updateMatrixWorld(true);
    const world = c.getWorldPosition(new Vector3());
    expect(world.x).toBeCloseTo(0, 5);
    expect(world.y).toBeCloseTo(-3.57, 5);
    expect(world.z).toBeCloseTo(0, 5);
  });

  test("Phase 2B: PLAYER_01-like fixture — the pivot point lands at position + pivot in world", async () => {
    // Formula B: pivot in local space maps to position + pivot in parent
    // (PLAYERS is at root here, so parent == world). For PLAYER_01 with
    // position Y=-3.5 and pivot Y=-1.4, the pivot lands at world Y=-4.9.
    const childAtPivot = groupData({
      id: "ap", name: "ANCHOR",
      transform: {
        position: { x: 0, y: -1.4, z: 0 }, // = pivot
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });
    const player = groupData({
      id: "p1", name: "PLAYER_01",
      transform: {
        position: { x: 0, y: -3.5, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.85 },
        pivot: { x: 0, y: -1.4, z: 0 },
      },
      children: [childAtPivot],
    });
    const { Vector3 } = await import("three");
    const root = buildNodeTree([player]);
    const outer = root.children[0] as Group;
    const inner = outer.children[0] as Group;
    const anchor = inner.children[0] as Group;
    outer.updateMatrixWorld(true);
    const world = anchor.getWorldPosition(new Vector3());
    expect(world.x).toBeCloseTo(0, 5);
    expect(world.y).toBeCloseTo(-4.9, 5); // position + pivot
    expect(world.z).toBeCloseTo(0, 5);
  });

  test("Phase 2B: PLAYER_02-like Pivot X=1.29 Y=-1.4 — outer.position += pivot, inner at -pivot", () => {
    const player = groupData({
      id: "p2", name: "PLAYER_02",
      transform: {
        position: { x: 0, y: -3.5, z: -5 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.85 },
        pivot: { x: 1.29, y: -1.4, z: 0 },
      },
      children: [groupData({ id: "c", name: "CHILD" })],
    });
    const root = buildNodeTree([player]);
    const outer = root.children[0] as Group;
    const inner = outer.children[0] as Group;
    expect(inner.name).toBe("PLAYER_02 (pivot)");
    expect(inner.position.x).toBeCloseTo(-1.29, 5);
    expect(inner.position.y).toBeCloseTo(1.4, 5);
    expect(inner.position.z).toBeCloseTo(0, 5);
    // Formula B: outer.position = position + pivot = (1.29, -4.9, -5).
    expect(outer.position.x).toBeCloseTo(1.29, 5);
    expect(outer.position.y).toBeCloseTo(-4.9, 5);
    expect(outer.position.z).toBeCloseTo(-5, 5);
  });

  test("Phase 2B: pivot with all-zero values does NOT insert an inner wrapper", () => {
    const g = groupData({
      id: "zp", name: "ZERO_PIVOT",
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        pivot: { x: 0, y: 0, z: 0 }, // explicit zero pivot
      },
      children: [groupData({ id: "c", name: "CHILD" })],
    });
    const root = buildNodeTree([g]);
    const outer = root.children[0] as Group;
    expect(outer.children).toHaveLength(1);
    expect((outer.children[0] as Group).name).toBe("CHILD"); // direct child, no wrapper
  });

  test("Phase 2F-flow: PLAYERS FlowChildren + PLAYER_0X Pivot compose — left→right order, per-player anchor applies", () => {
    // PLAYERS has no pivot and FlowChildren=true (leadingSpace=-1.26). Each
    // PLAYER_0X has Pivot Y=-1.4 and a measurable card child. FlowChildren must
    // lay them out +X by (cardWidth + leadingSpace) from the origin, and each
    // PLAYER_0X must independently get its own inner pivot anchor.
    const mk = (i: number) => groupData({
      id: `p${i}`, name: `PLAYER_0${i}`,
      transform: {
        position: { x: 0, y: -3.5, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        pivot: { x: 0, y: -1.4, z: 0 },
      },
      children: [quadData({ id: `c${i}`, name: `CARD_0${i}`, geometry: { size: { x: 2, y: 1 } } })],
    });
    const players = groupData({
      id: "PLAYERS", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
      children: [mk(1), mk(2), mk(3), mk(4), mk(5)],
    });
    const root = buildNodeTree([players]);
    const playersGroup = root.children[0] as Group;
    expect(playersGroup.children).toHaveLength(5);
    // First child at origin; subsequent advance by stride = width(2) + (-1.26).
    const stride = 2 + (-1.26); // 0.74 (player scale 1)
    const xs = playersGroup.children.map((c) => c.position.x);
    expect(xs[0]).toBeCloseTo(0, 5);
    expect(xs[4]).toBeCloseTo(4 * stride, 5);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]); // left→right
    // Each PLAYER outer must contain its own pivot inner.
    for (const playerOuter of playersGroup.children) {
      const inner = (playerOuter as Group).children[0] as Group;
      expect(inner.name).toBe(`${playerOuter.name} (pivot)`);
      expect(inner.position.x).toBeCloseTo(0, 5);
      expect(inner.position.y).toBeCloseTo(1.4, 5);
      expect(inner.position.z).toBeCloseTo(0, 5);
    }
  });

  test("Phase 2B: pivot with scale near 1 does NOT shift visual content by full -pivot (Formula B guarantee)", async () => {
    // Regression guard against Formula A. The Pivot must NOT be applied as a
    // direct -pivot translation when rotation=identity and scale≈1. With
    // Formula B the shift is (1 - S) × pivot, which is tiny for S=0.95.
    // For a 3D Pivot (1.29, -1.4, 0): visual shift must be ≤ 0.1 per axis.
    const child = groupData({ id: "c", name: "CHILD" });
    const player = groupData({
      id: "p2", name: "PLAYER_02",
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.85 },
        pivot: { x: 1.29, y: -1.4, z: 0 },
      },
      children: [child],
    });
    const { Vector3 } = await import("three");
    const root = buildNodeTree([player]);
    const outer = root.children[0] as Group;
    const inner = outer.children[0] as Group;
    const c = inner.children[0] as Group;
    outer.updateMatrixWorld(true);
    const world = c.getWorldPosition(new Vector3());
    // (1 - S) × pivot, axis by axis.
    expect(world.x).toBeCloseTo(0.05 * 1.29, 5); // ≈ +0.0645, NOT -0.95×1.29 = -1.22
    expect(world.y).toBeCloseTo(0.05 * -1.4, 5); // ≈ -0.07, NOT +0.95×1.4 = +1.33
    expect(world.z).toBeCloseTo(0, 5);
    // Smaller-than-tenth guard: visual content must stay within 0.1 per axis
    // of the (no-pivot) position when scale≈1. This is the property the user
    // asked to enforce.
    expect(Math.abs(world.x)).toBeLessThan(0.1);
    expect(Math.abs(world.y)).toBeLessThan(0.1);
  });

  test("Phase 2F-flow: PLAYER_02 pivot X=1.29 stays in its own slot, not overlapping PLAYER_01", async () => {
    // Stride = measuredWidth (card 2 × player scale 0.95 = 1.9) + leadingSpace
    // (-1.26) = 0.64. PLAYER_02 content lands at stride + Formula-B shift
    // (1-0.95)×1.29 ≈ +0.0645 → dx ≈ 0.7045 from PLAYER_01. Pivot must not
    // collapse the slot.
    const mk = (i: number, pivotX: number) => groupData({
      id: `p${i}`, name: `PLAYER_0${i}`,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.85 },
        pivot: { x: pivotX, y: -1.4, z: 0 },
      },
      children: [quadData({ id: `c${i}`, name: `CARD_0${i}`, geometry: { size: { x: 2, y: 1 } } })],
    });
    const players = groupData({
      id: "PLAYERS", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
      children: [mk(1, 0), mk(2, 1.29), mk(3, 0), mk(4, 0), mk(5, 0)],
    });
    const { Vector3 } = await import("three");
    const root = buildNodeTree([players]);
    root.updateMatrixWorld(true);
    const p1Card = (((root.children[0] as Group).children[0] as Group).children[0] as Group).children[0];
    const p2Card = (((root.children[0] as Group).children[1] as Group).children[0] as Group).children[0];
    const w1 = p1Card.getWorldPosition(new Vector3());
    const w2 = p2Card.getWorldPosition(new Vector3());
    const dx = w2.x - w1.x;
    const stride = 1.9 + (-1.26); // measuredWidth (2×0.95) + leadingSpace = 0.64
    expect(dx).toBeGreaterThan(0.5); // Player 02 must not land on top of Player 01
    expect(dx).toBeCloseTo(stride + 0.05 * 1.29, 5); // slot stride + Formula B X shift
  });

  test("Phase 2F-flow: FlowChildren + Pivot — each PLAYER stays in its own slot", async () => {
    // All 5 players, each must remain at the X position FlowChildren assigned
    // (first at origin, +X by stride 0.64), and PLAYER_02 (pivot.x = 1.29) must
    // only deviate by the (1-S)×pivot.x = 0.0645 amount predicted by Formula B.
    const mk = (i: number, pivotX: number) => groupData({
      id: `p${i}`, name: `PLAYER_0${i}`,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.85 },
        pivot: { x: pivotX, y: -1.4, z: 0 },
      },
      children: [quadData({ id: `c${i}`, name: `CARD_0${i}`, geometry: { size: { x: 2, y: 1 } } })],
    });
    const players = groupData({
      id: "PLAYERS", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
      children: [mk(1, 0), mk(2, 1.29), mk(3, 0), mk(4, 0), mk(5, 0)],
    });
    const { Vector3 } = await import("three");
    const root = buildNodeTree([players]);
    root.updateMatrixWorld(true);
    const stride = 1.9 + (-1.26); // 0.64
    const slotX = (i: number) => i * stride; // first child at origin, extending +X
    const expectedShift = [0, 0.05 * 1.29, 0, 0, 0]; // (1-S)×pivot.x for each
    for (let i = 0; i < 5; i++) {
      const inner = ((root.children[0] as Group).children[i] as Group).children[0] as Group;
      const child = inner.children[0];
      const w = child.getWorldPosition(new Vector3());
      expect(w.x).toBeCloseTo(slotX(i) + expectedShift[i], 5);
    }
  });

  test("Phase 2B: maskIds inheritance propagates through the pivot inner anchor", () => {
    // A child with no own maskIds should still inherit the parent Group's
    // effective maskIds, even though it now sits inside a pivot inner.
    const dummy = quadData({
      id: "dummy-1", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const color = quadData({ id: "c1", name: "PHOTO_COLOR_01" });
    const fill = groupData({
      id: "fill-1", name: "PHOTO_FILL_01",
      maskIds: ["dummy-1"],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        pivot: { x: 0, y: -0.5, z: 0 }, // hypothetical pivot on FILL group
      },
      children: [color],
    });
    const ctx = makeCtx();
    const root = buildNodeTree([dummy, fill], ctx);
    const fillOuter = root.children[1] as Group;
    const fillInner = fillOuter.children[0] as Group;
    expect(fillInner.name).toBe("PHOTO_FILL_01 (pivot)");
    const colorMesh = fillInner.children[0] as Mesh;
    const mat = colorMesh.material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true); // stencil setup still ran via inheritance
    expect(mat.stencilRef).toBe(8); // DUMMY owner=1 << 3
  });

  test("Phase 2B: leaf Quad with pivot is wrapped in an outer Group, mesh sits at -pivot", () => {
    const q = quadData({
      id: "lq", name: "LEAF_PIVOT",
      transform: {
        position: { x: 5, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        pivot: { x: 0, y: -0.7, z: 0 },
      },
    });
    const obj = buildNode(q);
    expect(obj).toBeInstanceOf(Group);
    const outer = obj as Group;
    expect(outer.name).toBe("LEAF_PIVOT (pivot wrapper)");
    // Formula B: outer.position = position + pivot = (5+0, 0+(-0.7), 0+0).
    expect(outer.position.x).toBeCloseTo(5, 5);
    expect(outer.position.y).toBeCloseTo(-0.7, 5);
    expect(outer.position.z).toBeCloseTo(0, 5);
    expect(outer.children).toHaveLength(1);
    const mesh = outer.children[0] as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.position.x).toBeCloseTo(0, 5);
    expect(mesh.position.y).toBeCloseTo(0.7, 5); // -pivot
    expect(mesh.position.z).toBeCloseTo(0, 5);
    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
  });

  test("Phase 2B: leaf Quad without pivot returns the Mesh directly (no extra wrapper)", () => {
    const q = quadData({ id: "lq", name: "LEAF_NO_PIVOT" });
    const obj = buildNode(q);
    expect(obj).toBeInstanceOf(Mesh); // no Group wrapper
    expect((obj as Mesh).name).toBe("LEAF_NO_PIVOT");
  });

  test("Phase 2B: Quad-with-children with pivot — mesh + children share the pivot inner anchor", () => {
    const child = quadData({ id: "cq", name: "CHILD_QUAD" });
    const parent = quadData({
      id: "pq", name: "PARENT_QUAD",
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        pivot: { x: 0, y: -0.5, z: 0 },
      },
      children: [child],
    });
    const obj = buildNode(parent);
    expect(obj).toBeInstanceOf(Group);
    const wrapper = obj as Group;
    expect(wrapper.name).toBe("PARENT_QUAD (wrapper)");
    expect(wrapper.children).toHaveLength(1);
    const inner = wrapper.children[0] as Group;
    // Inner name is derived from the wrapper's name (which carries "(wrapper)"
    // for Quad-with-children) — accept the composed name.
    expect(inner.name).toBe("PARENT_QUAD (wrapper) (pivot)");
    expect(inner.position.x).toBeCloseTo(0, 5);
    expect(inner.position.y).toBeCloseTo(0.5, 5);
    expect(inner.position.z).toBeCloseTo(0, 5);
    // Inner holds the parent's own mesh AND the child quad.
    expect(inner.children).toHaveLength(2);
    expect((inner.children[0] as Mesh).name).toBe("PARENT_QUAD");
    expect((inner.children[1] as Mesh).name).toBe("CHILD_QUAD");
  });

  test("Phase 2B: leaf isMask Quad with pivot preserves mesh.visible=false default", () => {
    const q = quadData({
      id: "mq", name: "SOME_MASK", isMask: true,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        pivot: { x: 0, y: -1, z: 0 },
      },
    });
    const obj = buildNode(q);
    const outer = obj as Group;
    const mesh = outer.children[0] as Mesh;
    expect(mesh.visible).toBe(false); // isMask hide default preserved through the wrapper
  });

  test("Phase 2B regression: PHOTO_MASK_05 with no pivot still produces a plain Mesh (no wrapper)", () => {
    // Anti-regression for Phase 2A: PHOTO_MASK_05 must remain a leaf Mesh
    // at root.children[0] so any code that locates it by index keeps working.
    const mask = quadData({
      id: "mask-5", name: "PHOTO_MASK_05", isMask: true,
      geometry: { alignmentX: "Left", size: { x: 1.55, y: 3 } },
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([mask], ctx);
    expect(root.children[0]).toBeInstanceOf(Mesh); // no Group wrapper inserted
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
      fontStyles: new Map(),
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
        fontStyles: new Map(),
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
        fontStyles: new Map(),
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
        fontStyles: new Map(),
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
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["BG.png", "blob:fake-bg"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "bg-layer", baseMaterialInherited: false, textureInherited: false } });
    const mesh = buildNode(node, ctx) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    // In Three.js, needsUpdate is a write-only setter that increments mat.version.
    // A freshly constructed material has version=0; after needsUpdate=true it becomes 1.
    expect(mat.version).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Phase 2C — Texture UV transforms (clone-on-apply, map/alphaMap separate).
  // -----------------------------------------------------------------------

  test("Phase 2C: identity transform reuses cached Texture instance (no clone)", () => {
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "T.png", filename: "T.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false },
      // No offset / scale / rotation / address modes → identity transform.
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["L", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["T.png", "blob:T"]]) });
    const fm = { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false };
    const m1 = buildNode(quadData({ id: "q1", faceMapping: fm }), ctx) as Mesh;
    const m2 = buildNode(quadData({ id: "q2", faceMapping: fm }), ctx) as Mesh;
    const tex1 = (m1.material as MeshBasicMaterial).map;
    const tex2 = (m2.material as MeshBasicMaterial).map;
    expect(tex1).not.toBeNull();
    // Identity → cached singleton reused across materials.
    expect(tex1).toBe(tex2);
    expect(ctx.textureCache.get("blob:T")).toBe(tex1);
  });

  test("Phase 2C: non-identity transform clones the cached Texture (no shared cache mutation)", () => {
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "T.png", filename: "T.png", folderPath: "" };
    const layerWithOffset: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L1", name: "L1", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false },
      offset: { x: -0.07, y: 0 },
    };
    const layerPlain: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L2", name: "L2", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["L1", layerWithOffset], ["L2", layerPlain]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["T.png", "blob:T"]]) });
    const m1 = buildNode(quadData({ id: "q1", faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L1", baseMaterialInherited: false, textureInherited: false } }), ctx) as Mesh;
    const m2 = buildNode(quadData({ id: "q2", faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L2", baseMaterialInherited: false, textureInherited: false } }), ctx) as Mesh;
    const tex1 = (m1.material as MeshBasicMaterial).map!;
    const tex2 = (m2.material as MeshBasicMaterial).map!;
    // Distinct Texture instances — L1 cloned, L2 reused cached singleton.
    expect(tex1).not.toBe(tex2);
    // The cached singleton (used by L2) must remain at identity offset.
    expect(tex2.offset.x).toBe(0);
    expect(tex2.offset.y).toBe(0);
    // Phase 2C.1: W3D Offset X=-0.07 is negated when handed to Three.js.
    expect(tex1.offset.x).toBeCloseTo(0.07, 5);
  });

  test("Phase 2C.1: layer Offset X=-0.07 → material.map.offset.x=+0.07 (W3D→Three.js sign flip)", () => {
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "T.png", filename: "T.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "PHOTO_01", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false },
      offset: { x: -0.07, y: 0 },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["L", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["T.png", "blob:T"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false } });
    const mat = (buildNode(node, ctx) as Mesh).material as MeshBasicMaterial;
    expect(mat.map!.offset.x).toBeCloseTo(0.07, 5); // negated W3D -0.07
    expect(mat.map!.offset.y).toBeCloseTo(0, 5);
  });

  test("Phase 2C: layer Scale X=1.7 Y=0.82 → material.map.repeat = (1.7, 0.82)", () => {
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "PATTERN.png", filename: "PATTERN.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "FF_PHOTO", name: "FF_PHOTO", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: true, useMipMapping: true },
      scale: { x: 1.7, y: 0.82 },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["FF_PHOTO", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["PATTERN.png", "blob:PATTERN"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "FF_PHOTO", baseMaterialInherited: false, textureInherited: false } });
    const mat = (buildNode(node, ctx) as Mesh).material as MeshBasicMaterial;
    expect(mat.map!.repeat.x).toBeCloseTo(1.7, 5);
    expect(mat.map!.repeat.y).toBeCloseTo(0.82, 5);
  });

  test("Phase 2C: layer Rotation Z=45 → material.map.rotation = π/4 (radians)", () => {
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "T.png", filename: "T.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false },
      rotationDeg: 45,
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["L", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["T.png", "blob:T"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false } });
    const mat = (buildNode(node, ctx) as Mesh).material as MeshBasicMaterial;
    expect(mat.map!.rotation).toBeCloseTo(Math.PI / 4, 5);
  });

  test("Phase UV.2b: negative repeat.x (mirror) pivots around texture center (0.5, 0.5)", () => {
    // INVERTED_GRADIENT-shape: Scale X=-1 + Clamp wrap. Center=(0, 0) would
    // collapse to sample the leftmost column under Clamp; center=(0.5, 0.5)
    // produces a real horizontal mirror around the image centre. Used for
    // the BASE_TEAM purple panel fade direction.
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "BASE_GRADIENT.png", filename: "BASE_GRADIENT.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "INV", name: "INVERTED_GRADIENT", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: true, useMipMapping: true,
        textureAddressModeU: "Clamp", textureAddressModeV: "Clamp" },
      scale: { x: -1, y: 1 },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["INV", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["BASE_GRADIENT.png", "blob:BG"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "INV", baseMaterialInherited: false, textureInherited: false } });
    const mat = (buildNode(node, ctx) as Mesh).material as MeshBasicMaterial;
    expect(mat.map!.repeat.x).toBe(-1);
    expect(mat.map!.center.x).toBeCloseTo(0.5, 5);
    expect(mat.map!.center.y).toBeCloseTo(0.5, 5);
  });

  test("Phase UV.2b: rotation alone (positive repeat) keeps center at default corner (0, 0)", () => {
    // FF_MAIN / FF_MAIN_BENCH-shape: small authored rotation, positive
    // repeat. Centre pivot would introduce a symmetric edge-clamp band on
    // both sides (visible "duplicated" pattern). The default corner pivot
    // matches what the user expected — a single-edge clamp band (subtle,
    // barely visible) instead of a doubled artefact.
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "PATTERN.png", filename: "PATTERN.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "FF", name: "FF_MAIN", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: true, useMipMapping: true,
        textureAddressModeU: "Clamp", textureAddressModeV: "Clamp" },
      scale: { x: 1.13, y: 1.13 },
      rotationDeg: -1,
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["FF", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["PATTERN.png", "blob:P"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "FF", baseMaterialInherited: false, textureInherited: false } });
    const mat = (buildNode(node, ctx) as Mesh).material as MeshBasicMaterial;
    expect(mat.map!.repeat.x).toBeCloseTo(1.13, 5);
    expect(mat.map!.rotation).toBeCloseTo(-Math.PI / 180, 5);
    expect(mat.map!.center.x).toBe(0); // pivot remains at corner — rotation does NOT trigger centre
    expect(mat.map!.center.y).toBe(0);
  });

  test("Phase UV.2b: pure offset (no rotation, positive repeat) keeps center at default (0, 0)", () => {
    // PHOTO_NN-shape: Offset X=-0.07, no rotation, no scale flip. Centre stays
    // at default so the existing scaleKey-around-origin behaviour for the
    // alphaMap layer doesn't regress.
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "Player.png", filename: "Player.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "PHOTO", name: "PHOTO_01", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: true, useMipMapping: true,
        textureAddressModeU: "Clamp", textureAddressModeV: "Clamp" },
      offset: { x: -0.07, y: 0 },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["PHOTO", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["Player.png", "blob:P"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "PHOTO", baseMaterialInherited: false, textureInherited: false } });
    const mat = (buildNode(node, ctx) as Mesh).material as MeshBasicMaterial;
    expect(mat.map!.center.x).toBe(0);
    expect(mat.map!.center.y).toBe(0);
    expect(mat.map!.offset.x).toBeCloseTo(0.07, 5);
  });

  test("Phase 2C: OffsetKey Y=-0.2 + ScaleKey Y=0.5 → material.alphaMap independent from map", () => {
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "T.png", filename: "T.png", folderPath: "" };
    const ramp: W3DTextureData = { kind: "Texture", id: "ramp", name: "VERTICAL_RAMP.png", filename: "VERTICAL_RAMP.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "PHOTO_01", textureBlending: "Multiply",
      mapping: { textureGuid: "t", keyGuid: "ramp", keyType: "AlphaKey", isEmissive: false, useMipMapping: false },
      offset: { x: -0.07, y: 0 },
      offsetKey: { y: -0.2 },
      scaleKey: { y: 0.5 },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex], ["ramp", ramp]]),
      textureLayers: new Map([["L", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["T.png", "blob:T"], ["VERTICAL_RAMP.png", "blob:RAMP"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false } });
    const mat = (buildNode(node, ctx) as Mesh).material as MeshBasicMaterial;
    // Phase 2C.1: W3D Offset / OffsetKey are negated when handed to Three.js.
    // map carries the layer's Offset (negated), untouched by OffsetKey/ScaleKey.
    expect(mat.map!.offset.x).toBeCloseTo(0.07, 5);   // negated -0.07
    expect(mat.map!.offset.y).toBeCloseTo(0, 5);
    expect(mat.map!.repeat.y).toBe(1);
    // alphaMap carries OffsetKey (negated)/ScaleKey, untouched by Offset.
    expect(mat.alphaMap!.offset.x).toBeCloseTo(0, 5);
    expect(mat.alphaMap!.offset.y).toBeCloseTo(0.2, 5); // negated -0.2
    expect(mat.alphaMap!.repeat.y).toBeCloseTo(0.5, 5); // ScaleKey NOT negated
    // map and alphaMap must be distinct Texture instances even if cached
    // file URLs differ (here they do — separate Map entries).
    expect(mat.map).not.toBe(mat.alphaMap);
  });

  test('Phase 2C: AddressMode "Repeat" → wrapS=RepeatWrapping on cloned Texture, cached singleton untouched', async () => {
    const { RepeatWrapping, ClampToEdgeWrapping } = await import("three");
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "T.png", filename: "T.png", folderPath: "" };
    const repeatLayer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "Lr", name: "REPEAT", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false, textureAddressModeU: "Repeat" },
    };
    const clampLayer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "Lc", name: "CLAMP", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["Lr", repeatLayer], ["Lc", clampLayer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["T.png", "blob:T"]]) });
    const matRepeat = (buildNode(quadData({ id: "qR", faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "Lr", baseMaterialInherited: false, textureInherited: false } }), ctx) as Mesh).material as MeshBasicMaterial;
    const matClamp = (buildNode(quadData({ id: "qC", faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "Lc", baseMaterialInherited: false, textureInherited: false } }), ctx) as Mesh).material as MeshBasicMaterial;
    expect(matRepeat.map!.wrapS).toBe(RepeatWrapping);
    expect(matRepeat.map!.wrapT).toBe(ClampToEdgeWrapping);
    // Clamp layer is identity → cached singleton must remain at ClampToEdge defaults.
    expect(matClamp.map!.wrapS).toBe(ClampToEdgeWrapping);
    expect(matClamp.map!.wrapT).toBe(ClampToEdgeWrapping);
    // Sanity: the cached singleton must NOT have been mutated by the Repeat layer.
    expect(matClamp.map).toBe(ctx.textureCache.get("blob:T"));
  });

  test('Phase 2C: AddressMode "Mirror" maps to MirroredRepeatWrapping', async () => {
    const { MirroredRepeatWrapping } = await import("three");
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "T.png", filename: "T.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false, textureAddressModeU: "Mirror", textureAddressModeV: "Mirror" },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["L", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["T.png", "blob:T"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false } });
    const mat = (buildNode(node, ctx) as Mesh).material as MeshBasicMaterial;
    expect(mat.map!.wrapS).toBe(MirroredRepeatWrapping);
    expect(mat.map!.wrapT).toBe(MirroredRepeatWrapping);
  });

  test("Phase 2C: applied texture has needsUpdate triggered (version > 0)", () => {
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "T.png", filename: "T.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false },
      offset: { x: -0.07, y: 0 },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map([["t", tex]]),
      textureLayers: new Map([["L", layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx = makeCtx({ registry, textureUrlsByFilename: new Map([["T.png", "blob:T"]]) });
    const node = quadData({ faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false } });
    const mat = (buildNode(node, ctx) as Mesh).material as MeshBasicMaterial;
    expect(mat.map!.version).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // DEV-Inspector — userData enrichment (Phase DEV-Inspector).
  // The builder now attaches enough metadata to each Object3D for the
  // inspector to report identity, transform, geometry, mask, material info
  // without needing extra parsing at click time.
  // -----------------------------------------------------------------------

  test("DEV-Inspector: Group userData carries `flow` when authored (PLAYERS LeadingSpace=-1.26)", () => {
    const players = groupData({
      id: "PLAYERS", name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
    });
    const root = buildNodeTree([players]);
    const g = root.children[0] as Group;
    expect(g.userData.w3d).toMatchObject({
      kind: "Group",
      name: "PLAYERS",
      flow: { children: true, leadingSpace: -1.26 },
    });
  });

  test("DEV-Inspector: Quad wrapper (with children) userData carries full Quad metadata", () => {
    const child = quadData({ id: "c", name: "CHILD" });
    const parent = quadData({
      id: "p", name: "PARENT",
      isMask: true,
      alpha: 0.5,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
      children: [child],
    });
    const obj = buildNode(parent) as Group;
    const w = obj.userData.w3d as Record<string, unknown>;
    expect(w.kind).toBe("Quad");
    expect(w.hasChildren).toBe(true);
    expect(w.isMask).toBe(true);
    expect(w.alpha).toBe(0.5);
    expect((w.maskProperties as { isColoredMask: boolean }).isColoredMask).toBe(true);
    expect(w.geometry).toBeDefined();
    expect(w.transform).toBeDefined();
  });

  test('DEV-Inspector: pivot inner Group is marked as "(pivot helper)" with forNodeId', () => {
    const g = groupData({
      id: "p1", name: "PLAYER_01",
      transform: {
        position: { x: 0, y: -3.5, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        pivot: { x: 0, y: -1.4, z: 0 },
      },
      children: [groupData({ id: "c", name: "CHILD" })],
    });
    const root = buildNodeTree([g]);
    const outer = root.children[0] as Group;
    const inner = outer.children[0] as Group;
    expect(inner.userData.w3d).toMatchObject({
      kind: "(pivot helper)",
      forNodeId: "p1",
    });
  });

  test('DEV-Inspector: leaf-Quad pivot wrapper is marked as "(pivot helper)" with forNodeId', () => {
    const q = quadData({
      id: "lq", name: "LEAF_PIVOT",
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        pivot: { x: 0, y: -0.7, z: 0 },
      },
    });
    const obj = buildNode(q) as Group;
    expect(obj.userData.w3d).toMatchObject({
      kind: "(pivot helper)",
      forNodeId: "lq",
    });
    // The Mesh inside still carries the real Quad userData.
    const inner = obj.children[0] as Mesh;
    expect((inner.userData.w3d as { kind: string }).kind).toBe("Quad");
  });

  test("DEV-Inspector regression: leaf Quad mesh userData still carries full W3DQuadData spread", () => {
    const q = quadData({
      id: "q", name: "Q", isMask: false, alpha: 0.7,
      faceMapping: { surfaceName: "All", materialId: "M", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false },
    });
    const mesh = buildNode(q) as Mesh;
    const w = mesh.userData.w3d as Record<string, unknown>;
    expect(w.id).toBe("q");
    expect(w.alpha).toBe(0.7);
    expect(w.kind).toBe("Quad");
    expect(w.faceMapping).toBeDefined();
    expect(w.transform).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Phase TextureText — canvas-to-texture static rendering.
  // -----------------------------------------------------------------------

  test("Phase TextureText: TextureText node builds a Mesh with PlaneGeometry sized to TextBoxSize", () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "SMALL_TEAM_NAME",
      enable: true, alpha: 1, speedScale: 1,
      text: "DETROIT IRONHAWKS",
      textBox: { x: 6.39, y: 0.23 },
      alignmentX: "Right" as const,
      alignmentY: "Center" as const,
      textQuality: 0.8,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const obj = buildNode(node, makeCtx()) as Mesh;
    expect(obj).toBeInstanceOf(Mesh);
    const params = (obj.geometry as InstanceType<typeof import("three").PlaneGeometry>).parameters;
    expect(params.width).toBeCloseTo(6.39, 5);
    expect(params.height).toBeCloseTo(0.23, 5);
  });

  test("Phase TextureText: mesh.userData.w3d carries kind, text, textBox", () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "PLAYER_NUMBER_02",
      enable: true, alpha: 1, speedScale: 1,
      text: "23",
      textBox: { x: 0.08, y: 0.19 },
      alignmentX: "Center" as const,
      alignmentY: "Center" as const,
      textQuality: 4,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, makeCtx()) as Mesh;
    const w = mesh.userData.w3d as Record<string, unknown>;
    expect(w.kind).toBe("TextureText");
    expect(w.text).toBe("23");
    expect(w.textBox).toEqual({ x: 0.08, y: 0.19 });
  });

  test("Phase TextureText: material is MeshBasicMaterial with map and transparent=true (canvas alpha)", () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "X",
      enable: true, alpha: 1, speedScale: 1,
      text: "X",
      textBox: { x: 1, y: 1 },
      textQuality: 1,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, makeCtx()) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.map).not.toBeNull();
    expect(mat.alphaTest).toBeGreaterThan(0);
  });

  test("Phase H3: TextureText userData carries fontLoaded=true when index says family/weight/style is registered", () => {
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map(),
      textureLayers: new Map(),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map([
        ["fs-1", {
          kind: "FontStyle", id: "fs-1", name: "FS_01",
          fontName: "Obviously Cond", type: "Bold",
          baselineAligned: true, lineSpacing: 1, kerning: 0, kerningScale: 1,
        }],
      ]),
    };
    const ctx = makeCtx({
      registry,
      loadedFontIndex: new Set(["Obviously Cond|700|normal"]),
    });
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "T",
      enable: true, alpha: 1, speedScale: 1,
      text: "X",
      fontStyleId: "fs-1",
      textBox: { x: 1, y: 0.3 },
      textQuality: 1,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, ctx) as Mesh;
    const w = mesh.userData.w3d as { fontFamily?: string; fontLoaded?: boolean };
    expect(w.fontFamily).toBe("Obviously Cond");
    expect(w.fontLoaded).toBe(true);
  });

  test("Phase H3: TextureText userData fontLoaded=false when index lacks the font", () => {
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map(),
      textures: new Map(),
      textureLayers: new Map(),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map([
        ["fs-1", {
          kind: "FontStyle", id: "fs-1", name: "FS_01",
          fontName: "Obviously Cond", type: "Bold",
          baselineAligned: true, lineSpacing: 1, kerning: 0, kerningScale: 1,
        }],
      ]),
    };
    const ctx = makeCtx({
      registry,
      loadedFontIndex: new Set(["Obviously|400|normal"]), // different family
    });
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "T",
      enable: true, alpha: 1, speedScale: 1,
      text: "X",
      fontStyleId: "fs-1",
      textBox: { x: 1, y: 0.3 },
      textQuality: 1,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, ctx) as Mesh;
    const w = mesh.userData.w3d as { fontLoaded?: boolean };
    expect(w.fontLoaded).toBe(false);
  });

  test("Phase H3: TextureText userData omits fontLoaded when no index supplied", () => {
    const ctx = makeCtx(); // no loadedFontIndex
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "T",
      enable: true, alpha: 1, speedScale: 1,
      text: "X",
      textBox: { x: 1, y: 0.3 },
      textQuality: 1,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, ctx) as Mesh;
    const w = mesh.userData.w3d as { fontLoaded?: boolean };
    expect(w.fontLoaded).toBeUndefined();
  });

  test("Phase TextureText: enable=false hides the mesh", () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "HIDDEN",
      enable: false, alpha: 1, speedScale: 1,
      text: "HIDDEN",
      textBox: { x: 1, y: 0.3 },
      textQuality: 1,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, makeCtx()) as Mesh;
    expect(mesh.visible).toBe(false);
  });

  test("Phase TextureText: MaskId=BASE_MAIN makes text a generic-stencil reader (Phase 2D.3 coexistence)", () => {
    const baseMain = quadData({
      id: "base-main", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const text = {
      kind: "TextureText" as const,
      id: "tt", name: "SMALL_TEAM_NAME",
      enable: true, alpha: 1, speedScale: 1,
      text: "DETROIT IRONHAWKS",
      textBox: { x: 6.39, y: 0.23 },
      textQuality: 0.8,
      maskIds: ["base-main"],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const root = buildNodeTree([baseMain, text], makeCtx());
    const textMesh = root.children[1] as Mesh;
    const mat = textMesh.material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilRef).toBe(64); // generic mask index 1 << 6
    expect(mat.stencilFuncMask).toBe(0b11000000);
  });

  // -----------------------------------------------------------------------
  // Phase TextureText render-order fix — labels without a MaskId render
  // on top of the photo-card stack (Phase A1: renderOrder=24). Stencil
  // readers use per-mask lanes: writer(11+3·(i−1)) / fill(+1) / text(+2),
  // with photo-card readers at 20/21/22.
  // -----------------------------------------------------------------------

  test("Phase TextureText render-order: TextureText without maskIds gets renderOrder=24, depthWrite=false, depthTest=false", () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "PLAYER_LAST_NAME_02",
      enable: true, alpha: 1, speedScale: 1,
      text: "JACKSON",
      textBox: { x: 0.38, y: 0.33 },
      textQuality: 3,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, makeCtx()) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mesh.renderOrder).toBe(24); // Phase A1 — labels above all generic + photo lanes
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(false);
  });

  test("Phase TextureText render-order: PLAYER_NUMBER-like TextureText gets renderOrder=24 and transparent=true", () => {
    const node = {
      kind: "TextureText" as const,
      id: "num", name: "PLAYER_NUMBER_02",
      enable: true, alpha: 1, speedScale: 1,
      text: "23",
      textBox: { x: 0.08, y: 0.19 },
      textQuality: 4,
      maskIds: [],
      transform: {
        position: { x: -0.5, y: 0.435, z: -3 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 3, y: 3, z: 3 },
      },
      children: [],
    };
    const mesh = buildNode(node, makeCtx()) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mesh.renderOrder).toBe(24); // Phase A1 — labels above all generic + photo lanes
    expect(mat.transparent).toBe(true);
  });

  test("Phase 2D.4 + A1: SMALL_TEAM_NAME (TextureText, MaskId=BASE_MAIN) gets renderOrder=13 (BASE_MAIN text lane)", () => {
    // SMALL_TEAM_NAME-like: own MaskId references BASE_MAIN (single generic
    // mask → discovery index 1 → block lanes 11/12/13). The generic-text
    // override drops the default-24 label baseline down into the BASE_MAIN
    // block so the team-name reads above its TEXTURE_FULLFRAME_* fill (12)
    // but below the photo cards (20+).
    const baseMain = quadData({
      id: "base-main", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const text = {
      kind: "TextureText" as const,
      id: "tt", name: "SMALL_TEAM_NAME",
      enable: true, alpha: 1, speedScale: 1,
      text: "DETROIT IRONHAWKS",
      textBox: { x: 6.39, y: 0.23 },
      textQuality: 0.8,
      maskIds: ["base-main"],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const root = buildNodeTree([baseMain, text], makeCtx());
    const mesh = root.children[1] as Mesh;
    expect(mesh.renderOrder).toBe(13); // Phase A1 — BASE_MAIN block text lane (index 1)
  });

  test("Phase 2D.4 + A1: TEAM_NAME TextureText child inheriting MaskId=BASE_MAIN gets renderOrder=13", () => {
    // TEAM_NAME-style: parent Group has MaskId=BASE_MAIN, TextureText child has none.
    // Inherited maskIds resolve to a generic writer → text lane of that writer's block.
    const baseMain = quadData({
      id: "base-main", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const text = {
      kind: "TextureText" as const,
      id: "tt", name: "TEAM_NAME_FS_01_L_01",
      enable: true, alpha: 1, speedScale: 1,
      text: "DETROIT",
      textBox: { x: 0.43, y: 0.4 },
      textQuality: 5,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const parent = groupData({
      id: "team-name", name: "TEAM_NAME",
      maskIds: ["base-main"],
      children: [text],
    });
    const root = buildNodeTree([baseMain, parent], makeCtx());
    const teamNameGroup = root.children[1] as Group;
    const textMesh = teamNameGroup.children[0] as Mesh;
    expect(textMesh.renderOrder).toBe(13); // Phase A1 — inherited generic reader → text lane (BASE_MAIN block)
  });

  test("Phase 2D.4 + A1: TEXTURE_FULLFRAME_MAIN (Quad fill client) sits at BASE_MAIN fill lane (12); text lane (13) above fill, below cards", async () => {
    // BASE_MAIN is the only generic mask here → discovery index 1 → block
    // lanes 11/12/13. The fill client (Quad) lands at 12, the sibling team-
    // name text (TextureText) at 13. Assert the full lane ordering:
    //   writer(11) < fill(12) < text(13) < photo cards (20+).
    const { EqualStencilFunc } = await import("three");
    const baseMain = quadData({
      id: "base-main", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const fill = quadData({ id: "ff", name: "TEXTURE_FULLFRAME_MAIN", maskIds: ["base-main"], alpha: 0.8 });
    const text = {
      kind: "TextureText" as const,
      id: "tt", name: "SMALL_TEAM_NAME",
      enable: true, alpha: 1, speedScale: 1,
      text: "DETROIT IRONHAWKS",
      textBox: { x: 6.39, y: 0.23 },
      textQuality: 0.8,
      maskIds: ["base-main"],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const root = buildNodeTree([baseMain, fill, text], makeCtx());
    const writerMesh = root.children[0] as Mesh;
    const fillMesh = root.children[1] as Mesh;
    const textMesh = root.children[2] as Mesh;
    expect(writerMesh.renderOrder).toBe(11);                            // BASE_MAIN writer
    expect(fillMesh.renderOrder).toBe(12);                              // BASE_MAIN fill
    expect(textMesh.renderOrder).toBe(13);                              // BASE_MAIN text
    expect(writerMesh.renderOrder).toBeLessThan(fillMesh.renderOrder); // 11 < 12
    expect(fillMesh.renderOrder).toBeLessThan(textMesh.renderOrder);   // 12 < 13
    expect(textMesh.renderOrder).toBeLessThan(20);                     // below photo cards (20+)
    // Masking is untouched: the text client still reads BASE_MAIN's generic
    // field (Equal, ref 64, funcMask 192), and the writer ref is unchanged.
    const textMat = textMesh.material as MeshBasicMaterial;
    expect(textMat.stencilFunc).toBe(EqualStencilFunc);
    expect(textMat.stencilRef).toBe(64);
    expect(textMat.stencilFuncMask).toBe(0b11000000);
    expect((writerMesh.material as MeshBasicMaterial).stencilRef).toBe(64);
  });

  test("Phase 2D.4 + A1: BASE_TEAM text client reads ref=128 and lands in BASE_TEAM block text lane (16)", async () => {
    // A TextureText client of the SECOND generic writer (BASE_TEAM, owner
    // index 2 → ref 128, block lanes 14/15/16) must read the correct generic
    // field AND land in the text lane of its OWN writer's block — proving
    // that the per-mask block scheme correctly routes readers to the lane
    // belonging to their writer, not a shared global lane.
    const { EqualStencilFunc } = await import("three");
    const baseMain = quadData({
      id: "base-main", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const baseTeam = quadData({
      id: "base-team", name: "BASE_TEAM", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    // Clients so both writers consume an index (BASE_MAIN=1, BASE_TEAM=2).
    const ffMain = quadData({ id: "ffm", name: "TEXTURE_FULLFRAME_MAIN", maskIds: ["base-main"] });
    const benchText = {
      kind: "TextureText" as const,
      id: "bt", name: "BENCH_NAME_01",
      enable: true, alpha: 1, speedScale: 1,
      text: "LOGAN BRANDON",
      textBox: { x: 0.5, y: 0.2 },
      textQuality: 1.3,
      maskIds: ["base-team"],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const root = buildNodeTree([baseMain, baseTeam, ffMain, benchText], makeCtx());
    const benchMesh = root.children[3] as Mesh;
    const benchMat = benchMesh.material as MeshBasicMaterial;
    expect(benchMesh.renderOrder).toBe(16); // Phase A1 — BASE_TEAM block text lane (index 2)
    expect(benchMat.stencilFunc).toBe(EqualStencilFunc);
    expect(benchMat.stencilRef).toBe(128); // BASE_TEAM owner index 2 << 6
    expect(benchMat.stencilFuncMask).toBe(0b11000000);
  });

  test("Phase A1: with two generic masks M1 then M2, M1's whole block renders before M2's whole block", () => {
    // The bug this fixes: with the old flat 15/16/17 scheme, FF_MAIN (reader
    // of BASE_MAIN at lane 16) drew on top of BASE_TEAM (writer at lane 15) in
    // their overlap region, reducing the visible BASE_TEAM panel to a thin
    // strip. The per-mask block scheme guarantees that every reader of M1
    // renders before M1+1's writer.
    const baseMain = quadData({
      id: "M1", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const baseTeam = quadData({
      id: "M2", name: "BASE_TEAM", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const ffMain = quadData({ id: "ffm", name: "TEXTURE_FULLFRAME_MAIN", maskIds: ["M1"] });
    const ffBench = quadData({ id: "ffb", name: "TEXTURE_FULLFRAME_BENCH", maskIds: ["M2"] });
    const root = buildNodeTree([baseMain, ffMain, baseTeam, ffBench], makeCtx());
    const m1Writer = root.children[0] as Mesh;
    const m1Fill = root.children[1] as Mesh;
    const m2Writer = root.children[2] as Mesh;
    const m2Fill = root.children[3] as Mesh;
    // Block 1 lanes 11/12, block 2 lanes 14/15.
    expect(m1Writer.renderOrder).toBe(11);
    expect(m1Fill.renderOrder).toBe(12);
    expect(m2Writer.renderOrder).toBe(14);
    expect(m2Fill.renderOrder).toBe(15);
    // The key invariant: M1 fill < M2 writer (so M2 paints over M1's fill in
    // the overlap region, matching R3 document-order semantics).
    expect(m1Fill.renderOrder).toBeLessThan(m2Writer.renderOrder);
  });

  test("Phase A1: photo-card lanes (20/21/22) sit above every generic mask block (max 19) and below label lane (24)", () => {
    // Even with the maximum allowed generic masks (STENCIL_GENERIC_INDEX_MAX=3),
    // the highest generic lane is 19 (text of block 3). Photo readers start at
    // 20 and labels at 24, so the relative stack ordering invariant holds.
    const mkGenericMask = (i: number) => quadData({
      id: `G${i}`, name: `BASE_${i}`, isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
    });
    const mkGenericClient = (i: number) =>
      quadData({ id: `c${i}`, name: `FF_${i}`, maskIds: [`G${i}`] });
    const photoMask = quadData({
      id: "pm", name: "PHOTO_MASK_01", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photo = quadData({ id: "p1", name: "PHOTO_01", maskIds: ["pm"] });
    const label = {
      kind: "TextureText" as const,
      id: "lbl", name: "PLAYER_NUMBER_01",
      enable: true, alpha: 1, speedScale: 1,
      text: "5",
      textBox: { x: 0.08, y: 0.19 },
      textQuality: 4,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const root = buildNodeTree(
      [mkGenericMask(1), mkGenericClient(1), mkGenericMask(2), mkGenericClient(2), mkGenericMask(3), mkGenericClient(3), photoMask, photo, label],
      makeCtx(),
    );
    const lanes = root.children.map((c) => (c as Mesh).renderOrder);
    const [g1w, g1f, g2w, g2f, g3w, g3f, pmw, pr, lbl] = lanes;
    // Per-mask block lanes ascend in pairs of writer/fill.
    expect([g1w, g1f, g2w, g2f, g3w, g3f]).toEqual([11, 12, 14, 15, 17, 18]);
    // Photo-mask writer stays at 10 (its own dedicated lane).
    expect(pmw).toBe(10);
    // Photo-card reader sits above all generic blocks.
    expect(pr).toBe(22);
    expect(pr).toBeGreaterThan(g3f);
    // Label sits above the photo-card stack.
    expect(lbl).toBe(24);
    expect(lbl).toBeGreaterThan(pr);
  });

  test("Phase TextureText render-order: TextureText inside PHOTO_FILL gets photoCardRenderOrder default 22 (regression)", () => {
    // A TextureText sitting under PHOTO_FILL_02 with maskIds=[DUMMY_02, MASK_02]
    // inherits both → Phase 2E intersection reader fires → renderOrder via
    // photoCardRenderOrder(name). Name doesn't match TEXTURE_PHOTO/COLOR/PHOTO,
    // so falls back to RENDER_ORDER_DEFAULT_CLIENT (Phase A1 = 22, was 20).
    const photoMask = quadData({
      id: "mask-2", name: "PHOTO_MASK_02", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photoDummy = quadData({
      id: "dummy-2", name: "PHOTO_DUMMY_02", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const text = {
      kind: "TextureText" as const,
      id: "tt", name: "MASKED_TEXT",
      enable: true, alpha: 1, speedScale: 1,
      text: "X",
      textBox: { x: 0.1, y: 0.1 },
      textQuality: 3,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const fill = groupData({
      id: "fill-2", name: "PHOTO_FILL_02",
      maskIds: ["dummy-2", "mask-2"],
      children: [text],
    });
    const root = buildNodeTree([photoMask, photoDummy, fill], makeCtx());
    const fillGroup = root.children[2] as Group;
    const mesh = fillGroup.children[0] as Mesh;
    expect(mesh.renderOrder).toBe(22); // Phase A1 — photoCardRenderOrder default (was 20)
  });

  test("Phase TextureText render-order regression: PHOTO_02 reader still gets renderOrder=22", () => {
    // The TextureText fix must NOT change the existing Phase 1a + Patch D2
    // renderOrder for Quad photo-card clients (Phase A1 shifted 20→22).
    const photoMask = quadData({
      id: "mask-2", name: "PHOTO_MASK_02", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const photo = quadData({ id: "p2", name: "PHOTO_02", maskIds: ["mask-2"] });
    const root = buildNodeTree([photoMask, photo], makeCtx());
    const photoMesh = root.children[1] as Mesh;
    expect(photoMesh.renderOrder).toBe(22); // Phase A1 — PHOTO_NN default reader (was 20)
  });

  // -----------------------------------------------------------------------
  // Phase TextureText layout v2 — ConstrainMethod="Width" path.
  // Structural assertions only — jsdom's canvas getContext("2d") returns
  // null, so the actual measureText shrink loop is exercised by browser
  // visual smoke, not unit tests.
  // -----------------------------------------------------------------------

  test('Phase TextureText layout v2: ConstrainMethod="Width" preserves PlaneGeometry size and material', () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "PLAYER_LAST_NAME_02",
      enable: true, alpha: 1, speedScale: 1,
      text: "JACKSON",
      textBox: { x: 0.38, y: 0.33 },
      textQuality: 3,
      alignmentX: "Left" as const,
      alignmentY: "Center" as const,
      constrainMethod: "Width",
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, makeCtx()) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    const params = (mesh.geometry as InstanceType<typeof import("three").PlaneGeometry>).parameters;
    // Plane size still matches TextBoxSize verbatim (Phase TextureText invariant).
    expect(params.width).toBeCloseTo(0.38, 5);
    expect(params.height).toBeCloseTo(0.33, 5);
    expect(mat.map).not.toBeNull(); // CanvasTexture present regardless of ConstrainMethod path
    expect(mat.transparent).toBe(true);
  });

  test('Phase TextureText layout v2: ConstrainMethod="Width" carried through to userData.w3d', () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "TEAM_NAME_FS_01_L_01",
      enable: true, alpha: 1, speedScale: 1,
      text: "DETROIT",
      textBox: { x: 0.43, y: 0.4 },
      textQuality: 5,
      alignmentX: "Left" as const,
      alignmentY: "Center" as const,
      constrainMethod: "Width",
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 5.635, y: 5.635, z: 5.635 },
      },
      children: [],
    };
    const mesh = buildNode(node, makeCtx()) as Mesh;
    const w = mesh.userData.w3d as Record<string, unknown>;
    expect(w.constrainMethod).toBe("Width");
  });

  test('Phase TextureText layout v2: missing ConstrainMethod does NOT crash and still produces a mesh', () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "PLAIN",
      enable: true, alpha: 1, speedScale: 1,
      text: "X",
      textBox: { x: 0.5, y: 0.5 },
      textQuality: 1,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, makeCtx()) as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.map).not.toBeNull();
  });

  test('Phase TextureText layout v2: render-order baseline unchanged by ConstrainMethod', () => {
    // Adding ConstrainMethod must not regress the renderOrder=24 default for
    // a TextureText without maskIds (Phase A1 shifted 22→24).
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "X",
      enable: true, alpha: 1, speedScale: 1,
      text: "ABCDEFG",
      textBox: { x: 0.1, y: 0.3 },
      textQuality: 4,
      constrainMethod: "Width",
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const mesh = buildNode(node, makeCtx()) as Mesh;
    expect(mesh.renderOrder).toBe(24); // Phase A1 — labels lane shifted 22 → 24
  });

  // -----------------------------------------------------------------------
  // Phase TextureText constrain — explicit "None" / "Height" branches
  // and unknown-value warning. The actual fontPx shrink runs in
  // renderTextToCanvas, which is a no-op under jsdom (getContext("2d") →
  // null), so these tests assert the structural contract: the recognised
  // value reaches userData.w3d, no warning is emitted, and unknown values
  // are downgraded to "Width" with a warning.
  // -----------------------------------------------------------------------

  test('Phase TextureText constrain: "None" is recognised and emits no warning', () => {
    // BENCH_TITLE in LINEUP_LEFT is the only "None" TextureText.
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "BENCH_TITLE",
      enable: true, alpha: 1, speedScale: 1,
      text: "BENCH",
      textBox: { x: 1, y: 0.3 },
      textQuality: 2,
      alignmentX: "Left" as const,
      alignmentY: "Center" as const,
      constrainMethod: "None",
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const ctx = makeCtx();
    const mesh = buildNode(node, ctx) as Mesh;
    const w = mesh.userData.w3d as Record<string, unknown>;
    expect(w.constrainMethod).toBe("None");
    expect(ctx.warnings.filter((m) => m.includes("ConstrainMethod"))).toEqual([]);
  });

  test('Phase TextureText constrain: "Height" is recognised and emits no warning', () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "TALL_LABEL",
      enable: true, alpha: 1, speedScale: 1,
      text: "FIT-HEIGHT",
      textBox: { x: 0.5, y: 0.5 },
      textQuality: 1,
      alignmentX: "Center" as const,
      alignmentY: "Center" as const,
      constrainMethod: "Height",
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const ctx = makeCtx();
    const mesh = buildNode(node, ctx) as Mesh;
    const w = mesh.userData.w3d as Record<string, unknown>;
    expect(w.constrainMethod).toBe("Height");
    expect(ctx.warnings.filter((m) => m.includes("ConstrainMethod"))).toEqual([]);
  });

  test('Phase TextureText constrain: unknown ConstrainMethod warns and falls back to "Width"', () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "WEIRD_LABEL",
      enable: true, alpha: 1, speedScale: 1,
      text: "X",
      textBox: { x: 0.5, y: 0.5 },
      textQuality: 1,
      alignmentX: "Center" as const,
      alignmentY: "Center" as const,
      constrainMethod: "FitToParent", // not in the recognised set
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      children: [],
    };
    const ctx = makeCtx();
    const mesh = buildNode(node, ctx) as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    // userData reflects the AUTHORED value (...rest), not the resolved one —
    // diagnostic visibility for the inspector. The resolver downgrade only
    // affects what reaches renderTextToCanvas.
    const w = mesh.userData.w3d as Record<string, unknown>;
    expect(w.constrainMethod).toBe("FitToParent");
    const matches = ctx.warnings.filter((m) =>
      m.includes("WEIRD_LABEL") && m.includes("FitToParent")
    );
    expect(matches.length).toBe(1);
    expect(matches[0]).toContain("falling back to 'Width'");
  });

  test('Phase TextureText constrain: "Width" still emits no ConstrainMethod warning (regression guard)', () => {
    const node = {
      kind: "TextureText" as const,
      id: "tt", name: "PLAYER_LAST_NAME_01",
      enable: true, alpha: 1, speedScale: 1,
      text: "STEPHENS",
      textBox: { x: 0.38, y: 0.33 },
      textQuality: 3,
      alignmentX: "Left" as const,
      alignmentY: "Center" as const,
      constrainMethod: "Width",
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 3, y: 3, z: 3 },
      },
      children: [],
    };
    const ctx = makeCtx();
    buildNode(node, ctx) as Mesh;
    expect(ctx.warnings.filter((m) => m.includes("ConstrainMethod"))).toEqual([]);
  });

  test("Phase 2C regression: PHOTO_MASK_05 (no texture layer) is unaffected by UV transform plumbing", () => {
    // PHOTO_MASK_05 uses TextureLayerId="Standard" → no texture lookup, no
    // UV transform path triggered. The Mesh's geometry stays exactly as
    // Phase 2A asserted (width 1.55, height 3, Left alignment).
    const mask = quadData({
      id: "mask-5", name: "PHOTO_MASK_05", isMask: true,
      geometry: { alignmentX: "Left", size: { x: 1.55, y: 3 } },
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
    });
    const ctx = makeCtx();
    const root = buildNodeTree([mask], ctx);
    const m = root.children[0] as Mesh;
    const mat = m.material as MeshBasicMaterial;
    expect(mat.map).toBeNull();
    expect(mat.alphaMap).toBeNull();
    const params = (m.geometry as InstanceType<typeof import("three").PlaneGeometry>).parameters;
    expect(params.width).toBeCloseTo(1.55, 5);
    expect(params.height).toBeCloseTo(3, 5);
  });

  test("Phase 2C regression: stencil writer (PHOTO_DUMMY_01) keeps Phase 2J ref/writeMask after UV transform plumbing", () => {
    // Belt-and-suspenders: confirm the new acquireTexture path does not
    // disturb the stencil setup applied by applyPhotoMaskStencil.
    const tex: W3DTextureData = { kind: "Texture", id: "t", name: "T.png", filename: "T.png", folderPath: "" };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L", name: "PHOTO_01", textureBlending: "Multiply",
      mapping: { textureGuid: "t", isEmissive: false, useMipMapping: false },
      offset: { x: -0.07, y: 0 },
    };
    const ctx = makeCtx({
      registry: {
        baseMaterials: new Map(),
        textures: new Map([["t", tex]]),
        textureLayers: new Map([["L", layer]]),
        dynamicTextureFilenameByLayerId: new Map(),
        fontStyles: new Map(),
      },
      textureUrlsByFilename: new Map([["T.png", "blob:T"]]),
    });
    const dummy = quadData({
      id: "d", name: "PHOTO_DUMMY_01", isMask: true,
      maskProperties: { disableBinaryAlpha: true, hasSampleCount: false, isColoredMask: false, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "", textureLayerId: "L", baseMaterialInherited: false, textureInherited: false },
    });
    const root = buildNodeTree([dummy], ctx);
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilWriteMask).toBe(56); // Phase 2J DUMMY_OWNER_FIELD
    expect(mat.stencilRef).toBe(8);        // DUMMY owner=1 << 3
    // And the texture still carries the layer's UV transform (Phase 2C.1 negated).
    expect(mat.map!.offset.x).toBeCloseTo(0.07, 5); // negated W3D -0.07
  });
});

// ---------------------------------------------------------------------------
// Phase P1 — parent Group Alpha propagation into descendant leaf opacity.
// XML evidence: LINEUP_LEFT `<Group Name="BENCH" Alpha="0.7">` — bench/coach
// text should render at 70% opacity instead of 100%.
// ---------------------------------------------------------------------------
describe("builder — Phase P1 parent Group Alpha propagation", () => {
  test("Group(alpha=0.7) > Quad(alpha=1) → mesh material.opacity ≈ 0.7", () => {
    const child = quadData({ id: "child", alpha: 1 });
    const parent = groupData({ id: "parent", alpha: 0.7, children: [child] });
    const root = buildNode(parent) as Group;
    const mesh = root.children[0] as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.7, 6);
    expect(mat.transparent).toBe(true);
  });

  test("nested Group(0.5) > Group(0.5) > Quad(1) multiplies to ≈ 0.25", () => {
    const leaf = quadData({ id: "leaf", alpha: 1 });
    const inner = groupData({ id: "inner", alpha: 0.5, children: [leaf] });
    const outer = groupData({ id: "outer", alpha: 0.5, children: [inner] });
    const root = buildNode(outer) as Group;
    const mesh = ((root.children[0] as Group).children[0]) as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.25, 6);
    expect(mat.transparent).toBe(true);
  });

  test("Group without authored Alpha is a no-op — child alpha preserved verbatim", () => {
    const child = quadData({ id: "child", alpha: 0.8 });
    const parent = groupData({ id: "parent", children: [child] }); // no alpha
    const root = buildNode(parent) as Group;
    const mat = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.8, 6);
  });

  test("Group(alpha=0.7) > Quad(alpha=0.5) → composes to 0.35", () => {
    const child = quadData({ id: "child", alpha: 0.5 });
    const parent = groupData({ id: "parent", alpha: 0.7, children: [child] });
    const root = buildNode(parent) as Group;
    const mat = ((root.children[0] as Mesh).material) as MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.35, 6);
    expect(mat.transparent).toBe(true);
  });

  test("Group(alpha=0.7) > TextureText → text material.opacity ≈ 0.7", () => {
    // Minimal TextureText node — builder accepts it without a registry context.
    const text = {
      kind: "TextureText" as const,
      id: "t", name: "T", enable: true, alpha: 1, speedScale: 1, isMask: false,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      textBox: { x: 0.5, y: 0.2 },
      text: "TEST",
      fontStyleId: undefined,
      textQuality: 1,
      constrainMethod: undefined,
      alignmentX: "Center" as const,
      alignmentY: "Center" as const,
      children: [],
    };
    const parent = groupData({ id: "parent", alpha: 0.7, children: [text] });
    const root = buildNode(parent) as Group;
    const mesh = root.children[0] as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.7, 6);
  });

  test("regression: Group without alpha and no parent context → child Quad opacity=1, transparent=false", () => {
    const child = quadData({ id: "child", alpha: 1 });
    const parent = groupData({ id: "parent", children: [child] });
    const root = buildNode(parent) as Group;
    const mat = ((root.children[0] as Mesh).material) as MeshBasicMaterial;
    expect(mat.opacity).toBe(1);
    expect(mat.transparent).toBe(false);
  });

  test("stencil writer inside Alpha Group keeps stencilWrite=true (no stencil regression)", () => {
    // Replicates the corpus shape: a generic colored mask quad embedded under
    // a Group with fractional Alpha. Phase P1 must reduce its color opacity
    // but never disable the stencil write path that downstream readers depend on.
    const baseMaterial: W3DBaseMaterialData = {
      kind: "BaseMaterial", id: "M1", name: "M",
      hasEmissive: true, hasDiffuse: false, emissive: "ff0000", diffuse: "ffffff", alpha: 1,
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map([[baseMaterial.id, baseMaterial]]),
      textures: new Map(),
      textureLayers: new Map(),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx: BuildContext = {
      registry,
      textureUrlsByFilename: new Map(),
      textureCache: new Map(),
      warnings: [],
    };
    const mask = quadData({
      id: "BASE_GENERIC", name: "BASE_GENERIC", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "M1", textureLayerId: "Standard", baseMaterialInherited: false, textureInherited: false },
    });
    // collectGenericMaskInfo skips masks no client references — add a reader
    // sibling that points its maskIds at BASE_GENERIC, mirroring the
    // BASE_TEAM ⇄ TEXTURE_FULLFRAME_BENCH coupling in the real corpus.
    const reader = quadData({ id: "reader", name: "READER", maskIds: ["BASE_GENERIC"] });
    const parent = groupData({ id: "parent", alpha: 0.7, children: [mask, reader] });
    const root = buildNodeTree([parent], ctx);
    const parentGroup = root.children[0] as Group;
    const maskMesh = parentGroup.children[0] as Mesh;
    const mat = maskMesh.material as MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.7, 6);
    expect(mat.stencilWrite).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase P4.1 — Generic foreground overlay render-order policy.
// XML evidence: LINEUP_LEFT LOGO Quad (Id 51199cb6, line 221) is authored
// AFTER BASE_MAIN (line 41) in the same MAIN/HORIZONTAL_SLIDE branch. LOGO
// uses IronHawks.png via TextureLayer "LOGO". With three.js default
// renderOrder=0 and BASE_MAIN at generic-mask lane 11, the colored gradient
// painted over LOGO's pixels even though XML order and R3 reference put LOGO
// in front. Rule promotes non-mask, non-reader, textured Quads to overlay
// lane 19 (above generic mask blocks ≤19, below photo-card stack 20+).
// ---------------------------------------------------------------------------
describe("builder — Phase P4.1 foreground overlay render-order", () => {
  test("textured Quad with no mask, no inherited mask → renderOrder=19 (above colored masks)", () => {
    // Synthetic minimal setup: colored generic mask + sibling textured overlay
    // referencing the same registry. After build the overlay quad's renderOrder
    // must be 19 while the mask writer sits at the generic block lane (11).
    const baseMaterial: W3DBaseMaterialData = {
      kind: "BaseMaterial", id: "M1", name: "M",
      hasEmissive: true, hasDiffuse: false, emissive: "ffff00", diffuse: "ffffff", alpha: 1,
    };
    const texture: W3DTextureData = {
      kind: "Texture", id: "tex-logo", name: "Logo.png", filename: "Logo.png", folderPath: "",
    };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L1", name: "LOGO", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-logo", isEmissive: true, useMipMapping: true, keyType: "AlphaKey" },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map([[baseMaterial.id, baseMaterial]]),
      textures: new Map([[texture.id, texture]]),
      textureLayers: new Map([[layer.id, layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx: BuildContext = {
      registry,
      textureUrlsByFilename: new Map([["Logo.png", "blob:logo-url"]]),
      textureCache: new Map(),
      warnings: [],
    };
    const mask = quadData({
      id: "mask-id", name: "BASE_PANEL", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "M1", textureLayerId: "Standard", baseMaterialInherited: false, textureInherited: false },
    });
    const overlay = quadData({
      id: "overlay-id", name: "LOGO",
      faceMapping: { surfaceName: "All", materialId: "M1", textureLayerId: "L1", baseMaterialInherited: false, textureInherited: false },
    });
    // Reader sibling so collectGenericMaskInfo registers the mask
    const reader = quadData({ id: "reader-id", name: "TEXTURE_FULLFRAME_X", maskIds: ["mask-id"] });
    const parent = groupData({ id: "g", name: "G", children: [mask, overlay, reader] });
    const root = buildNodeTree([parent], ctx);
    const g = root.children[0] as Group;
    const maskMesh = g.children[0] as Mesh;
    const overlayMesh = g.children[1] as Mesh;
    // mask writer at generic block lane 11 (index 1 → genericWriterLane(1)=11)
    expect(maskMesh.renderOrder).toBe(11);
    expect(overlayMesh.renderOrder).toBe(19); // overlay above the mask
    expect(overlayMesh.renderOrder).toBeGreaterThan(maskMesh.renderOrder);
  });

  test("non-textured Quad (no map) stays at renderOrder=0 (rule guard)", () => {
    const overlay = quadData({ id: "overlay-id", name: "LOGO" }); // no faceMapping → no texture
    const root = buildNodeTree([overlay]);
    const overlayMesh = root.children[0] as Mesh;
    expect(overlayMesh.renderOrder).toBe(0);
  });

  test("Quad with own MaskId is left alone (stencil reader path owns renderOrder)", () => {
    const baseMaterial: W3DBaseMaterialData = {
      kind: "BaseMaterial", id: "M1", name: "M",
      hasEmissive: true, hasDiffuse: false, emissive: "ffffff", diffuse: "ffffff", alpha: 1,
    };
    const texture: W3DTextureData = {
      kind: "Texture", id: "tex", name: "x.png", filename: "x.png", folderPath: "",
    };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L1", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex", isEmissive: false, useMipMapping: true, keyType: "AlphaKey" },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map([[baseMaterial.id, baseMaterial]]),
      textures: new Map([[texture.id, texture]]),
      textureLayers: new Map([[layer.id, layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx: BuildContext = {
      registry,
      textureUrlsByFilename: new Map([["x.png", "blob:x"]]),
      textureCache: new Map(),
      warnings: [],
    };
    const mask = quadData({
      id: "mask-id", name: "BASE_PANEL", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "M1", textureLayerId: "Standard", baseMaterialInherited: false, textureInherited: false },
    });
    // Reader quad with its own maskId — Phase P4.1 should NOT touch it.
    const reader = quadData({
      id: "r", name: "TEXTURE_FULLFRAME_X", maskIds: ["mask-id"],
      faceMapping: { surfaceName: "All", materialId: "M1", textureLayerId: "L1", baseMaterialInherited: false, textureInherited: false },
    });
    const parent = groupData({ id: "g", name: "G", children: [mask, reader] });
    const root = buildNodeTree([parent], ctx);
    const g = root.children[0] as Group;
    const readerMesh = g.children[1] as Mesh;
    // The reader sits in the generic-fill lane (writerLane+1=12), NOT the overlay lane 19.
    expect(readerMesh.renderOrder).toBe(12);
    expect(readerMesh.renderOrder).not.toBe(19);
  });

  test("mask writer Quad is left alone (its own lane allocation owns renderOrder)", () => {
    const baseMaterial: W3DBaseMaterialData = {
      kind: "BaseMaterial", id: "M1", name: "M",
      hasEmissive: true, hasDiffuse: false, emissive: "ffffff", diffuse: "ffffff", alpha: 1,
    };
    const texture: W3DTextureData = {
      kind: "Texture", id: "tex-grad", name: "grad.png", filename: "grad.png", folderPath: "",
    };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L1", name: "GRADIENT", textureBlending: "Multiply",
      mapping: { textureGuid: "tex-grad", isEmissive: true, useMipMapping: true, keyType: "AlphaKey" },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map([[baseMaterial.id, baseMaterial]]),
      textures: new Map([[texture.id, texture]]),
      textureLayers: new Map([[layer.id, layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx: BuildContext = {
      registry,
      textureUrlsByFilename: new Map([["grad.png", "blob:grad"]]),
      textureCache: new Map(),
      warnings: [],
    };
    // Even though mask carries a texture (GRADIENT.png), it's a mask writer:
    // Phase P4.1 must NOT overwrite its writer lane.
    const mask = quadData({
      id: "mask-id", name: "BASE_MAIN", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "M1", textureLayerId: "L1", baseMaterialInherited: false, textureInherited: false },
    });
    const reader = quadData({ id: "r", name: "TEXTURE_FULLFRAME_X", maskIds: ["mask-id"] });
    const parent = groupData({ id: "g", name: "G", children: [mask, reader] });
    const root = buildNodeTree([parent], ctx);
    const g = root.children[0] as Group;
    const maskMesh = g.children[0] as Mesh;
    expect(maskMesh.renderOrder).toBe(11); // genericWriterLane(1)
    expect(maskMesh.renderOrder).not.toBe(19);
  });

  test("textured Quad inside a Group with MaskId inherits that mask — rule does NOT promote", () => {
    const baseMaterial: W3DBaseMaterialData = {
      kind: "BaseMaterial", id: "M1", name: "M",
      hasEmissive: true, hasDiffuse: false, emissive: "ffffff", diffuse: "ffffff", alpha: 1,
    };
    const texture: W3DTextureData = {
      kind: "Texture", id: "tex", name: "x.png", filename: "x.png", folderPath: "",
    };
    const layer: W3DTextureLayerData = {
      kind: "TextureLayer", id: "L1", name: "L", textureBlending: "Multiply",
      mapping: { textureGuid: "tex", isEmissive: false, useMipMapping: true, keyType: "AlphaKey" },
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map([[baseMaterial.id, baseMaterial]]),
      textures: new Map([[texture.id, texture]]),
      textureLayers: new Map([[layer.id, layer]]),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx: BuildContext = {
      registry,
      textureUrlsByFilename: new Map([["x.png", "blob:x"]]),
      textureCache: new Map(),
      warnings: [],
    };
    const mask = quadData({
      id: "mask-id", name: "BASE_PANEL", isMask: true,
      maskProperties: { disableBinaryAlpha: false, hasSampleCount: false, isColoredMask: true, isInvertedMask: true },
      faceMapping: { surfaceName: "All", materialId: "M1", textureLayerId: "Standard", baseMaterialInherited: false, textureInherited: false },
    });
    // child Quad inside a Group that inherits MaskId — stencil reader path
    // owns renderOrder; Phase P4.1 must not interfere.
    const insideMask = quadData({
      id: "inside", name: "TEXT_OVER_PANEL",
      faceMapping: { surfaceName: "All", materialId: "M1", textureLayerId: "L1", baseMaterialInherited: false, textureInherited: false },
    });
    const wrappedGroup = groupData({
      id: "w", name: "WRAPPED", maskIds: ["mask-id"], children: [insideMask],
    });
    const parent = groupData({ id: "g", name: "G", children: [mask, wrappedGroup] });
    const root = buildNodeTree([parent], ctx);
    const g = root.children[0] as Group;
    const wrapped = g.children[1] as Group;
    const insideMesh = wrapped.children[0] as Mesh;
    // Inherits the generic-fill lane (12), NOT overlay lane 19.
    expect(insideMesh.renderOrder).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Phase P6.1 — TextureText opacity when MaterialId = DE1A3E3C (project default
// transparent). The resolver's "DE1A3E3C without mapUrl → opacity 0" rule was
// designed for Quads but TextureText synthesises its own canvas glyph map AFTER
// resolveMaterial returns, so the rule wrongly hid PLAYER_FIRST_NAME /
// PLAYER_LAST_NAME / COACH text in LINEUP_LEFT. buildTextureText now passes
// `expectsCallerMap: true` so the rule is skipped only for TextureText.
// Quad behavior is unchanged.
// ---------------------------------------------------------------------------
describe("builder — Phase P6.1 TextureText opacity with DE1A3E3C", () => {
  const DE1A3E3C = "DE1A3E3C-AE85-4B7B-BA86-056463611630";

  // Minimal TextureText node helper for these tests.
  function textNode(overrides: {
    id?: string; name?: string; alpha?: number;
    materialId?: string; textureLayerId?: string;
  } = {}) {
    return {
      kind: "TextureText" as const,
      id: overrides.id ?? "t",
      name: overrides.name ?? "T",
      enable: true,
      alpha: overrides.alpha ?? 1,
      speedScale: 1,
      isMask: false,
      maskIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      textBox: { x: 0.5, y: 0.2 },
      text: "X",
      fontStyleId: undefined,
      textQuality: 1,
      constrainMethod: undefined,
      alignmentX: "Center" as const,
      alignmentY: "Center" as const,
      faceMapping: overrides.materialId !== undefined ? {
        surfaceName: "All",
        materialId: overrides.materialId,
        textureLayerId: overrides.textureLayerId ?? "Standard",
        baseMaterialInherited: false,
        textureInherited: false,
      } : undefined,
      children: [],
    };
  }

  function ctxWith(): BuildContext {
    return {
      registry: {
        baseMaterials: new Map(),
        textures: new Map(),
        textureLayers: new Map(),
        dynamicTextureFilenameByLayerId: new Map(),
        fontStyles: new Map(),
      },
      textureUrlsByFilename: new Map(),
      textureCache: new Map(),
      warnings: [],
    };
  }

  test("TextureText with MaterialId=DE1A3E3C + Standard TextureLayer → material.opacity = node.alpha (not forced 0)", () => {
    const text = textNode({ materialId: DE1A3E3C, alpha: 1 });
    const root = buildNode(text, ctxWith()) as Mesh;
    const mat = root.material as MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(1, 6);
  });

  test("TextureText with DE1A3E3C and node.alpha=0.5 under Group alpha=0.7 → opacity ≈ 0.35 (P1 propagation preserved)", () => {
    const text = textNode({ materialId: DE1A3E3C, alpha: 0.5 });
    const parent = groupData({ id: "g", alpha: 0.7, children: [text] });
    const root = buildNode(parent, ctxWith()) as Group;
    const mesh = root.children[0] as Mesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.35, 6);
  });

  test("TextureText with no faceMapping (default ctx) → opacity 1, no DE1A3E3C interaction", () => {
    const text = textNode({}); // no materialId at all
    const root = buildNode(text, ctxWith()) as Mesh;
    const mat = root.material as MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(1, 6);
  });

  test("Phase P6.1 regression — Quad with MaterialId=DE1A3E3C + no map STILL has material.opacity=0", () => {
    // The Quad path does NOT pass expectsCallerMap, so DE1A3E3C-without-mapUrl
    // forces invisibility as before. This guards against accidental scope creep.
    const q = quadData({
      id: "q", name: "Q",
      faceMapping: {
        surfaceName: "All", materialId: DE1A3E3C, textureLayerId: "Standard",
        baseMaterialInherited: false, textureInherited: false,
      },
    });
    const root = buildNode(q, ctxWith()) as Mesh;
    const mat = root.material as MeshBasicMaterial;
    expect(mat.opacity).toBe(0);
  });

  test("TextureText with a real BaseMaterial alpha → opacity = node.alpha × matAlpha × parentAlpha (no regression)", () => {
    const mat: W3DBaseMaterialData = {
      kind: "BaseMaterial", id: "real", name: "REAL",
      hasEmissive: true, hasDiffuse: false, emissive: "ffffff", diffuse: "ffffff", alpha: 0.7,
    };
    const registry: W3DResourceRegistry = {
      baseMaterials: new Map([[mat.id, mat]]),
      textures: new Map(),
      textureLayers: new Map(),
      dynamicTextureFilenameByLayerId: new Map(),
      fontStyles: new Map(),
    };
    const ctx: BuildContext = {
      registry,
      textureUrlsByFilename: new Map(),
      textureCache: new Map(),
      warnings: [],
    };
    const text = textNode({ materialId: "real", alpha: 0.5 });
    const parent = groupData({ id: "g", alpha: 0.8, children: [text] });
    const root = buildNode(parent, ctx) as Group;
    const mesh = root.children[0] as Mesh;
    const material = mesh.material as MeshBasicMaterial;
    // 0.5 × 0.7 × 0.8 = 0.28
    expect(material.opacity).toBeCloseTo(0.28, 6);
  });
});

// ---------------------------------------------------------------------------
// Phase P7 — PivotType="Absolute" + animated-axis Position semantic.
//
// For LINEUP_LEFT PLAYER_0X: Pivot Y=-1.4, animated Position.YProp holds at
// -1.4 at PreviewMarker=799, Scale Y=0.95. The legacy Maya formula
// (T(pos+piv) × R × S × T(-piv)) leaves a (1-S)·pivot = -0.07 residual that
// pushes the player slightly too far down. R3 treats the animated value as
// the pivot's world landing point: skip the `+pivot` add on `outer` for the
// animated axis only, keep the inner T(-pivot) so scale-around-pivot stays
// correct. Static axes preserve the legacy formula — PLAYER_02 X-ordering
// (Pivot X=1.29, Position X static at 0) is untouched.
// ---------------------------------------------------------------------------
describe("builder — Phase P7 PivotType=Absolute animated-axis pivot semantic", () => {
  test('animated Y axis with Pivot Y=-1.4, Position Y=-1.4, Scale 0.95: child origin lands at Y = pos + S·(-(-pivot)) = -1.4 + 1.33 = -0.07', () => {
    const child = quadData({ id: "c", name: "C" });
    const parent = groupData({
      id: "p", name: "PLAYER_LIKE",
      transform: {
        position: { x: 0, y: -1.4, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.85 },
        pivot: { x: 0, y: -1.4, z: 0 },
        pivotType: "Absolute",
        positionAnimatedAxes: { y: true },
      },
      children: [child],
    });
    const root = buildNode(parent) as Group;
    root.updateWorldMatrix(true, true);
    // Outer.position.y stays at -1.4 (no +pivot add on animated Y).
    expect(root.position.y).toBeCloseTo(-1.4, 6);
    // Inner pivot helper keeps -pivot on Y → +1.4.
    expect(root.children.length).toBe(1);
    const inner = root.children[0] as Group;
    expect(inner.position.y).toBeCloseTo(1.4, 6);
    // World position of child mesh at local origin: pos + S·(-(-pivot)) on Y.
    const w = new Vector3();
    const mesh = inner.children[0] as Mesh;
    mesh.getWorldPosition(w);
    expect(w.y).toBeCloseTo(-0.07, 5);  // -1.4 + 0.95·1.4 = -0.07
  });

  test('PLAYER_02 shape (Pivot X=1.29, STATIC Position X=0, animated Y only) preserves X-ordering math', () => {
    const child = quadData({ id: "c", name: "C" });
    const parent = groupData({
      id: "p", name: "PLAYER_02_LIKE",
      transform: {
        position: { x: 0, y: -1.4, z: -5 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.85 },
        pivot: { x: 1.29, y: -1.4, z: 0 },
        pivotType: "Absolute",
        positionAnimatedAxes: { y: true }, // Y is animated; X is NOT
      },
      children: [child],
    });
    const root = buildNode(parent) as Group;
    // X is static → Maya path → outer.x = 0 + 1.29 = +1.29
    expect(root.position.x).toBeCloseTo(1.29, 6);
    // Y is animated → no +pivot add → outer.y stays at -1.4
    expect(root.position.y).toBeCloseTo(-1.4, 6);
    // Inner at -pivot on all axes (always).
    const inner = root.children[0] as Group;
    expect(inner.position.x).toBeCloseTo(-1.29, 6);
    expect(inner.position.y).toBeCloseTo(1.4, 6);
    // For child at local origin:
    //   x = +1.29 + 0.95·(-1.29) = 0.0645  (legacy Maya residual on static X)
    //   y = -1.4 + 0.95·(+1.4)  = -0.07    (P7 path on animated Y)
    const w = new Vector3();
    root.updateWorldMatrix(true, true);
    (inner.children[0] as Mesh).getWorldPosition(w);
    expect(w.x).toBeCloseTo(0.0645, 5);
    expect(w.y).toBeCloseTo(-0.07, 5);
  });

  test('non-Absolute (legacy) Pivot keeps the existing Maya formula on all axes — regression guard', () => {
    const child = quadData({ id: "c", name: "C" });
    const parent = groupData({
      id: "p", name: "LEGACY",
      transform: {
        position: { x: 0, y: -1.4, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.95 },
        pivot: { x: 0, y: -1.4, z: 0 },
        // pivotType undefined → not Absolute → legacy Maya path
        positionAnimatedAxes: { y: true }, // animated flag is ignored when not Absolute
      },
      children: [child],
    });
    const root = buildNode(parent) as Group;
    // Maya: outer.y = -1.4 + -1.4 = -2.8
    expect(root.position.y).toBeCloseTo(-2.8, 6);
  });

  test('PivotType=Absolute WITHOUT animated axes uses full legacy Maya — regression guard', () => {
    const child = quadData({ id: "c", name: "C" });
    const parent = groupData({
      id: "p", name: "ABS_STATIC_ONLY",
      transform: {
        position: { x: 0, y: -1.4, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.95, y: 0.95, z: 0.95 },
        pivot: { x: 0, y: -1.4, z: 0 },
        pivotType: "Absolute",
        // positionAnimatedAxes undefined → no axes opt-in
      },
      children: [child],
    });
    const root = buildNode(parent) as Group;
    expect(root.position.y).toBeCloseTo(-2.8, 6); // unchanged from legacy
  });

  test('PivotType=Absolute + animated axis but ZERO pivot → applyPivotAnchor early-returns (no-op)', () => {
    const child = quadData({ id: "c", name: "C" });
    const parent = groupData({
      id: "p", name: "ABS_NO_PIVOT",
      transform: {
        position: { x: 0, y: 0.983, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        // no pivot — equivalent to (0,0,0) → hasNonZeroPivot returns false
        pivotType: "Absolute",
        positionAnimatedAxes: { y: true },
      },
      children: [child],
    });
    const root = buildNode(parent) as Group;
    // BENCH_LIST-like: position passes through unchanged.
    expect(root.position.y).toBeCloseTo(0.983, 6);
  });
});
