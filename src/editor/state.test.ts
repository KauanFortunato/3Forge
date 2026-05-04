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
                id: "track-visible",
                nodeId: "dup",
                property: "visible",
                keyframes: [
                  { id: "v1", frame: 0, value: true, ease: "linear" },
                  { id: "v2", frame: 18, value: 0.2, ease: "easeIn" },
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
    expect(store.animation.clips[0]?.tracks).toHaveLength(2);
    expect(store.animation.clips[0]?.tracks[0]?.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 12]);
    expect(store.animation.clips[0]?.tracks[1]).toMatchObject({
      property: "visible",
      keyframes: [
        { frame: 0, value: 1 },
        { frame: 18, value: 0 },
      ],
    });
  });

  it("round-trips a valid blueprint through JSON export and import", () => {
    const blueprint = new EditorStore(createBlueprintFixture()).getSnapshot();
    const json = exportBlueprintToJson(blueprint);
    const store = new EditorStore(JSON.parse(json));

    expect(JSON.parse(json)).toEqual(blueprint);
    expect(store.getSnapshot()).toEqual(blueprint);
  });

  it("normalizes project image libraries without breaking inline image fallbacks", () => {
    const image = {
      id: "poster",
      name: "Poster.png",
      mimeType: "image/png",
      src: "data:image/png;base64,cG9zdGVy",
      width: 640,
      height: 320,
    };
    const store = new EditorStore({
      ...createDefaultBlueprint(),
      images: [image],
      nodes: [
        createDefaultBlueprint().nodes[0],
        {
          ...createTransparentImageAsset(),
          id: "image-node",
          type: "image",
          name: "Image Node",
          parentId: ROOT_NODE_ID,
          visible: true,
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          origin: { x: "center", y: "center", z: "center" },
          editable: {},
          geometry: { width: 1, height: 1 },
          imageId: "poster",
          image: createTransparentImageAsset(),
          material: {
            type: "basic",
            color: "#ffffff",
            emissive: "#000000",
            roughness: 0.5,
            metalness: 0,
            opacity: 1,
            transparent: false,
            visible: true,
            alphaTest: 0,
            depthTest: true,
            depthWrite: true,
            wireframe: false,
            castShadow: true,
            receiveShadow: true,
          },
        },
        {
          id: "fallback-image",
          type: "image",
          name: "Fallback Image",
          parentId: ROOT_NODE_ID,
          visible: true,
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          origin: { x: "center", y: "center", z: "center" },
          editable: {},
          geometry: { width: 1, height: 1 },
          imageId: "missing",
          image: { ...createTransparentImageAsset(), name: "Inline.png" },
          material: {
            type: "basic",
            color: "#ffffff",
            emissive: "#000000",
            roughness: 0.5,
            metalness: 0,
            opacity: 1,
            transparent: false,
            visible: true,
            alphaTest: 0,
            depthTest: true,
            depthWrite: true,
            wireframe: false,
            castShadow: true,
            receiveShadow: true,
          },
        },
      ],
    });

    const imageNode = store.getNode("image-node");
    const fallbackNode = store.getNode("fallback-image");

    expect(store.images).toEqual([image]);
    expect(imageNode?.type).toBe("image");
    expect(fallbackNode?.type).toBe("image");
    if (imageNode?.type !== "image" || fallbackNode?.type !== "image") {
      throw new Error("Expected image nodes.");
    }
    expect(imageNode.image.src).toBe(image.src);
    expect(fallbackNode.imageId).toBeUndefined();
    expect(fallbackNode.image.name).toBe("Inline.png");
  });

  it("adds, assigns, updates, and safely removes project image assets", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const nodeId = store.insertNode("image", ROOT_NODE_ID);
    const assetId = store.addImageAsset({
      name: "Poster.png",
      mimeType: "image/png",
      src: "data:image/png;base64,cG9zdGVy",
      width: 800,
      height: 400,
    });

    expect(store.assignImageAssetToNodes([nodeId], assetId)).toBe(1);
    let node = store.getNode(nodeId);
    expect(node?.type).toBe("image");
    if (node?.type !== "image") {
      throw new Error("Expected image node.");
    }
    expect(node.imageId).toBe(assetId);
    expect(node.image.name).toBe("Poster.png");
    expect(store.getNodesUsingImageAsset(assetId).map((entry) => entry.id)).toEqual([nodeId]);

    expect(store.updateImageAsset(assetId, {
      name: "Poster Wide.png",
      mimeType: "image/png",
      src: "data:image/png;base64,d2lkZQ==",
      width: 1200,
      height: 300,
    })).toBe(true);
    node = store.getNode(nodeId);
    expect(node?.type).toBe("image");
    if (node?.type !== "image") {
      throw new Error("Expected image node.");
    }
    expect(node.image.src).toContain("d2lkZQ==");
    expect(node.geometry).toEqual({ width: 1.6, height: 0.4 });

    expect(store.removeImageAsset(assetId)).toBe(true);
    node = store.getNode(nodeId);
    expect(node?.type).toBe("image");
    if (node?.type !== "image") {
      throw new Error("Expected image node.");
    }
    expect(node.imageId).toBeUndefined();
    expect(node.image.name).toBe("Poster Wide.png");
  });

  it("inserts image nodes linked to existing project image assets", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const assetId = store.addImageAsset({
      name: "Linked Poster.png",
      mimeType: "image/png",
      src: "data:image/png;base64,bGlua2Vk",
      width: 600,
      height: 300,
    });

    const nodeId = store.insertImageAssetNode(assetId, ROOT_NODE_ID);
    expect(nodeId).toBeTruthy();
    expect(store.insertImageAssetNode("missing-asset", ROOT_NODE_ID)).toBeNull();

    const node = store.getNode(nodeId!);
    expect(node?.type).toBe("image");
    if (node?.type !== "image") {
      throw new Error("Expected linked image node.");
    }
    expect(node.imageId).toBe(assetId);
    expect(node.image.name).toBe("Linked Poster.png");
    expect(node.geometry).toEqual({ width: 2, height: 1 });

    expect(store.updateImageAsset(assetId, {
      name: "Updated Linked Poster.png",
      mimeType: "image/png",
      src: "data:image/png;base64,dXBkYXRlZA==",
      width: 300,
      height: 600,
    })).toBe(true);

    const updatedNode = store.getNode(nodeId!);
    expect(updatedNode?.type).toBe("image");
    if (updatedNode?.type !== "image") {
      throw new Error("Expected updated linked image node.");
    }
    expect(updatedNode.imageId).toBe(assetId);
    expect(updatedNode.image.name).toBe("Updated Linked Poster.png");
    expect(updatedNode.image.src).toContain("dXBkYXRlZA==");
    expect(updatedNode.geometry).toEqual({ width: 1, height: 2 });
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

  it("updates shared properties for multiple nodes with a single notification and undo step", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const box = store.blueprint.nodes.find((node) => node.name === "Hero Panel");
    const accent = store.blueprint.nodes.find((node) => node.name === "Accent Plate");

    expect(box).toBeTruthy();
    expect(accent).toBeTruthy();
    if (!box || !accent || box.type === "group" || accent.type === "group") {
      throw new Error("Expected material nodes.");
    }

    const materialColorDefinition = getPropertyDefinitions(box).find((definition) => definition.path === "material.color");
    expect(materialColorDefinition).toBeTruthy();
    if (!materialColorDefinition) {
      throw new Error("Expected material color definition.");
    }

    const notifications: string[] = [];
    store.subscribe((change) => notifications.push(change.reason));

    const updatedCount = store.updateNodesProperty([box.id, accent.id], materialColorDefinition, "#abcdef");

    expect(updatedCount).toBe(2);
    expect(box.material.color).toBe("#abcdef");
    expect(accent.material.color).toBe("#abcdef");
    expect(notifications).toEqual(["node"]);
    expect(store.canUndo).toBe(true);

    expect(store.undo()).toBe(true);
    const revertedBox = store.blueprint.nodes.find((node) => node.name === "Hero Panel");
    const revertedAccent = store.blueprint.nodes.find((node) => node.name === "Accent Plate");
    expect(revertedBox?.type).not.toBe("group");
    expect(revertedAccent?.type).not.toBe("group");
    if (!revertedBox || !revertedAccent || revertedBox.type === "group" || revertedAccent.type === "group") {
      throw new Error("Expected reverted material nodes.");
    }
    expect(revertedBox.material.color).toBe("#7c44de");
    expect(revertedAccent.material.color).toBe("#ffffff");
    expect(store.canUndo).toBe(false);
  });

  it("exposes node visibility in the object group and keeps material visibility distinct", () => {
    const store = new EditorStore(createBlueprintFixture());
    const box = store.blueprint.nodes.find((node) => node.type === "box");
    const group = store.getNode(ROOT_NODE_ID);

    expect(box).toBeTruthy();
    expect(group?.type).toBe("group");
    if (!box || !group) {
      throw new Error("Expected fixture nodes.");
    }

    const boxVisible = getPropertyDefinitions(box).find((definition) => definition.path === "visible");
    const materialVisible = getPropertyDefinitions(box).find((definition) => definition.path === "material.visible");
    const groupVisible = getPropertyDefinitions(group).find((definition) => definition.path === "visible");

    expect(boxVisible).toMatchObject({ group: "Object", label: "Visible" });
    expect(materialVisible).toMatchObject({ group: "Material", label: "Material Visible" });
    expect(groupVisible).toMatchObject({ group: "Object", label: "Visible" });
  });

  it("captures node visibility as discrete animation keyframes", () => {
    const store = new EditorStore(createBlueprintFixture());
    const box = store.blueprint.nodes.find((node) => node.type === "box");

    expect(box).toBeTruthy();
    if (!box) {
      throw new Error("Expected box node.");
    }

    const trackId = store.ensureAnimationTrack(box.id, "visible");
    store.toggleNodeVisibility(box.id);
    store.addAnimationKeyframe(trackId, 0);
    store.toggleNodeVisibility(box.id);
    store.addAnimationKeyframe(trackId, 12);

    const track = store.getAnimationTrack(trackId);
    expect(track?.property).toBe("visible");
    expect(track?.keyframes.map((keyframe) => ({ frame: keyframe.frame, value: keyframe.value }))).toEqual([
      { frame: 0, value: 0 },
      { frame: 12, value: 1 },
    ]);
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

  it("setTrackMuted(true) sets the muted flag and setTrackMuted(false) deletes the property for JSON cleanliness", () => {
    const store = new EditorStore(createBlueprintFixture());
    const clip = store.animation.clips[0];
    expect(clip).toBeTruthy();
    const track = clip?.tracks[0];
    expect(track).toBeTruthy();
    if (!clip || !track) {
      throw new Error("Expected animation clip and track.");
    }

    store.setTrackMuted(clip.id, track.id, true);
    const mutedTrack = store.animation.clips[0]?.tracks.find((candidate) => candidate.id === track.id);
    expect(mutedTrack?.muted).toBe(true);

    store.setTrackMuted(clip.id, track.id, false);
    const unmutedTrack = store.animation.clips[0]?.tracks.find((candidate) => candidate.id === track.id);
    expect(unmutedTrack).toBeTruthy();
    expect(unmutedTrack?.muted).toBeUndefined();
    expect(unmutedTrack && "muted" in unmutedTrack).toBe(false);
  });

  it("persists a muted track's muted field through JSON round-trip", () => {
    const store = new EditorStore(createBlueprintFixture());
    const clip = store.animation.clips[0];
    const track = clip?.tracks[0];
    if (!clip || !track) {
      throw new Error("Expected animation clip and track.");
    }
    store.setTrackMuted(clip.id, track.id, true);

    const json = exportBlueprintToJson(store.getSnapshot());
    const reloaded = new EditorStore(JSON.parse(json));
    const reloadedTrack = reloaded.animation.clips[0]?.tracks.find((candidate) => candidate.id === track.id);
    expect(reloadedTrack?.muted).toBe(true);
  });

  it("cascade-deletes tracks from every clip when a node is removed and restores them on undo", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const groupId = store.insertNode("group", ROOT_NODE_ID);
    const childId = store.insertNode("sphere", groupId);
    expect(store.getNode(childId)?.parentId).toBe(groupId);

    const firstTrackId = store.ensureAnimationTrack(groupId, "transform.position.x");
    expect(firstTrackId).toBeTruthy();
    const childTrackId = store.ensureAnimationTrack(childId, "transform.scale.y");
    expect(childTrackId).toBeTruthy();

    // Add a second clip and ensure tracks exist there too (createAnimationClip activates it).
    const secondaryClipId = store.createAnimationClip("secondary");
    expect(store.animation.activeClipId).toBe(secondaryClipId);
    const secondaryBoxTrackId = store.ensureAnimationTrack(groupId, "transform.rotation.z");
    const secondaryChildTrackId = store.ensureAnimationTrack(childId, "transform.position.y");
    expect(secondaryBoxTrackId).toBeTruthy();
    expect(secondaryChildTrackId).toBeTruthy();

    const beforeNodeCount = store.blueprint.nodes.length;
    const beforeClipTrackCounts = store.animation.clips.map((clip) => clip.tracks.length);

    store.deleteNode(groupId);

    // Node and descendant are gone.
    expect(store.getNode(groupId)).toBeUndefined();
    expect(store.getNode(childId)).toBeUndefined();

    // Tracks referencing the deleted subtree are removed from every clip.
    for (const clip of store.animation.clips) {
      for (const track of clip.tracks) {
        expect(track.nodeId).not.toBe(groupId);
        expect(track.nodeId).not.toBe(childId);
      }
    }

    // Undo restores nodes AND their tracks in one step.
    expect(store.undo()).toBe(true);
    expect(store.blueprint.nodes.length).toBe(beforeNodeCount);
    expect(store.getNode(groupId)).toBeTruthy();
    expect(store.getNode(childId)).toBeTruthy();
    expect(store.animation.clips.map((clip) => clip.tracks.length)).toEqual(beforeClipTrackCounts);
  });

  it("deleteSelected with multi-select cascades delete of nodes and tracks across clips", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const sphereId = store.insertNode("sphere", ROOT_NODE_ID);

    store.ensureAnimationTrack(boxId, "transform.position.x");
    store.ensureAnimationTrack(sphereId, "transform.scale.x");
    store.createAnimationClip("secondary");
    store.ensureAnimationTrack(boxId, "transform.rotation.z");
    store.ensureAnimationTrack(sphereId, "transform.position.y");

    store.setSelectedNodes([boxId, sphereId]);
    store.deleteSelected();

    expect(store.getNode(boxId)).toBeUndefined();
    expect(store.getNode(sphereId)).toBeUndefined();
    for (const clip of store.animation.clips) {
      for (const track of clip.tracks) {
        expect([boxId, sphereId]).not.toContain(track.nodeId);
      }
    }
  });

  it("duplicateAnimationClip returns a new clip with fresh ids, preserves muted, and does not change the active clip", () => {
    const store = new EditorStore(createBlueprintFixture());
    const originalClip = store.animation.clips[0];
    expect(originalClip).toBeTruthy();
    if (!originalClip) {
      throw new Error("Expected animation clip.");
    }
    const originalTrack = originalClip.tracks[0];
    expect(originalTrack).toBeTruthy();
    if (!originalTrack) {
      throw new Error("Expected animation track.");
    }

    // Mark the first track muted so we can assert preservation.
    store.setTrackMuted(originalClip.id, originalTrack.id, true);

    const beforeActive = store.animation.activeClipId;
    const duplicateId = store.duplicateAnimationClip(originalClip.id);
    expect(duplicateId).toBeTruthy();
    if (!duplicateId) {
      throw new Error("Duplicate should return an id.");
    }

    // Active clip should NOT change.
    expect(store.animation.activeClipId).toBe(beforeActive);

    const duplicatedClip = store.animation.clips.find((clip) => clip.id === duplicateId);
    expect(duplicatedClip).toBeTruthy();
    if (!duplicatedClip) {
      throw new Error("Duplicated clip should exist.");
    }
    expect(duplicatedClip.id).not.toBe(originalClip.id);
    expect(duplicatedClip.name).toBe(`${originalClip.name} (copy)`);
    expect(duplicatedClip.tracks.length).toBe(originalClip.tracks.length);

    const dupTrack = duplicatedClip.tracks[0];
    const originalTrackAfter = store.getAnimationClip(originalClip.id)?.tracks[0];
    expect(dupTrack.id).not.toBe(originalTrackAfter?.id);
    expect(dupTrack.nodeId).toBe(originalTrackAfter?.nodeId);
    expect(dupTrack.property).toBe(originalTrackAfter?.property);
    expect(dupTrack.muted).toBe(true);

    for (let index = 0; index < dupTrack.keyframes.length; index += 1) {
      const dupKey = dupTrack.keyframes[index];
      const origKey = originalTrackAfter?.keyframes[index];
      expect(dupKey.id).not.toBe(origKey?.id);
      expect(dupKey.frame).toBe(origKey?.frame);
      expect(dupKey.value).toBe(origKey?.value);
      expect(dupKey.ease).toBe(origKey?.ease);
    }

    // Second duplicate yields suffix "(copy) 2".
    const secondDuplicateId = store.duplicateAnimationClip(originalClip.id);
    expect(secondDuplicateId).toBeTruthy();
    const secondDupClip = store.animation.clips.find((clip) => clip.id === secondDuplicateId);
    expect(secondDupClip?.name).toBe(`${originalClip.name} (copy) 2`);
  });

  it("duplicateAnimationClip deep-clones so deleting the original leaves the duplicate intact", () => {
    const store = new EditorStore(createBlueprintFixture());
    const originalClip = store.animation.clips[0];
    if (!originalClip) {
      throw new Error("Expected animation clip.");
    }
    const originalTrackCount = originalClip.tracks.length;
    const originalKeyframeCount = originalClip.tracks.reduce((sum, track) => sum + track.keyframes.length, 0);

    // Need at least 2 clips to be able to remove one (removeAnimationClip refuses to delete the last).
    const duplicateId = store.duplicateAnimationClip(originalClip.id);
    expect(duplicateId).toBeTruthy();
    if (!duplicateId) {
      throw new Error("Duplicate should return an id.");
    }

    store.removeAnimationClip(originalClip.id);

    const remaining = store.animation.clips.find((clip) => clip.id === duplicateId);
    expect(remaining).toBeTruthy();
    expect(remaining?.tracks.length).toBe(originalTrackCount);
    expect(remaining?.tracks.reduce((sum, track) => sum + track.keyframes.length, 0)).toBe(originalKeyframeCount);
  });

  it("removeAnimationKeyframes removes multiple keyframes in a single undoable step", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const trackId = store.ensureAnimationTrack(boxId, "transform.position.x");
    const k1 = store.addAnimationKeyframe(trackId, 0, 0);
    const k2 = store.addAnimationKeyframe(trackId, 12, 1);
    const k3 = store.addAnimationKeyframe(trackId, 24, 2);

    store.removeAnimationKeyframes(trackId, [k1, k3]);

    const track = store.getAnimationTrack(trackId);
    expect(track?.keyframes.map((keyframe) => keyframe.id)).toEqual([k2]);

    // Single undo restores both removals.
    expect(store.undo()).toBe(true);
    const restored = store.getAnimationTrack(trackId);
    expect(restored?.keyframes.map((keyframe) => keyframe.id).sort()).toEqual([k1, k2, k3].sort());
  });

  it("removeAnimationKeyframes with empty list is a no-op and does not grow the undo stack", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const trackId = store.ensureAnimationTrack(boxId, "transform.position.x");
    store.addAnimationKeyframe(trackId, 0, 0);

    const undoBefore = store.canUndo;
    store.removeAnimationKeyframes(trackId, []);
    expect(store.canUndo).toBe(undoBefore);
  });

  it("shiftAnimationKeyframes clamps negative results to 0 and past-duration results to durationFrames", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const trackId = store.ensureAnimationTrack(boxId, "transform.position.x");
    const clip = store.getActiveAnimationClip();
    expect(clip).toBeTruthy();
    if (!clip) {
      throw new Error("Expected clip.");
    }
    const duration = clip.durationFrames;

    const earlyId = store.addAnimationKeyframe(trackId, 5, 0);
    const lateId = store.addAnimationKeyframe(trackId, duration - 5, 1);

    // Negative shift past 0 → clamp.
    store.shiftAnimationKeyframes(trackId, [earlyId], -100);
    let track = store.getAnimationTrack(trackId);
    expect(track?.keyframes.find((keyframe) => keyframe.id === earlyId)?.frame).toBe(0);

    // Positive shift past durationFrames → clamp.
    store.shiftAnimationKeyframes(trackId, [lateId], 1000);
    track = store.getAnimationTrack(trackId);
    expect(track?.keyframes.find((keyframe) => keyframe.id === lateId)?.frame).toBe(duration);
  });

  it("shiftAnimationKeyframes collides with a non-shifted keyframe using last-wins semantics", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const trackId = store.ensureAnimationTrack(boxId, "transform.position.x");
    const staticId = store.addAnimationKeyframe(trackId, 10, 0);
    const movingId = store.addAnimationKeyframe(trackId, 5, 1);

    // Shift the moving keyframe forward so it lands exactly on the static keyframe's frame.
    store.shiftAnimationKeyframes(trackId, [movingId], 5);

    const track = store.getAnimationTrack(trackId);
    expect(track).toBeTruthy();
    // Only one keyframe should remain at frame 10 — the shifted one wins.
    const atFrame10 = track?.keyframes.filter((keyframe) => keyframe.frame === 10) ?? [];
    expect(atFrame10).toHaveLength(1);
    expect(atFrame10[0].id).toBe(movingId);
    expect(track?.keyframes.find((keyframe) => keyframe.id === staticId)).toBeUndefined();
  });

  it("shiftAnimationKeyframes with empty list is a no-op and does not grow the undo stack", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const trackId = store.ensureAnimationTrack(boxId, "transform.position.x");
    store.addAnimationKeyframe(trackId, 10, 0);

    const undoBefore = store.canUndo;
    store.shiftAnimationKeyframes(trackId, [], 5);
    expect(store.canUndo).toBe(undoBefore);
  });

  it("updateAnimationKeyframes applies ease and value patches to all listed keyframes", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const trackId = store.ensureAnimationTrack(boxId, "transform.position.x");
    const k1 = store.addAnimationKeyframe(trackId, 0, 0, "linear");
    const k2 = store.addAnimationKeyframe(trackId, 12, 1, "linear");
    const k3 = store.addAnimationKeyframe(trackId, 24, 2, "linear");

    store.updateAnimationKeyframes(trackId, [k1, k2, k3], { ease: "easeOut", value: 9 });

    const track = store.getAnimationTrack(trackId);
    expect(track).toBeTruthy();
    for (const keyframe of track?.keyframes ?? []) {
      expect(keyframe.ease).toBe("easeOut");
      expect(keyframe.value).toBe(9);
    }
  });

  it("updateAnimationKeyframes with empty patch is a no-op and does not grow the undo stack", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const trackId = store.ensureAnimationTrack(boxId, "transform.position.x");
    const keyframeId = store.addAnimationKeyframe(trackId, 0, 0, "linear");

    const undoBefore = store.canUndo;
    store.updateAnimationKeyframes(trackId, [keyframeId], {});
    expect(store.canUndo).toBe(undoBefore);
  });

  it("updateAnimationKeyframes with empty keyframeIds is a no-op and does not grow the undo stack", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const trackId = store.ensureAnimationTrack(boxId, "transform.position.x");
    store.addAnimationKeyframe(trackId, 0, 0, "linear");

    const undoBefore = store.canUndo;
    store.updateAnimationKeyframes(trackId, [], { ease: "easeOut" });
    expect(store.canUndo).toBe(undoBefore);
  });

  it("selectAll selects every non-ROOT node and keeps the primary if already selected", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const sphereId = store.insertNode("sphere", ROOT_NODE_ID);

    store.selectNode(sphereId);
    store.selectAll();

    const selected = store.selectedNodeIds;
    expect(selected).toContain(boxId);
    expect(selected).toContain(sphereId);
    expect(selected).not.toContain(ROOT_NODE_ID);
    expect(store.selectedNodeId).toBe(sphereId);
  });

  it("clearSelection resets selection to the ROOT node", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const sphereId = store.insertNode("sphere", ROOT_NODE_ID);

    store.setSelectedNodes([boxId, sphereId]);
    store.clearSelection();

    expect(store.selectedNodeIds).toEqual([ROOT_NODE_ID]);
    expect(store.selectedNodeId).toBe(ROOT_NODE_ID);
  });

  it("moveSelectedNodes moves all selected root ids into the target parent, preserving order, in a single undo step", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const groupId = store.insertNode("group", ROOT_NODE_ID);
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const sphereId = store.insertNode("sphere", ROOT_NODE_ID);

    store.setSelectedNodes([boxId, sphereId], "ui", sphereId);

    const moved = store.moveSelectedNodes(groupId, 0);
    expect(moved).toBe(true);

    const groupChildren = store.getNodeChildren(groupId).map((node) => node.id);
    expect(groupChildren).toEqual([boxId, sphereId]);

    // A single undo restores both nodes to their original parent (one history entry).
    store.undo();
    const rootChildren = store.getNodeChildren(ROOT_NODE_ID).map((node) => node.id);
    expect(rootChildren).toContain(boxId);
    expect(rootChildren).toContain(sphereId);
    expect(store.getNodeChildren(groupId).map((node) => node.id)).toEqual([]);
  });

  it("moveSelectedNodes rejects drops into a descendant of a selected node", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const outerGroupId = store.insertNode("group", ROOT_NODE_ID);
    const innerGroupId = store.insertNode("group", outerGroupId);
    const sphereId = store.insertNode("sphere", ROOT_NODE_ID);

    store.setSelectedNodes([outerGroupId, sphereId], "ui", sphereId);
    expect(store.moveSelectedNodes(innerGroupId, 0)).toBe(false);
  });
});

describe("property clipboard", () => {
  function setColor(store: EditorStore, nodeId: string, color: string): void {
    const node = store.getNode(nodeId);
    if (!node || node.type === "group") {
      throw new Error(`expected non-group node ${nodeId}`);
    }
    const defs = getPropertyDefinitions(node);
    const colorDef = defs.find((def) => def.path === "material.color");
    if (!colorDef) {
      throw new Error(`no material.color on ${nodeId}`);
    }
    store.updateNodeProperty(nodeId, colorDef, color);
  }

  function setMaterialType(store: EditorStore, nodeId: string, type: "basic" | "standard"): void {
    const node = store.getNode(nodeId);
    if (!node || node.type === "group") {
      throw new Error(`expected non-group node ${nodeId}`);
    }
    const defs = getPropertyDefinitions(node);
    const typeDef = defs.find((def) => def.path === "material.type");
    if (!typeDef) {
      throw new Error(`no material.type on ${nodeId}`);
    }
    store.updateNodeProperty(nodeId, typeDef, type);
  }

  function setEmissive(store: EditorStore, nodeId: string, color: string): void {
    const node = store.getNode(nodeId);
    if (!node || node.type === "group") {
      throw new Error(`expected non-group node ${nodeId}`);
    }
    const defs = getPropertyDefinitions(node);
    const emissiveDef = defs.find((def) => def.path === "material.emissive");
    if (!emissiveDef) {
      throw new Error(`no material.emissive on ${nodeId}`);
    }
    store.updateNodeProperty(nodeId, emissiveDef, color);
  }

  function materialColorOf(store: EditorStore, nodeId: string): string {
    const node = store.getNode(nodeId);
    if (!node || node.type === "group") {
      throw new Error(`expected non-group node ${nodeId}`);
    }
    return node.material.color;
  }

  function containsKeyDeep(value: unknown, key: string): boolean {
    if (Array.isArray(value)) {
      return value.some((item) => containsKeyDeep(item, key));
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === key) {
          return true;
        }
        if (containsKeyDeep(v, key)) {
          return true;
        }
      }
    }
    return false;
  }

  it("round-trips material color from one box to another via copy then paste", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    setColor(store, boxAId, "#ff0000");
    setColor(store, boxBId, "#0000ff");

    store.selectNode(boxAId);
    const clipboard = store.capturePropertiesFromSelection();
    expect(clipboard).not.toBeNull();

    store.selectNode(boxBId);
    const report = store.applyPropertiesToSelection("material");

    expect(materialColorOf(store, boxBId)).toBe("#ff0000");
    expect(report.applied).toBeGreaterThanOrEqual(1);
  });

  it("applies to multiple targets in a single history transaction (one undo reverts all)", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    const boxCId = store.insertNode("box", ROOT_NODE_ID);

    setColor(store, boxAId, "#ff0000");
    setColor(store, boxBId, "#00ff00");
    setColor(store, boxCId, "#0000ff");

    const preBColor = materialColorOf(store, boxBId);
    const preCColor = materialColorOf(store, boxCId);

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([boxBId, boxCId], "ui", boxBId);
    store.applyPropertiesToSelection("material");

    expect(materialColorOf(store, boxBId)).toBe("#ff0000");
    expect(materialColorOf(store, boxCId)).toBe("#ff0000");

    expect(store.undo()).toBe(true);

    expect(materialColorOf(store, boxBId)).toBe(preBColor);
    expect(materialColorOf(store, boxCId)).toBe(preCColor);
  });

  it("reports incompatibility for sphere targets under scope 'geometry' from a box source", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const sphereId = store.insertNode("sphere", ROOT_NODE_ID);

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([sphereId]);
    const report = store.applyPropertiesToSelection("geometry");

    expect(report.applied).toBe(0);
    expect(report.skippedIncompatible).toBeGreaterThan(0);

    // Transform paths are NOT part of scope "geometry", so they must not be
    // counted in this report at all.
    expect(report.perPath["transform.position.x"]).toBeUndefined();
  });

  it("canPasteProperties gates on clipboard presence and scope applicability", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    const groupId = store.insertNode("group", ROOT_NODE_ID);

    // No clipboard yet.
    expect(store.canPasteProperties("material", [boxBId])).toBe(false);

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    expect(store.canPasteProperties("material", [boxBId])).toBe(true);
    expect(store.canPasteProperties("geometry", [groupId])).toBe(false);
  });

  it("preserves the clipboard across unrelated mutations", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    store.selectNode(boxAId);
    const clipboard = store.capturePropertiesFromSelection();
    expect(clipboard).not.toBeNull();
    const originalEntryCount = clipboard!.entries.length;

    // Unrelated mutations.
    const newBoxId = store.insertNode("box", ROOT_NODE_ID);
    store.selectNode(newBoxId);
    store.moveSelectedNodes(ROOT_NODE_ID, 0);
    store.ensureAnimationTrack(newBoxId, "transform.position.x");

    expect(store.propertyClipboard).not.toBeNull();
    expect(store.propertyClipboard!.entries.length).toBe(originalEntryCount);
  });

  it("does not leak the clipboard into the exported blueprint JSON", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    const json = exportBlueprintToJson(store.blueprint);
    expect(json.includes("propertyClipboard")).toBe(false);

    const parsed = JSON.parse(json) as unknown;
    expect(containsKeyDeep(parsed, "propertyClipboard")).toBe(false);
  });

  it("promotes basic target to standard and carries PBR values through in the same apply", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);

    setMaterialType(store, boxAId, "standard");
    setEmissive(store, boxAId, "#abcdef");
    setMaterialType(store, boxBId, "basic");

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([boxBId]);
    const report = store.applyPropertiesToSelection("material");

    // After the fix, applyPropertiesToSelection detects the pending
    // material.type promotion and re-plans PBR entries against the
    // post-promotion type. The target ends up as standard AND carries the
    // PBR values from the source.
    const boxB = store.getNode(boxBId);
    if (!boxB || boxB.type === "group") {
      throw new Error("expected box B to remain a non-group node");
    }
    expect(boxB.material.type).toBe("standard");
    expect(boxB.material.emissive).toBe("#abcdef");

    expect(report.perPath["material.type"]?.applied ?? 0).toBeGreaterThanOrEqual(1);
    expect(report.perPath["material.emissive"]?.applied ?? 0).toBeGreaterThanOrEqual(1);
    expect(report.perPath["material.emissive"]?.incompatible ?? 0).toBe(0);
  });

  it("lifts full PBR material from standard source to basic target under scope 'material'", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);

    setMaterialType(store, boxAId, "standard");
    const boxA = store.getNode(boxAId);
    if (!boxA || boxA.type === "group") {
      throw new Error("expected box A to be non-group");
    }
    const defsA = getPropertyDefinitions(boxA);
    const emissiveDef = defsA.find((def) => def.path === "material.emissive");
    const roughnessDef = defsA.find((def) => def.path === "material.roughness");
    const metalnessDef = defsA.find((def) => def.path === "material.metalness");
    const colorDef = defsA.find((def) => def.path === "material.color");
    if (!emissiveDef || !roughnessDef || !metalnessDef || !colorDef) {
      throw new Error("missing PBR property definitions on source");
    }
    store.updateNodeProperty(boxAId, emissiveDef, "#ff0000");
    store.updateNodeProperty(boxAId, roughnessDef, 0.9);
    store.updateNodeProperty(boxAId, metalnessDef, 0.5);
    store.updateNodeProperty(boxAId, colorDef, "#00ff00");

    setMaterialType(store, boxBId, "basic");

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([boxBId]);
    const report = store.applyPropertiesToSelection("material");

    const boxB = store.getNode(boxBId);
    if (!boxB || boxB.type === "group") {
      throw new Error("expected box B to remain a non-group node");
    }
    expect(boxB.material.type).toBe("standard");
    expect(boxB.material.emissive).toBe("#ff0000");
    expect(boxB.material.roughness).toBe(0.9);
    expect(boxB.material.metalness).toBe(0.5);
    expect(boxB.material.color).toBe("#00ff00");

    expect(report.perPath["material.emissive"]?.applied ?? 0).toBe(1);
    expect(report.applied).toBeGreaterThanOrEqual(5);
  });

  it("still carries PBR values to a standard target that stays standard (regression for common case)", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);

    setMaterialType(store, boxAId, "standard");
    setMaterialType(store, boxBId, "standard");
    setEmissive(store, boxAId, "#112233");

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([boxBId]);
    const report = store.applyPropertiesToSelection("material");

    const boxB = store.getNode(boxBId);
    if (!boxB || boxB.type === "group") {
      throw new Error("expected box B to remain a non-group node");
    }
    expect(boxB.material.type).toBe("standard");
    expect(boxB.material.emissive).toBe("#112233");
    expect(report.perPath["material.emissive"]?.applied ?? 0).toBeGreaterThanOrEqual(1);
    expect(report.perPath["material.emissive"]?.incompatible ?? 0).toBe(0);
  });

  it("applies standard source uniformly to mixed basic + standard targets (mixed promotion)", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const sourceId = store.insertNode("box", ROOT_NODE_ID);
    const basicTargetId = store.insertNode("box", ROOT_NODE_ID);
    const standardTargetId = store.insertNode("box", ROOT_NODE_ID);

    setMaterialType(store, sourceId, "standard");
    setEmissive(store, sourceId, "#4488cc");
    setColor(store, sourceId, "#aabbcc");
    setMaterialType(store, basicTargetId, "basic");
    setMaterialType(store, standardTargetId, "standard");

    store.selectNode(sourceId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([basicTargetId, standardTargetId], "ui", basicTargetId);
    store.applyPropertiesToSelection("material");

    const basicTarget = store.getNode(basicTargetId);
    const standardTarget = store.getNode(standardTargetId);
    if (
      !basicTarget ||
      !standardTarget ||
      basicTarget.type === "group" ||
      standardTarget.type === "group"
    ) {
      throw new Error("expected both targets to be non-group");
    }

    expect(basicTarget.material.type).toBe("standard");
    expect(standardTarget.material.type).toBe("standard");
    expect(basicTarget.material.emissive).toBe("#4488cc");
    expect(standardTarget.material.emissive).toBe("#4488cc");
    expect(basicTarget.material.color).toBe("#aabbcc");
    expect(standardTarget.material.color).toBe("#aabbcc");
  });

  it("demotes a standard target when source is basic and leaves existing PBR fields untouched", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const sourceId = store.insertNode("box", ROOT_NODE_ID);
    const targetId = store.insertNode("box", ROOT_NODE_ID);

    setMaterialType(store, sourceId, "basic");
    setMaterialType(store, targetId, "standard");
    setEmissive(store, targetId, "#123456");
    const targetBefore = store.getNode(targetId);
    if (!targetBefore || targetBefore.type === "group") {
      throw new Error("expected target to be non-group");
    }
    const priorRoughness = targetBefore.material.roughness;
    const priorMetalness = targetBefore.material.metalness;

    store.selectNode(sourceId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([targetId]);
    const report = store.applyPropertiesToSelection("material");

    const targetAfter = store.getNode(targetId);
    if (!targetAfter || targetAfter.type === "group") {
      throw new Error("expected target to remain non-group");
    }
    expect(targetAfter.material.type).toBe("basic");
    // Demotion does not clobber PBR fields on the underlying spec — they
    // simply become hidden from the property surface.
    expect(targetAfter.material.emissive).toBe("#123456");
    expect(targetAfter.material.roughness).toBe(priorRoughness);
    expect(targetAfter.material.metalness).toBe(priorMetalness);
    // No PBR writes should appear in the report because the source did not
    // carry them.
    expect(report.perPath["material.emissive"]?.applied ?? 0).toBe(0);
    expect(report.perPath["material.roughness"]?.applied ?? 0).toBe(0);
    expect(report.perPath["material.metalness"]?.applied ?? 0).toBe(0);
  });

  it("applies shadow flags across targets under scope 'shadow'", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const sourceId = store.insertNode("box", ROOT_NODE_ID);
    const targetAId = store.insertNode("box", ROOT_NODE_ID);
    const targetBId = store.insertNode("box", ROOT_NODE_ID);

    const source = store.getNode(sourceId);
    if (!source || source.type === "group") {
      throw new Error("expected source to be non-group");
    }
    const castShadowDef = getPropertyDefinitions(source).find(
      (def) => def.path === "material.castShadow",
    );
    if (!castShadowDef) {
      throw new Error("missing material.castShadow definition");
    }
    store.updateNodeProperty(sourceId, castShadowDef, false);

    const targetABefore = store.getNode(targetAId);
    const targetBBefore = store.getNode(targetBId);
    if (
      !targetABefore ||
      !targetBBefore ||
      targetABefore.type === "group" ||
      targetBBefore.type === "group"
    ) {
      throw new Error("expected both targets to be non-group");
    }
    expect(targetABefore.material.castShadow).toBe(true);
    expect(targetBBefore.material.castShadow).toBe(true);

    store.selectNode(sourceId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([targetAId, targetBId], "ui", targetAId);
    store.applyPropertiesToSelection("shadow");

    const targetAAfter = store.getNode(targetAId);
    const targetBAfter = store.getNode(targetBId);
    if (
      !targetAAfter ||
      !targetBAfter ||
      targetAAfter.type === "group" ||
      targetBAfter.type === "group"
    ) {
      throw new Error("expected both targets to remain non-group");
    }
    expect(targetAAfter.material.castShadow).toBe(false);
    expect(targetBAfter.material.castShadow).toBe(false);
  });

  it("redo re-applies a property paste after undo (full undo/redo chain)", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    setColor(store, boxAId, "#ff0000");
    setColor(store, boxBId, "#0000ff");

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([boxBId]);
    store.applyPropertiesToSelection("material");
    expect(materialColorOf(store, boxBId)).toBe("#ff0000");

    // Undo reverts the paste.
    expect(store.canUndo).toBe(true);
    expect(store.undo()).toBe(true);
    expect(materialColorOf(store, boxBId)).toBe("#0000ff");

    // Redo re-applies it.
    expect(store.canRedo).toBe(true);
    expect(store.redo()).toBe(true);
    expect(materialColorOf(store, boxBId)).toBe("#ff0000");
  });

  it("paste still succeeds when the clipboard source node has been deleted", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    setColor(store, boxAId, "#ff0000");
    setColor(store, boxBId, "#0000ff");

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    // Delete the source node after capture — the clipboard holds cloned values.
    store.deleteNode(boxAId);
    expect(store.getNode(boxAId)).toBeUndefined();
    expect(store.propertyClipboard).not.toBeNull();
    expect(store.canPasteProperties("all", [boxBId])).toBe(true);

    store.setSelectedNodes([boxBId]);
    const report = store.applyPropertiesToSelection("all");

    expect(materialColorOf(store, boxBId)).toBe("#ff0000");
    expect(report.applied).toBeGreaterThan(0);
  });

  it("applyPropertiesToSelection with no capture returns an empty report and no history step", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxId = store.insertNode("box", ROOT_NODE_ID);
    const notifications: string[] = [];
    store.subscribe((change) => notifications.push(change.reason));

    store.setSelectedNodes([boxId]);
    const canUndoBefore = store.canUndo;
    const report = store.applyPropertiesToSelection("material");

    expect(report.applied).toBe(0);
    expect(report.skippedIncompatible).toBe(0);
    expect(Object.keys(report.perPath)).toHaveLength(0);
    expect(store.canUndo).toBe(canUndoBefore);
    // No "node" or "history" notification — silent no-op.
    expect(notifications).not.toContain("node");
    expect(notifications).not.toContain("history");
  });

  it("group source -> box target scope 'geometry' yields zero applicable entries and canPasteProperties is false", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const groupSourceId = store.insertNode("group", ROOT_NODE_ID);
    const boxTargetId = store.insertNode("box", ROOT_NODE_ID);

    store.selectNode(groupSourceId);
    store.capturePropertiesFromSelection();

    // A group captures no geometry entries, so pasting with scope "geometry"
    // to a box must be a no-op — nothing to apply, nothing to count as
    // incompatible either.
    expect(store.canPasteProperties("geometry", [boxTargetId])).toBe(false);

    store.setSelectedNodes([boxTargetId]);
    const report = store.applyPropertiesToSelection("geometry");
    expect(report.applied).toBe(0);
  });

  it("multi-target mixed compatibility — box+sphere accept, group incompatible, report buckets reflect per-node counts", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const sourceId = store.insertNode("box", ROOT_NODE_ID);
    const boxTargetId = store.insertNode("box", ROOT_NODE_ID);
    const sphereTargetId = store.insertNode("sphere", ROOT_NODE_ID);
    const groupTargetId = store.insertNode("group", ROOT_NODE_ID);

    setColor(store, sourceId, "#ff5500");

    store.selectNode(sourceId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([boxTargetId, sphereTargetId, groupTargetId], "ui", boxTargetId);
    const report = store.applyPropertiesToSelection("material");

    expect(report.applied).toBeGreaterThan(0);
    expect(report.skippedIncompatible).toBeGreaterThan(0);

    // Box and sphere must have applied writes.
    expect(report.perNode[boxTargetId]?.applied ?? 0).toBeGreaterThan(0);
    expect(report.perNode[sphereTargetId]?.applied ?? 0).toBeGreaterThan(0);

    // The group cannot receive material entries — its bucket should only count
    // incompatibles (if any) and no applied writes.
    expect(report.perNode[groupTargetId]?.applied ?? 0).toBe(0);
    expect(report.perNode[groupTargetId]?.incompatible ?? 0).toBeGreaterThan(0);

    // Box target receives the color; the sphere does too (direct match).
    expect(materialColorOf(store, boxTargetId)).toBe("#ff5500");
    expect(materialColorOf(store, sphereTargetId)).toBe("#ff5500");
  });
});

describe("inspector keyframing", () => {
    function setupBoxStore() {
      const store = new EditorStore(createBlueprintFixture());
      const box = store.blueprint.nodes.find((node) => node.type === "box");
      if (!box) {
        throw new Error("Expected box node in fixture.");
      }
      return { store, box };
    }

    it("insertOrUpdateKeyframeAtFrame creates the track on first call and uses the supplied value", () => {
      const { store, box } = setupBoxStore();

      const keyframeId = store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 12, 3.5);

      expect(keyframeId).not.toBe("");
      const track = store.getAnimationTrackForProperty(box.id, "transform.position.z");
      expect(track?.keyframes.map((k) => ({ frame: k.frame, value: k.value }))).toEqual([
        { frame: 12, value: 3.5 },
      ]);
    });

    it("insertOrUpdateKeyframeAtFrame at the same frame replaces, never duplicates", () => {
      const { store, box } = setupBoxStore();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 12, 1);
      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 12, 5);

      const track = store.getAnimationTrackForProperty(box.id, "transform.position.z");
      expect(track?.keyframes.length).toBe(1);
      expect(track?.keyframes[0]).toMatchObject({ frame: 12, value: 5 });
    });

    it("insertOrUpdateKeyframeAtFrame keeps separate keyframes per frame, sorted", () => {
      const { store, box } = setupBoxStore();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 24, 2);
      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 0, 0);
      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 12, 1);

      const track = store.getAnimationTrackForProperty(box.id, "transform.position.z");
      expect(track?.keyframes.map((k) => k.frame)).toEqual([0, 12, 24]);
    });

    it("removeKeyframeAtFrame removes a key and reports success / failure", () => {
      const { store, box } = setupBoxStore();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 6, 0.25);
      expect(store.removeKeyframeAtFrame(box.id, "transform.position.z", 6)).toBe(true);
      expect(store.getAnimationTrackForProperty(box.id, "transform.position.z")?.keyframes).toEqual([]);
      expect(store.removeKeyframeAtFrame(box.id, "transform.position.z", 6)).toBe(false);
      expect(store.removeKeyframeAtFrame(box.id, "transform.position.y", 6)).toBe(false);
    });

    it("commitAnimatableValueAtFrame updates the keyframe when on a keyed frame", () => {
      const { store, box } = setupBoxStore();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 8, 1);
      const baseBefore = box.transform.position.z;

      const committed = store.commitAnimatableValueAtFrame(box.id, "transform.position.z", 9.75, 8);

      expect(committed).toBe(true);
      expect(box.transform.position.z).toBe(baseBefore); // base untouched
      const track = store.getAnimationTrackForProperty(box.id, "transform.position.z");
      expect(track?.keyframes[0].value).toBe(9.75);
    });

    it("cancels an in-progress keyed edit without changing the previous keyframe value", () => {
      const { store, box } = setupBoxStore();
      const definition = getPropertyDefinitions(box).find((entry) => entry.path === "transform.position.z");
      expect(definition).toBeTruthy();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 0, 2.5);
      store.beginHistoryTransaction();
      store.updateNodePropertyAtFrame(box.id, definition!, "8.5", 0);
      store.cancelHistoryTransaction("ui");

      const track = store.getAnimationTrackForProperty(box.id, "transform.position.z");
      expect(track?.keyframes).toHaveLength(1);
      expect(track?.keyframes[0]).toMatchObject({ frame: 0, value: 2.5 });
    });

    it("commitAnimatableValueAtFrame returns false when no key sits at the frame", () => {
      const { store, box } = setupBoxStore();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 0, 0);

      expect(store.commitAnimatableValueAtFrame(box.id, "transform.position.z", 2, 5)).toBe(false);
      expect(store.commitAnimatableValueAtFrame(box.id, "transform.position.y", 2, 0)).toBe(false);
    });

    it("updateNodePropertyAtFrame does not update keyframes automatically when on a keyframe", () => {
      const { store, box } = setupBoxStore();
      const definition = getPropertyDefinitions(box).find((entry) => entry.path === "transform.position.z");
      expect(definition).toBeTruthy();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 4, 1);
      const baseBefore = box.transform.position.z;

      store.updateNodePropertyAtFrame(box.id, definition!, "8.5", 4);

      expect(box.transform.position.z).toBe(baseBefore); // base untouched
      const track = store.getAnimationTrackForProperty(box.id, "transform.position.z");
      expect(track?.keyframes[0].value).toBe(1);
    });

    it("updateNodePropertyAtFrame falls through to base when the property is not animated", () => {
      const { store, box } = setupBoxStore();
      const definition = getPropertyDefinitions(box).find((entry) => entry.path === "transform.position.z");
      expect(definition).toBeTruthy();

      store.updateNodePropertyAtFrame(box.id, definition!, "7.25", 4);

      expect(box.transform.position.z).toBe(7.25);
      expect(store.getAnimationTrackForProperty(box.id, "transform.position.z")).toBeUndefined();
    });

    it("setNodeTransformProperties only writes the transform axes supplied by the viewport", () => {
      const { store, box } = setupBoxStore();
      box.transform.position.y = 0.8;
      box.transform.position.z = 0.1;
      box.transform.rotation.z = 0.25;

      store.setNodeTransformProperties(box.id, {
        "transform.position.z": 3.5,
      });

      expect(box.transform.position.y).toBe(0.8);
      expect(box.transform.position.z).toBe(3.5);
      expect(box.transform.rotation.z).toBe(0.25);
    });

    it("updateNodePropertyAtFrame does not mutate base when animated between keyframes", () => {
      const { store, box } = setupBoxStore();
      const definition = getPropertyDefinitions(box).find((entry) => entry.path === "transform.position.z");
      expect(definition).toBeTruthy();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 0, 0);
      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 12, 12);
      const baseBefore = box.transform.position.z;

      store.updateNodePropertyAtFrame(box.id, definition!, "7.25", 6);

      expect(box.transform.position.z).toBe(baseBefore);
      const track = store.getAnimationTrackForProperty(box.id, "transform.position.z");
      expect(track?.keyframes.map((keyframe) => ({ frame: keyframe.frame, value: keyframe.value }))).toEqual([
        { frame: 0, value: 0 },
        { frame: 12, value: 12 },
      ]);
    });

    it("evaluates animated properties without mutating base node state", () => {
      const { store, box } = setupBoxStore();
      box.transform.position.z = 5;

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 0, 0);
      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 10, 10);

      expect(store.getEvaluatedPropertyValue(box.id, "transform.position.z", 0)).toBe(0);
      expect(store.getEvaluatedPropertyValue(box.id, "transform.position.z", 5)).toBe(5);
      expect(box.transform.position.z).toBe(5);
    });

    it("keeps runtime editable bindings independent from animation keyframes", () => {
      const { store, box } = setupBoxStore();
      const definition = getPropertyDefinitions(box).find((entry) => entry.path === "transform.position.z");
      expect(definition).toBeTruthy();

      store.toggleEditableProperty(box.id, definition!, true);
      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 0, 3);

      expect(box.editable["transform.position.z"]).toBeTruthy();
      expect(store.getAnimationTrackForProperty(box.id, "transform.position.z")?.keyframes[0]).toMatchObject({
        frame: 0,
        value: 3,
      });

      store.toggleEditableProperty(box.id, definition!, false);
      expect(box.editable["transform.position.z"]).toBeUndefined();
      expect(store.getAnimationTrackForProperty(box.id, "transform.position.z")?.keyframes).toHaveLength(1);
    });

    it("insertOrUpdateKeyframeAtFrame produces a single undo entry per call", () => {
      const { store, box } = setupBoxStore();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 5, 1);

      // Undo once should remove BOTH the track and the keyframe.
      expect(store.undo()).toBe(true);
      expect(store.getAnimationTrackForProperty(box.id, "transform.position.z")).toBeUndefined();
    });

    it("removing a keyframe and undoing restores it", () => {
      const { store, box } = setupBoxStore();

      store.insertOrUpdateKeyframeAtFrame(box.id, "transform.position.z", 5, 2.5);
      store.removeKeyframeAtFrame(box.id, "transform.position.z", 5);
      expect(store.getAnimationTrackForProperty(box.id, "transform.position.z")?.keyframes).toEqual([]);

      expect(store.undo()).toBe(true);
      expect(store.getAnimationTrackForProperty(box.id, "transform.position.z")?.keyframes[0].value).toBe(2.5);
    });
});
