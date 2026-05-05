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
  EngineCameraSettings,
  EngineCameraMetadata,
  EngineViewportSettings,
  ExposedProperty,
  ExposedPropertyType,
  ImageAsset,
  ImportedLight,
  ImportMetadata,
  MaterialSpec,
  SceneMode,
  TextureSamplingOptions,
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
  /**
   * True when the importer applied the legacy +Y-down / -Z-depth screen-space
   * flip on Position values (and on Y/Z keyframes). Exporter must mirror this
   * exact decision to keep round-trips byte-stable. Absent = legacy true for
   * back-compat with blueprints written before this flag existed.
   */
  flippedYZ?: boolean;
  /**
   * Node ids that the renderer should hide because they're placeholders for
   * <Mesh>/<Model> primitives whose vertex buffers we can't yet load. The
   * hierarchy and transforms survive (for inspector, animation tracks, and
   * round-trip export) but rendering 100s of opaque cubes would drown the
   * scene in placeholder geometry.
   */
  meshPlaceholderNodeIds?: string[];
  /**
   * Per-node `<MaskProperties>` attribute bag (DisableBinaryAlpha,
   * IsColoredMask, etc.). Preserved for round-trip and future stencil work;
   * the current renderer doesn't read these yet.
   */
  maskProperties?: Record<string, Record<string, string>>;
  /**
   * 3Forge node ids that the source XML had `Enable="False"` on. The
   * importer flips every node to visible at import time (design-view —
   * authors hide a HELPERS / ESCONDER group as their workflow scaffolding,
   * we want users to actually SEE the imported scene), but the exporter
   * needs the original list so it can preserve `Enable="False"` for nodes
   * the user didn't explicitly re-enable. Without this round-trips would
   * silently strip every "false" flag.
   */
  initialDisabledNodeIds?: string[];
  /**
   * Subset of `initialDisabledNodeIds` whose own name — or some ancestor's
   * name — matches a known authoring-helper pattern (HELPERS, ESCONDER,
   * Pitch_Reference). The renderer hides these from the viewport while
   * leaving them in the tree (selectable, editable, exportable). Without
   * this the design-view promotion correctly turned them visible but they
   * then competed with the authored layout — a giant solid-colour
   * `Pitch_Reference` plate ended up in front of the scoreboard.
   */
  helperNodeIds?: string[];
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
  /**
   * TextureLayerId (lowercase) → ordered list of 3Forge node ids that draw
   * with that layer. R3 routes animated `TextureMappingOption.*` properties
   * through the TextureLayer's GUID (not the node's), so to fan a single
   * controller out onto every Quad that shares the layer we need this map.
   */
  textureLayerToNodeIds: Map<string, string[]>;
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
  /** Pending mask resolutions: 3Forge node id → ordered list of W3D mask Ids (lower-cased). */
  pendingMaskRefs: Map<string, string[]>;
  /** 3Forge node ids of plane fallbacks for quads whose texture wasn't supplied. */
  missingTextureNodeIds: Set<string>;
  /** 3Forge node ids that stand in for <Mesh>/<Model> primitives we can't load. */
  meshPlaceholderNodeIds: Set<string>;
  /** 3Forge node ids whose source XML had `Enable="False"` (authoring-time hidden). */
  initialDisabledNodeIds: Set<string>;
  /** When true, position+keyframe Y/Z values are negated to map R3 screen-space → Three.js. */
  flipYZ: boolean;
  /** mesh resource id (lowercase, no extension) → marker that asset is on disk. */
  meshAssets: Set<string>;
  /** Aggregate counts for noisy "skipped" warnings, written into ctx.warnings at the end. */
  skipped: Map<string, { count: number; sample: string | null }>;
}

export interface W3DParseOptions {
  sceneName?: string;
  textures?: Map<string, ImageAsset>;
  videos?: Set<string>;
  /**
   * Lower-cased GUIDs of mesh resources available on disk (.vert + .ind pairs
   * under Resources/Meshes). Currently used only for clearer warnings —
   * vertex-buffer loading is not yet implemented.
   */
  meshAssets?: Set<string>;
  /**
   * Force a specific scene mode, bypassing detection. Used by tests / when the
   * caller has overridden the user's preferred orientation.
   */
  sceneModeOverride?: SceneMode;
}

/**
 * R3 → 3Forge animation property mapping. Most W3D properties target a
 * single 3Forge path; a few (uniform `Transform.Scale`) fan out to multiple
 * paths because Three.js stores the components separately. Using arrays
 * uniformly keeps the parser logic simple — single-axis tracks just get a
 * 1-element array.
 */
const W3D_PROPERTY_TO_PATHS: Record<string, AnimationPropertyPath[]> = {
  "Transform.Position.XProp": ["transform.position.x"],
  "Transform.Position.YProp": ["transform.position.y"],
  "Transform.Position.ZProp": ["transform.position.z"],
  "Transform.Rotation.XProp": ["transform.rotation.x"],
  "Transform.Rotation.YProp": ["transform.rotation.y"],
  "Transform.Rotation.ZProp": ["transform.rotation.z"],
  // Some R3 scenes (notably AR_GAMEINTRO/AR_TACTIC) emit the rotation Y
  // controller without the canonical `.Prop` suffix. Treat the bare name as
  // an alias for the .YProp path so those tracks stop being aggregated as
  // "no track mapping" and actually animate.
  "Transform.Rotation.Y": ["transform.rotation.y"],
  "Transform.Scale.XProp": ["transform.scale.x"],
  "Transform.Scale.YProp": ["transform.scale.y"],
  "Transform.Scale.ZProp": ["transform.scale.z"],
  // R3 sometimes ships a single uniform Transform.Scale controller that
  // moves all three axes together (typical In/Out scaling). Fan it out.
  "Transform.Scale": ["transform.scale.x", "transform.scale.y", "transform.scale.z"],
  Enabled: ["visible"],
  // R3 broadcast scenes animate Alpha very heavily for In/Out fades —
  // mapping it to material.opacity recovers most fade animations.
  Alpha: ["material.opacity"],
  "Material.Alpha": ["material.opacity"],
  // Animated UV — broadcast templates use these for sliding logos /
  // ticker bands. ControllableId for these tracks points at the
  // <TextureLayer>, not at a scene node, so parseTimeline routes them
  // through ctx.textureLayerToNodeIds (one track per Quad sharing the
  // layer). Y is negated at keyframe-decode time to mirror the
  // R3-downward-V → Three-upward-V flip we already do in the static
  // parseTextureSamplingOptions path.
  "TextureMappingOption.Offset.XProp": ["material.textureOptions.offsetU"],
  "TextureMappingOption.Offset.YProp": ["material.textureOptions.offsetV"],
  "TextureMappingOption.Scale.XProp": ["material.textureOptions.repeatU"],
  "TextureMappingOption.Scale.YProp": ["material.textureOptions.repeatV"],
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

  const sceneModeDecision = options.sceneModeOverride
    ? { mode: options.sceneModeOverride, source: "override" as const, reason: "caller override" }
    : detectSceneMode(sceneEl, componentName);
  const sceneMode: SceneMode = sceneModeDecision.mode;
  // Legacy authoring (broadcast layouts in XY screen-space) only needs the Y/Z
  // negation when we render in 2D ortho. In 3D mode we mirror via the camera
  // pose instead, so the scene graph is preserved verbatim.
  const flipYZ = sceneMode === "2d";

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
      flippedYZ: flipYZ,
    },
    textureLayerToFilename: new Map(),
    textureLayerToNodeIds: new Map(),
    textures: normalizeFilenameMap(options.textures),
    videos: normalizeFilenameSet(options.videos),
    usedImages: new Map(),
    texturesProvided: !!options.textures && options.textures.size > 0,
    missingTextures: new Set(),
    pendingMaskRefs: new Map(),
    missingTextureNodeIds: new Set(),
    meshPlaceholderNodeIds: new Set(),
    initialDisabledNodeIds: new Set(),
    flipYZ,
    meshAssets: options.meshAssets ?? new Set(),
    skipped: new Map(),
  };

  const sceneLayer = sceneEl.getElementsByTagName("SceneLayer")[0];
  if (!sceneLayer) {
    return {
      blueprint: emptyBlueprint(componentName, ctx.nodes, sceneMode),
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

  const engine = collectEngineSettings(sceneEl, sceneLayer, sceneMode, flipYZ);
  const exposedProperties = parseExposedProperties(sceneEl);
  const lights = collectImportedLights(sceneEl);

  const blueprint: ComponentBlueprint = {
    version: 1,
    componentName,
    sceneMode,
    fonts: [],
    materials: [],
    images: Array.from(ctx.usedImages.values()),
    nodes: ctx.nodes,
    animation: createDefaultAnimation(),
  };
  if (engine) blueprint.engine = engine;
  if (exposedProperties.length > 0) blueprint.exposedProperties = exposedProperties;
  const importMetadata: ImportMetadata = { source: "w3d" };
  if (lights.length > 0) importMetadata.lights = lights;
  blueprint.importMetadata = importMetadata;

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
  if (ctx.meshPlaceholderNodeIds.size > 0) {
    ctx.shadow.meshPlaceholderNodeIds = Array.from(ctx.meshPlaceholderNodeIds);
  }
  if (ctx.initialDisabledNodeIds.size > 0) {
    ctx.shadow.initialDisabledNodeIds = Array.from(ctx.initialDisabledNodeIds);
    const helperIds = collectAuthoringHelperNodeIds(
      ctx.nodes,
      ctx.initialDisabledNodeIds,
    );
    if (helperIds.length > 0) ctx.shadow.helperNodeIds = helperIds;
  }

  // Resolve mask references now that all nodes are walked (mask quads can be
  // declared after the nodes referencing them). Multi-mask is intersected
  // by the renderer; we just feed it the resolved id list here.
  let unresolvedMasks = 0;
  for (const [nodeId, w3dMaskIds] of ctx.pendingMaskRefs) {
    const resolved: string[] = [];
    for (const w3dMaskId of w3dMaskIds) {
      const maskNodeId = ctx.idMap.get(w3dMaskId);
      if (maskNodeId) resolved.push(maskNodeId);
      else unresolvedMasks += 1;
    }
    if (resolved.length === 0) continue;
    const node = ctx.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    node.maskId = resolved[0];
    if (resolved.length > 1) node.maskIds = resolved;
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

  flushSkipWarnings(ctx);

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
  // Combined resource id (lower) → filename. Both <Texture> (still images)
  // and <ImageSequence> (video clips, e.g. .mov) live here under the same
  // GUID space — TextureMappingOption.Texture references either kind by Id.
  // <Texture> exposes the file via Filename="..." while <ImageSequence>
  // carries it in Name="..." (no Filename attribute), so we read the
  // appropriate one per resource type.
  const textureById = new Map<string, string>();
  for (const tex of Array.from(resourcesEl.getElementsByTagName("Texture"))) {
    const id = tex.getAttribute("Id");
    const filename = tex.getAttribute("Filename");
    if (!id || !filename) continue;
    textureById.set(id.toLowerCase(), filename);
  }
  for (const seq of Array.from(resourcesEl.getElementsByTagName("ImageSequence"))) {
    const id = seq.getAttribute("Id");
    const filename = seq.getAttribute("Name");
    if (!id || !filename) continue;
    textureById.set(id.toLowerCase(), filename);
  }

  // TextureLayer id (lower) → filename via TextureMappingOption.Texture. R3
  // stores the reference one of three ways:
  //  - GUID matching a <Texture Id="…"> in this scene's Resources.
  //  - GUID matching an <ImageSequence Id="…"> for video textures.
  //  - File path like "ProjectResource\Foo.png" — a shared asset library
  //    outside the scene folder. We treat the basename as a filename hint and
  //    let the folder import resolve it if the user happens to have placed
  //    the file in Resources/Textures.
  const layerToFilename = new Map<string, string>();
  for (const layer of Array.from(resourcesEl.getElementsByTagName("TextureLayer"))) {
    const layerId = layer.getAttribute("Id");
    if (!layerId) continue;
    const mapping = childElementByTag(layer, "TextureMappingOption");
    const textureRef = mapping?.getAttribute("Texture");
    if (!textureRef) continue;
    const resolved = resolveTextureReference(textureRef, textureById);
    if (!resolved) continue;
    layerToFilename.set(layerId.toLowerCase(), resolved);
  }
  return layerToFilename;
}

function resolveTextureReference(reference: string, textureById: Map<string, string>): string | null {
  // Direct GUID hit takes priority — even if the string happens to also look
  // like a path, GUIDs win because they're exact and unambiguous.
  const direct = textureById.get(reference.toLowerCase());
  if (direct) return direct;
  // Path form: pull the basename. R3 paths use Windows backslashes; on the
  // off chance forward slashes show up we strip those too.
  const cleaned = reference.replace(/\\/g, "/");
  const slash = cleaned.lastIndexOf("/");
  const basename = slash >= 0 ? cleaned.slice(slash + 1) : cleaned;
  if (!basename || basename.toLowerCase() === reference.toLowerCase()) {
    // Reference was already a bare filename and didn't match a GUID — return
    // it so the caller can still try to look it up against supplied textures.
    return basename || null;
  }
  return basename;
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
    // Lights are walked separately by collectImportedLights and stashed in
    // importMetadata.lights — we don't create scene nodes for them yet
    // because the editor uses fixed lighting. We still emit one aggregated
    // "DirectionalLight" warning per scene so the user knows lighting was
    // skipped (and so existing tests that grep for "DirectionalLight" pass).
    aggregateSkip(ctx, "DirectionalLight", w3dName, "saved to importMetadata.lights — fixed editor lighting in use");
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
    case "GeometryText":
      // GeometryText is the 3D-extruded variant (R3 ships it for hero
      // titles like "IRONHAWKS"). Same fields, plus optional Extrusion that
      // createTextNode now reads into geometry.depth.
      node = createTextNode(el, parentId, ctx);
      break;
    case "Box":
      node = createBoxNode(el, parentId, ctx);
      break;
    case "Cone":
      node = createConeNode(el, parentId, ctx);
      break;
    case "Mesh":
    case "Model":
      node = createMeshPlaceholderNode(el, parentId, ctx);
      break;
    case "BasicPrimitive":
      // R3 wraps spline/transform groups in <BasicPrimitive> — it's a node
      // with its own transform that contains other primitives. We treat it
      // as a Group so the children survive and the transform is honoured.
      node = createGroupNode(el, parentId, ctx);
      break;
    default:
      aggregateSkip(ctx, tag, w3dName, "no importer for this primitive yet");
      return;
  }

  if (!node) {
    return;
  }

  node.name = w3dName;
  // Design-view: import everything visible. R3 broadcast templates park
  // design-time scaffolding (HELPERS, ESCONDER, REFERENCE) under a parent
  // Group with `Enable="False"`, which would otherwise hide >50% of what
  // the operator is supposed to *see* in the editor. We track the original
  // disabled state in the shadow data so the exporter restores
  // Enable="False" for nodes the user didn't explicitly re-enable.
  node.visible = true;
  if (!enabled) {
    ctx.initialDisabledNodeIds.add(node.id);
  }
  if (isMaskQuad) {
    node.isMask = true; // scene renderer hides masks while still using their bounds for clipping
  }
  applyAlignment(el, node);
  applyTransform(el, node, ctx);
  applyNodeAlpha(el, node);

  // R3 references masks via the MaskId attribute on the masked node — a
  // semicolon-separated list. We resolve every entry post-walk; the first
  // id is also kept on `maskId` for back-compat with code paths that only
  // ever read one mask.
  const maskAttr = el.getAttribute("MaskId");
  if (maskAttr && !isMaskQuad) {
    const ids = maskAttr.split(";").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (ids.length > 0) {
      ctx.pendingMaskRefs.set(node.id, ids);
    }
  }
  // IsInvertedMask flips clipping: keep the inside of the mask volume.
  // MaskProperties (DisableBinaryAlpha, IsColoredMask) we preserve as
  // metadata — the renderer doesn't consume them yet but the data is there
  // for future stencil/colour-key work.
  if (el.getAttribute("IsInvertedMask") === "True" && !isMaskQuad) {
    node.maskInverted = true;
  }
  const maskPropsEl = childElementByTag(el, "MaskProperties");
  if (maskPropsEl) {
    const props: Record<string, string> = {};
    for (let i = 0; i < maskPropsEl.attributes.length; i += 1) {
      const attr = maskPropsEl.attributes[i];
      props[attr.name] = attr.value;
    }
    if (Object.keys(props).length > 0) {
      ctx.shadow.maskProperties ??= {};
      ctx.shadow.maskProperties[node.id] = props;
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
      // Broadcast Quads with textures are essentially unlit overlays — the
      // PNG/JPG already encodes the final colour. Forcing basic material
      // matches R3's "the texture IS the look" behaviour and keeps the
      // colours from being washed out by editor lights or shifted by the
      // standard material's PBR shading.
      imageNode.material.type = "basic";
      // Quads textured with formats that carry an alpha channel (PNG, WEBP)
      // almost always rely on the alpha for cutout silhouettes — broadcast
      // logos, player photos, etc. The XML BaseMaterial defaults to
      // Alpha=1/HasDiffuse=True which would otherwise leave us rendering an
      // opaque rectangle, hiding the cutout. Force transparency + a tiny
      // alphaTest so edges stay crisp without binning the half-transparent
      // pixels of antialiased borders.
      if (assetHasAlphaChannel(stored)) {
        imageNode.material.transparent = true;
        if (imageNode.material.alphaTest <= 0) {
          imageNode.material.alphaTest = 0.01;
        }
      }
      // White diffuse so the texture comes through unchanged. The XML often
      // encodes a tint via Diffuse=#XXX intended for the underlying mesh,
      // but for a textured quad we want the PNG's colours verbatim.
      imageNode.material.color = "#ffffff";
      // Pull TextureMappingOption sampling settings (wrap, filter, offset,
      // scale) onto the material. The renderer applies them to the loaded
      // Texture so authored offsets/repeats survive the import.
      const samplingOptions = parseTextureSamplingOptions(el);
      if (samplingOptions) {
        imageNode.material.textureOptions = samplingOptions;
      }
      registerTextureLayerNode(ctx, layerId, imageNode.id);
      return imageNode;
    }
    ctx.missingTextures.add(filename);
  }

  const node = createNode("plane", parentId);
  node.geometry.width = width;
  node.geometry.height = height;
  applyMaterialFromPrimitive(el, node, ctx);
  // Track the layer→node link even on the plane-fallback path so animated
  // texture properties don't silently drop their target — the renderer can
  // still apply offset/repeat to the (texture-less) material if the user
  // wires up a texture later.
  if (layerId) {
    registerTextureLayerNode(ctx, layerId, node.id);
  }
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

/**
 * Pull texture sampling intent off the <TextureMappingOption> that this
 * Quad is wired to. Returns undefined when there's nothing worth recording
 * (every field falls back to a Three.js default at apply time).
 */
function parseTextureSamplingOptions(quadEl: Element): TextureSamplingOptions | undefined {
  const primitive = childElementByTag(quadEl, "Primitive");
  const list = childElementByTag(primitive, "FaceMappingList");
  const mapping = childElementByTag(list, "NamedBaseFaceMapping");
  if (!mapping) return undefined;
  // The actual TextureMappingOption lives off the TextureLayer in
  // <Resources>, so we walk via the layer's GUID. Find it in the same XML
  // document.
  const layerId = mapping.getAttribute("TextureLayerId");
  if (!layerId || layerId === "Standard") return undefined;
  const doc = quadEl.ownerDocument;
  if (!doc) return undefined;
  const targetLayerId = layerId.toLowerCase();
  let mappingOption: Element | null = null;
  for (const layer of Array.from(doc.getElementsByTagName("TextureLayer"))) {
    if ((layer.getAttribute("Id") ?? "").toLowerCase() === targetLayerId) {
      mappingOption = childElementByTag(layer, "TextureMappingOption");
      break;
    }
  }
  if (!mappingOption) return undefined;

  const out: TextureSamplingOptions = {};
  const wrapU = textureWrapFromW3D(mappingOption.getAttribute("TextureAddressModeU"));
  if (wrapU) out.wrapU = wrapU;
  const wrapV = textureWrapFromW3D(mappingOption.getAttribute("TextureAddressModeV"));
  if (wrapV) out.wrapV = wrapV;
  const magFilter = textureFilterFromW3D(mappingOption.getAttribute("TextureFilteringMag"));
  if (magFilter) out.magFilter = magFilter;
  const minFilter = textureFilterFromW3D(mappingOption.getAttribute("TextureFilteringMin"));
  if (minFilter) out.minFilter = minFilter;
  // Anisotropy: when authored as "Anisotropic" lift to a sane default; the
  // renderer caps to GPU max. R3 doesn't expose a numeric level here.
  if (out.magFilter === "anisotropic" || out.minFilter === "anisotropic") {
    out.anisotropy = 8;
  }

  const offsetEl = childElementByTag(mappingOption, "Offset");
  if (offsetEl) {
    const x = parseNumberAttr(offsetEl, "X", 0);
    const y = parseNumberAttr(offsetEl, "Y", 0);
    if (x !== 0) out.offsetU = x;
    // R3's UV V grows downward; Three's grows upward — so authored Y
    // offsets are negated to keep the visual the same.
    if (y !== 0) out.offsetV = -y;
  }
  const scaleEl = childElementByTag(mappingOption, "Scale");
  if (scaleEl) {
    const x = parseNumberAttr(scaleEl, "X", 1);
    const y = parseNumberAttr(scaleEl, "Y", 1);
    if (x !== 1) out.repeatU = x;
    if (y !== 1) out.repeatV = y;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function textureWrapFromW3D(raw: string | null): TextureSamplingOptions["wrapU"] | undefined {
  switch (raw) {
    case "Clamp":
    case "ClampToEdge":
      return "clamp";
    case "Wrap":
    case "Repeat":
      return "repeat";
    case "Mirror":
    case "MirrorOnce":
      return "mirror";
    default:
      return undefined;
  }
}

function textureFilterFromW3D(raw: string | null): TextureSamplingOptions["magFilter"] | undefined {
  switch (raw) {
    case "Point":
    case "Nearest":
      return "nearest";
    case "Linear":
      return "linear";
    case "Anisotropic":
      return "anisotropic";
    default:
      return undefined;
  }
}

function registerTextureLayerNode(ctx: ParseContext, layerId: string, nodeId: string): void {
  const existing = ctx.textureLayerToNodeIds.get(layerId);
  if (existing) {
    existing.push(nodeId);
  } else {
    ctx.textureLayerToNodeIds.set(layerId, [nodeId]);
  }
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

/**
 * Names that R3 broadcast templates use to mark authoring-only scaffolding
 * (full-frame guides, pitch references, hidden helpers). Conservative whole-
 * name match — case-insensitive, anchored at start and end — so that real
 * elements like "PITCH_OVERLAY" or "RefereeName" don't get caught by mistake.
 */
const HELPER_NAME_RE = /^(helpers?|esconder|pitch[_ -]?reference|reference)$/i;

/**
 * Returns the subset of `disabledNodeIds` whose own name — or the name of any
 * ancestor — matches HELPER_NAME_RE. The renderer will keep these nodes in the
 * tree (for selection/round-trip) but hide them from the viewport, undoing the
 * design-view promotion *only* for clearly-marked authoring helpers.
 */
function collectAuthoringHelperNodeIds(
  nodes: ReadonlyArray<EditorNode>,
  disabledNodeIds: ReadonlySet<string>,
): string[] {
  const byId = new Map<string, EditorNode>();
  for (const n of nodes) byId.set(n.id, n);

  // Cache "is this node or any ancestor a helper-named one?" so deep trees
  // don't re-walk the whole chain per descendant.
  const helperAncestor = new Map<string, boolean>();
  function isHelperAncestor(id: string | null): boolean {
    if (!id) return false;
    const cached = helperAncestor.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node) {
      helperAncestor.set(id, false);
      return false;
    }
    const own = HELPER_NAME_RE.test(node.name ?? "");
    const result = own || isHelperAncestor(node.parentId);
    helperAncestor.set(id, result);
    return result;
  }

  const out: string[] = [];
  for (const id of disabledNodeIds) {
    if (isHelperAncestor(id)) out.push(id);
  }
  return out;
}

function findAssetCaseInsensitive(map: Map<string, ImageAsset>, filename: string): ImageAsset | undefined {
  const lower = filename.toLowerCase();
  for (const [key, value] of map) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function assetHasAlphaChannel(asset: ImageAsset): boolean {
  // Formats with a real alpha channel that broadcast scenes lean on for cutouts.
  // GIF technically has 1-bit alpha but 3Forge rarely uses it; when in doubt,
  // tagging false here just means the user can flip transparency manually.
  const mime = (asset.mimeType ?? "").toLowerCase();
  if (mime === "image/png" || mime === "image/webp" || mime === "image/svg+xml") return true;
  const lowerName = (asset.name ?? "").toLowerCase();
  return lowerName.endsWith(".png") || lowerName.endsWith(".webp") || lowerName.endsWith(".svg");
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
  if (node.type !== "text") return node;
  const geom = childElementByTag(el, "GeometryOptions");
  node.geometry.text = geom?.getAttribute("Text") ?? "";
  // R3 sizes glyphs by the textbox height — <TextBoxSize Y="0.19"/> means
  // ~0.19 world units tall, regardless of the editor's default. NodeTransform
  // Scale is multiplied on top by Three at render time, so the final height
  // is `size * scale.y`. When the textbox is absent (HasTextBox="False",
  // free-flow text), we drop the default down from 0.3 → 0.1 so the typical
  // Scale of 1.5–3× authored on free-flow text doesn't blow it up to fill
  // the viewport.
  const textBox = childElementByTag(geom, "TextBoxSize");
  const textBoxY = parseNumberAttr(textBox, "Y", NaN);
  const hasTextBox = (geom?.getAttribute("HasTextBox") ?? "False") === "True";
  if (Number.isFinite(textBoxY) && textBoxY > 0) {
    node.geometry.size = textBoxY;
  } else {
    node.geometry.size = hasTextBox ? 0.2 : 0.1;
  }
  // R3's <TextureText> is a flat textured glyph plane; <GeometryText> is the
  // 3D-extruded variant authored with `Extrusion="..."`. We respect the
  // authored extrusion when present, falling back to flat for TextureText.
  const extrusion = parseNumberAttr(geom, "Extrusion", 0);
  node.geometry.depth = Math.max(0, extrusion);
  node.fontId = DEFAULT_FONT_ID;
  applyMaterialFromPrimitive(el, node, ctx);
  return node;
}

function createBoxNode(el: Element, parentId: string, ctx: ParseContext): EditorNode {
  const node = createNode("box", parentId);
  const sizeEl = childElementByTag(childElementByTag(el, "GeometryOptions"), "Size");
  if (node.type === "box") {
    node.geometry.width = parseNumberAttr(sizeEl, "X", 1);
    node.geometry.height = parseNumberAttr(sizeEl, "Y", 1);
    node.geometry.depth = parseNumberAttr(sizeEl, "Z", 1);
  }
  applyMaterialFromPrimitive(el, node, ctx);
  return node;
}

/**
 * R3 <Cone> doesn't map cleanly onto Three.js — Three's ConeGeometry is just a
 * CylinderGeometry with `radiusTop = 0`. We use 3Forge's CylinderNode and pin
 * the top radius to zero so the silhouette matches.
 */
function createConeNode(el: Element, parentId: string, ctx: ParseContext): EditorNode {
  const node = createNode("cylinder", parentId);
  if (node.type === "cylinder") {
    const geom = childElementByTag(el, "GeometryOptions");
    node.geometry.radiusBottom = parseNumberAttr(geom, "Radius", parseNumberAttr(geom, "BaseRadius", 0.5));
    node.geometry.radiusTop = 0;
    node.geometry.height = parseNumberAttr(geom, "Height", parseNumberAttr(geom, "Length", 1));
  }
  applyMaterialFromPrimitive(el, node, ctx);
  return node;
}

/**
 * Placeholder for <Mesh> primitives. R3 stores geometry as paired
 * Resources/Meshes/<guid>.vert + .ind binary buffers; loading those is out of
 * scope for v1 (proprietary header). We render a low-cost box stand-in so the
 * scene tree, transforms and animations still survive intact, and round-trip
 * via the shadow XML continues to work.
 */
function createMeshPlaceholderNode(el: Element, parentId: string, ctx: ParseContext): EditorNode {
  const node = createNode("box", parentId);
  if (node.type === "box") {
    // Tiny default — the real mesh's bounds aren't known without parsing the
    // .vert buffer. Authors typically rely on NodeTransform.Scale to size
    // hero meshes, so the scale is preserved by applyTransform.
    node.geometry.width = 0.5;
    node.geometry.height = 0.5;
    node.geometry.depth = 0.5;
  }
  applyMaterialFromPrimitive(el, node, ctx);
  const meshId = (el.getAttribute("MeshId") ?? el.getAttribute("ResourceId") ?? "").toLowerCase();
  const hasAsset = meshId && ctx.meshAssets.has(meshId);
  aggregateSkip(
    ctx,
    "Mesh",
    el.getAttribute("Name") ?? "Mesh",
    hasAsset
      ? "vertex/index buffer loading not yet implemented — hidden placeholder kept for round-trip"
      : "no .vert/.ind asset in folder — hidden placeholder kept for round-trip",
  );
  ctx.meshPlaceholderNodeIds.add(node.id);
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

/**
 * R3 lets authors override the BaseMaterial's alpha right on the primitive
 * via an `Alpha=` attribute on the <Quad>/<TextureText>/<Disk> tag itself.
 * This is what they use for "shadow" quads at 0.5, half-transparent
 * overlays at 0.25, etc. We multiply onto the existing material opacity so
 * a translucent BaseMaterial isn't accidentally bumped back to opaque.
 */
function applyNodeAlpha(el: Element, node: EditorNode): void {
  if (node.type === "group") return;
  const raw = el.getAttribute("Alpha");
  if (raw === null) return;
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  const clamped = Math.max(0, Math.min(1, value));
  // Multiply rather than overwrite — a 0.25 attribute on a quad whose
  // BaseMaterial already had opacity=0.5 should land at 0.125, not 0.25.
  node.material.opacity = node.material.opacity * clamped;
  if (node.material.opacity < 1) {
    node.material.transparent = true;
  }
}

function applyTransform(el: Element, node: EditorNode, ctx: ParseContext): void {
  const transformEl = childElementByTag(el, "NodeTransform");
  if (!transformEl) {
    return;
  }
  const positionEl = childElementByTag(transformEl, "Position");
  if (positionEl) {
    // R3 Designer is screen-space-ish for 2D layouts: +Y points down (canvas
    // Y), depth layers stack toward -Z. Three.js editor uses +Y up. In 2D
    // mode we negate both axes so the layout sits on the same side of the XY
    // plane as the ortho camera. In 3D mode we keep coordinates as authored
    // and adjust the camera pose instead, so the spatial relationships
    // between meshes survive untouched. The exporter mirrors this decision
    // via shadow.flippedYZ.
    setVecFromEl(positionEl, node.transform.position, 0, { flipY: ctx.flipYZ, flipZ: ctx.flipYZ });
  }
  const scaleEl = childElementByTag(transformEl, "Scale");
  if (scaleEl) {
    setVecFromEl(scaleEl, node.transform.scale, 1);
  }
  const rotationEl = childElementByTag(transformEl, "Rotation");
  if (rotationEl) {
    setVecFromEl(rotationEl, node.transform.rotation);
  }
  // Static <Skew> in degrees per axis. Carry it onto the node only when at
  // least one axis is authored — the renderer's identity check skips the
  // skewLayer Group entirely when this stays undefined, so legacy nodes
  // and templates without skew keep their existing wrapper shape.
  const skewEl = childElementByTag(transformEl, "Skew");
  if (skewEl) {
    const skew = { x: 0, y: 0, z: 0 };
    if (skewEl.hasAttribute("X")) skew.x = parseNumberAttr(skewEl, "X", 0);
    if (skewEl.hasAttribute("Y")) skew.y = parseNumberAttr(skewEl, "Y", 0);
    if (skewEl.hasAttribute("Z")) skew.z = parseNumberAttr(skewEl, "Z", 0);
    if (skew.x !== 0 || skew.y !== 0 || skew.z !== 0) {
      node.transform.skew = skew;
    }
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

    const propertyPaths = W3D_PROPERTY_TO_PATHS[animatedProperty];
    if (!propertyPaths) {
      // Aggregate by property — broadcast scenes touch the same handful of
      // unsupported tracks (Skew, Size, TextureMappingOption.Offset)
      // hundreds of times across timelines.
      aggregateSkip(ctx, "AnimatedProperty", animatedProperty, `no track mapping for "${animatedProperty}"`);
      continue;
    }

    // ControllableId for animated TextureMappingOption tracks references the
    // <TextureLayer> rather than a scene node — fan the controller out to
    // every Quad that draws with that layer (often more than one in
    // broadcast templates that reuse a single texture across siblings).
    const isTextureMappingTrack = animatedProperty.startsWith("TextureMappingOption.");
    const nodeIds = isTextureMappingTrack
      ? ctx.textureLayerToNodeIds.get(controllableId) ?? []
      : (() => {
          const id = ctx.idMap.get(controllableId);
          return id ? [id] : [];
        })();
    if (nodeIds.length === 0) {
      aggregateSkip(ctx, "AnimationTrack", controllableId, "track targets a node we didn't import");
      continue;
    }

    // Pre-sort + decode the source keyframes once so each fan-out track
    // sees identical values. Decoding here also keeps the Y/Z sign-flip
    // logic in one place.
    const keyframes = childElementsByTag(controllerEl, "KeyFrame");
    const sortedKeyframes = [...keyframes].sort(
      (a, b) => parseNumberAttr(a, "FrameNumber", 0) - parseNumberAttr(b, "FrameNumber", 0),
    );
    const flipKeyframeY = ctx.flipYZ && animatedProperty === "Transform.Position.YProp";
    const flipKeyframeZ = ctx.flipYZ && animatedProperty === "Transform.Position.ZProp";
    // R3 stores texture V offsets growing downward; Three's grow upward, so
    // negate the keyframe value to keep the visual direction the same. This
    // mirrors the static `out.offsetV = -y` in parseTextureSamplingOptions.
    // Scale (repeat) is a magnitude, not a direction — no flip needed.
    const flipKeyframeOffsetV = animatedProperty === "TextureMappingOption.Offset.YProp";

    // Walk every (node, target path) pair. Most properties resolve to a
    // single node + single path; uniform Scale fans out to three paths;
    // shared TextureLayers fan out to N nodes. Using a stable cached value
    // array prevents the import from re-decoding the same XML per axis.
    for (const nodeId of nodeIds) for (const propertyPath of propertyPaths) {
      const track = createAnimationTrack(nodeId, propertyPath);
      // Same trackKey for every fan-out so the exporter folds them back
      // onto the original single controller — patchKeyframe is idempotent
      // when the values match across axes (which they do for uniform Scale).
      ctx.shadow.trackKeys[track.id] = `${controllableId}|${animatedProperty}`;

      sortedKeyframes.forEach((kfEl, index) => {
        const frame = parseNumberAttr(kfEl, "FrameNumber", 0);
        const rawValue = parseNumberAttr(kfEl, "Value", 0);
        const value = animatedProperty === "Enabled"
          ? booleanAttrAsNumber(kfEl.getAttribute("Value"))
          : flipKeyframeY ? -rawValue
          : flipKeyframeZ ? -rawValue
          : flipKeyframeOffsetV ? -rawValue
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

function emptyBlueprint(componentName: string, nodes: EditorNode[], sceneMode?: SceneMode): ComponentBlueprint {
  const blueprint: ComponentBlueprint = {
    version: 1,
    componentName,
    fonts: [],
    materials: [],
    images: [],
    nodes,
    animation: createDefaultAnimation(),
  };
  if (sceneMode) blueprint.sceneMode = sceneMode;
  return blueprint;
}

// ---------------------------------------------------------------------------
// Scene-mode detection + engine settings
// ---------------------------------------------------------------------------

const PRIMITIVE_TAGS_3D = new Set(["Mesh", "Box", "Cone", "Sphere", "Cylinder", "DirectionalLight", "PointLight", "SpotLight"]);

interface SceneModeDecision {
  mode: SceneMode;
  source: "name-2d" | "name-3d" | "Is2DScene-attr" | "heuristic-3d" | "heuristic-2d" | "default" | "override";
  reason: string;
}

const NAME_2D_PATTERNS = [
  /(^|[_-])fs([_-]|$)/i,
  /(^|[_-])fullscreen($|[_-])/i,
  /(^|[_-])overlay($|[_-])/i,
  /(^|[_-])2d($|[_-])/i,
  /(^|[_-])lower([_-]?third)?($|[_-])/i,
];
const NAME_3D_PATTERNS = [
  /^ar[_-]/i,
  /(^|[_-])ar($|[_-])/i,
  /(^|[_-])3d($|[_-])/i,
];

/**
 * Decide between 2D (orthographic broadcast layout) and 3D (perspective
 * spatial scene).
 *
 * Priority order (highest first):
 *   1. Caller `sceneModeOverride` (handled by parseW3D before calling this).
 *   2. **Folder-name conventions**. R3 broadcast houses encode camera intent
 *      in the file name (`*_FS`, `*_Fullscreen`, `*_Overlay`, `*_2D`,
 *      `AR_*`). These are reliable studio conventions and override
 *      Is2DScene, which authors leave at the default in many cases.
 *   3. `Is2DScene` attribute when explicitly set.
 *   4. Heuristics: 3D primitives (Mesh/Box/Cone/Light) or off-plane camera
 *      → 3D; otherwise 2D.
 */
export function detectSceneMode(sceneEl: Element, sceneName?: string): SceneModeDecision {
  if (sceneName) {
    if (NAME_2D_PATTERNS.some((re) => re.test(sceneName))) {
      return { mode: "2d", source: "name-2d", reason: `name "${sceneName}" matches a 2D/fullscreen convention` };
    }
    if (NAME_3D_PATTERNS.some((re) => re.test(sceneName))) {
      return { mode: "3d", source: "name-3d", reason: `name "${sceneName}" matches an AR/3D convention` };
    }
  }

  const attr = sceneEl.getAttribute("Is2DScene");
  if (attr === "True") {
    return { mode: "2d", source: "Is2DScene-attr", reason: 'Is2DScene="True"' };
  }
  if (attr === "False") {
    return { mode: "3d", source: "Is2DScene-attr", reason: 'Is2DScene="False"' };
  }

  const tags = Array.from(sceneEl.getElementsByTagName("*"))
    .map((el) => el.tagName);
  if (tags.some((t) => PRIMITIVE_TAGS_3D.has(t))) {
    const found = tags.find((t) => PRIMITIVE_TAGS_3D.has(t)) ?? "3d primitive";
    return { mode: "3d", source: "heuristic-3d", reason: `found <${found}> in scene` };
  }
  // Camera positioned away from XY plane → 3D.
  const cameras = Array.from(sceneEl.getElementsByTagName("Camera"));
  for (const camera of cameras) {
    const pos = childElementByTag(camera, "Position");
    if (pos) {
      const z = Math.abs(parseNumberAttr(pos, "Z", 0));
      if (z > 0.0001) {
        return { mode: "3d", source: "heuristic-3d", reason: `camera Z=${pos.getAttribute("Z")}` };
      }
    }
  }

  // Fallback: only Quad/Disk/TextureText → 2D layout.
  return { mode: "2d", source: "heuristic-2d", reason: "no 3D primitives or off-plane camera detected" };
}

function collectEngineSettings(
  sceneEl: Element,
  sceneLayer: Element | null,
  sceneMode: SceneMode,
  flipYZ: boolean,
): EngineViewportSettings | undefined {
  const out: EngineViewportSettings = {};

  // Camera tracked? AR/broadcast scenes composite over a live video feed, so
  // the editor background should be transparent (or chroma) instead of the
  // R3 studio's opaque preview colour. We promote the background to
  // "transparent" whenever a tracked camera is present and short-circuit the
  // BackgroundColor handling.
  const cameraEl = sceneEl.getElementsByTagName("Camera")[0] ?? null;
  const cameraTracked = cameraEl?.getAttribute("IsTracked") === "True";
  const isChroma = sceneEl.getAttribute("IsChroma") === "True";

  if (cameraTracked || isChroma) {
    out.background = { type: "transparent" };
  } else {
    // Background — SceneLayer.BackgroundColor is a signed 32-bit ARGB integer
    // (e.g. -16777216 = 0xFF000000 = opaque black).
    const bgRaw = sceneLayer?.getAttribute("BackgroundColor");
    if (bgRaw) {
      const argb = Number(bgRaw);
      if (Number.isFinite(argb)) {
        const u32 = argb >>> 0;
        const a = ((u32 >>> 24) & 0xff) / 255;
        const r = (u32 >>> 16) & 0xff;
        const g = (u32 >>> 8) & 0xff;
        const b = u32 & 0xff;
        const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        out.background = a < 1 ? { type: "color", color: hex, alpha: a } : { type: "color", color: hex };
      }
    }
  }

  // Camera — first <Camera> wins. Position/Rotation are flipped Y/Z to match
  // editor conventions when we're keeping the scene graph as authored (3D
  // mode); in 2D mode the geometry itself was already flipped, so the camera
  // can sit on the +Z side at the standard ortho location and we leave it to
  // the renderer's defaults.
  const camera = cameraEl;
  if (camera) {
    const cam: EngineCameraSettings = {
      mode: sceneMode === "2d" ? "orthographic" : "perspective",
    };
    const fov = parseNumberAttr(camera, "FieldofViewY", NaN);
    if (Number.isFinite(fov) && fov > 0) cam.fovY = fov;

    const positionEl = childElementByTag(camera, "Position");
    if (positionEl) {
      const x = parseNumberAttr(positionEl, "X", 0);
      const y = parseNumberAttr(positionEl, "Y", 0);
      const z = parseNumberAttr(positionEl, "Z", 0);
      // In 3D mode we mirror via the camera so authored X stays as-is, and
      // we negate Z so a Designer cam at Z=-22 (looking +Z toward origin)
      // becomes a Three cam at Z=+22 (looking -Z toward origin).
      cam.position = flipYZ
        ? { x, y: -y, z: -z }
        : { x, y, z: -z };
    }
    const rotationEl = childElementByTag(camera, "Rotation");
    if (rotationEl) {
      cam.rotation = {
        x: parseNumberAttr(rotationEl, "X", 0),
        y: parseNumberAttr(rotationEl, "Y", 0),
        z: parseNumberAttr(rotationEl, "Z", 0),
      };
    }

    // Broadcast metadata worth surfacing — not used for projection but the
    // renderer copies it onto camera.userData so future broadcast plug-ins
    // (NDI, tracking, render-target routing) can pick it up.
    const metadata: EngineCameraMetadata = {};
    if (cameraTracked) metadata.isTracked = true;
    const trackingCamera = camera.getAttribute("TrackingCamera");
    if (trackingCamera) metadata.trackingCamera = trackingCamera;
    const renderTarget = camera.getAttribute("RenderTarget");
    if (renderTarget) metadata.renderTarget = renderTarget;
    const aspect = parseNumberAttr(camera, "AspectRatio", NaN);
    if (Number.isFinite(aspect) && aspect > 0) metadata.aspectRatio = aspect;
    const fovX = parseNumberAttr(camera, "FieldofViewX", NaN);
    if (Number.isFinite(fovX) && fovX > 0) metadata.fovX = fovX;
    const sourceId = camera.getAttribute("Id");
    if (sourceId) metadata.sourceId = sourceId.toLowerCase();
    const sourceName = camera.getAttribute("Name");
    if (sourceName) metadata.sourceName = sourceName;
    if (Object.keys(metadata).length > 0) cam.metadata = metadata;

    out.camera = cam;
  }

  return out.background || out.camera ? out : undefined;
}

// ---------------------------------------------------------------------------
// Lights, Exposed properties, Import metadata
// ---------------------------------------------------------------------------

/**
 * Walk every <DirectionalLight> in the scene and snapshot its pose +
 * intensity into a metadata array. We don't yet instantiate Three lights —
 * the editor uses fixed scene lighting — but preserving the data lets a
 * future renderer or runtime export pick the authored lighting back up.
 */
function collectImportedLights(sceneEl: Element): ImportedLight[] {
  const out: ImportedLight[] = [];
  for (const el of Array.from(sceneEl.getElementsByTagName("DirectionalLight"))) {
    const id = el.getAttribute("Id") ?? "";
    if (!id) continue;
    const light: ImportedLight = {
      id: id.toLowerCase(),
      name: el.getAttribute("Name") ?? "DirectionalLight",
      kind: "directional",
    };
    const geom = childElementByTag(el, "GeometryOptions");
    const intensity = parseNumberAttr(childElementByTag(geom, "Intensity"), "Value", NaN);
    if (Number.isFinite(intensity)) light.intensity = intensity;
    const baseMaterial = childElementByTag(geom, "BaseMaterial");
    const diffuse = baseMaterial?.getAttribute("Diffuse");
    if (diffuse) light.color = "#" + sanitizeHex(diffuse);
    const transformEl = childElementByTag(el, "NodeTransform");
    if (transformEl) {
      const positionEl = childElementByTag(transformEl, "Position");
      if (positionEl) {
        light.position = {
          x: parseNumberAttr(positionEl, "X", 0),
          y: parseNumberAttr(positionEl, "Y", 0),
          z: parseNumberAttr(positionEl, "Z", 0),
        };
      }
      const rotationEl = childElementByTag(transformEl, "Rotation");
      if (rotationEl) {
        light.rotation = {
          x: parseNumberAttr(rotationEl, "X", 0),
          y: parseNumberAttr(rotationEl, "Y", 0),
          z: parseNumberAttr(rotationEl, "Z", 0),
        };
      }
    }
    out.push(light);
  }
  return out;
}

const W3D_TYPE_TO_EXPOSED: Record<string, ExposedPropertyType> = {
  String: "string",
  Float: "number",
  Int: "number",
  Bool: "boolean",
  ColorInt: "color",
  Color: "color",
  Texture: "texture",
};

/**
 * Parse <ExportList>/<ExportProperty> into the blueprint's exposedProperties.
 * R3 uses these to mark fields the operator is meant to tweak per take —
 * scoreboards, names, sponsor logos. We surface them as a flat list with
 * the GUID-based binding (`controllableId`) preserved so the renderer can
 * later wire them up to the right node/material.
 */
function parseExposedProperties(sceneEl: Element): ExposedProperty[] {
  const out: ExposedProperty[] = [];
  // ExportProperty can live under ExportList or directly under
  // ExportManagerProperties / Resources — search broadly.
  const props = Array.from(sceneEl.getElementsByTagName("ExportProperty"));
  for (const el of props) {
    const propertyName = el.getAttribute("PropertyName") ?? el.getAttribute("Id") ?? "";
    if (!propertyName) continue;
    const rawType = el.getAttribute("Type") ?? "";
    const type: ExposedPropertyType = W3D_TYPE_TO_EXPOSED[rawType] ?? "unknown";
    const rawValue = el.getAttribute("Value") ?? el.getAttribute("DefaultValue") ?? "";
    const defaultValue = coerceExposedDefault(type, rawValue);
    const exposed: ExposedProperty = {
      id: propertyName,
      label: el.getAttribute("Name") ?? propertyName,
      type,
      defaultValue,
    };
    const controllableId = el.getAttribute("ControllableId");
    if (controllableId) exposed.controllableId = controllableId.toLowerCase();
    const updateMode = el.getAttribute("UpdateMode");
    if (updateMode) exposed.updateMode = updateMode;
    // Preserve every attribute for forward-compat / round-trip — even ones
    // we don't currently understand stay in raw[].
    const raw: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i += 1) {
      const attr = el.attributes[i];
      raw[attr.name] = attr.value;
    }
    exposed.raw = raw;
    out.push(exposed);
  }
  return out;
}

function coerceExposedDefault(type: ExposedPropertyType, raw: string): string | number | boolean | null {
  if (raw === "" || raw === undefined) return null;
  switch (type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean":
      return raw === "True" || raw === "true" || raw === "1";
    case "color": {
      // R3 ColorInt is a signed 32-bit ARGB; normalise to "#RRGGBB".
      const n = Number(raw);
      if (Number.isFinite(n)) {
        const u32 = n >>> 0;
        const r = (u32 >>> 16) & 0xff;
        const g = (u32 >>> 8) & 0xff;
        const b = u32 & 0xff;
        return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      }
      return raw;
    }
    default:
      return raw;
  }
}

// ---------------------------------------------------------------------------
// Skipped-primitive aggregation
// ---------------------------------------------------------------------------

function aggregateSkip(ctx: ParseContext, tag: string, sample: string, detail: string): void {
  const key = `${tag}|${detail}`;
  const entry = ctx.skipped.get(key);
  if (entry) {
    entry.count += 1;
  } else {
    ctx.skipped.set(key, { count: 1, sample });
  }
}

function flushSkipWarnings(ctx: ParseContext): void {
  for (const [key, entry] of ctx.skipped) {
    const [tag, detail] = key.split("|");
    if (entry.count === 1 && entry.sample) {
      ctx.warnings.push(`Skipped <${tag}> "${entry.sample}" — ${detail}.`);
    } else {
      ctx.warnings.push(`Skipped ${entry.count} <${tag}> primitive${entry.count === 1 ? "" : "s"} — ${detail}.`);
    }
  }
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
