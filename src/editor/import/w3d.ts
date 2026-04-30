/*
 * Importer for R3 Engine / wTVision .w3d scenes (XML-based).
 *
 * v1 scope (lossy, best-effort):
 *  - Quad / Disk / Group / TextureText / DirectionalLight (skipped) primitives
 *  - NodeTransform Position + Scale (Skew/Pivot ignored with warning)
 *  - BaseMaterial Diffuse / Emissive / Alpha mapped onto MaterialSpec
 *  - Timelines + KeyFrameAnimationController for transform.position/scale/rotation + Enabled (=visible)
 *  - Bezier handles approximated to nearest 3Forge ease preset
 *
 * Warnings collected for: lights, masks, video sequences, skew, unsupported animated properties.
 */
import {
  createAnimationClip,
  createAnimationKeyframe,
  createAnimationTrack,
  createDefaultAnimation,
} from "../animation";
import { DEFAULT_FONT_ID } from "../fonts";
import { createMaterialSpec } from "../materials";
import { createNode, ROOT_NODE_ID } from "../state";
import type {
  AnimationClip,
  AnimationEasePreset,
  AnimationPropertyPath,
  ComponentBlueprint,
  EditorNode,
  ImageAsset,
  MaterialSpec,
  TransformSpec,
} from "../types";

export interface W3DImportResult {
  blueprint: ComponentBlueprint;
  warnings: string[];
}

/** Side-channel data attached to ComponentBlueprint.metadata.w3d for round-trip export. */
export interface W3DShadowData {
  originalXml: string;
  /** 3Forge nodeId → W3D Id (lowercase GUID) */
  nodeIds: Record<string, string>;
  /** 3Forge keyframeId → W3D KeyFrame Id */
  keyframeIds: Record<string, string>;
  /** 3Forge trackId → matching W3D KeyFrameAnimationController identity (controllableId|animatedProperty) */
  trackKeys: Record<string, string>;
  /** 3Forge clipId → W3D Timeline Id */
  clipIds: Record<string, string>;
  /** Plane fallbacks for quads whose texture wasn't in the supplied folder.
   * Hidden at render time but still round-tripped (their original Enable flag
   * is preserved). */
  missingTextureNodeIds?: string[];
}

interface ParseContext {
  nodes: EditorNode[];
  warnings: string[];
  /** Maps W3D node Id (lower-cased GUID) to 3Forge node id. */
  idMap: Map<string, string>;
  /** Resources/BaseMaterial cache, lower-cased Id → spec */
  baseMaterials: Map<string, MaterialSpec>;
  shadow: W3DShadowData;
  /** TextureLayerId (lowercase) → texture filename, or null when unmapped. */
  textureLayerToFilename: Map<string, string>;
  /** Filename → ImageAsset supplied by caller (folder import). */
  textures: Map<string, ImageAsset>;
  /** Filenames of video textures present in the folder (skipped, with clearer warning). */
  videos: Set<string>;
  /** Image assets actually used by converted Quads, keyed by stable id. */
  usedImages: Map<string, ImageAsset>;
  /** True when caller passed any textures at all (i.e. folder import path). */
  texturesProvided: boolean;
  /** Filenames of textures referenced but not resolved to an asset. */
  missingTextures: Set<string>;
  /** Pending mask resolutions: 3Forge node id → first W3D mask Id (lower-cased). */
  pendingMaskRefs: Map<string, string>;
  /** 3Forge node ids of plane fallbacks for quads whose texture wasn't supplied. */
  missingTextureNodeIds: Set<string>;
}

export interface W3DParseOptions {
  sceneName?: string;
  textures?: Map<string, ImageAsset>;
  videos?: Set<string>;
}

const W3D_PROPERTY_TO_PATH: Record<string, AnimationPropertyPath> = {
  "Transform.Position.XProp": "transform.position.x",
  "Transform.Position.YProp": "transform.position.y",
  "Transform.Position.ZProp": "transform.position.z",
  "Transform.Rotation.XProp": "transform.rotation.x",
  "Transform.Rotation.YProp": "transform.rotation.y",
  "Transform.Rotation.ZProp": "transform.rotation.z",
  "Transform.Scale.XProp": "transform.scale.x",
  "Transform.Scale.YProp": "transform.scale.y",
  "Transform.Scale.ZProp": "transform.scale.z",
  Enabled: "visible",
};

export function parseW3D(xmlText: string, options: W3DParseOptions = {}): W3DImportResult {
  const cleaned = xmlText.replace(/^﻿/, "");
  const doc = new DOMParser().parseFromString(cleaned, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`W3D parse error: ${parserError.textContent ?? "invalid XML"}`);
  }

  const sceneEl = doc.documentElement;
  if (!sceneEl || sceneEl.tagName !== "Scene") {
    throw new Error("W3D file is missing the root <Scene> element.");
  }

  const componentName = options.sceneName ?? sceneEl.getAttribute("Name") ?? "Imported Scene";

  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = componentName;

  const ctx: ParseContext = {
    nodes: [root],
    warnings: [],
    idMap: new Map(),
    baseMaterials: new Map(),
    shadow: {
      originalXml: cleaned,
      nodeIds: {},
      keyframeIds: {},
      trackKeys: {},
      clipIds: {},
    },
    textureLayerToFilename: new Map(),
    textures: normalizeFilenameMap(options.textures),
    videos: normalizeFilenameSet(options.videos),
    usedImages: new Map(),
    texturesProvided: !!options.textures && options.textures.size > 0,
    missingTextures: new Set(),
    pendingMaskRefs: new Map(),
    missingTextureNodeIds: new Set(),
  };

  const sceneLayer = sceneEl.getElementsByTagName("SceneLayer")[0];
  if (!sceneLayer) {
    return {
      blueprint: emptyBlueprint(componentName, ctx.nodes),
      warnings: ["Scene has no <SceneLayer> — imported as empty blueprint."],
    };
  }

  // Parse Resources first so material/texture lookups work while walking nodes.
  const resourcesEl = sceneEl.getElementsByTagName("Resources")[0];
  if (resourcesEl) {
    collectBaseMaterials(resourcesEl, ctx);
    ctx.textureLayerToFilename = collectTextureLayerMap(resourcesEl);
  }

  const sceneNodes = childElementsByTag(sceneLayer, "SceneNode");
  for (const sceneNode of sceneNodes) {
    const childrenEl = childElementByTag(sceneNode, "Children");
    if (!childrenEl) {
      continue;
    }
    walkChildren(childrenEl, root.id, ctx);
  }

  const blueprint: ComponentBlueprint = {
    version: 1,
    componentName,
    // R3 broadcast scenes are authored in the XY plane with screen-space
    // conventions — orthographic + locked rotation matches Designer's view.
    sceneMode: "2d",
    fonts: [],
    materials: [],
    images: Array.from(ctx.usedImages.values()),
    nodes: ctx.nodes,
    animation: createDefaultAnimation(),
  };

  const timelinesEl = sceneEl.getElementsByTagName("Timelines")[0];
  if (timelinesEl) {
    parseTimelines(timelinesEl, blueprint, ctx);
  }

  blueprint.metadata = { ...(blueprint.metadata ?? {}), w3d: ctx.shadow };

  // Plane fallbacks for quads whose texture wasn't in the supplied folder are
  // tracked here and hidden by the scene renderer (rather than mutating
  // node.visible) so round-trip export preserves the original Enable flag.
  if (ctx.missingTextureNodeIds.size > 0) {
    ctx.shadow.missingTextureNodeIds = Array.from(ctx.missingTextureNodeIds);
  }

  // Resolve mask references now that all nodes are walked (mask quads can be
  // declared after the nodes referencing them).
  let unresolvedMasks = 0;
  for (const [nodeId, w3dMaskId] of ctx.pendingMaskRefs) {
    const maskNodeId = ctx.idMap.get(w3dMaskId);
    if (!maskNodeId) {
      unresolvedMasks += 1;
      continue;
    }
    const node = ctx.nodes.find((n) => n.id === nodeId);
    if (node) {
      node.maskId = maskNodeId;
    }
  }
  if (unresolvedMasks > 0) {
    ctx.warnings.push(`${unresolvedMasks} mask reference${unresolvedMasks === 1 ? "" : "s"} could not be resolved.`);
  }

  if (ctx.missingTextures.size > 0) {
    if (!ctx.texturesProvided) {
      ctx.warnings.push(
        `Scene references ${ctx.missingTextures.size} texture${ctx.missingTextures.size === 1 ? "" : "s"} — re-import via "Import W3D Scene (folder)" to load them.`,
      );
    } else {
      const sample = Array.from(ctx.missingTextures).slice(0, 5).join(", ");
      ctx.warnings.push(
        `Missing ${ctx.missingTextures.size} texture${ctx.missingTextures.size === 1 ? "" : "s"} in selected folder: ${sample}${ctx.missingTextures.size > 5 ? ", …" : ""}`,
      );
    }
  }

  return { blueprint, warnings: ctx.warnings };
}

export async function parseW3DFromFile(file: File): Promise<W3DImportResult> {
  const text = await file.text();
  const sceneName = stripExtension(file.name);
  return parseW3D(text, { sceneName });
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

/**
 * Build a map of textureLayerId (lowercase GUID) → texture filename by composing
 * the Resources/Texture and Resources/TextureLayer tables. Layers without a
 * resolvable texture are omitted from the result.
 */
export function collectTextureMap(xmlText: string): Map<string, string> {
  const cleaned = xmlText.replace(/^﻿/, "");
  const doc = new DOMParser().parseFromString(cleaned, "application/xml");
  if (doc.getElementsByTagName("parsererror")[0]) {
    return new Map();
  }
  const resourcesEl = doc.getElementsByTagName("Resources")[0];
  if (!resourcesEl) {
    return new Map();
  }
  return collectTextureLayerMap(resourcesEl);
}

function collectTextureLayerMap(resourcesEl: Element): Map<string, string> {
  // Texture id (lower) → filename
  const textureById = new Map<string, string>();
  for (const tex of Array.from(resourcesEl.getElementsByTagName("Texture"))) {
    const id = tex.getAttribute("Id");
    const filename = tex.getAttribute("Filename");
    if (!id || !filename) continue;
    textureById.set(id.toLowerCase(), filename);
  }

  // TextureLayer id (lower) → filename via TextureMappingOption.Texture
  const layerToFilename = new Map<string, string>();
  for (const layer of Array.from(resourcesEl.getElementsByTagName("TextureLayer"))) {
    const layerId = layer.getAttribute("Id");
    if (!layerId) continue;
    const mapping = childElementByTag(layer, "TextureMappingOption");
    const textureId = mapping?.getAttribute("Texture");
    if (!textureId) continue;
    const filename = textureById.get(textureId.toLowerCase());
    if (!filename) continue;
    layerToFilename.set(layerId.toLowerCase(), filename);
  }
  return layerToFilename;
}

function collectBaseMaterials(resourcesEl: Element, ctx: ParseContext): void {
  const baseMaterials = resourcesEl.getElementsByTagName("BaseMaterial");
  for (const baseMaterial of Array.from(baseMaterials)) {
    const id = baseMaterial.getAttribute("Id");
    if (!id) {
      continue;
    }
    ctx.baseMaterials.set(id.toLowerCase(), parseBaseMaterial(baseMaterial));
  }
}

function parseBaseMaterial(el: Element): MaterialSpec {
  const hasDiffuse = (el.getAttribute("HasDiffuse") ?? "False") === "True";
  const hasEmissive = (el.getAttribute("HasEmissive") ?? "False") === "True";
  const hasSpecular = (el.getAttribute("HasSpecular") ?? "False") === "True";
  const diffuse = el.getAttribute("Diffuse") ?? "ffffff";
  const emissive = el.getAttribute("Emissive") ?? "000000";
  const alpha = parseNumberAttr(el, "Alpha", 1);

  const spec = createMaterialSpec(
    "#" + sanitizeHex(diffuse),
    hasEmissive || hasSpecular ? "standard" : "basic",
  );
  if (hasEmissive) {
    spec.emissive = "#" + sanitizeHex(emissive);
  }
  spec.opacity = clamp01(alpha);
  spec.transparent = spec.opacity < 1 || hasEmissive;
  if (!hasDiffuse && !hasEmissive) {
    spec.color = "#ffffff";
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Node tree walk
// ---------------------------------------------------------------------------

function walkChildren(childrenEl: Element, parentId: string, ctx: ParseContext): void {
  for (const child of childElementsOf(childrenEl)) {
    handleNode(child, parentId, ctx);
  }
}

function handleNode(el: Element, parentId: string, ctx: ParseContext): void {
  const tag = el.tagName;
  const w3dId = el.getAttribute("Id");
  const w3dName = el.getAttribute("Name") ?? tag;
  const enabled = (el.getAttribute("Enable") ?? "True") !== "False";
  const isMaskQuad = (el.getAttribute("IsMask") ?? "False") === "True";

  if (tag === "DirectionalLight") {
    ctx.warnings.push(`Skipped DirectionalLight "${w3dName}" (3Forge has fixed scene lighting).`);
    return;
  }

  let node: EditorNode | null = null;
  switch (tag) {
    case "Group":
      node = createGroupNode(el, parentId, ctx);
      break;
    case "Quad":
      node = createQuadNode(el, parentId, ctx);
      break;
    case "Disk":
      node = createCircleNode(el, parentId, ctx);
      break;
    case "TextureText":
      node = createTextNode(el, parentId, ctx);
      break;
    default:
      ctx.warnings.push(`Skipped unsupported W3D primitive <${tag}> "${w3dName}".`);
      return;
  }

  if (!node) {
    return;
  }

  node.name = w3dName;
  node.visible = enabled;
  if (isMaskQuad) {
    node.isMask = true; // scene renderer hides masks while still using their bounds for clipping
  }
  applyAlignment(el, node);
  applyTransform(el, node);

  // R3 references masks via the MaskId attribute on the masked node, semicolon-
  // separated list of mask node ids. We support the first id (single-mask case
  // covers >99% of broadcast scenes).
  const maskAttr = el.getAttribute("MaskId");
  if (maskAttr && !isMaskQuad) {
    const firstMask = maskAttr.split(";").map((s) => s.trim()).filter(Boolean)[0];
    if (firstMask) {
      ctx.pendingMaskRefs.set(node.id, firstMask.toLowerCase());
    }
  }

  if (w3dId) {
    const lowered = w3dId.toLowerCase();
    ctx.idMap.set(lowered, node.id);
    ctx.shadow.nodeIds[node.id] = lowered;
  }

  ctx.nodes.push(node);

  const childrenEl = childElementByTag(el, "Children");
  if (childrenEl) {
    walkChildren(childrenEl, node.id, ctx);
  }
}

function createGroupNode(_el: Element, parentId: string, _ctx: ParseContext): EditorNode {
  return createNode("group", parentId);
}

function createQuadNode(el: Element, parentId: string, ctx: ParseContext): EditorNode {
  const sizeEl = childElementByTag(childElementByTag(el, "GeometryOptions"), "Size");
  const width = parseNumberAttr(sizeEl, "X", 1);
  const height = parseNumberAttr(sizeEl, "Y", 1);

  const layerId = findTextureLayerId(el);
  const filename = layerId ? ctx.textureLayerToFilename.get(layerId) : undefined;

  if (layerId && filename) {
    const asset = ctx.textures.get(filename) ?? findAssetCaseInsensitive(ctx.textures, filename);
    if (asset) {
      const imageNode = createNode("image", parentId);
      imageNode.geometry.width = width;
      imageNode.geometry.height = height;
      const stableId = asset.id ?? toImageId(filename);
      const stored: ImageAsset = { ...asset, id: stableId };
      imageNode.image = stored;
      imageNode.imageId = stableId;
      if (!ctx.usedImages.has(stableId)) {
        ctx.usedImages.set(stableId, stored);
      }
      applyMaterialFromPrimitive(el, imageNode, ctx);
      return imageNode;
    }
    ctx.missingTextures.add(filename);
  }

  const node = createNode("plane", parentId);
  node.geometry.width = width;
  node.geometry.height = height;
  applyMaterialFromPrimitive(el, node, ctx);
  // Track plane fallbacks for quads that referenced an unresolved texture so
  // the post-walk pass can hide them — they'd otherwise render as bright white
  // placeholders that obscure the rest of the scene.
  if (layerId && filename && !ctx.videos.has(filename.toLowerCase())) {
    const asset = ctx.textures.get(filename) ?? findAssetCaseInsensitive(ctx.textures, filename);
    if (!asset) {
      ctx.missingTextureNodeIds.add(node.id);
    }
  }
  return node;
}

function findTextureLayerId(quadEl: Element): string | null {
  const primitive = childElementByTag(quadEl, "Primitive");
  if (!primitive) return null;
  const list = childElementByTag(primitive, "FaceMappingList");
  if (!list) return null;
  const mapping = childElementByTag(list, "NamedBaseFaceMapping");
  if (!mapping) return null;
  const layerId = mapping.getAttribute("TextureLayerId");
  if (!layerId || layerId === "Standard") return null;
  return layerId.toLowerCase();
}

function findAssetCaseInsensitive(map: Map<string, ImageAsset>, filename: string): ImageAsset | undefined {
  const lower = filename.toLowerCase();
  for (const [key, value] of map) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function toImageId(filename: string): string {
  const slug = filename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `img-${slug || "texture"}`;
}

function normalizeFilenameMap(input: Map<string, ImageAsset> | undefined): Map<string, ImageAsset> {
  if (!input) return new Map();
  // Keep keys verbatim; case-insensitive fallback handled at lookup site.
  return new Map(input);
}

function normalizeFilenameSet(input: Set<string> | undefined): Set<string> {
  const out = new Set<string>();
  if (!input) return out;
  for (const v of input) out.add(v.toLowerCase());
  return out;
}

function createCircleNode(el: Element, parentId: string, ctx: ParseContext): EditorNode {
  const node = createNode("circle", parentId);
  const geom = childElementByTag(el, "GeometryOptions");
  node.geometry.radius = parseNumberAttr(geom, "OuterRadius", 0.5);
  node.geometry.segments = Math.max(3, Math.round(parseNumberAttr(geom, "Segments", 32)));
  const startDeg = parseNumberAttr(geom, "StartAngle", 0);
  const stopDeg = parseNumberAttr(geom, "StopAngle", 360);
  // Quirk: in this codebase the field "thetaLenght" actually stores the start
  // angle (passed as Three's thetaStart) and "thetaStarts" stores the arc
  // length (passed as Three's thetaLength). Match those semantics here.
  const arcLengthRad = degToRad(Math.max(0.01, stopDeg - startDeg));
  node.geometry.thetaLenght = degToRad(startDeg);
  node.geometry.thetaStarts = arcLengthRad;
  applyMaterialFromPrimitive(el, node, ctx);
  return node;
}

function createTextNode(el: Element, parentId: string, ctx: ParseContext): EditorNode {
  const node = createNode("text", parentId);
  const geom = childElementByTag(el, "GeometryOptions");
  node.geometry.text = geom?.getAttribute("Text") ?? "";
  node.geometry.size = 0.3;
  node.geometry.depth = 0;
  node.fontId = DEFAULT_FONT_ID;
  applyMaterialFromPrimitive(el, node, ctx);
  return node;
}

/**
 * R3 GeometryOptions has AlignmentX / AlignmentY on Quads and TextureTexts —
 * these declare the origin (anchor) of the geometry relative to the node's
 * position. R3 default is centered. 3Forge has an equivalent NodeOriginSpec on
 * BaseEditorNode; mapping the two keeps masks (which use Left alignment) and
 * left/right-aligned text in the right world position.
 */
function applyAlignment(el: Element, node: EditorNode): void {
  const geom = childElementByTag(el, "GeometryOptions");
  if (!geom) return;
  const ax = geom.getAttribute("AlignmentX");
  const ay = geom.getAttribute("AlignmentY");
  if (ax === "Left") node.origin.x = "left";
  else if (ax === "Right") node.origin.x = "right";
  if (ay === "Top") node.origin.y = "top";
  else if (ay === "Bottom") node.origin.y = "bottom";
}

function applyTransform(el: Element, node: EditorNode): void {
  const transformEl = childElementByTag(el, "NodeTransform");
  if (!transformEl) {
    return;
  }
  const positionEl = childElementByTag(transformEl, "Position");
  if (positionEl) {
    // R3 Designer is screen-space-ish: +Y points down (canvas Y), the camera
    // sits on the -Z side of the scene (e.g. <Camera Position Z="-3.8"/>) and
    // depth layers stack toward -Z (CONTENT Z=-0.01, layers at Z=-1, etc.).
    // Three.js editor camera sits on +Z with +Y up, so we negate both Y and Z
    // to put the scene on the same side of XY plane the editor camera lives
    // on. The exporter undoes both flips to keep round-trips clean.
    setVecFromEl(positionEl, node.transform.position, 0, { flipY: true, flipZ: true });
  }
  const scaleEl = childElementByTag(transformEl, "Scale");
  if (scaleEl) {
    setVecFromEl(scaleEl, node.transform.scale, 1);
  }
  const rotationEl = childElementByTag(transformEl, "Rotation");
  if (rotationEl) {
    setVecFromEl(rotationEl, node.transform.rotation);
  }
}

function setVecFromEl(
  el: Element,
  target: TransformSpec["position"],
  fallback = 0,
  options: { flipY?: boolean; flipZ?: boolean } = {},
): void {
  if (el.hasAttribute("X")) target.x = parseNumberAttr(el, "X", fallback);
  if (el.hasAttribute("Y")) {
    const raw = parseNumberAttr(el, "Y", fallback);
    target.y = options.flipY ? -raw : raw;
  }
  if (el.hasAttribute("Z")) {
    const raw = parseNumberAttr(el, "Z", fallback);
    target.z = options.flipZ ? -raw : raw;
  }
}

function applyMaterialFromPrimitive(el: Element, node: EditorNode, ctx: ParseContext): void {
  if (node.type === "group") {
    return;
  }
  const primitive = childElementByTag(el, "Primitive");
  if (!primitive) {
    return;
  }
  const mappingList = childElementByTag(primitive, "FaceMappingList");
  if (!mappingList) {
    return;
  }
  const mapping = childElementByTag(mappingList, "NamedBaseFaceMapping");
  if (!mapping) {
    return;
  }
  const materialId = mapping.getAttribute("MaterialId");
  if (!materialId) {
    return;
  }
  const baseSpec = ctx.baseMaterials.get(materialId.toLowerCase());
  if (!baseSpec) {
    return;
  }
  node.material = { ...baseSpec };
}

// ---------------------------------------------------------------------------
// Timelines
// ---------------------------------------------------------------------------

function parseTimelines(timelinesEl: Element, blueprint: ComponentBlueprint, ctx: ParseContext): void {
  const format = timelinesEl.getAttribute("Format") ?? "";
  const fps = fpsForFormat(format);
  if (format && !KNOWN_FORMATS.has(format)) {
    ctx.warnings.push(`Unknown timeline Format "${format}" — assuming ${fps} fps. Verify keyframe timing.`);
  }

  const clips: AnimationClip[] = [];
  const timelineEls = childElementsByTag(timelinesEl, "Timeline");
  for (const timelineEl of timelineEls) {
    const clip = parseTimeline(timelineEl, ctx, fps);
    if (clip) {
      clips.push(clip);
    }
  }

  if (clips.length === 0) {
    return;
  }

  blueprint.animation = {
    activeClipId: clips[0].id,
    clips,
  };
}

/**
 * Broadcast format → playback fps. Notably, "i" (interlaced) suffixes denote
 * fields per second; the actual frame rate is half. Sources confirm
 * HD1080i50 → 25 fps. See wTVision research notes.
 */
const FORMAT_FPS: Record<string, number> = {
  HD1080i50: 25,
  HD1080i60: 30,
  HD1080p50: 50,
  HD1080p60: 60,
  HD1080p25: 25,
  HD1080p30: 30,
  "1080i50": 25,
  "1080i60": 30,
  "1080p25": 25,
  "1080p30": 30,
  "1080p50": 50,
  "1080p60": 60,
  HD720p50: 50,
  HD720p60: 60,
  UHD2160p25: 25,
  UHD2160p30: 30,
  UHD2160p50: 50,
  UHD2160p60: 60,
};

const KNOWN_FORMATS = new Set(Object.keys(FORMAT_FPS));

function fpsForFormat(format: string): number {
  if (!format) {
    return 25;
  }
  if (FORMAT_FPS[format] !== undefined) {
    return FORMAT_FPS[format];
  }
  const fieldMatch = format.match(/i(\d+)$/);
  if (fieldMatch) {
    return Math.max(1, Math.round(Number(fieldMatch[1]) / 2));
  }
  const progressiveMatch = format.match(/p(\d+)$/);
  if (progressiveMatch) {
    return Math.max(1, Math.round(Number(progressiveMatch[1])));
  }
  return 25;
}

function parseTimeline(el: Element, ctx: ParseContext, formatFps: number): AnimationClip | null {
  const name = el.getAttribute("Name") ?? "clip";
  const timelineId = el.getAttribute("Id");
  const maxFrames = Math.max(1, Math.round(parseNumberAttr(el, "MaxFrames", 200)));
  const clip = createAnimationClip(name, { fps: formatFps, durationFrames: maxFrames });
  if (timelineId) {
    ctx.shadow.clipIds[clip.id] = timelineId.toLowerCase();
  }

  const controllers = childElementsByTag(el, "KeyFrameAnimationController");
  for (const controllerEl of controllers) {
    const animatedProperty = controllerEl.getAttribute("AnimatedProperty") ?? "";
    const controllableId = (controllerEl.getAttribute("ControllableId") ?? "").toLowerCase();

    const propertyPath = W3D_PROPERTY_TO_PATH[animatedProperty];
    if (!propertyPath) {
      ctx.warnings.push(`Skipped unsupported animated property "${animatedProperty}" on timeline "${name}".`);
      continue;
    }

    const nodeId = ctx.idMap.get(controllableId);
    if (!nodeId) {
      ctx.warnings.push(`Skipped track for unknown ControllableId ${controllableId} on timeline "${name}".`);
      continue;
    }

    const track = createAnimationTrack(nodeId, propertyPath);
    ctx.shadow.trackKeys[track.id] = `${controllableId}|${animatedProperty}`;
    const keyframes = childElementsByTag(controllerEl, "KeyFrame");
    const sortedKeyframes = [...keyframes].sort(
      (a, b) => parseNumberAttr(a, "FrameNumber", 0) - parseNumberAttr(b, "FrameNumber", 0),
    );

    const flipKeyframeY = animatedProperty === "Transform.Position.YProp";
    const flipKeyframeZ = animatedProperty === "Transform.Position.ZProp";

    sortedKeyframes.forEach((kfEl, index) => {
      const frame = parseNumberAttr(kfEl, "FrameNumber", 0);
      const rawValue = parseNumberAttr(kfEl, "Value", 0);
      const value = animatedProperty === "Enabled"
        ? booleanAttrAsNumber(kfEl.getAttribute("Value"))
        : flipKeyframeY ? -rawValue
        : flipKeyframeZ ? -rawValue
        : rawValue;
      const ease = mapEase(
        sortedKeyframes[index - 1]?.getAttribute("RightType") ?? "Linear",
        kfEl.getAttribute("LeftType") ?? "Linear",
      );
      const kf = createAnimationKeyframe(frame, value, ease);
      const kfId = kfEl.getAttribute("Id");
      if (kfId) {
        ctx.shadow.keyframeIds[kf.id] = kfId.toLowerCase();
      }
      track.keyframes.push(kf);
    });

    if (track.keyframes.length > 0) {
      clip.tracks.push(track);
    }
  }

  return clip.tracks.length > 0 ? clip : null;
}

function mapEase(prevRight: string, currentLeft: string): AnimationEasePreset {
  if (prevRight === "Linear" && currentLeft === "Linear") {
    return "linear";
  }
  if (prevRight === "CubicBezier" && currentLeft === "Linear") {
    return "easeIn";
  }
  if (prevRight === "Linear" && currentLeft === "CubicBezier") {
    return "easeOut";
  }
  return "easeInOut";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyBlueprint(componentName: string, nodes: EditorNode[]): ComponentBlueprint {
  return {
    version: 1,
    componentName,
    fonts: [],
    materials: [],
    images: [],
    nodes,
    animation: createDefaultAnimation(),
  };
}

function childElementsOf(el: Element): Element[] {
  return Array.from(el.children);
}

function childElementsByTag(el: Element | null | undefined, tag: string): Element[] {
  if (!el) {
    return [];
  }
  return Array.from(el.children).filter((child) => child.tagName === tag);
}

function childElementByTag(el: Element | null | undefined, tag: string): Element | null {
  if (!el) {
    return null;
  }
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) {
      return child;
    }
  }
  return null;
}

function parseNumberAttr(el: Element | null | undefined, attr: string, fallback: number): number {
  if (!el) {
    return fallback;
  }
  const raw = el.getAttribute(attr);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function booleanAttrAsNumber(value: string | null): number {
  return value === "True" ? 1 : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function sanitizeHex(value: string): string {
  const trimmed = value.replace(/[^0-9a-fA-F]/g, "");
  if (trimmed.length === 6) {
    return trimmed.toLowerCase();
  }
  if (trimmed.length === 3) {
    const [r, g, b] = trimmed;
    return `${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (trimmed.length === 8) {
    return trimmed.slice(2).toLowerCase();
  }
  return "ffffff";
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx <= 0 ? name : name.slice(0, idx);
}
