import { frameToSeconds, getTrackSegments, isTrackMuted, mapAnimationEaseToGsap, sortTrackKeyframes } from "./animation";
import { getAvailableFonts, getFontData } from "./fonts";
import type { ComponentBlueprint, EditableBinding, EditorNode, EditorNodeType, FontAsset, ImageAsset, ImageNode } from "./types";
import { ROOT_NODE_ID, getPropertyDefinitions, getPropertyValue, toCamelCase, toPascalCase } from "./state";

interface CollectedBinding {
  node: EditorNode;
  binding: EditableBinding;
}

interface CollectedFont {
  font: FontAsset;
  dataVariableName: string;
  fontVariableName: string;
}

interface CollectedImage {
  node: ImageNode;
  dataVariableName: string;
  textureVariableName: string;
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

interface ExportCollections {
  bindings: CollectedBinding[];
  fonts: CollectedFont[];
  images: CollectedImage[];
}

export interface GenerateTypeScriptComponentOptions {
  fontAssetPathsById?: Record<string, string>;
  imageAssetPathsByNodeId?: Record<string, string>;
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
  const nodes = blueprint.nodes;
  const animationClips = collectAnimationClips(blueprint, nodes);
  const hasAnimations = animationClips.length > 0;
  const usesNodeOriginHelper = nodes.some((node) => node.type !== "group");
  const rootNode = nodes.find((node) => node.id === ROOT_NODE_ID) ?? nodes[0];
  const childrenByParent = buildChildrenMap(nodes);
  const variableNames = createVariableNames(nodes);
  const groupContentVariableNames = createGroupContentVariableNames(nodes, variableNames);
  const { bindings, fonts, images } = collectExportCollections(blueprint, nodes);
  const importNames = collectImports(nodes, bindings);
  const fontVariables = new Map(fonts.map((font) => [font.font.id, font.fontVariableName]));
  const imageVariables = new Map(images.map((image) => [image.node.id, image.textureVariableName]));
  const fontAssetPathsById = options.fontAssetPathsById ?? {};
  const imageAssetPathsByNodeId = options.imageAssetPathsByNodeId ?? {};
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
      const imageSource = imageAssetPathsByNodeId[image.node.id] ?? resolveImageAssetForNode(image.node, imagesById).src;
      lines.push(`const ${image.dataVariableName} = ${JSON.stringify(imageSource)} as const;`);
    }
    lines.push("");
    lines.push("const textureLoader = new TextureLoader();");
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
      const value = getPropertyValue(node, binding.path);
      lines.push(`  ${binding.key}: ${serializeLiteral(value, binding.type)},`);
    }
  }
  lines.push("};");
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

  emitNode(rootNode, lines, childrenByParent, variableNames, groupContentVariableNames, fontVariables, imageVariables, "this.options", hasAnimations, true);

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

function collectExportCollections(blueprint: ComponentBlueprint, nodes: EditorNode[]): ExportCollections {
  const bindings: CollectedBinding[] = [];
  const availableFonts = getAvailableFonts(blueprint.fonts);
  const fontsById = new Map(availableFonts.map((font) => [font.id, font]));
  const imagesById = new Map((blueprint.images ?? []).map((image) => [image.id, image] as const));
  const collectedFontIds = new Set<string>();
  const fontUsedNames = new Set<string>();
  const imageUsedNames = new Set<string>();
  const fonts: CollectedFont[] = [];
  const images: CollectedImage[] = [];

  for (const node of nodes) {
    const validPaths = new Set(getPropertyDefinitions(node).map((definition) => definition.path));
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
      const base = toCamelCase(node.name || image.name) || "image";
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
      images.push({ node, dataVariableName, textureVariableName });
    }
  }

  return {
    bindings,
    fonts,
    images,
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

function collectImports(nodes: EditorNode[], bindings: CollectedBinding[]): Set<string> {
  const imports = new Set<string>(["Group", "Mesh"]);
  const types = new Set<EditorNodeType>(nodes.map((node) => node.type));
  const hasRenderableNodes = nodes.some((node) => node.type !== "group");
  const materialNodes = nodes.filter((node): node is Exclude<EditorNode, { type: "group" }> => node.type !== "group");
  const hasRuntimeMaterialType = materialNodes.some((node) => Boolean(node.editable["material.type"]));
  const usesBasicMaterial = hasRuntimeMaterialType || materialNodes.some((node) => node.material.type === "basic");
  const usesStandardMaterial = hasRuntimeMaterialType || materialNodes.some((node) => node.material.type === "standard");

  if (types.has("box")) imports.add("BoxGeometry");
  if (types.has("circle")) imports.add("CircleGeometry");
  if (types.has("sphere")) imports.add("SphereGeometry");
  if (types.has("cylinder")) imports.add("CylinderGeometry");
  if (types.has("plane") || types.has("image")) imports.add("PlaneGeometry");
  if (usesBasicMaterial) {
    imports.add("MeshBasicMaterial");
  }
  if (usesStandardMaterial) {
    imports.add("MeshStandardMaterial");
  }
  if (types.has("image")) {
    imports.add("TextureLoader");
    imports.add("SRGBColorSpace");
  }
  if (types.has("plane") || types.has("image")) {
    imports.add("DoubleSide");
  }
  if (bindings.some(({ binding }) => binding.type === "color")) {
    imports.add("type ColorRepresentation");
  }
  if (hasRenderableNodes) {
    imports.add("type BufferGeometry");
  }

  return imports;
}

function buildChildrenMap(nodes: EditorNode[]): Map<string | null, EditorNode[]> {
  const map = new Map<string | null, EditorNode[]>();

  for (const node of nodes) {
    const bucket = map.get(node.parentId) ?? [];
    bucket.push(node);
    map.set(node.parentId, bucket);
  }

  return map;
}

function createVariableNames(nodes: EditorNode[]): Map<string, string> {
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
  node: EditorNode | undefined,
  lines: string[],
  childrenByParent: Map<string | null, EditorNode[]>,
  variableNames: Map<string, string>,
  groupContentVariableNames: Map<string, string>,
  fontVariables: Map<string, string>,
  imageVariables: Map<string, string>,
  bindingAccessor: string,
  captureNodeRefs: boolean,
  skipCreation = false,
): void {
  if (!node) return;

  const variableName = variableNames.get(node.id) ?? toCamelCase(node.name);
  if (!skipCreation) {
    for (const line of emitCreationLines(node, variableName, fontVariables, imageVariables, bindingAccessor)) {
      lines.push(`    ${line}`);
    }
  }

  if (node.id !== ROOT_NODE_ID) {
    const parentVariable = groupContentVariableNames.get(node.parentId ?? ROOT_NODE_ID)
      ?? variableNames.get(node.parentId ?? ROOT_NODE_ID)
      ?? "root";
    lines.push(`    ${parentVariable}.add(${variableName});`);
  }

  if (captureNodeRefs) {
    lines.push(`    this.nodeRefs.set(${JSON.stringify(node.id)}, ${variableName});`);
  }

  for (const child of childrenByParent.get(node.id) ?? []) {
    emitNode(child, lines, childrenByParent, variableNames, groupContentVariableNames, fontVariables, imageVariables, bindingAccessor, captureNodeRefs);
  }
}

function emitCreationLines(
  node: EditorNode,
  variableName: string,
  fontVariables: Map<string, string>,
  imageVariables: Map<string, string>,
  bindingAccessor: string,
): string[] {
  const lines: string[] = [];

  if (node.type === "group") {
    lines.push(`const ${variableName} = new Group();`);
    lines.push(`const ${variableName}Content = new Group();`);
    lines.push(`${variableName}Content.position.set(${node.pivotOffset.x}, ${node.pivotOffset.y}, ${node.pivotOffset.z});`);
    lines.push(`${variableName}.add(${variableName}Content);`);
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
          `const ${geometryVariable} = new SphereGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, 32, 24);`,
        );
        break;
      case "cylinder":
        lines.push(
          `const ${geometryVariable} = new CylinderGeometry(${propertyExpression(node, "geometry.radiusTop", bindingAccessor)}, ${propertyExpression(node, "geometry.radiusBottom", bindingAccessor)}, ${propertyExpression(node, "geometry.height", bindingAccessor)}, 32);`,
        );
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

    for (const line of emitMaterialCreationLines(node, materialVariable, bindingAccessor, imageVariables.get(node.id))) {
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

function createGroupContentVariableNames(nodes: EditorNode[], variableNames: Map<string, string>): Map<string, string> {
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
  node: Exclude<EditorNode, { type: "group" }>,
  materialVariable: string,
  bindingAccessor: string,
  textureVariable?: string,
): string[] {
  const lines: string[] = [];
  const hasDynamicMaterialType = Boolean(node.editable["material.type"]);
  const materialTypeExpression = propertyExpression(node, "material.type", bindingAccessor);
  const sharedOptions = [
    `color: ${propertyExpression(node, "material.color", bindingAccessor)}`,
    `opacity: ${propertyExpression(node, "material.opacity", bindingAccessor)}`,
    `transparent: ${propertyExpression(node, "material.transparent", bindingAccessor)}`,
    `alphaTest: ${propertyExpression(node, "material.alphaTest", bindingAccessor)}`,
    `depthTest: ${propertyExpression(node, "material.depthTest", bindingAccessor)}`,
    `depthWrite: ${propertyExpression(node, "material.depthWrite", bindingAccessor)}`,
    `wireframe: ${propertyExpression(node, "material.wireframe", bindingAccessor)}`,
  ];

  if (node.type === "plane" || node.type === "circle" || node.type === "image") {
    sharedOptions.push("side: DoubleSide");
  }

  if (node.type === "image") {
    if (!textureVariable) {
      throw new Error(`Image texture not found for image node "${node.name}".`);
    }
    sharedOptions.push(`map: ${textureVariable}`);
  }

  const standardOnlyOptions = [
    `emissive: ${propertyExpression(node, "material.emissive", bindingAccessor)}`,
    `roughness: ${propertyExpression(node, "material.roughness", bindingAccessor)}`,
    `metalness: ${propertyExpression(node, "material.metalness", bindingAccessor)}`,
  ];

  if (hasDynamicMaterialType) {
    const basicConfigVariable = `${materialVariable}BasicConfig`;
    const standardConfigVariable = `${materialVariable}StandardConfig`;
    lines.push(`const ${basicConfigVariable} = { ${sharedOptions.join(", ")} };`);
    lines.push(`const ${standardConfigVariable} = { ...${basicConfigVariable}, ${standardOnlyOptions.join(", ")} };`);
    lines.push(
      `const ${materialVariable} = ${materialTypeExpression} === "basic" ? new MeshBasicMaterial(${basicConfigVariable}) : new MeshStandardMaterial(${standardConfigVariable});`,
    );
    return lines;
  }

  if (node.material.type === "basic") {
    lines.push(`const ${materialVariable} = new MeshBasicMaterial({ ${sharedOptions.join(", ")} });`);
    return lines;
  }

  lines.push(`const ${materialVariable} = new MeshStandardMaterial({ ${[...sharedOptions, ...standardOnlyOptions].join(", ")} });`);
  return lines;
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

function propertyExpression(node: EditorNode, path: string, bindingAccessor = "resolved"): string {
  const binding = node.editable[path];
  if (binding) {
    return `${bindingAccessor}.${binding.key}`;
  }

  const value = getPropertyValue(node, path);
  return serializeLiteral(value, inferTypeFromValue(value));
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
