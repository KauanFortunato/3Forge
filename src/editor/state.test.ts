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
    expect(store.animation.clips[0]?.tracks[0]?.keyframes.map((keyframe) => keyframe.frame)).toEqual([1, 12]);
    expect(store.animation.clips[0]?.tracks[1]).toMatchObject({
      property: "visible",
      keyframes: [
        { frame: 1, value: 1 },
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
});
