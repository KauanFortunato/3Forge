import { describe, expect, it } from "vitest";
import { exportBlueprintToJson } from "./exports";
import {
  createDefaultBlueprint,
  EditorStore,
  getPropertyDefinitions,
  ROOT_NODE_ID,
} from "./state";
import type { EditorNode, NodePropertyDefinition } from "./types";

// -----------------------------------------------------------------------------
// Local helpers (do not leak into production code).
// -----------------------------------------------------------------------------

function requireNonGroup(node: EditorNode | undefined): Exclude<EditorNode, { type: "group" }> {
  if (!node || node.type === "group") {
    throw new Error("expected non-group node");
  }
  return node;
}

function requireDef(node: EditorNode, path: string): NodePropertyDefinition {
  const def = getPropertyDefinitions(node).find((d) => d.path === path);
  if (!def) {
    throw new Error(`missing property definition for ${path} on ${node.type}`);
  }
  return def;
}

function setProperty(
  store: EditorStore,
  nodeId: string,
  path: string,
  value: string | number | boolean,
): void {
  const node = store.getNode(nodeId);
  if (!node) {
    throw new Error(`missing node ${nodeId}`);
  }
  store.updateNodeProperty(nodeId, requireDef(node, path), value);
}

function setMaterialType(store: EditorStore, nodeId: string, type: "basic" | "standard"): void {
  setProperty(store, nodeId, "material.type", type);
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

/** Round-trip a store through the canonical JSON import path. */
function roundTrip(store: EditorStore): { json: string; reloaded: EditorStore } {
  const json = exportBlueprintToJson(store.blueprint);
  const reloaded = new EditorStore(JSON.parse(json));
  return { json, reloaded };
}

// -----------------------------------------------------------------------------

describe("persistence after property clipboard", () => {
  it("never leaks propertyClipboard into re-exported JSON after copy + paste", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    setProperty(store, boxAId, "material.color", "#112233");

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();

    store.setSelectedNodes([boxBId]);
    store.applyPropertiesToSelection("material");

    // The clipboard is still populated in memory.
    expect(store.propertyClipboard).not.toBeNull();

    // Export AFTER paste — it must not carry the clipboard.
    const json = exportBlueprintToJson(store.blueprint);
    expect(json.includes("propertyClipboard")).toBe(false);
    const parsed = JSON.parse(json) as unknown;
    expect(containsKeyDeep(parsed, "propertyClipboard")).toBe(false);
    expect(containsKeyDeep(parsed, "capturedAt")).toBe(false);
    expect(containsKeyDeep(parsed, "sourceNodeId")).toBe(false);
  });

  it("reloaded store starts with a null propertyClipboard (no cross-session leak)", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    store.selectNode(boxAId);
    const captured = store.capturePropertiesFromSelection();
    expect(captured).not.toBeNull();
    expect(store.propertyClipboard).not.toBeNull();

    const { reloaded } = roundTrip(store);
    // Crucial non-leak guarantee: a freshly imported store has no clipboard.
    expect(reloaded.propertyClipboard).toBeNull();
  });

  it("is byte-for-byte stable across a second round-trip after multi-edit + clipboard apply", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    const boxCId = store.insertNode("box", ROOT_NODE_ID);

    // Multi-edit: change color on A + B + C in one shot.
    const sourceA = requireNonGroup(store.getNode(boxAId));
    const colorDef = requireDef(sourceA, "material.color");
    store.updateNodesProperty([boxAId, boxBId, boxCId], colorDef, "#336699");

    // Clipboard-apply: copy shadow flags from A, paste to B and C.
    setProperty(store, boxAId, "material.castShadow", false);
    setProperty(store, boxAId, "material.receiveShadow", false);
    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();
    store.setSelectedNodes([boxBId, boxCId], "ui", boxBId);
    store.applyPropertiesToSelection("shadow");

    // First round-trip → reloaded store.
    const firstJson = exportBlueprintToJson(store.blueprint);
    const reloaded = new EditorStore(JSON.parse(firstJson));
    const secondJson = exportBlueprintToJson(reloaded.blueprint);

    expect(secondJson).toBe(firstJson);

    // And the derived state matches.
    const reloadedB = requireNonGroup(reloaded.getNode(boxBId));
    const reloadedC = requireNonGroup(reloaded.getNode(boxCId));
    expect(reloadedB.material.color).toBe("#336699");
    expect(reloadedC.material.color).toBe("#336699");
    expect(reloadedB.material.castShadow).toBe(false);
    expect(reloadedC.material.castShadow).toBe(false);
  });

  it("persists cross-type geometry alias width from plane to image through export/import", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const planeId = store.insertNode("plane", ROOT_NODE_ID);
    const imageId = store.insertNode("image", ROOT_NODE_ID);

    setProperty(store, planeId, "geometry.width", 3.75);
    // Give the image a distinctly different starting width so we can prove the
    // copy actually landed (rather than being a no-op).
    setProperty(store, imageId, "geometry.width", 1.25);

    store.selectNode(planeId);
    store.capturePropertiesFromSelection();
    store.setSelectedNodes([imageId]);
    const report = store.applyPropertiesToSelection("geometry");
    expect(report.applied).toBeGreaterThanOrEqual(1);

    const beforeImage = store.getNode(imageId);
    if (!beforeImage || beforeImage.type !== "image") {
      throw new Error("expected image node before round-trip");
    }
    expect(beforeImage.geometry.width).toBe(3.75);

    const { reloaded } = roundTrip(store);
    const reloadedImage = reloaded.getNode(imageId);
    if (!reloadedImage || reloadedImage.type !== "image") {
      throw new Error("expected image node after round-trip");
    }
    expect(reloadedImage.geometry.width).toBe(3.75);
  });

  it("persists shadow + PBR values after basic→standard promotion from a clipboard apply", () => {
    // Note: castShadow/receiveShadow live in scope "shadow", not "material"
    // (see classifyClipboardScope). A single "all" apply pulls both in, which
    // is the closer analog of the "paste material + shadow" user action.
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);

    setMaterialType(store, boxAId, "standard");
    setProperty(store, boxAId, "material.emissive", "#abcdef");
    setProperty(store, boxAId, "material.roughness", 0.77);
    setProperty(store, boxAId, "material.metalness", 0.33);
    setProperty(store, boxAId, "material.castShadow", false);

    setMaterialType(store, boxBId, "basic");

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();
    store.setSelectedNodes([boxBId]);
    store.applyPropertiesToSelection("material");
    store.applyPropertiesToSelection("shadow");

    // Sanity before round-trip.
    const liveB = requireNonGroup(store.getNode(boxBId));
    expect(liveB.material.type).toBe("standard");
    expect(liveB.material.emissive).toBe("#abcdef");
    expect(liveB.material.roughness).toBe(0.77);
    expect(liveB.material.metalness).toBe(0.33);
    expect(liveB.material.castShadow).toBe(false);

    const { reloaded } = roundTrip(store);
    const reloadedB = requireNonGroup(reloaded.getNode(boxBId));
    expect(reloadedB.material.type).toBe("standard");
    expect(reloadedB.material.emissive).toBe("#abcdef");
    expect(reloadedB.material.roughness).toBe(0.77);
    expect(reloadedB.material.metalness).toBe(0.33);
    expect(reloadedB.material.castShadow).toBe(false);
  });

  it("normalizeBlueprint is a fixed point on a clipboard-mutated blueprint", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);

    setProperty(store, boxAId, "material.color", "#a1b2c3");
    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();
    store.setSelectedNodes([boxBId]);
    store.applyPropertiesToSelection("material");

    // First canonical serialization through the import path.
    const firstJson = exportBlueprintToJson(store.blueprint);
    const firstReload = new EditorStore(JSON.parse(firstJson));
    const afterFirst = exportBlueprintToJson(firstReload.blueprint);
    // Second import → re-export must equal first.
    const secondReload = new EditorStore(JSON.parse(afterFirst));
    const afterSecond = exportBlueprintToJson(secondReload.blueprint);

    expect(afterFirst).toBe(firstJson);
    expect(afterSecond).toBe(afterFirst);
  });

  it("preserves editable bindings on material.color across a clipboard material paste + round-trip", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    setProperty(store, boxAId, "material.color", "#ff8800");
    setProperty(store, boxBId, "material.color", "#0088ff");

    // Bind B's material.color BEFORE the paste.
    const boxB = requireNonGroup(store.getNode(boxBId));
    const colorDef = requireDef(boxB, "material.color");
    store.toggleEditableProperty(boxBId, colorDef, true);
    store.updateEditableBinding(boxBId, "material.color", {
      key: "heroColor",
      label: "Hero Color",
    });

    // Capture the binding as it actually lives after updateEditableBinding's
    // sanitization — the test is about *preservation* across the paste +
    // round-trip, not about the sanitizer itself.
    const boxBAfterBind = requireNonGroup(store.getNode(boxBId));
    const boundBefore = { ...boxBAfterBind.editable["material.color"] };
    expect(boundBefore).toBeDefined();

    // Paste material scope from A to B — this will overwrite the color value,
    // but the binding metadata on B should remain.
    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();
    store.setSelectedNodes([boxBId]);
    store.applyPropertiesToSelection("material");

    const { reloaded } = roundTrip(store);
    const reloadedB = requireNonGroup(reloaded.getNode(boxBId));
    expect(reloadedB.material.color).toBe("#ff8800");
    const binding = reloadedB.editable["material.color"];
    expect(binding).toBeDefined();
    expect(binding.path).toBe(boundBefore.path);
    expect(binding.key).toBe(boundBefore.key);
    expect(binding.label).toBe(boundBefore.label);
    expect(binding.type).toBe(boundBefore.type);
  });

  it("leaves animation tracks unchanged after a multi-edit color apply through the clipboard", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);

    // Track on B.position.x — must survive a material paste on B.
    // (Frames are chosen in [1, durationFrames] because the canonical
    // keyframe normalizer forces `frame: 0` → `frame: 1` on import.)
    const trackId = store.ensureAnimationTrack(boxBId, "transform.position.x");
    store.addAnimationKeyframe(trackId, 4, 0);
    store.addAnimationKeyframe(trackId, 24, 1.5);

    const beforeTrack = store.getAnimationTrack(trackId);
    expect(beforeTrack).toBeTruthy();
    const beforeKeyframes = beforeTrack!.keyframes.map((k) => ({
      frame: k.frame,
      value: k.value,
      ease: k.ease,
    }));

    setProperty(store, boxAId, "material.color", "#deadbe");
    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();
    store.setSelectedNodes([boxBId]);
    store.applyPropertiesToSelection("material");

    const { reloaded } = roundTrip(store);
    const reloadedTrack = reloaded.getAnimationTrack(trackId);
    expect(reloadedTrack).toBeTruthy();
    expect(reloadedTrack?.nodeId).toBe(boxBId);
    expect(reloadedTrack?.property).toBe("transform.position.x");
    expect(
      reloadedTrack!.keyframes.map((k) => ({ frame: k.frame, value: k.value, ease: k.ease })),
    ).toEqual(beforeKeyframes);
  });

  it("does not change blueprint.version across capture + apply + round-trip", () => {
    const store = new EditorStore(createDefaultBlueprint());
    expect(store.blueprint.version).toBe(1);

    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    setProperty(store, boxAId, "material.color", "#654321");

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();
    expect(store.blueprint.version).toBe(1);

    store.setSelectedNodes([boxBId]);
    store.applyPropertiesToSelection("material");
    expect(store.blueprint.version).toBe(1);

    const { reloaded } = roundTrip(store);
    expect(reloaded.blueprint.version).toBe(1);
  });

  it("leaves skipped-incompatible targets byte-identical after apply + round-trip (no orphan state)", () => {
    // Source: box (has material). Targets: sphere + group. Scope "geometry"
    // forces incompatibility for both targets relative to a box source, so
    // every entry within scope is skipped.
    const store = new EditorStore(createDefaultBlueprint());
    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const sphereId = store.insertNode("sphere", ROOT_NODE_ID);
    const groupId = store.insertNode("group", ROOT_NODE_ID);

    setProperty(store, boxAId, "geometry.width", 2.5);
    setProperty(store, boxAId, "geometry.height", 3.5);
    setProperty(store, boxAId, "geometry.depth", 4.5);

    // Capture per-target JSON BEFORE the apply.
    const beforeSphereJson = JSON.stringify(store.getNode(sphereId));
    const beforeGroupJson = JSON.stringify(store.getNode(groupId));

    store.selectNode(boxAId);
    store.capturePropertiesFromSelection();
    store.setSelectedNodes([sphereId, groupId], "ui", sphereId);
    const report = store.applyPropertiesToSelection("geometry");

    // Guard: the scenario must actually produce a skipped-incompatible count.
    expect(report.skippedIncompatible).toBeGreaterThan(0);
    expect(report.applied).toBe(0);

    // Live: no partial writes on the skipped targets.
    expect(JSON.stringify(store.getNode(sphereId))).toBe(beforeSphereJson);
    expect(JSON.stringify(store.getNode(groupId))).toBe(beforeGroupJson);

    // Round-trip: same guarantee survives JSON export → import.
    const { reloaded } = roundTrip(store);
    expect(JSON.stringify(reloaded.getNode(sphereId))).toBe(beforeSphereJson);
    expect(JSON.stringify(reloaded.getNode(groupId))).toBe(beforeGroupJson);
  });
});
