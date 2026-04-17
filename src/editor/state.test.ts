import { Object3D } from "three";
import { describe, expect, it } from "vitest";
import { createDefaultFontAsset, getFontData } from "./fonts";
import { createTransparentImageAsset } from "./images";
import { exportBlueprintToJson } from "./exports";
import { computeGroupContentBounds, computeNodeWorldBounds, computeNodeWorldPosition } from "./spatial";
import {
  createDefaultBlueprint,
  EditorStore,
  getPropertyDefinitions,
  ROOT_NODE_ID,
} from "./state";
import { createBlueprintFixture } from "../test/fixtures";

describe("EditorStore", () => {
  it("normalizes imported blueprints into a valid working state", () => {
    const store = new EditorStore({
      componentName: "Fixture",
      fonts: [],
      nodes: [
        {
          id: "dup",
          type: "box",
          name: "Broken Box",
          parentId: "missing-parent",
          visible: true,
          transform: {
            position: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          origin: { x: "left", y: "center", z: "front" },
          editable: {
            "material.color": {
              path: "material.color",
              key: "panel-color",
              label: "Panel Color",
              type: "color",
            },
            "invalid.path": {
              path: "invalid.path",
              key: "broken",
              label: "Broken",
              type: "string",
            },
          },
          geometry: { width: -10, height: 0, depth: 2 },
          material: {
            type: "basic",
            color: "#123",
            emissive: "bad",
            roughness: 10,
            metalness: -1,
            opacity: 2,
            transparent: false,
            visible: true,
            alphaTest: 2,
            depthTest: true,
            depthWrite: true,
            wireframe: false,
          },
        },
        {
          id: "dup",
          type: "text",
          name: "Headline",
          parentId: "dup",
          visible: true,
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          origin: { x: "center", y: "center", z: "center" },
          editable: {},
          fontId: "missing-font",
          geometry: {
            text: "Hello",
            size: 0,
            depth: -1,
            curveSegments: 0,
            bevelEnabled: true,
            bevelThickness: -1,
            bevelSize: -1,
          },
          material: {
            type: "standard",
            color: "#ffffff",
            emissive: "#000000",
            roughness: 0.2,
            metalness: 0.1,
            opacity: 1,
            transparent: true,
            visible: true,
            alphaTest: 0,
            depthTest: true,
            depthWrite: true,
            wireframe: false,
          },
        },
      ],
      animation: {
        activeClipId: "missing",
        clips: [
          {
            id: "clip-1",
            name: "Main",
            fps: 24,
            durationFrames: 30,
            tracks: [
              {
                id: "track-1",
                nodeId: "dup",
                property: "transform.position.x",
                keyframes: [
                  { id: "k2", frame: 12, value: 2, ease: "easeOut" },
                  { id: "k1", frame: 0, value: 1, ease: "linear" },
                ],
              },
              {
                id: "track-bad",
                nodeId: "missing-node",
                property: "transform.position.x",
                keyframes: [],
              },
            ],
          },
        ],
      },
    });

    const root = store.getNode(ROOT_NODE_ID);
    const nodes = store.blueprint.nodes;
    const ids = nodes.map((node) => node.id);
    const box = nodes.find((node) => node.type === "box");
    const text = nodes.find((node) => node.type === "text");

    expect(root?.type).toBe("group");
    expect(root?.parentId).toBeNull();
    expect(new Set(ids).size).toBe(ids.length);
    expect(box?.parentId).toBe(ROOT_NODE_ID);
    expect(box?.geometry.width).toBe(0.01);
    expect(box?.geometry.height).toBe(0.01);
    expect(box?.material.color).toBe("#112233");
    expect(Object.keys(box?.editable ?? {})).toEqual(["material.color"]);
    expect(text?.fontId).toBe(createDefaultFontAsset().id);
    expect(text?.geometry.size).toBe(0.01);
    expect(text?.geometry.depth).toBe(0);
    expect(text?.geometry.curveSegments).toBe(1);
    expect(store.animation.activeClipId).toBe("clip-1");
    expect(store.animation.clips[0]?.tracks).toHaveLength(1);
    expect(store.animation.clips[0]?.tracks[0]?.keyframes.map((keyframe) => keyframe.frame)).toEqual([1, 12]);
  });

  it("round-trips a valid blueprint through JSON export and import", () => {
    const blueprint = new EditorStore(createBlueprintFixture()).getSnapshot();
    const json = exportBlueprintToJson(blueprint);
    const store = new EditorStore(JSON.parse(json));

    expect(JSON.parse(json)).toEqual(blueprint);
    expect(store.getSnapshot()).toEqual(blueprint);
  });

  it("groups, moves, and rejects cyclical hierarchy changes", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const circleId = store.insertNode("circle", ROOT_NODE_ID);
    const sphereId = store.insertNode("sphere", ROOT_NODE_ID);

    const groupId = store.groupNodes([circleId, sphereId]);

    expect(groupId).toBeTruthy();
    expect(store.getNode(circleId)?.parentId).toBe(groupId);
    expect(store.getNode(sphereId)?.parentId).toBe(groupId);
    expect(store.reparentNode(groupId!, circleId)).toBe(false);
    expect(store.moveNode(groupId!, circleId, 0)).toBe(false);

    const rootChildrenBefore = store.getNodeChildren(ROOT_NODE_ID).map((node) => node.id);
    expect(rootChildrenBefore.at(-1)).toBe(groupId);

    expect(store.moveNode(groupId!, ROOT_NODE_ID, 1)).toBe(true);

    const rootChildrenAfter = store.getNodeChildren(ROOT_NODE_ID).map((node) => node.id);
    expect(rootChildrenAfter[1]).toBe(groupId);
  });

  it("updates properties, editable bindings, transforms, fonts, and images", () => {
    const store = new EditorStore(createBlueprintFixture());
    const box = store.blueprint.nodes.find((node) => node.type === "box");
    const textNode = store.blueprint.nodes.find((node) => node.type === "text");
    const imageNode = store.blueprint.nodes.find((node) => node.type === "image");

    expect(box).toBeTruthy();
    expect(textNode).toBeTruthy();
    expect(imageNode).toBeTruthy();

    const rotationDefinition = getPropertyDefinitions(box!).find((definition) => definition.path === "transform.rotation.z");
    const scaleDefinition = getPropertyDefinitions(box!).find((definition) => definition.path === "transform.scale.x");
    const materialColorDefinition = getPropertyDefinitions(box!).find((definition) => definition.path === "material.color");

    expect(rotationDefinition).toBeTruthy();
    expect(scaleDefinition).toBeTruthy();
    expect(materialColorDefinition).toBeTruthy();

    store.updateNodeProperty(box!.id, rotationDefinition!, "180");
    store.updateNodeProperty(box!.id, scaleDefinition!, "-4");
    expect(box!.transform.rotation.z).toBeCloseTo(Math.PI);
    expect(box!.transform.scale.x).toBe(0.01);

    store.toggleEditableProperty(box!.id, rotationDefinition!, true);
    store.toggleEditableProperty(box!.id, materialColorDefinition!, true);
    store.updateEditableBinding(box!.id, rotationDefinition!.path, { key: "sharedField" });
    store.updateEditableBinding(box!.id, materialColorDefinition!.path, { key: "sharedField" });

    const bindings = store.listEditableFields()
      .filter((entry) => entry.node.id === box!.id)
      .map((entry) => entry.binding.key)
      .sort();
    expect(bindings).toContain("sharedfield");
    expect(bindings).toContain("sharedfield2");

    const object = new Object3D();
    object.position.set(4, 5, 6);
    object.rotation.set(0.1, 0.2, 0.3);
    object.scale.set(2, 3, 4);
    store.setNodeTransformFromObject(box!.id, object);
    expect(box!.transform.position).toEqual({ x: 4, y: 5, z: 6 });
    expect(box!.transform.scale).toEqual({ x: 2, y: 3, z: 4 });

    const baseFont = createDefaultFontAsset();
    const importedFont = {
      id: "fixture-font",
      name: "Fixture Font",
      source: "imported" as const,
      data: JSON.stringify({
        ...JSON.parse(getFontData(baseFont)),
        familyName: "Fixture Font",
      }),
    };
    const importedFontId = store.addFont(importedFont);
    store.updateTextNodeFont(textNode!.id, importedFontId);
    const updatedTextNode = store.getNode(textNode!.id);
    expect(updatedTextNode?.type).toBe("text");
    if (updatedTextNode?.type !== "text") {
      throw new Error("Expected text node.");
    }
    expect(updatedTextNode.fontId).toBe(importedFontId);

    store.updateImageNodeAsset(imageNode!.id, {
      ...createTransparentImageAsset(),
      name: "Poster.png",
      width: 800,
      height: 400,
    });
    const updatedImageNode = store.getNode(imageNode!.id);
    expect(updatedImageNode?.type).toBe("image");
    if (updatedImageNode?.type !== "image") {
      throw new Error("Expected image node.");
    }
    expect(updatedImageNode.geometry).toEqual({
      width: 2.4,
      height: 1.2,
    });
  });

  it("repositions a group pivot to content center without changing world layout", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const groupId = store.insertNode("group", ROOT_NODE_ID);
    const planeId = store.insertNode("plane", groupId);
    const boxId = store.insertNode("box", groupId);
    const group = store.getNode(groupId);
    const plane = store.getNode(planeId);
    const box = store.getNode(boxId);

    expect(group?.type).toBe("group");
    expect(plane?.type).toBe("plane");
    expect(box?.type).toBe("box");
    if (!group || group.type !== "group" || !plane || plane.type !== "plane" || !box || box.type !== "box") {
      throw new Error("Expected test nodes.");
    }

    plane.geometry.width = 2;
    plane.geometry.height = 4;
    plane.transform.position = { x: 2, y: 4, z: 0 };
    box.geometry.width = 2;
    box.geometry.height = 2;
    box.geometry.depth = 2;
    box.transform.position = { x: -1, y: 1, z: 3 };

    const beforePlaneWorld = computeNodeWorldPosition(planeId, store);
    const beforeBoxWorld = computeNodeWorldPosition(boxId, store);
    const beforeGroupWorldBounds = computeNodeWorldBounds(groupId, store);

    expect(store.setGroupPivotFromPreset(groupId, "center")).toBe(true);

    expect(group.pivotOffset.x).toBeCloseTo(-0.5);
    expect(group.pivotOffset.y).toBeCloseTo(-3);
    expect(group.pivotOffset.z).toBeCloseTo(-2);
    expect(computeNodeWorldPosition(planeId, store)).toEqual(beforePlaneWorld);
    expect(computeNodeWorldPosition(boxId, store)).toEqual(beforeBoxWorld);
    expect(computeNodeWorldBounds(groupId, store)).toEqual(beforeGroupWorldBounds);
  });

  it("computes bottom-center pivot from current group content bounds", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const groupId = store.insertNode("group", ROOT_NODE_ID);
    const planeId = store.insertNode("plane", groupId);
    const group = store.getNode(groupId);
    const plane = store.getNode(planeId);

    expect(group?.type).toBe("group");
    expect(plane?.type).toBe("plane");
    if (!group || group.type !== "group" || !plane || plane.type !== "plane") {
      throw new Error("Expected group hierarchy.");
    }

    plane.geometry.width = 2;
    plane.geometry.height = 4;
    plane.transform.position = { x: 2, y: 4, z: 0 };

    const contentBounds = computeGroupContentBounds(groupId, store);
    expect(contentBounds).toEqual({
      min: { x: 1, y: 2, z: 0 },
      max: { x: 3, y: 6, z: 0 },
    });

    expect(store.setGroupPivotFromPreset(groupId, "bottom-center")).toBe(true);
    expect(group.pivotOffset.x).toBeCloseTo(-2);
    expect(group.pivotOffset.y).toBeCloseTo(-2);
    expect(group.pivotOffset.z).toBeCloseTo(0);
  });

  it("preserves nested group world positions when recalculating a child group pivot", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const parentGroupId = store.insertNode("group", ROOT_NODE_ID);
    const childGroupId = store.insertNode("group", parentGroupId);
    const planeId = store.insertNode("plane", childGroupId);
    const parentGroup = store.getNode(parentGroupId);
    const childGroup = store.getNode(childGroupId);
    const plane = store.getNode(planeId);

    expect(parentGroup?.type).toBe("group");
    expect(childGroup?.type).toBe("group");
    expect(plane?.type).toBe("plane");
    if (!parentGroup || parentGroup.type !== "group" || !childGroup || childGroup.type !== "group" || !plane || plane.type !== "plane") {
      throw new Error("Expected nested group hierarchy.");
    }

    parentGroup.transform.position = { x: 5, y: -2, z: 1 };
    parentGroup.transform.rotation.z = Math.PI / 4;
    childGroup.transform.position = { x: 1, y: 3, z: -2 };
    childGroup.transform.rotation.y = Math.PI / 6;
    plane.geometry.width = 2;
    plane.geometry.height = 2;
    plane.transform.position = { x: 4, y: -1, z: 2 };

    const beforePlaneWorld = computeNodeWorldPosition(planeId, store);
    const beforeChildBounds = computeNodeWorldBounds(childGroupId, store);

    expect(store.setGroupPivotFromPreset(childGroupId, "center")).toBe(true);
    const afterPlaneWorld = computeNodeWorldPosition(planeId, store);
    const afterChildBounds = computeNodeWorldBounds(childGroupId, store);

    expect(afterPlaneWorld?.x).toBeCloseTo(beforePlaneWorld?.x ?? 0);
    expect(afterPlaneWorld?.y).toBeCloseTo(beforePlaneWorld?.y ?? 0);
    expect(afterPlaneWorld?.z).toBeCloseTo(beforePlaneWorld?.z ?? 0);
    expect(afterChildBounds?.min.x).toBeCloseTo(beforeChildBounds?.min.x ?? 0);
    expect(afterChildBounds?.min.y).toBeCloseTo(beforeChildBounds?.min.y ?? 0);
    expect(afterChildBounds?.min.z).toBeCloseTo(beforeChildBounds?.min.z ?? 0);
    expect(afterChildBounds?.max.x).toBeCloseTo(beforeChildBounds?.max.x ?? 0);
    expect(afterChildBounds?.max.y).toBeCloseTo(beforeChildBounds?.max.y ?? 0);
    expect(afterChildBounds?.max.z).toBeCloseTo(beforeChildBounds?.max.z ?? 0);
  });

  it("keeps serialization stable for groups with persisted pivot offsets", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const groupId = store.insertNode("group", ROOT_NODE_ID);
    const planeId = store.insertNode("plane", groupId);
    const plane = store.getNode(planeId);

    expect(plane?.type).toBe("plane");
    if (!plane || plane.type !== "plane") {
      throw new Error("Expected plane node.");
    }

    plane.transform.position = { x: 3, y: -2, z: 1 };
    expect(store.setGroupPivotFromPreset(groupId, "center")).toBe(true);

    const json = exportBlueprintToJson(store.getSnapshot());
    const reloaded = new EditorStore(JSON.parse(json));
    const reloadedGroup = reloaded.getNode(groupId);
    const originalGroup = store.getNode(groupId);

    expect(reloadedGroup?.type).toBe("group");
    expect(originalGroup?.type).toBe("group");
    if (!reloadedGroup || reloadedGroup.type !== "group" || !originalGroup || originalGroup.type !== "group") {
      throw new Error("Expected reloaded group.");
    }

    expect(reloadedGroup.pivotOffset).toEqual(originalGroup.pivotOffset);
  });

  it("treats empty groups safely when applying a pivot preset", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const groupId = store.insertNode("group", ROOT_NODE_ID);
    const group = store.getNode(groupId);

    expect(group?.type).toBe("group");
    if (!group || group.type !== "group") {
      throw new Error("Expected group node.");
    }

    expect(store.setGroupPivotFromPreset(groupId, "center")).toBe(false);
    expect(group.pivotOffset).toEqual({ x: 0, y: 0, z: 0 });
    expect(group.transform.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});
