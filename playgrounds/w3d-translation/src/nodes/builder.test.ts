// playgrounds/w3d-translation/src/nodes/builder.test.ts
import { describe, expect, test } from "vitest";
import { Group, Mesh } from "three";
import { buildNode, buildNodeTree } from "./builder";
import type { W3DGroupData, W3DQuadData } from "./data";

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
