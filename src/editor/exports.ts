import { frameToSeconds, getTrackSegments, isTrackMuted, mapAnimationEaseToGsap, sortTrackKeyframes } from "./animation";
import { getAvailableFonts, getFontData } from "./fonts";
import type { ComponentBlueprint, EditableBinding, EditorNode, EditorNodeType, FontAsset, ImageAsset, ImageNode, ModelAsset, SceneSettings, TransformSpec } from "./types";
import { ROOT_NODE_ID, createDefaultSceneSettings, getPropertyDefinitions, getPropertyValue, toCamelCase, toPascalCase } from "./state";

interface CollectedBinding {
  node: ExportNode;
  binding: EditableBinding;
}

interface CollectedFont {
  font: FontAsset;
  dataVariableName: string;
  fontVariableName: string;
}

interface CollectedImage {
  key: string;
  image: ImageAsset;
  dataVariableName: string;
  textureVariableName: string;
}

interface CollectedModel {
  key: string;
  model: ModelAsset;
  dataVariableName: string;
  gltfVariableName: string;
}

type TimelineTargetKey = "position" | "rotation" | "scale" | "visible";
type TimelineAxisKey = "x" | "y" | "z" | "value";

interface CollectedAnimationSegment {
  atSeconds: number;
  durationSeconds: number;
  value: number;
  ease: string;
}

interface CollectedAnimationTrack {
  nodeId: string;
  target: TimelineTargetKey;
  key: TimelineAxisKey;
  initialValue: number;
  firstKeyframeAtSeconds: number;
  segments: CollectedAnimationSegment[];
}

interface CollectedAnimationClip {
  name: string;
  fps: number;
  durationFrames: number;
  tracks: CollectedAnimationTrack[];
}

interface ExportModelNode {
  id: string;
  name: string;
  type: "model";
  parentId: string | null;
  visible: boolean;
  transform: TransformSpec;
  editable: Record<string, EditableBinding>;
  modelId?: string;
  model?: ModelAsset;
}

type ExportNode = EditorNode | ExportModelNode;
type MaterialEditorNode = Exclude<EditorNode, { type: "group" }>;

interface ExportCollections {
  bindings: CollectedBinding[];
  fonts: CollectedFont[];
  images: CollectedImage[];
  models: CollectedModel[];
}

function isModelNode(node: ExportNode): node is ExportModelNode {
  return node.type === "model";
}

function isMaterialNode(node: ExportNode): node is MaterialEditorNode {
  return node.type !== "group" && node.type !== "model";
}

export interface GenerateTypeScriptComponentOptions {
  fontAssetPathsById?: Record<string, string>;
  imageAssetPathsByNodeId?: Record<string, string>;
  modelAssetPathsById?: Record<string, string>;
  hdrAssetPathsById?: Record<string, string>;
}

export function exportBlueprintToJson(blueprint: ComponentBlueprint): string {
  return JSON.stringify(blueprint, null, 2);
}

export function generateTypeScriptComponent(
  blueprint: ComponentBlueprint,
  options: GenerateTypeScriptComponentOptions = {},
): string {
  const componentName = blueprint.componentName.trim() || "3ForgeComponent";
  const componentTypeName = toPascalCase(componentName);
  const optionTypeName = `${componentTypeName}Options`;
  const resolvedTypeName = `${componentTypeName}ResolvedOptions`;
  const nodes = blueprint.nodes as ExportNode[];
  const animationClips = collectAnimationClips(blueprint, blueprint.nodes);
  const hasAnimations = animationClips.length > 0;
  const usesNodeOriginHelper = nodes.some((node) => node.type !== "group");
  const rootNode = nodes.find((node) => node.id === ROOT_NODE_ID && node.type === "group");
  const childrenByParent = buildChildrenMap(nodes);
  const variableNames = createVariableNames(nodes);
  const groupContentVariableNames = createGroupContentVariableNames(nodes, variableNames);
  const { bindings, fonts, images, models } = collectExportCollections(blueprint, nodes);
  const materialNodes = nodes.filter(isMaterialNode);
  const usesDepthPackingHelper = materialNodes.some((node) =>
    node.material.type === "depth" || Boolean(node.editable["material.type"]) || Boolean(node.editable["material.depthPacking"]),
  );
  const importNames = collectImports(nodes, bindings);
  const fontVariables = new Map(fonts.map((font) => [font.font.id, font.fontVariableName]));
  const imageVariables = new Map(images.map((image) => [image.key, image.textureVariableName]));
  const modelVariables = new Map<string, { variableName: string; format: ModelAsset["format"] }>(
    models.map((model) => [model.key, { variableName: model.gltfVariableName, format: model.model.format }] as const),
  );
  const fontAssetPathsById = options.fontAssetPathsById ?? {};
  const imageAssetPathsByNodeId = options.imageAssetPathsByNodeId ?? {};
  const modelAssetPathsById = options.modelAssetPathsById ?? {};
  const hdrAssetPathsById = options.hdrAssetPathsById ?? {};
  const imagesById = new Map((blueprint.images ?? []).map((image) => [image.id, image] as const));
  const inlineFonts = fonts.filter((font) => !fontAssetPathsById[font.font.id]);
  const externalFonts = fonts.filter((font) => Boolean(fontAssetPathsById[font.font.id]));
  const lines: string[] = [];

  lines.push(`import { ${Array.from(importNames).sort().join(", ")} } from "three";`);
  if (hasAnimations) {
    lines.push(`import gsap from "gsap";`);
  }
  if (fonts.length > 0) {
    lines.push(`import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";`);
    lines.push(`import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";`);
  }
  const hasGltfModels = models.some((model) => model.model.format !== "usdz");
  const hasUsdzModels = models.some((model) => model.model.format === "usdz");
  if (hasGltfModels) {
    lines.push(`import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";`);
  }
  if (hasUsdzModels) {
    lines.push(`import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";`);
  }
  lines.push("");

  if (usesNodeOriginHelper) {
    lines.push(`interface NodeOriginSpec {`);
    lines.push(`  x: "left" | "center" | "right";`);
    lines.push(`  y: "top" | "center" | "bottom";`);
    lines.push(`  z: "front" | "center" | "back";`);
    lines.push(`}`);
    lines.push("");
    lines.push(`function resolveOriginOffset(min: number, max: number, origin: NodeOriginSpec["x"] | NodeOriginSpec["y"] | NodeOriginSpec["z"]): number {`);
    lines.push(`  switch (origin) {`);
    lines.push(`    case "left":`);
    lines.push(`    case "bottom":`);
    lines.push(`    case "back":`);
    lines.push(`      return -min;`);
    lines.push(`    case "right":`);
    lines.push(`    case "top":`);
    lines.push(`    case "front":`);
    lines.push(`      return -max;`);
    lines.push(`    default:`);
    lines.push(`      return -((min + max) * 0.5);`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push("");
    lines.push(`function applyNodeOrigin(mesh: Mesh, geometry: BufferGeometry, origin: NodeOriginSpec): void {`);
    lines.push(`  geometry.computeBoundingBox();`);
    lines.push(`  if (!geometry.boundingBox) {`);
    lines.push(`    return;`);
    lines.push(`  }`);
    lines.push("");
    lines.push(`  mesh.position.set(`);
    lines.push(`    resolveOriginOffset(geometry.boundingBox.min.x, geometry.boundingBox.max.x, origin.x),`);
    lines.push(`    resolveOriginOffset(geometry.boundingBox.min.y, geometry.boundingBox.max.y, origin.y),`);
    lines.push(`    resolveOriginOffset(geometry.boundingBox.min.z, geometry.boundingBox.max.z, origin.z),`);
    lines.push(`  );`);
    lines.push(`}`);
    lines.push("");
  }

  if (materialNodes.length > 0) {
    lines.push(`function resolveMaterialSide(side: string): Side {`);
    lines.push(`  switch (side) {`);
    lines.push(`    case "back":`);
    lines.push(`      return BackSide;`);
    lines.push(`    case "double":`);
    lines.push(`      return DoubleSide;`);
    lines.push(`    default:`);
    lines.push(`      return FrontSide;`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push("");
  }

  if (usesDepthPackingHelper) {
    lines.push(`function resolveDepthPacking(depthPacking: string): typeof BasicDepthPacking | typeof RGBADepthPacking {`);
    lines.push(`  return depthPacking === "rgba" ? RGBADepthPacking : BasicDepthPacking;`);
    lines.push(`}`);
    lines.push("");
  }

  if (inlineFonts.length > 0) {
    for (const font of inlineFonts) {
      lines.push(`const ${font.dataVariableName} = ${getFontData(font.font)} as const;`);
    }
    lines.push("");
  }

  if (fonts.length > 0) {
    lines.push("const fontLoader = new FontLoader();");
    lines.push("");
  }

  if (images.length > 0) {
    for (const image of images) {
      const imageSource = image.key.startsWith("node:")
        ? imageAssetPathsByNodeId[image.key.slice("node:".length)] ?? image.image.src
        : image.image.src;
      lines.push(`const ${image.dataVariableName} = ${JSON.stringify(imageSource)} as const;`);
    }
    lines.push("");
    lines.push("const textureLoader = new TextureLoader();");
    lines.push("");
  }

  if (models.length > 0) {
    for (const model of models) {
      const modelSource = model.key.startsWith("asset:")
        ? modelAssetPathsById[model.key.slice("asset:".length)] ?? model.model.src
        : model.model.src;
      lines.push(`const ${model.dataVariableName} = ${JSON.stringify(modelSource)} as const;`);
    }
    lines.push("");
    if (hasGltfModels) {
      lines.push("const gltfLoader = new GLTFLoader();");
    }
    if (hasUsdzModels) {
      lines.push("const usdLoader = new USDLoader();");
    }
    lines.push("");
  }

  lines.push(`export interface ${optionTypeName} {`);
  if (bindings.length > 0) {
    for (const { binding } of bindings) {
      lines.push(`  ${binding.key}?: ${mapBindingType(binding.type)};`);
    }
  }
  lines.push("}");
  lines.push("");
  lines.push(`type ${resolvedTypeName} = Required<${optionTypeName}>;`);
  lines.push("");
  lines.push(`const defaults: ${resolvedTypeName} = {`);
  if (bindings.length > 0) {
    for (const { node, binding } of bindings) {
      const value = isModelNode(node) ? getModelPropertyValue(node, binding.path) : getPropertyValue(node, binding.path);
      lines.push(`  ${binding.key}: ${serializeLiteral(value, binding.type)},`);
    }
  }
  lines.push("};");
  lines.push("");
  lines.push("export const sceneSettings = ");
  lines.push(`${JSON.stringify(createExportSceneSettings(blueprint.sceneSettings, hdrAssetPathsById), null, 2)} as const;`);
  lines.push("");
  if (hasAnimations) {
    emitAnimationDefinitions(lines, animationClips);
  }
  lines.push(`export class ${componentTypeName} {`);
  lines.push("  public readonly group: Group;");
  lines.push(`  private readonly options: ${resolvedTypeName};`);
  if (hasAnimations) {
    lines.push("  private timeline: gsap.core.Timeline | null = null;");
    lines.push("  private currentClipName: string | null = null;");
    lines.push("  private readonly nodeRefs = new Map<string, Group | Mesh>();");
    lines.push("  private readonly timelineCache = new Map<string, gsap.core.Timeline>();");
    lines.push("  private pendingPlayback: Promise<AnimationPlaybackResult> | null = null;");
    lines.push("  private pendingPlaybackMeta: { clipName: string; direction: AnimationPlaybackDirection; timeline: gsap.core.Timeline } | null = null;");
    lines.push("  private resolvePendingPlayback: ((result: AnimationPlaybackResult) => void) | null = null;");
  }
  lines.push("");
  lines.push(`  constructor(options: ${optionTypeName} = {}) {`);
  lines.push(`    this.options = { ...defaults, ...options };`);
  lines.push("    this.group = new Group();");
  lines.push(`    this.group.name = ${JSON.stringify(componentName)};`);
  lines.push("  }");
  lines.push("");
  lines.push("  public async build(): Promise<void> {");
  lines.push("    this.disposeResources(false);");
  lines.push("");
  lines.push("    const root = this.group;");
  lines.push(`    root.name = ${JSON.stringify(componentName)};`);
  if (rootNode) {
    lines.push(`    root.visible = ${propertyExpression(rootNode, "visible", "this.options")};`);
  }
  if (rootNode?.type === "group") {
    lines.push("    const rootContent = new Group();");
    lines.push(`    rootContent.position.set(${rootNode.pivotOffset.x}, ${rootNode.pivotOffset.y}, ${rootNode.pivotOffset.z});`);
    lines.push("    root.add(rootContent);");
  }
  if (hasAnimations) {
    lines.push("    this.nodeRefs.clear();");
    lines.push(`    this.nodeRefs.set(${JSON.stringify(ROOT_NODE_ID)}, root);`);
  }

  if (images.length > 0) {
    lines.push("    const [");
    for (const image of images) {
      lines.push(`      ${image.textureVariableName},`);
    }
    lines.push("    ] = await Promise.all([");
    for (const image of images) {
      lines.push(`      textureLoader.loadAsync(${image.dataVariableName}),`);
    }
    lines.push("    ]);");
    for (const image of images) {
      lines.push(`    ${image.textureVariableName}.colorSpace = SRGBColorSpace;`);
      lines.push(`    ${image.textureVariableName}.needsUpdate = true;`);
    }
  }

  if (externalFonts.length > 0) {
    lines.push("    const [");
    for (const font of externalFonts) {
      lines.push(`      ${font.fontVariableName},`);
    }
    lines.push("    ] = await Promise.all([");
    for (const font of externalFonts) {
      lines.push(`      fontLoader.loadAsync(${JSON.stringify(fontAssetPathsById[font.font.id])}),`);
    }
    lines.push("    ]);");
  }

  if (models.length > 0) {
    lines.push("    const [");
    for (const model of models) {
      lines.push(`      ${model.gltfVariableName},`);
    }
    lines.push("    ] = await Promise.all([");
    for (const model of models) {
      const loaderName = model.model.format === "usdz" ? "usdLoader" : "gltfLoader";
      lines.push(`      ${loaderName}.loadAsync(${model.dataVariableName}),`);
    }
    lines.push("    ]);");
  }

  if (inlineFonts.length > 0) {
    for (const font of inlineFonts) {
      lines.push(`    const ${font.fontVariableName} = fontLoader.parse(${font.dataVariableName});`);
    }
  }

  if (rootNode) {
    lines.push(`    root.position.set(${propertyExpression(rootNode, "transform.position.x", "this.options")}, ${propertyExpression(rootNode, "transform.position.y", "this.options")}, ${propertyExpression(rootNode, "transform.position.z", "this.options")});`);
    lines.push(`    root.rotation.set(${propertyExpression(rootNode, "transform.rotation.x", "this.options")}, ${propertyExpression(rootNode, "transform.rotation.y", "this.options")}, ${propertyExpression(rootNode, "transform.rotation.z", "this.options")});`);
    lines.push(`    root.scale.set(${propertyExpression(rootNode, "transform.scale.x", "this.options")}, ${propertyExpression(rootNode, "transform.scale.y", "this.options")}, ${propertyExpression(rootNode, "transform.scale.z", "this.options")});`);
  }

  if (rootNode) {
    emitNode(rootNode, lines, childrenByParent, variableNames, groupContentVariableNames, fontVariables, imageVariables, modelVariables, "this.options", hasAnimations, true);
  } else {
    for (const node of childrenByParent.get(null) ?? []) {
      emitNode(node, lines, childrenByParent, variableNames, groupContentVariableNames, fontVariables, imageVariables, modelVariables, "this.options", hasAnimations);
    }
  }

  lines.push("  }");
  lines.push("");
  if (hasAnimations) {
    emitAnimationMethods(lines, animationClips);
  }
  lines.push("  public dispose(): void {");
  lines.push("    this.disposeResources(true);");
  lines.push("  }");
  lines.push("");
  lines.push("  private disposeResources(removeFromParent: boolean): void {");
  if (hasAnimations) {
    lines.push("    this.cancelPendingPlayback();");
    lines.push("    for (const timeline of this.timelineCache.values()) {");
    lines.push("      timeline.kill();");
    lines.push("    }");
    lines.push("    this.timelineCache.clear();");
    lines.push("    this.timeline = null;");
    lines.push("    this.currentClipName = null;");
  }
  lines.push("    this.group.traverse((object) => {");
  lines.push("      const mesh = object as Mesh;");
  lines.push("      if (!mesh.isMesh) {");
  lines.push("        return;");
  lines.push("      }");
  lines.push("");
  lines.push("      mesh.geometry?.dispose?.();");
  lines.push("");
  lines.push("      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];");
  lines.push("      for (const material of materials) {");
  lines.push("        if (!material) {");
  lines.push("          continue;");
  lines.push("        }");
  lines.push("");
  lines.push("        if (\"map\" in material && material.map) {");
  lines.push("          material.map.dispose();");
  lines.push("        }");
  lines.push("");
  lines.push("        material.dispose?.();");
  lines.push("      }");
  lines.push("    });");
  lines.push("");
  lines.push("    this.group.clear();");
  if (hasAnimations) {
    lines.push("    this.nodeRefs.clear();");
  }
  lines.push("    if (removeFromParent) {");
  lines.push("      this.group.parent?.remove(this.group);");
  lines.push("    }");
  lines.push("  }");
  lines.push("}");

  return lines.join("\n");
}

function createExportSceneSettings(
  sceneSettings: SceneSettings | undefined,
  hdrAssetPathsById: Record<string, string>,
): SceneSettings | (SceneSettings & { environment: SceneSettings["environment"] & { hdrAssetPath?: string } }) {
  const settings = structuredClone(sceneSettings ?? createDefaultSceneSettings());
  const hdrAssetId = settings.environment.hdrAssetId;
  const hdrAssetPath = hdrAssetId ? hdrAssetPathsById[hdrAssetId] : undefined;
  if (!hdrAssetPath) {
    return settings;
  }

  return {
    ...settings,
    environment: {
      ...settings.environment,
      hdrAssetPath,
    },
  };
}

function collectExportCollections(blueprint: ComponentBlueprint, nodes: ExportNode[]): ExportCollections {
  const bindings: CollectedBinding[] = [];
  const availableFonts = getAvailableFonts(blueprint.fonts);
  const fontsById = new Map(availableFonts.map((font) => [font.id, font]));
  const imagesById = new Map((blueprint.images ?? []).map((image) => [image.id, image] as const));
  const modelsById = new Map((blueprint.models ?? []).map((model) => [model.id, model] as const));
  const collectedFontIds = new Set<string>();
  const fontUsedNames = new Set<string>();
  const imageUsedNames = new Set<string>();
  const modelUsedNames = new Set<string>();
  const collectedImageKeys = new Set<string>();
  const collectedModelKeys = new Set<string>();
  const fonts: CollectedFont[] = [];
  const images: CollectedImage[] = [];
  const models: CollectedModel[] = [];

  const collectImage = (key: string, image: ImageAsset, baseName: string) => {
    if (collectedImageKeys.has(key)) {
      return;
    }
    const base = toCamelCase(baseName || image.name) || "image";
    let dataVariableName = `${base}ImageData`;
    let textureVariableName = `${base}Texture`;
    let suffix = 2;

    while (imageUsedNames.has(dataVariableName) || imageUsedNames.has(textureVariableName)) {
      dataVariableName = `${base}ImageData${suffix}`;
      textureVariableName = `${base}Texture${suffix}`;
      suffix += 1;
    }

    imageUsedNames.add(dataVariableName);
    imageUsedNames.add(textureVariableName);
    collectedImageKeys.add(key);
    images.push({ key, image, dataVariableName, textureVariableName });
  };

  const collectModel = (key: string, model: ModelAsset, baseName: string) => {
    if (collectedModelKeys.has(key)) {
      return;
    }
    const base = toCamelCase(baseName || model.name) || "model";
    let dataVariableName = `${base}ModelData`;
    let gltfVariableName = `${base}Gltf`;
    let suffix = 2;

    while (modelUsedNames.has(dataVariableName) || modelUsedNames.has(gltfVariableName)) {
      dataVariableName = `${base}ModelData${suffix}`;
      gltfVariableName = `${base}Gltf${suffix}`;
      suffix += 1;
    }

    modelUsedNames.add(dataVariableName);
    modelUsedNames.add(gltfVariableName);
    collectedModelKeys.add(key);
    models.push({ key, model, dataVariableName, gltfVariableName });
  };

  for (const node of nodes) {
    const validPaths = node.type === "model"
      ? new Set([
        "visible",
        "transform.position.x",
        "transform.position.y",
        "transform.position.z",
        "transform.rotation.x",
        "transform.rotation.y",
        "transform.rotation.z",
        "transform.scale.x",
        "transform.scale.y",
        "transform.scale.z",
      ])
      : new Set(getPropertyDefinitions(node).map((definition) => definition.path));
    const nodeBindings = Object.values(node.editable)
      .filter((binding) => validPaths.has(binding.path))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((binding) => ({ node, binding }));
    bindings.push(...nodeBindings);

    if (node.type === "text" && !collectedFontIds.has(node.fontId)) {
      const font = fontsById.get(node.fontId);
      if (!font) {
        throw new Error(`Font not found for text node "${node.name}".`);
      }

      const base = toCamelCase(font.name) || "font";
      let dataVariableName = `${base}FontData`;
      let fontVariableName = `${base}Font`;
      let suffix = 2;

      while (fontUsedNames.has(dataVariableName) || fontUsedNames.has(fontVariableName)) {
        dataVariableName = `${base}FontData${suffix}`;
        fontVariableName = `${base}Font${suffix}`;
        suffix += 1;
      }

      fontUsedNames.add(dataVariableName);
      fontUsedNames.add(fontVariableName);
      collectedFontIds.add(node.fontId);
      fonts.push({ font, dataVariableName, fontVariableName });
    }

    if (node.type === "image") {
      const image = resolveImageAssetForNode(node, imagesById);
      collectImage(`node:${node.id}`, image, node.name || image.name);
    }

    if (node.type === "model") {
      const model = resolveModelAssetForNode(node, modelsById);
      collectModel(node.modelId ? `asset:${node.modelId}` : `node:${node.id}`, model, node.name || model.name);
    }

    if (isMaterialNode(node) && node.material.mapImageId) {
      const image = imagesById.get(node.material.mapImageId);
      if (image) {
        collectImage(`material:${node.material.mapImageId}`, image, image.name);
      }
    }
  }

  return {
    bindings,
    fonts,
    images,
    models,
  };
}

function resolveImageAssetForNode(node: ImageNode, imagesById: Map<string | undefined, ImageAsset>): ImageAsset {
  if (node.imageId) {
    const asset = imagesById.get(node.imageId);
    if (asset) {
      return asset;
    }
  }

  return node.image;
}

function resolveModelAssetForNode(node: ExportModelNode, modelsById: Map<string | undefined, ModelAsset>): ModelAsset {
  if (node.modelId) {
    const asset = modelsById.get(node.modelId);
    if (asset) {
      return asset;
    }
  }

  if (node.model) {
    return node.model;
  }

  throw new Error(`Model asset not found for model node "${node.name}".`);
}

function collectImports(nodes: ExportNode[], bindings: CollectedBinding[]): Set<string> {
  const imports = new Set<string>(["Group", "Mesh"]);
  const types = new Set<EditorNodeType | "model">(nodes.map((node) => node.type));
  const hasRenderableNodes = nodes.some((node) => node.type !== "group");
  const materialNodes = nodes.filter(isMaterialNode);
  const hasRuntimeMaterialType = materialNodes.some((node) => Boolean(node.editable["material.type"]));
  const materialClassFor: Record<string, string> = {
    basic: "MeshBasicMaterial",
    lambert: "MeshLambertMaterial",
    phong: "MeshPhongMaterial",
    standard: "MeshStandardMaterial",
    physical: "MeshPhysicalMaterial",
    toon: "MeshToonMaterial",
    normal: "MeshNormalMaterial",
    depth: "MeshDepthMaterial",
  };
  const usedMaterialTypes = new Set<string>();
  if (hasRuntimeMaterialType) {
    Object.keys(materialClassFor).forEach((key) => usedMaterialTypes.add(key));
  } else {
    materialNodes.forEach((node) => usedMaterialTypes.add(node.material.type));
  }

  if (types.has("box")) imports.add("BoxGeometry");
  if (types.has("circle")) imports.add("CircleGeometry");
  if (types.has("sphere")) imports.add("SphereGeometry");
  if (types.has("cylinder")) imports.add("CylinderGeometry");
  if (types.has("cone")) imports.add("ConeGeometry");
  if (types.has("capsule")) imports.add("CapsuleGeometry");
  if (types.has("ring")) imports.add("RingGeometry");
  if (types.has("torus")) imports.add("TorusGeometry");
  if (types.has("torusKnot")) imports.add("TorusKnotGeometry");
  if (types.has("dodecahedron")) imports.add("DodecahedronGeometry");
  if (types.has("icosahedron")) imports.add("IcosahedronGeometry");
  if (types.has("octahedron")) imports.add("OctahedronGeometry");
  if (types.has("tetrahedron")) imports.add("TetrahedronGeometry");
  if (types.has("plane") || types.has("image")) imports.add("PlaneGeometry");
  for (const used of usedMaterialTypes) {
    const cls = materialClassFor[used];
    if (cls) {
      imports.add(cls);
    }
  }
  if (types.has("image") || materialNodes.some((node) => Boolean(node.material.mapImageId))) {
    imports.add("TextureLoader");
    imports.add("SRGBColorSpace");
  }
  if (hasRenderableNodes) {
    imports.add("BackSide");
    imports.add("DoubleSide");
    imports.add("FrontSide");
    imports.add("type Side");
  }
  if (
    hasRuntimeMaterialType ||
    materialNodes.some((node) => node.material.type === "depth" || Boolean(node.editable["material.depthPacking"]))
  ) {
    imports.add("BasicDepthPacking");
    imports.add("RGBADepthPacking");
  }
  if (bindings.some(({ binding }) => binding.type === "color")) {
    imports.add("type ColorRepresentation");
  }
  if (hasRenderableNodes) {
    imports.add("type BufferGeometry");
  }

  return imports;
}

function buildChildrenMap(nodes: ExportNode[]): Map<string | null, ExportNode[]> {
  const map = new Map<string | null, ExportNode[]>();

  for (const node of nodes) {
    const bucket = map.get(node.parentId) ?? [];
    bucket.push(node);
    map.set(node.parentId, bucket);
  }

  return map;
}

function createVariableNames(nodes: ExportNode[]): Map<string, string> {
  const variables = new Map<string, string>();
  const used = new Set<string>(["root"]);

  for (const node of nodes) {
    if (node.id === ROOT_NODE_ID) {
      variables.set(node.id, "root");
      continue;
    }

    const base = toCamelCase(node.name) || node.type;
    let candidate = base;
    let suffix = 2;

    while (used.has(candidate)) {
      candidate = `${base}${suffix}`;
      suffix += 1;
    }

    used.add(candidate);
    variables.set(node.id, candidate);
  }

  return variables;
}

function emitNode(
  node: ExportNode | undefined,
  lines: string[],
  childrenByParent: Map<string | null, ExportNode[]>,
  variableNames: Map<string, string>,
  groupContentVariableNames: Map<string, string>,
  fontVariables: Map<string, string>,
  imageVariables: Map<string, string>,
  modelVariables: Map<string, { variableName: string; format: ModelAsset["format"] }>,
  bindingAccessor: string,
  captureNodeRefs: boolean,
  skipCreation = false,
): void {
  if (!node) return;

  const variableName = variableNames.get(node.id) ?? toCamelCase(node.name);
  if (!skipCreation) {
    for (const line of emitCreationLines(node, variableName, fontVariables, imageVariables, modelVariables, bindingAccessor)) {
      lines.push(`    ${line}`);
    }
  }

  if (node.id !== ROOT_NODE_ID) {
    const parentVariable = node.parentId
      ? groupContentVariableNames.get(node.parentId) ?? variableNames.get(node.parentId) ?? "root"
      : "root";
    lines.push(`    ${parentVariable}.add(${variableName});`);
  }

  if (captureNodeRefs) {
    lines.push(`    this.nodeRefs.set(${JSON.stringify(node.id)}, ${variableName});`);
  }

  for (const child of childrenByParent.get(node.id) ?? []) {
    emitNode(child, lines, childrenByParent, variableNames, groupContentVariableNames, fontVariables, imageVariables, modelVariables, bindingAccessor, captureNodeRefs);
  }
}

function emitCreationLines(
  node: ExportNode,
  variableName: string,
  fontVariables: Map<string, string>,
  imageVariables: Map<string, string>,
  modelVariables: Map<string, { variableName: string; format: ModelAsset["format"] }>,
  bindingAccessor: string,
): string[] {
  const lines: string[] = [];

  if (node.type === "group") {
    lines.push(`const ${variableName} = new Group();`);
    lines.push(`const ${variableName}Content = new Group();`);
    lines.push(`${variableName}Content.position.set(${node.pivotOffset.x}, ${node.pivotOffset.y}, ${node.pivotOffset.z});`);
    lines.push(`${variableName}.add(${variableName}Content);`);
  } else if (node.type === "model") {
    const modelVariable = modelVariables.get(node.modelId ? `asset:${node.modelId}` : `node:${node.id}`);
    if (!modelVariable) {
      throw new Error(`Model asset not found for model node "${node.name}".`);
    }
    if (modelVariable.format === "usdz") {
      lines.push(`const ${variableName} = ${modelVariable.variableName}.clone(true) as Group;`);
    } else {
      lines.push(`const ${variableName} = ${modelVariable.variableName}.scene.clone(true) as Group;`);
    }
  } else {
    const geometryVariable = `${variableName}Geometry`;
    const materialVariable = `${variableName}Material`;
    const meshVariable = `${variableName}Mesh`;

    switch (node.type) {
      case "box":
        lines.push(
          `const ${geometryVariable} = new BoxGeometry(${propertyExpression(node, "geometry.width", bindingAccessor)}, ${propertyExpression(node, "geometry.height", bindingAccessor)}, ${propertyExpression(node, "geometry.depth", bindingAccessor)});`,
        );
        break;
      case "circle":
        lines.push(
          `const ${geometryVariable} = new CircleGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, ${propertyExpression(node, "geometry.segments", bindingAccessor)}, ${propertyExpression(node, "geometry.thetaStarts", bindingAccessor)}, ${propertyExpression(node, "geometry.thetaLenght", bindingAccessor)});`,
        );
        break;
      case "sphere":
        lines.push(
          `const ${geometryVariable} = new SphereGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, Math.max(3, Math.round(${propertyExpression(node, "geometry.widthSegments", bindingAccessor)})), Math.max(2, Math.round(${propertyExpression(node, "geometry.heightSegments", bindingAccessor)})), ${propertyExpression(node, "geometry.phiStart", bindingAccessor)}, ${propertyExpression(node, "geometry.phiLength", bindingAccessor)}, ${propertyExpression(node, "geometry.thetaStart", bindingAccessor)}, ${propertyExpression(node, "geometry.thetaLength", bindingAccessor)});`,
        );
        break;
      case "cylinder":
        lines.push(
          `const ${geometryVariable} = new CylinderGeometry(${propertyExpression(node, "geometry.radiusTop", bindingAccessor)}, ${propertyExpression(node, "geometry.radiusBottom", bindingAccessor)}, ${propertyExpression(node, "geometry.height", bindingAccessor)}, Math.max(3, Math.round(${propertyExpression(node, "geometry.radialSegments", bindingAccessor)})), Math.max(1, Math.round(${propertyExpression(node, "geometry.heightSegments", bindingAccessor)})), false, ${propertyExpression(node, "geometry.thetaStart", bindingAccessor)}, ${propertyExpression(node, "geometry.thetaLength", bindingAccessor)});`,
        );
        break;
      case "cone":
        lines.push(
          `const ${geometryVariable} = new ConeGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, ${propertyExpression(node, "geometry.height", bindingAccessor)}, Math.max(3, Math.round(${propertyExpression(node, "geometry.radialSegments", bindingAccessor)})), Math.max(1, Math.round(${propertyExpression(node, "geometry.heightSegments", bindingAccessor)})), false, ${propertyExpression(node, "geometry.thetaStart", bindingAccessor)}, ${propertyExpression(node, "geometry.thetaLength", bindingAccessor)});`,
        );
        break;
      case "capsule":
        lines.push(
          `const ${geometryVariable} = new CapsuleGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, ${propertyExpression(node, "geometry.length", bindingAccessor)}, Math.max(1, Math.round(${propertyExpression(node, "geometry.capSegments", bindingAccessor)})), Math.max(3, Math.round(${propertyExpression(node, "geometry.radialSegments", bindingAccessor)})));`,
        );
        break;
      case "ring":
        lines.push(
          `const ${geometryVariable} = new RingGeometry(${propertyExpression(node, "geometry.innerRadius", bindingAccessor)}, ${propertyExpression(node, "geometry.outerRadius", bindingAccessor)}, Math.max(3, Math.round(${propertyExpression(node, "geometry.thetaSegments", bindingAccessor)})), Math.max(1, Math.round(${propertyExpression(node, "geometry.phiSegments", bindingAccessor)})), ${propertyExpression(node, "geometry.thetaStart", bindingAccessor)}, ${propertyExpression(node, "geometry.thetaLength", bindingAccessor)});`,
        );
        break;
      case "torus":
        lines.push(
          `const ${geometryVariable} = new TorusGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, ${propertyExpression(node, "geometry.tube", bindingAccessor)}, Math.max(3, Math.round(${propertyExpression(node, "geometry.radialSegments", bindingAccessor)})), Math.max(3, Math.round(${propertyExpression(node, "geometry.tubularSegments", bindingAccessor)})), ${propertyExpression(node, "geometry.arc", bindingAccessor)});`,
        );
        break;
      case "torusKnot":
        lines.push(
          `const ${geometryVariable} = new TorusKnotGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, ${propertyExpression(node, "geometry.tube", bindingAccessor)}, Math.max(3, Math.round(${propertyExpression(node, "geometry.tubularSegments", bindingAccessor)})), Math.max(3, Math.round(${propertyExpression(node, "geometry.radialSegments", bindingAccessor)})), Math.max(1, Math.round(${propertyExpression(node, "geometry.p", bindingAccessor)})), Math.max(1, Math.round(${propertyExpression(node, "geometry.q", bindingAccessor)})));`,
        );
        break;
      case "dodecahedron":
        lines.push(`const ${geometryVariable} = new DodecahedronGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, Math.max(0, Math.round(${propertyExpression(node, "geometry.detail", bindingAccessor)})));`);
        break;
      case "icosahedron":
        lines.push(`const ${geometryVariable} = new IcosahedronGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, Math.max(0, Math.round(${propertyExpression(node, "geometry.detail", bindingAccessor)})));`);
        break;
      case "octahedron":
        lines.push(`const ${geometryVariable} = new OctahedronGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, Math.max(0, Math.round(${propertyExpression(node, "geometry.detail", bindingAccessor)})));`);
        break;
      case "tetrahedron":
        lines.push(`const ${geometryVariable} = new TetrahedronGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, Math.max(0, Math.round(${propertyExpression(node, "geometry.detail", bindingAccessor)})));`);
        break;
      case "plane":
        lines.push(
          `const ${geometryVariable} = new PlaneGeometry(${propertyExpression(node, "geometry.width", bindingAccessor)}, ${propertyExpression(node, "geometry.height", bindingAccessor)});`,
        );
        break;
      case "image":
        lines.push(
          `const ${geometryVariable} = new PlaneGeometry(${propertyExpression(node, "geometry.width", bindingAccessor)}, ${propertyExpression(node, "geometry.height", bindingAccessor)});`,
        );
        break;
      case "text": {
        const fontVariableName = fontVariables.get(node.fontId);
        if (!fontVariableName) {
          throw new Error(`Font not found for text node "${node.name}".`);
        }
        lines.push(
          `const ${geometryVariable} = new TextGeometry(${propertyExpression(node, "geometry.text", bindingAccessor)}, { font: ${fontVariableName}, size: ${propertyExpression(node, "geometry.size", bindingAccessor)}, depth: ${propertyExpression(node, "geometry.depth", bindingAccessor)}, curveSegments: ${propertyExpression(node, "geometry.curveSegments", bindingAccessor)}, bevelEnabled: ${propertyExpression(node, "geometry.bevelEnabled", bindingAccessor)}, bevelThickness: ${propertyExpression(node, "geometry.bevelThickness", bindingAccessor)}, bevelSize: ${propertyExpression(node, "geometry.bevelSize", bindingAccessor)} });`,
        );
        break;
      }
    }

    const materialNode = node;
    const nodeTextureVariable = imageVariables.get(`node:${node.id}`);
    const materialTextureVariable = node.material.mapImageId ? imageVariables.get(`material:${node.material.mapImageId}`) : undefined;
    for (const line of emitMaterialCreationLines(materialNode, materialVariable, bindingAccessor, materialTextureVariable ?? nodeTextureVariable, Boolean(materialTextureVariable))) {
      lines.push(line);
    }
    lines.push(`const ${meshVariable} = new Mesh(${geometryVariable}, ${materialVariable});`);
    lines.push(`${meshVariable}.castShadow = ${propertyExpression(node, "material.castShadow", bindingAccessor)};`);
    lines.push(`${meshVariable}.receiveShadow = ${propertyExpression(node, "material.receiveShadow", bindingAccessor)};`);
    lines.push(`${meshVariable}.visible = ${propertyExpression(node, "material.visible", bindingAccessor)};`);
    lines.push(`applyNodeOrigin(${meshVariable}, ${geometryVariable}, ${JSON.stringify(node.origin)});`);
    lines.push(`const ${variableName} = new Group();`);
    lines.push(`${variableName}.add(${meshVariable});`);
  }

  lines.push(`${variableName}.name = ${JSON.stringify(node.name)};`);
  lines.push(`${variableName}.visible = ${serializeLiteral(node.visible, "boolean")};`);
  lines.push(`${variableName}.position.set(${propertyExpression(node, "transform.position.x", bindingAccessor)}, ${propertyExpression(node, "transform.position.y", bindingAccessor)}, ${propertyExpression(node, "transform.position.z", bindingAccessor)});`);
  lines.push(`${variableName}.rotation.set(${propertyExpression(node, "transform.rotation.x", bindingAccessor)}, ${propertyExpression(node, "transform.rotation.y", bindingAccessor)}, ${propertyExpression(node, "transform.rotation.z", bindingAccessor)});`);
  lines.push(`${variableName}.scale.set(${propertyExpression(node, "transform.scale.x", bindingAccessor)}, ${propertyExpression(node, "transform.scale.y", bindingAccessor)}, ${propertyExpression(node, "transform.scale.z", bindingAccessor)});`);

  return lines;
}

function createGroupContentVariableNames(nodes: ExportNode[], variableNames: Map<string, string>): Map<string, string> {
  const names = new Map<string, string>();
  names.set(ROOT_NODE_ID, "rootContent");

  for (const node of nodes) {
    if (node.type !== "group" || node.id === ROOT_NODE_ID) {
      continue;
    }

    names.set(node.id, `${variableNames.get(node.id) ?? toCamelCase(node.name)}Content`);
  }

  return names;
}

function emitMaterialCreationLines(
  node: MaterialEditorNode,
  materialVariable: string,
  bindingAccessor: string,
  textureVariable?: string,
  hasMaterialTexture = false,
): string[] {
  const lines: string[] = [];
  const hasDynamicMaterialType = Boolean(node.editable["material.type"]);
  const materialTypeExpression = propertyExpression(node, "material.type", bindingAccessor);
  const sharedOptions = [
    `color: ${propertyExpression(node, "material.color", bindingAccessor)}`,
    `side: resolveMaterialSide(${propertyExpression(node, "material.side", bindingAccessor)})`,
    `opacity: ${propertyExpression(node, "material.opacity", bindingAccessor)}`,
    `transparent: ${propertyExpression(node, "material.transparent", bindingAccessor)}`,
    `alphaTest: ${propertyExpression(node, "material.alphaTest", bindingAccessor)}`,
    `depthTest: ${propertyExpression(node, "material.depthTest", bindingAccessor)}`,
    `depthWrite: ${propertyExpression(node, "material.depthWrite", bindingAccessor)}`,
    `colorWrite: ${propertyExpression(node, "material.colorWrite", bindingAccessor)}`,
    `dithering: ${propertyExpression(node, "material.dithering", bindingAccessor)}`,
    `toneMapped: ${propertyExpression(node, "material.toneMapped", bindingAccessor)}`,
    `premultipliedAlpha: ${propertyExpression(node, "material.premultipliedAlpha", bindingAccessor)}`,
    `polygonOffset: ${propertyExpression(node, "material.polygonOffset", bindingAccessor)}`,
    `polygonOffsetFactor: ${propertyExpression(node, "material.polygonOffsetFactor", bindingAccessor)}`,
    `polygonOffsetUnits: ${propertyExpression(node, "material.polygonOffsetUnits", bindingAccessor)}`,
    `wireframe: ${propertyExpression(node, "material.wireframe", bindingAccessor)}`,
    `wireframeLinewidth: ${propertyExpression(node, "material.wireframeLinewidth", bindingAccessor)}`,
  ];

  if (textureVariable && (node.type === "image" || hasMaterialTexture)) {
    sharedOptions.push(`map: ${textureVariable}`);
  } else if (node.type === "image") {
    if (!textureVariable) {
      throw new Error(`Image texture not found for image node "${node.name}".`);
    }
  }

  const emissiveOption = `emissive: ${propertyExpression(node, "material.emissive", bindingAccessor)}`;
  const emissiveIntensityOption = `emissiveIntensity: ${propertyExpression(node, "material.emissiveIntensity", bindingAccessor)}`;
  const fogOption = `fog: ${propertyExpression(node, "material.fog", bindingAccessor)}`;
  const flatShadingOption = `flatShading: ${propertyExpression(node, "material.flatShading", bindingAccessor)}`;
  const standardOnlyOptions = [
    emissiveOption,
    emissiveIntensityOption,
    `roughness: ${propertyExpression(node, "material.roughness", bindingAccessor)}`,
    `metalness: ${propertyExpression(node, "material.metalness", bindingAccessor)}`,
    `envMapIntensity: ${propertyExpression(node, "material.envMapIntensity", bindingAccessor)}`,
    flatShadingOption,
    fogOption,
  ];
  const physicalOnlyOptions = [
    `ior: ${propertyExpression(node, "material.ior", bindingAccessor)}`,
    `transmission: ${propertyExpression(node, "material.transmission", bindingAccessor)}`,
    `thickness: ${propertyExpression(node, "material.thickness", bindingAccessor)}`,
    `clearcoat: ${propertyExpression(node, "material.clearcoat", bindingAccessor)}`,
    `clearcoatRoughness: ${propertyExpression(node, "material.clearcoatRoughness", bindingAccessor)}`,
    `reflectivity: ${propertyExpression(node, "material.reflectivity", bindingAccessor)}`,
    `iridescence: ${propertyExpression(node, "material.iridescence", bindingAccessor)}`,
    `iridescenceIOR: ${propertyExpression(node, "material.iridescenceIOR", bindingAccessor)}`,
    `iridescenceThicknessRange: [${propertyExpression(node, "material.iridescenceThicknessRangeStart", bindingAccessor)}, ${propertyExpression(node, "material.iridescenceThicknessRangeEnd", bindingAccessor)}]`,
    `sheen: ${propertyExpression(node, "material.sheen", bindingAccessor)}`,
    `sheenRoughness: ${propertyExpression(node, "material.sheenRoughness", bindingAccessor)}`,
    `sheenColor: ${propertyExpression(node, "material.sheenColor", bindingAccessor)}`,
    `specularIntensity: ${propertyExpression(node, "material.specularIntensity", bindingAccessor)}`,
    `specularColor: ${propertyExpression(node, "material.specularColor", bindingAccessor)}`,
    `attenuationDistance: ${propertyExpression(node, "material.attenuationDistance", bindingAccessor)}`,
    `attenuationColor: ${propertyExpression(node, "material.attenuationColor", bindingAccessor)}`,
    `dispersion: ${propertyExpression(node, "material.dispersion", bindingAccessor)}`,
    `anisotropy: ${propertyExpression(node, "material.anisotropy", bindingAccessor)}`,
  ];
  const phongOnlyOptions = [
    emissiveOption,
    emissiveIntensityOption,
    `specular: ${propertyExpression(node, "material.specular", bindingAccessor)}`,
    `shininess: ${propertyExpression(node, "material.shininess", bindingAccessor)}`,
    flatShadingOption,
    fogOption,
  ];
  const basicOnlyOptions = [
    fogOption,
  ];
  const toonOnlyOptions = [
    emissiveOption,
    emissiveIntensityOption,
    fogOption,
  ];
  const lambertOnlyOptions = [
    emissiveOption,
    emissiveIntensityOption,
    flatShadingOption,
    fogOption,
  ];
  const normalOnlyOptions = [
    flatShadingOption,
  ];
  const depthOnlyOptions = [
    `depthPacking: resolveDepthPacking(${propertyExpression(node, "material.depthPacking", bindingAccessor)})`,
  ];

  if (hasDynamicMaterialType) {
    const basicConfig = `${materialVariable}BasicConfig`;
    const standardConfig = `${materialVariable}StandardConfig`;
    const physicalConfig = `${materialVariable}PhysicalConfig`;
    const toonConfig = `${materialVariable}ToonConfig`;
    const lambertConfig = `${materialVariable}LambertConfig`;
    const phongConfig = `${materialVariable}PhongConfig`;
    const normalConfig = `${materialVariable}NormalConfig`;
    const depthConfig = `${materialVariable}DepthConfig`;
    lines.push(`const ${basicConfig} = { ${[...sharedOptions, ...basicOnlyOptions].join(", ")} };`);
    lines.push(`const ${standardConfig} = { ...${basicConfig}, ${standardOnlyOptions.join(", ")} };`);
    lines.push(`const ${physicalConfig} = { ...${standardConfig}, ${physicalOnlyOptions.join(", ")} };`);
    lines.push(`const ${toonConfig} = { ...${basicConfig}, ${toonOnlyOptions.join(", ")} };`);
    lines.push(`const ${lambertConfig} = { ...${basicConfig}, ${lambertOnlyOptions.join(", ")} };`);
    lines.push(`const ${phongConfig} = { ...${basicConfig}, ${phongOnlyOptions.join(", ")} };`);
    lines.push(`const ${normalConfig} = { ${[...sharedOptions, ...normalOnlyOptions].join(", ")} };`);
    lines.push(`const ${depthConfig} = { ${[...sharedOptions, ...depthOnlyOptions].join(", ")} };`);
    lines.push(
      `const ${materialVariable} = ${materialTypeExpression} === "basic" ? new MeshBasicMaterial(${basicConfig})`
      + ` : ${materialTypeExpression} === "lambert" ? new MeshLambertMaterial(${lambertConfig})`
      + ` : ${materialTypeExpression} === "phong" ? new MeshPhongMaterial(${phongConfig})`
      + ` : ${materialTypeExpression} === "physical" ? new MeshPhysicalMaterial(${physicalConfig})`
      + ` : ${materialTypeExpression} === "toon" ? new MeshToonMaterial(${toonConfig})`
      + ` : ${materialTypeExpression} === "normal" ? new MeshNormalMaterial(${normalConfig})`
      + ` : ${materialTypeExpression} === "depth" ? new MeshDepthMaterial(${depthConfig})`
      + ` : new MeshStandardMaterial(${standardConfig});`,
    );
    return lines;
  }

  switch (node.material.type) {
    case "basic":
      lines.push(`const ${materialVariable} = new MeshBasicMaterial({ ${[...sharedOptions, ...basicOnlyOptions].join(", ")} });`);
      return lines;
    case "lambert":
      lines.push(`const ${materialVariable} = new MeshLambertMaterial({ ${[...sharedOptions, ...lambertOnlyOptions].join(", ")} });`);
      return lines;
    case "phong":
      lines.push(`const ${materialVariable} = new MeshPhongMaterial({ ${[...sharedOptions, ...phongOnlyOptions].join(", ")} });`);
      return lines;
    case "toon":
      lines.push(`const ${materialVariable} = new MeshToonMaterial({ ${[...sharedOptions, ...toonOnlyOptions].join(", ")} });`);
      return lines;
    case "physical":
      lines.push(`const ${materialVariable} = new MeshPhysicalMaterial({ ${[...sharedOptions, ...standardOnlyOptions, ...physicalOnlyOptions].join(", ")} });`);
      return lines;
    case "normal":
      lines.push(`const ${materialVariable} = new MeshNormalMaterial({ ${[...sharedOptions, ...normalOnlyOptions].join(", ")} });`);
      return lines;
    case "depth":
      lines.push(`const ${materialVariable} = new MeshDepthMaterial({ ${[...sharedOptions, ...depthOnlyOptions].join(", ")} });`);
      return lines;
    default:
      lines.push(`const ${materialVariable} = new MeshStandardMaterial({ ${[...sharedOptions, ...standardOnlyOptions].join(", ")} });`);
      return lines;
  }
}

function collectAnimationClips(blueprint: ComponentBlueprint, nodes: EditorNode[]): CollectedAnimationClip[] {
  const validNodeIds = new Set(nodes.map((node) => node.id));

  return blueprint.animation.clips.flatMap((clip) => {
    const tracks = clip.tracks.flatMap((track) => {
      if (!validNodeIds.has(track.nodeId) || track.keyframes.length === 0) {
        return [];
      }
      if (isTrackMuted(track)) {
        return [];
      }

      const orderedKeyframes = sortTrackKeyframes(track.keyframes);
      if (orderedKeyframes.length === 0) {
        return [];
      }

      const target = toTimelineTargetKey(track.property);
      const key = toTimelineAxisKey(track.property);
      const initialKeyframe = orderedKeyframes[0];

      return [{
        nodeId: track.nodeId,
        target,
        key,
        initialValue: initialKeyframe.value,
        firstKeyframeAtSeconds: frameToSeconds(initialKeyframe.frame, clip.fps),
        segments: getTrackSegments(track).map((segment) => ({
          atSeconds: frameToSeconds(segment.from.frame, clip.fps),
          durationSeconds: frameToSeconds(segment.to.frame - segment.from.frame, clip.fps),
          value: segment.to.value,
          ease: mapAnimationEaseToGsap(segment.to.ease),
        })),
      }] satisfies CollectedAnimationTrack[];
    });

    if (tracks.length === 0) {
      return [];
    }

    return [{
      name: clip.name,
      fps: clip.fps,
      durationFrames: clip.durationFrames,
      tracks,
    }] satisfies CollectedAnimationClip[];
  });
}

function emitAnimationDefinitions(lines: string[], clips: CollectedAnimationClip[]): void {
  lines.push("function resolveAnimatedVisibility(value: number): boolean {");
  lines.push("  return value >= 0.5;");
  lines.push("}");
  lines.push("");
  lines.push("function getAnimatedVisibilityMesh(node: Group | Mesh): Mesh | null {");
  lines.push("  if (!(node instanceof Group)) {");
  lines.push("    return null;");
  lines.push("  }");
  lines.push("  return node.children.find((child): child is Mesh => child instanceof Mesh) ?? null;");
  lines.push("}");
  lines.push("");
  lines.push("interface AnimationSegmentDefinition {");
  lines.push("  at: number;");
  lines.push("  duration: number;");
  lines.push("  value: number;");
  lines.push("  ease: string;");
  lines.push("}");
  lines.push("");
  lines.push("interface AnimationTrackDefinition {");
  lines.push("  target: \"position\" | \"rotation\" | \"scale\" | \"visible\";");
  lines.push("  key: \"x\" | \"y\" | \"z\" | \"value\";");
  lines.push("  nodeId: string;");
  lines.push("  initialValue: number;");
  lines.push("  firstKeyframeAt: number;");
  lines.push("  segments: AnimationSegmentDefinition[];");
  lines.push("}");
  lines.push("");
  lines.push("interface AnimationClipDefinition {");
  lines.push("  name: string;");
  lines.push("  fps: number;");
  lines.push("  durationFrames: number;");
  lines.push("  tracks: AnimationTrackDefinition[];");
  lines.push("}");
  lines.push("");
  lines.push("type AnimationPlaybackDirection = \"forward\" | \"reverse\";");
  lines.push("");
  lines.push("interface AnimationPlaybackResult {");
  lines.push("  clipName: string;");
  lines.push("  direction: AnimationPlaybackDirection;");
  lines.push("  status: \"completed\" | \"interrupted\";");
  lines.push("}");
  lines.push("");
  lines.push("const animationClipOrder = [");
  for (const clip of clips) {
    lines.push(`  ${JSON.stringify(clip.name)},`);
  }
  lines.push("] as const;");
  lines.push("");
  lines.push("const animationClipDefinitions: Record<string, AnimationClipDefinition> = {");
  for (const clip of clips) {
    lines.push(`  ${JSON.stringify(clip.name)}: {`);
    lines.push(`    name: ${JSON.stringify(clip.name)},`);
    lines.push(`    fps: ${clip.fps},`);
    lines.push(`    durationFrames: ${clip.durationFrames},`);
    lines.push("    tracks: [");
    for (const track of clip.tracks) {
      lines.push("      {");
      lines.push(`        nodeId: ${JSON.stringify(track.nodeId)},`);
      lines.push(`        target: ${JSON.stringify(track.target)},`);
      lines.push(`        key: ${JSON.stringify(track.key)},`);
      lines.push(`        initialValue: ${serializeLiteral(track.initialValue, "number")},`);
      lines.push(`        firstKeyframeAt: ${serializeLiteral(track.firstKeyframeAtSeconds, "number")},`);
      lines.push("        segments: [");
      for (const segment of track.segments) {
        lines.push("          {");
        lines.push(`            at: ${serializeLiteral(segment.atSeconds, "number")},`);
        lines.push(`            duration: ${serializeLiteral(segment.durationSeconds, "number")},`);
        lines.push(`            value: ${serializeLiteral(segment.value, "number")},`);
        lines.push(`            ease: ${JSON.stringify(segment.ease)},`);
        lines.push("          },");
      }
      lines.push("        ],");
      lines.push("      },");
    }
    lines.push("    ],");
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
}

function emitAnimationMethods(
  lines: string[],
  clips: CollectedAnimationClip[],
): void {
  const defaultClipName = clips[0]?.name ?? "";

  lines.push("  private getClipDefinition(clipName: string): AnimationClipDefinition | null {");
  lines.push("    return animationClipDefinitions[clipName] ?? null;");
  lines.push("  }");
  lines.push("");
  lines.push("  private clearTimelineCallbacks(timeline: gsap.core.Timeline | null): void {");
  lines.push("    timeline?.eventCallback(\"onComplete\", null);");
  lines.push("    timeline?.eventCallback(\"onReverseComplete\", null);");
  lines.push("  }");
  lines.push("");
  lines.push("  private settlePendingPlayback(status: AnimationPlaybackResult[\"status\"]): void {");
  lines.push("    if (!this.resolvePendingPlayback || !this.pendingPlaybackMeta) {");
  lines.push("      return;");
  lines.push("    }");
  lines.push("    const { clipName, direction, timeline } = this.pendingPlaybackMeta;");
  lines.push("    this.clearTimelineCallbacks(timeline);");
  lines.push("    const resolve = this.resolvePendingPlayback;");
  lines.push("    this.resolvePendingPlayback = null;");
  lines.push("    this.pendingPlayback = null;");
  lines.push("    this.pendingPlaybackMeta = null;");
  lines.push("    resolve({ clipName, direction, status });");
  lines.push("  }");
  lines.push("");
  lines.push("  private cancelPendingPlayback(): void {");
  lines.push("    this.settlePendingPlayback(\"interrupted\");");
  lines.push("  }");
  lines.push("");
  lines.push("  private resolveRequestedClipName(clipName?: string): string {");
  lines.push(`    return clipName?.trim() || this.currentClipName || animationClipOrder[0] || ${JSON.stringify(defaultClipName)};`);
  lines.push("  }");
  lines.push("");
  lines.push("  private createTimelineInstance(clip: AnimationClipDefinition): gsap.core.Timeline {");
  lines.push("    const timeline = gsap.timeline({ paused: true });");
  lines.push("    timeline.set({}, {}, clip.durationFrames / Math.max(clip.fps, 1));");
  lines.push("    for (const track of clip.tracks) {");
  lines.push("      const node = this.nodeRefs.get(track.nodeId);");
  lines.push("      if (!node) {");
  lines.push("        continue;");
  lines.push("      }");
  lines.push("      if (track.target === \"visible\") {");
  lines.push("        timeline.set(node, { visible: resolveAnimatedVisibility(track.initialValue) }, track.firstKeyframeAt);");
  lines.push("        const mesh = getAnimatedVisibilityMesh(node);");
  lines.push("        if (mesh) {");
  lines.push("          timeline.set(mesh, { visible: resolveAnimatedVisibility(track.initialValue) }, track.firstKeyframeAt);");
  lines.push("        }");
  lines.push("        for (const segment of track.segments) {");
  lines.push("          timeline.set(node, { visible: resolveAnimatedVisibility(segment.value) }, segment.at + segment.duration);");
  lines.push("          if (mesh) {");
  lines.push("            timeline.set(mesh, { visible: resolveAnimatedVisibility(segment.value) }, segment.at + segment.duration);");
  lines.push("          }");
  lines.push("        }");
  lines.push("        continue;");
  lines.push("      }");
  lines.push("      const owner = track.target === \"position\" ? node.position : track.target === \"rotation\" ? node.rotation : node.scale;");
  lines.push("      timeline.set(owner, { [track.key]: track.initialValue }, track.firstKeyframeAt);");
  lines.push("      for (const segment of track.segments) {");
  lines.push("        timeline.to(owner, { [track.key]: segment.value, duration: segment.duration, ease: segment.ease, immediateRender: false }, segment.at);");
  lines.push("      }");
  lines.push("    }");
  lines.push("    timeline.pause(0);");
  lines.push("    return timeline;");
  lines.push("  }");
  lines.push("");
  lines.push("  private getOrCreateTimeline(clipName?: string): { clip: AnimationClipDefinition; timeline: gsap.core.Timeline } | null {");
  lines.push("    const resolvedClipName = this.resolveRequestedClipName(clipName);");
  lines.push("    const clip = this.getClipDefinition(resolvedClipName);");
  lines.push("    if (!clip) {");
  lines.push("      return null;");
  lines.push("    }");
  lines.push("    let timeline = this.timelineCache.get(clip.name) ?? null;");
  lines.push("    if (!timeline) {");
  lines.push("      timeline = this.createTimelineInstance(clip);");
  lines.push("      this.timelineCache.set(clip.name, timeline);");
  lines.push("    }");
  lines.push("    return { clip, timeline };");
  lines.push("  }");
  lines.push("");
  lines.push("  private beginPlayback(");
  lines.push("    clipName: string,");
  lines.push("    direction: AnimationPlaybackDirection,");
  lines.push("    timeline: gsap.core.Timeline,");
  lines.push("  ): Promise<AnimationPlaybackResult> {");
  lines.push("    this.cancelPendingPlayback();");
  lines.push("    this.clearTimelineCallbacks(timeline);");
  lines.push("    this.pendingPlaybackMeta = { clipName, direction, timeline };");
  lines.push("    this.pendingPlayback = new Promise<AnimationPlaybackResult>((resolve) => {");
  lines.push("      this.resolvePendingPlayback = resolve;");
  lines.push("      if (direction === \"reverse\") {");
  lines.push("        timeline.eventCallback(\"onReverseComplete\", () => this.settlePendingPlayback(\"completed\"));");
  lines.push("        return;");
  lines.push("      }");
  lines.push("      timeline.eventCallback(\"onComplete\", () => this.settlePendingPlayback(\"completed\"));");
  lines.push("    });");
  lines.push("    return this.pendingPlayback;");
  lines.push("  }");
  lines.push("");
  lines.push("  private activateClip(clipName?: string): { clip: AnimationClipDefinition; timeline: gsap.core.Timeline } | null {");
  lines.push("    const resolved = this.getOrCreateTimeline(clipName);");
  lines.push("    if (!resolved) {");
  lines.push("      this.cancelPendingPlayback();");
  lines.push("      this.timeline = null;");
  lines.push("      this.currentClipName = null;");
  lines.push("      return null;");
  lines.push("    }");
  lines.push("    if (this.currentClipName && this.currentClipName !== resolved.clip.name) {");
  lines.push("      this.timeline?.pause();");
  lines.push("    }");
  lines.push("    const { clip, timeline } = resolved;");
  lines.push("    this.timeline = timeline;");
  lines.push("    this.currentClipName = clip.name;");
  lines.push("    return { clip, timeline };");
  lines.push("  }");
  lines.push("");
  lines.push("  public getClipNames(): string[] {");
  lines.push("    return [...animationClipOrder];");
  lines.push("  }");
  lines.push("");
  lines.push(`  public createTimeline(clipName: string = ${JSON.stringify(defaultClipName)}): gsap.core.Timeline | null {`);
  lines.push("    return this.getOrCreateTimeline(clipName)?.timeline ?? null;");
  lines.push("  }");
  lines.push("");
  lines.push("  public async playClip(clipName: string): Promise<AnimationPlaybackResult | null> {");
  lines.push("    const previousClipName = this.currentClipName;");
  lines.push("    const resolved = this.activateClip(clipName);");
  lines.push("    if (!resolved) {");
  lines.push("      return null;");
  lines.push("    }");
  lines.push("    const { clip, timeline } = resolved;");
  lines.push("    const playback = this.beginPlayback(clip.name, \"forward\", timeline);");
  lines.push("    timeline.reversed(false);");
  lines.push("    if (previousClipName !== clip.name || timeline.progress() >= 1) {");
  lines.push("      timeline.restart();");
  lines.push("      return playback;");
  lines.push("    }");
  lines.push("    timeline.play();");
  lines.push("    return playback;");
  lines.push("  }");
  lines.push("");
  lines.push("  public async play(clipName?: string): Promise<AnimationPlaybackResult | null> {");
  lines.push("    return this.playClip(this.resolveRequestedClipName(clipName));");
  lines.push("  }");
  lines.push("");
  lines.push("  public async restart(clipName?: string): Promise<AnimationPlaybackResult | null> {");
  lines.push("    const resolved = this.activateClip(clipName);");
  lines.push("    if (!resolved) {");
  lines.push("      return null;");
  lines.push("    }");
  lines.push("    const playback = this.beginPlayback(resolved.clip.name, \"forward\", resolved.timeline);");
  lines.push("    resolved.timeline.reversed(false);");
  lines.push("    resolved.timeline.restart();");
  lines.push("    return playback;");
  lines.push("  }");
  lines.push("");
  lines.push("  public async reverse(clipName?: string): Promise<AnimationPlaybackResult | null> {");
  lines.push("    const resolved = this.activateClip(clipName);");
  lines.push("    if (!resolved) {");
  lines.push("      return null;");
  lines.push("    }");
  lines.push("    const { clip, timeline } = resolved;");
  lines.push("    const playback = this.beginPlayback(clip.name, \"reverse\", timeline);");
  lines.push("    if (timeline.progress() <= 0) {");
  lines.push("      timeline.pause(timeline.duration());");
  lines.push("    }");
  lines.push("    timeline.reverse();");
  lines.push("    return playback;");
  lines.push("  }");
  lines.push("");
  lines.push("  public async pause(): Promise<void> {");
  lines.push("    this.cancelPendingPlayback();");
  lines.push("    this.timeline?.pause();");
  lines.push("  }");
  lines.push("");
  lines.push("  public async stop(): Promise<void> {");
  lines.push("    const resolved = this.activateClip();");
  lines.push("    if (!resolved) {");
  lines.push("      return;");
  lines.push("    }");
  lines.push("    this.cancelPendingPlayback();");
  lines.push("    resolved.timeline.reversed(false);");
  lines.push("    resolved.timeline.pause();");
  lines.push("    resolved.timeline.seek(0, false);");
  lines.push("  }");
  lines.push("");
  lines.push("  public async seek(frame: number, clipName?: string): Promise<void> {");
  lines.push("    const resolved = this.activateClip(clipName);");
  lines.push("    if (!resolved) {");
  lines.push("      return;");
  lines.push("    }");
  lines.push("    this.cancelPendingPlayback();");
  lines.push("    const normalizedFrame = Math.max(0, Math.min(Math.round(frame), resolved.clip.durationFrames));");
  lines.push("    resolved.timeline.reversed(false);");
  lines.push("    resolved.timeline.pause();");
  lines.push("    resolved.timeline.seek(normalizedFrame / Math.max(resolved.clip.fps, 1), false);");
  lines.push("  }");
  lines.push("");
}

function toTimelineTargetKey(property: string): TimelineTargetKey {
  return property === "visible"
    ? "visible"
    : property.includes("position")
    ? "position"
    : property.includes("rotation")
      ? "rotation"
      : "scale";
}

function toTimelineAxisKey(property: string): TimelineAxisKey {
  if (property === "visible") {
    return "value";
  }
  const propertyKey = property.split(".").at(-1);
  return propertyKey === "y" || propertyKey === "z" ? propertyKey : "x";
}

function propertyExpression(node: ExportNode, path: string, bindingAccessor = "resolved"): string {
  const binding = node.editable[path];
  if (binding) {
    return `${bindingAccessor}.${binding.key}`;
  }

  const value = isModelNode(node) ? getModelPropertyValue(node, path) : getPropertyValue(node, path);
  return serializeLiteral(value, inferTypeFromValue(value));
}

function getModelPropertyValue(node: ExportModelNode, path: string): unknown {
  switch (path) {
    case "visible":
      return node.visible;
    case "transform.position.x":
      return node.transform.position.x;
    case "transform.position.y":
      return node.transform.position.y;
    case "transform.position.z":
      return node.transform.position.z;
    case "transform.rotation.x":
      return node.transform.rotation.x;
    case "transform.rotation.y":
      return node.transform.rotation.y;
    case "transform.rotation.z":
      return node.transform.rotation.z;
    case "transform.scale.x":
      return node.transform.scale.x;
    case "transform.scale.y":
      return node.transform.scale.y;
    case "transform.scale.z":
      return node.transform.scale.z;
    default:
      return "";
  }
}

function inferTypeFromValue(value: unknown): EditableBinding["type"] {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string" && value.startsWith("#")) return "color";
  return "string";
}

function mapBindingType(type: EditableBinding["type"]): string {
  switch (type) {
    case "color":
      return "ColorRepresentation";
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
  }
}

function serializeLiteral(value: unknown, type: EditableBinding["type"]): string {
  switch (type) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
      return Number(numericValue.toFixed(6)).toString();
    }
    case "color":
    case "string":
      return JSON.stringify(String(value ?? ""));
  }
}
