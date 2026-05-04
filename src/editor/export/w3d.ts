/*
 * Exporter for R3 Engine / wTVision .w3d scenes.
 *
 * Strategy: shadow patch. The importer keeps the original XML plus id maps in
 * blueprint.metadata.w3d. On export we re-parse that XML, mutate only the
 * attributes that 3Forge actually owns (transform, visibility, keyframe values
 * + frame numbers), and re-serialise. Anything we don't understand —
 * TextureLayers, ImageSequences, MaskProperties, Triggers, Variables — passes
 * through untouched.
 *
 * If the blueprint never came from a .w3d (no shadow), we emit a minimal
 * scaffold so the user gets a parseable file plus a warning.
 */
import { animationValueToBoolean, isDiscreteAnimationProperty } from "../animation";
import type {
  AnimationClip,
  AnimationKeyframe,
  AnimationPropertyPath,
  AnimationTrack,
  ComponentBlueprint,
  EditorNode,
} from "../types";
import type { W3DShadowData } from "../import/w3d";

export interface W3DExportResult {
  xml: string;
  warnings: string[];
}

const XML_DECL = '<?xml version="1.0" encoding="utf-8"?>\r\n';

const PROPERTY_TO_W3D: Record<AnimationPropertyPath, string> = {
  "transform.position.x": "Transform.Position.XProp",
  "transform.position.y": "Transform.Position.YProp",
  "transform.position.z": "Transform.Position.ZProp",
  "transform.rotation.x": "Transform.Rotation.XProp",
  "transform.rotation.y": "Transform.Rotation.YProp",
  "transform.rotation.z": "Transform.Rotation.ZProp",
  "transform.scale.x": "Transform.Scale.XProp",
  "transform.scale.y": "Transform.Scale.YProp",
  "transform.scale.z": "Transform.Scale.ZProp",
  visible: "Enabled",
  "material.opacity": "Alpha",
};

export function exportToW3D(blueprint: ComponentBlueprint): W3DExportResult {
  const shadow = blueprint.metadata?.w3d as W3DShadowData | undefined;
  if (shadow && typeof shadow.originalXml === "string" && shadow.originalXml.length > 0) {
    return patchExistingXml(blueprint, shadow);
  }
  return emitFreshXml(blueprint);
}

// ---------------------------------------------------------------------------
// Shadow-patch path
// ---------------------------------------------------------------------------

function patchExistingXml(blueprint: ComponentBlueprint, shadow: W3DShadowData): W3DExportResult {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(shadow.originalXml, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`W3D export: cannot reparse shadow XML — ${parserError.textContent ?? "invalid XML"}`);
  }

  // Index every element with an Id attribute (case-insensitive lookup).
  const elementsById = indexElementsById(doc);

  // Default to true preserves the historical export behaviour for any
  // pre-flag blueprint that still carries shadow data without flippedYZ set.
  const flipYZ = shadow.flippedYZ !== false;

  patchNodes(blueprint.nodes, shadow, elementsById, warnings, flipYZ);
  patchAnimations(blueprint.animation.clips, shadow, elementsById, warnings, flipYZ);

  const xml = XML_DECL + new XMLSerializer().serializeToString(doc.documentElement);
  return { xml, warnings };
}

function indexElementsById(doc: Document): Map<string, Element> {
  const map = new Map<string, Element>();
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i += 1) {
    const el = all[i];
    const id = el.getAttribute("Id");
    if (id) {
      map.set(id.toLowerCase(), el);
    }
  }
  return map;
}

function patchNodes(
  nodes: EditorNode[],
  shadow: W3DShadowData,
  elementsById: Map<string, Element>,
  warnings: string[],
  flipYZ: boolean,
): void {
  // The importer flipped every Enable="False" node to visible (design-view
  // mode); we feed that ledger to patchNodeVisibility so it doesn't
  // accidentally promote authoring-time hidden nodes back to enabled.
  const initialDisabled = new Set(shadow.initialDisabledNodeIds ?? []);
  for (const node of nodes) {
    if (node.parentId === null) {
      continue; // 3Forge synthetic root — has no W3D counterpart.
    }
    const w3dId = shadow.nodeIds[node.id];
    if (!w3dId) {
      warnings.push(
        `Skipped untracked node "${node.name}" — only originally-imported scenes round-trip cleanly for now.`,
      );
      continue;
    }
    const el = elementsById.get(w3dId.toLowerCase());
    if (!el) {
      warnings.push(`W3D element with Id ${w3dId} for node "${node.name}" not found in shadow XML.`);
      continue;
    }
    patchNodeTransform(el, node, flipYZ);
    patchNodeVisibility(el, node, initialDisabled.has(node.id));
  }
}

function patchNodeTransform(el: Element, node: EditorNode, flipYZ: boolean): void {
  let transformEl = childByTag(el, "NodeTransform");
  const hasAnyDelta =
    !isVecDefault(node.transform.position, 0) ||
    !isVecDefault(node.transform.scale, 1) ||
    !isVecDefault(node.transform.rotation, 0);
  if (!transformEl && !hasAnyDelta) {
    return; // Nothing to write, leave shadow alone.
  }
  if (!transformEl) {
    transformEl = el.ownerDocument!.createElement("NodeTransform");
    el.appendChild(transformEl);
  }
  // Undo the importer's Y/Z flips (R3 designer is screen-space, +Y down with
  // depth stacked on the -Z side of XY plane; Three.js editor uses +Y up and
  // mounts content on the +Z side). Only applies when the import side
  // actually flipped — for 3D scenes we keep coordinates 1:1.
  const positionForXml = flipYZ
    ? { x: node.transform.position.x, y: -node.transform.position.y, z: -node.transform.position.z }
    : node.transform.position;
  patchVecChild(transformEl, "Position", positionForXml, 0);
  patchVecChild(transformEl, "Scale", node.transform.scale, 1);
  patchVecChild(transformEl, "Rotation", node.transform.rotation, 0);
}

function patchVecChild(
  parent: Element,
  tag: string,
  vec: { x: number; y: number; z: number },
  defaultValue: number,
): void {
  let child = childByTag(parent, tag);
  const allDefault =
    approxEq(vec.x, defaultValue) && approxEq(vec.y, defaultValue) && approxEq(vec.z, defaultValue);
  if (allDefault) {
    if (child) {
      parent.removeChild(child);
    }
    return;
  }
  if (!child) {
    child = parent.ownerDocument!.createElement(tag);
    parent.appendChild(child);
  }
  patchAxisAttr(child, "X", vec.x, defaultValue);
  patchAxisAttr(child, "Y", vec.y, defaultValue);
  patchAxisAttr(child, "Z", vec.z, defaultValue);
}

function patchAxisAttr(el: Element, attr: string, value: number, defaultValue: number): void {
  if (approxEq(value, defaultValue)) {
    if (el.hasAttribute(attr)) {
      el.removeAttribute(attr);
    }
    return;
  }
  el.setAttribute(attr, formatNumber(value));
}

function patchNodeVisibility(el: Element, node: EditorNode, wasInitiallyDisabled: boolean): void {
  // The importer's design-view promotion means `node.visible` no longer
  // reflects the XML truth on its own — a node that started Enable="False"
  // and was never touched will read visible=true here. Resolve the
  // "effective intent" first: if the user didn't change the visibility,
  // restore whatever the XML originally had.
  const intendedVisibility = wasInitiallyDisabled && node.visible === true ? false : node.visible;
  const currentRaw = el.getAttribute("Enable");
  const currentlyEnabled = currentRaw === null ? true : currentRaw !== "False";
  if (currentlyEnabled === intendedVisibility) {
    return;
  }
  el.setAttribute("Enable", intendedVisibility ? "True" : "False");
}

function patchAnimations(
  clips: AnimationClip[],
  shadow: W3DShadowData,
  elementsById: Map<string, Element>,
  warnings: string[],
  flipYZ: boolean,
): void {
  for (const clip of clips) {
    const timelineId = shadow.clipIds[clip.id];
    if (!timelineId) {
      warnings.push(`Skipped untracked clip "${clip.name}" — only originally-imported clips round-trip cleanly for now.`);
      continue;
    }
    const timelineEl = elementsById.get(timelineId.toLowerCase());
    if (!timelineEl) {
      warnings.push(`Timeline ${timelineId} for clip "${clip.name}" not found in shadow XML.`);
      continue;
    }
    for (const track of clip.tracks) {
      patchTrack(track, timelineEl, shadow, elementsById, warnings, clip.name, flipYZ);
    }
  }
}

function patchTrack(
  track: AnimationTrack,
  timelineEl: Element,
  shadow: W3DShadowData,
  elementsById: Map<string, Element>,
  warnings: string[],
  clipName: string,
  flipYZ: boolean,
): void {
  const trackKey = shadow.trackKeys[track.id];
  if (!trackKey) {
    warnings.push(
      `Skipped untracked animation track on clip "${clipName}" — only originally-imported tracks round-trip cleanly for now.`,
    );
    return;
  }
  const [controllableId, animatedProperty] = trackKey.split("|");
  const controller = findController(timelineEl, controllableId, animatedProperty);
  if (!controller) {
    warnings.push(
      `KeyFrameAnimationController ${controllableId} / ${animatedProperty} not found on timeline "${clipName}".`,
    );
    return;
  }

  const isDiscrete = isDiscreteAnimationProperty(track.property);
  // Reverse the Y/Z flips applied during import — only when the import did flip.
  const flipValue =
    flipYZ &&
    (track.property === "transform.position.y" || track.property === "transform.position.z");
  for (const kf of track.keyframes) {
    const w3dKfId = shadow.keyframeIds[kf.id];
    if (!w3dKfId) {
      warnings.push(
        `Skipped untracked keyframe at frame ${kf.frame} on clip "${clipName}" — only originally-imported keyframes round-trip cleanly for now.`,
      );
      continue;
    }
    const kfEl = elementsById.get(w3dKfId.toLowerCase());
    if (!kfEl) {
      warnings.push(`KeyFrame ${w3dKfId} not found in shadow XML.`);
      continue;
    }
    patchKeyframe(kfEl, kf, isDiscrete, flipValue);
  }
}

function findController(timelineEl: Element, controllableId: string, animatedProperty: string): Element | null {
  const controllers = childrenByTag(timelineEl, "KeyFrameAnimationController");
  for (const controller of controllers) {
    const cid = (controller.getAttribute("ControllableId") ?? "").toLowerCase();
    const prop = controller.getAttribute("AnimatedProperty") ?? "";
    if (cid === controllableId.toLowerCase() && prop === animatedProperty) {
      return controller;
    }
  }
  return null;
}

function patchKeyframe(kfEl: Element, kf: AnimationKeyframe, isDiscrete: boolean, flipValue: boolean): void {
  kfEl.setAttribute("FrameNumber", String(Math.max(0, Math.round(kf.frame))));
  if (isDiscrete) {
    kfEl.setAttribute("Value", animationValueToBoolean("visible", kf.value) ? "True" : "False");
  } else {
    const value = flipValue ? -kf.value : kf.value;
    kfEl.setAttribute("Value", formatNumber(value));
  }
}

// ---------------------------------------------------------------------------
// Fresh-emit fallback
// ---------------------------------------------------------------------------

function emitFreshXml(blueprint: ComponentBlueprint): W3DExportResult {
  const warnings: string[] = [
    "No W3D shadow data found — emitted minimal scaffold; this is a partial export.",
  ];
  const doc = new DOMParser().parseFromString("<Scene/>", "application/xml");
  const scene = doc.documentElement;
  scene.setAttribute("Id", randomGuid());
  scene.setAttribute("Name", blueprint.componentName || "Scene");
  scene.setAttribute("Version", "3.6.0.*");

  const sceneLayer = doc.createElement("SceneLayer");
  sceneLayer.setAttribute("Id", randomGuid());
  sceneLayer.setAttribute("Name", "Default");
  scene.appendChild(sceneLayer);

  const sceneNode = doc.createElement("SceneNode");
  sceneNode.setAttribute("Id", randomGuid());
  sceneNode.setAttribute("Name", "RootNode");
  sceneLayer.appendChild(sceneNode);

  const childrenEl = doc.createElement("Children");
  sceneNode.appendChild(childrenEl);

  // Walk top-level (parent == synthetic root) and emit a flat structure. We
  // keep this intentionally tiny — anything more elaborate belongs in a real
  // round-trip path.
  const idByNodeId = new Map<string, string>();
  for (const node of blueprint.nodes) {
    if (node.parentId === null) {
      continue;
    }
    const tag = nodeTypeToW3DTag(node.type);
    if (!tag) {
      warnings.push(`Skipped node "${node.name}" — type ${node.type} has no W3D fresh-emit mapping.`);
      continue;
    }
    const el = doc.createElement(tag);
    const id = randomGuid();
    idByNodeId.set(node.id, id);
    el.setAttribute("Id", id);
    el.setAttribute("Name", node.name);
    if (!node.visible) {
      el.setAttribute("Enable", "False");
    }
    appendFreshTransform(doc, el, node);
    // Attach to the right parent (collapse hierarchy onto Children if parent
    // wasn't emitted above).
    const parentEl = node.parentId && idByNodeId.has(node.parentId)
      ? findChildrenContainer(doc, idByNodeId.get(node.parentId)!)
      : childrenEl;
    parentEl.appendChild(el);
    if (node.type === "group") {
      const inner = doc.createElement("Children");
      el.appendChild(inner);
    }
  }

  const resources = doc.createElement("Resources");
  scene.appendChild(resources);

  const xml = XML_DECL + new XMLSerializer().serializeToString(scene);
  return { xml, warnings };
}

function findChildrenContainer(doc: Document, parentId: string): Element {
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i += 1) {
    if (all[i].getAttribute("Id") === parentId) {
      const inner = childByTag(all[i], "Children");
      if (inner) {
        return inner;
      }
    }
  }
  // Fallback to the top-level Children node.
  return doc.getElementsByTagName("Children")[0];
}

function appendFreshTransform(doc: Document, el: Element, node: EditorNode): void {
  const hasPos = !isVecDefault(node.transform.position, 0);
  const hasScale = !isVecDefault(node.transform.scale, 1);
  const hasRot = !isVecDefault(node.transform.rotation, 0);
  if (!hasPos && !hasScale && !hasRot) {
    return;
  }
  const transform = doc.createElement("NodeTransform");
  el.appendChild(transform);
  if (hasPos) appendVec(doc, transform, "Position", node.transform.position, 0);
  if (hasScale) appendVec(doc, transform, "Scale", node.transform.scale, 1);
  if (hasRot) appendVec(doc, transform, "Rotation", node.transform.rotation, 0);
}

function appendVec(
  doc: Document,
  parent: Element,
  tag: string,
  vec: { x: number; y: number; z: number },
  defaultValue: number,
): void {
  const child = doc.createElement(tag);
  if (!approxEq(vec.x, defaultValue)) child.setAttribute("X", formatNumber(vec.x));
  if (!approxEq(vec.y, defaultValue)) child.setAttribute("Y", formatNumber(vec.y));
  if (!approxEq(vec.z, defaultValue)) child.setAttribute("Z", formatNumber(vec.z));
  parent.appendChild(child);
}

function nodeTypeToW3DTag(type: EditorNode["type"]): string | null {
  switch (type) {
    case "group":
      return "Group";
    case "plane":
      return "Quad";
    case "circle":
      return "Disk";
    case "text":
      return "TextureText";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function childByTag(el: Element | null | undefined, tag: string): Element | null {
  if (!el) return null;
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) return child;
  }
  return null;
}

function childrenByTag(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((child) => child.tagName === tag);
}

function isVecDefault(vec: { x: number; y: number; z: number }, defaultValue: number): boolean {
  return approxEq(vec.x, defaultValue) && approxEq(vec.y, defaultValue) && approxEq(vec.z, defaultValue);
}

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  // Trim trailing zeros from a fixed-precision repr so round-trips stay tidy.
  const rounded = Math.round(value * 1e6) / 1e6;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return String(rounded);
}

function randomGuid(): string {
  // RFC4122-ish v4. crypto.randomUUID is fine in jsdom + browser, but guard anyway.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const b = Array.from(bytes, hex).join("");
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20)}`;
}
