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
