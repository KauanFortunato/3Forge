import { getAvailableFonts, getFontData } from "./fonts";
import type { ComponentBlueprint, EditableBinding, EditorNode, EditorNodeType, FontAsset, ImageNode } from "./types";
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

export function exportBlueprintToJson(blueprint: ComponentBlueprint): string {
  return JSON.stringify(blueprint, null, 2);
}

export function generateTypeScriptComponent(blueprint: ComponentBlueprint): string {
  const componentName = blueprint.componentName.trim() || "3ForgeComponent";
  const componentTypeName = toPascalCase(componentName);
  const optionTypeName = `${componentTypeName}Options`;
  const resolvedTypeName = `${componentTypeName}ResolvedOptions`;

  const nodes = blueprint.nodes;
  const rootNode = nodes.find((node) => node.id === ROOT_NODE_ID) ?? nodes[0];
  const bindings = collectBindings(nodes);
  const importNames = collectImports(nodes, bindings);
  const childrenByParent = buildChildrenMap(nodes);
  const variableNames = createVariableNames(nodes);
  const fonts = collectFonts(blueprint, nodes);
  const images = collectImages(nodes);
  const fontVariables = new Map(fonts.map((font) => [font.font.id, font.fontVariableName]));
  const imageVariables = new Map(images.map((image) => [image.node.id, image.textureVariableName]));
  const lines: string[] = [];

  lines.push(`import { ${Array.from(importNames).sort().join(", ")} } from "three";`);
  if (fonts.length > 0) {
    lines.push(`import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";`);
    lines.push(`import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";`);
  }
  lines.push("");

  if (fonts.length > 0) {
    for (const font of fonts) {
      lines.push(`const ${font.dataVariableName} = ${getFontData(font.font)} as const;`);
    }
    lines.push("");
  }

  if (images.length > 0) {
    for (const image of images) {
      lines.push(`const ${image.dataVariableName} = ${JSON.stringify(image.node.image.src)} as const;`);
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
      const value = getPropertyValue(node, binding.path);
      lines.push(`  ${binding.key}: ${serializeLiteral(value, binding.type)},`);
    }
  }
  lines.push("};");
  lines.push("");
  lines.push(`export class ${componentTypeName} {`);
  lines.push("  public readonly group: Group;");
  lines.push(`  private readonly options: ${resolvedTypeName};`);
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

  if (fonts.length > 0) {
    lines.push("    const fontLoader = new FontLoader();");
    for (const font of fonts) {
      lines.push(`    const ${font.fontVariableName} = fontLoader.parse(${font.dataVariableName});`);
    }
  }
  if (images.length > 0) {
    lines.push("    const textureLoader = new TextureLoader();");
    for (const image of images) {
      lines.push(`    const ${image.textureVariableName} = await textureLoader.loadAsync(${image.dataVariableName});`);
      lines.push(`    ${image.textureVariableName}.colorSpace = SRGBColorSpace;`);
      lines.push(`    ${image.textureVariableName}.needsUpdate = true;`);
    }
  }

  if (rootNode) {
    lines.push(`    root.position.set(${propertyExpression(rootNode, "transform.position.x", "this.options")}, ${propertyExpression(rootNode, "transform.position.y", "this.options")}, ${propertyExpression(rootNode, "transform.position.z", "this.options")});`);
    lines.push(`    root.rotation.set(${propertyExpression(rootNode, "transform.rotation.x", "this.options")}, ${propertyExpression(rootNode, "transform.rotation.y", "this.options")}, ${propertyExpression(rootNode, "transform.rotation.z", "this.options")});`);
    lines.push(`    root.scale.set(${propertyExpression(rootNode, "transform.scale.x", "this.options")}, ${propertyExpression(rootNode, "transform.scale.y", "this.options")}, ${propertyExpression(rootNode, "transform.scale.z", "this.options")});`);
  }

  emitNode(rootNode, lines, childrenByParent, variableNames, fontVariables, imageVariables, "this.options", true);

  lines.push("  }");
  lines.push("");
  lines.push("  public dispose(): void {");
  lines.push("    this.disposeResources(true);");
  lines.push("  }");
  lines.push("");
  lines.push("  private disposeResources(removeFromParent: boolean): void {");
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
  lines.push("    if (removeFromParent) {");
  lines.push("      this.group.parent?.remove(this.group);");
  lines.push("    }");
  lines.push("  }");
  lines.push("}");

  return lines.join("\n");
}

function collectBindings(nodes: EditorNode[]): CollectedBinding[] {
  return nodes.flatMap((node) =>
    Object.values(node.editable)
      .filter((binding) => getPropertyDefinitions(node).some((definition) => definition.path === binding.path))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((binding) => ({ node, binding })),
  );
}

function collectImports(nodes: EditorNode[], bindings: CollectedBinding[]): Set<string> {
  const imports = new Set<string>(["Group", "Mesh"]);
  const types = new Set<EditorNodeType>(nodes.map((node) => node.type));
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

  return imports;
}

function collectImages(nodes: EditorNode[]): CollectedImage[] {
  const usedNames = new Set<string>();
  const collected: CollectedImage[] = [];

  for (const node of nodes) {
    if (node.type !== "image") {
      continue;
    }

    const base = toCamelCase(node.name || node.image.name) || "image";
    let dataVariableName = `${base}ImageData`;
    let textureVariableName = `${base}Texture`;
    let suffix = 2;

    while (usedNames.has(dataVariableName) || usedNames.has(textureVariableName)) {
      dataVariableName = `${base}ImageData${suffix}`;
      textureVariableName = `${base}Texture${suffix}`;
      suffix += 1;
    }

    usedNames.add(dataVariableName);
    usedNames.add(textureVariableName);
    collected.push({ node, dataVariableName, textureVariableName });
  }

  return collected;
}

function collectFonts(blueprint: ComponentBlueprint, nodes: EditorNode[]): CollectedFont[] {
  const availableFonts = getAvailableFonts(blueprint.fonts);
  const fontsById = new Map(availableFonts.map((font) => [font.id, font]));
  const usedNames = new Set<string>();
  const collected: CollectedFont[] = [];

  for (const node of nodes) {
    if (node.type !== "text" || collected.some((entry) => entry.font.id === node.fontId)) {
      continue;
    }

    const font = fontsById.get(node.fontId);
    if (!font) {
      continue;
    }

    const base = toCamelCase(font.name) || "font";
    let dataVariableName = `${base}FontData`;
    let fontVariableName = `${base}Font`;
    let suffix = 2;

    while (usedNames.has(dataVariableName) || usedNames.has(fontVariableName)) {
      dataVariableName = `${base}FontData${suffix}`;
      fontVariableName = `${base}Font${suffix}`;
      suffix += 1;
    }

    usedNames.add(dataVariableName);
    usedNames.add(fontVariableName);
    collected.push({ font, dataVariableName, fontVariableName });
  }

  return collected;
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
  fontVariables: Map<string, string>,
  imageVariables: Map<string, string>,
  bindingAccessor: string,
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
    const parentVariable = variableNames.get(node.parentId ?? ROOT_NODE_ID) ?? "root";
    lines.push(`    ${parentVariable}.add(${variableName});`);
  }

  for (const child of childrenByParent.get(node.id) ?? []) {
    emitNode(child, lines, childrenByParent, variableNames, fontVariables, imageVariables, bindingAccessor);
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
  } else {
    const geometryVariable = `${variableName}Geometry`;
    const materialVariable = `${variableName}Material`;

    switch (node.type) {
      case "box":
        lines.push(
          `const ${geometryVariable} = new BoxGeometry(${propertyExpression(node, "geometry.width", bindingAccessor)}, ${propertyExpression(node, "geometry.height", bindingAccessor)}, ${propertyExpression(node, "geometry.depth", bindingAccessor)});`,
        );
        break;
      case "circle":
        lines.push(
          `const ${geometryVariable} = new SphereGeometry(${propertyExpression(node, "geometry.radius", bindingAccessor)}, ${propertyExpression(node, "geometry.segments", bindingAccessor)}, ${propertyExpression(node, "geometry.thetaStarts", bindingAccessor)}, ${propertyExpression(node, "geometry.thetaLenght", bindingAccessor)});`,
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
        lines.push(`${geometryVariable}.computeBoundingBox();`);
        lines.push(`${geometryVariable}.center();`);
        break;
      }
    }

    for (const line of emitMaterialCreationLines(node, materialVariable, bindingAccessor, imageVariables.get(node.id))) {
      lines.push(line);
    }
    lines.push(`const ${variableName} = new Mesh(${geometryVariable}, ${materialVariable});`);
    lines.push(`${variableName}.castShadow = ${node.type === "image" ? "false" : "true"};`);
    lines.push(`${variableName}.receiveShadow = ${node.type === "image" ? "false" : "true"};`);
    lines.push(`${variableName}.visible = ${propertyExpression(node, "material.visible", bindingAccessor)};`);
  }

  lines.push(`${variableName}.name = ${JSON.stringify(node.name)};`);
  lines.push(`${variableName}.position.set(${propertyExpression(node, "transform.position.x", bindingAccessor)}, ${propertyExpression(node, "transform.position.y", bindingAccessor)}, ${propertyExpression(node, "transform.position.z", bindingAccessor)});`);
  lines.push(`${variableName}.rotation.set(${propertyExpression(node, "transform.rotation.x", bindingAccessor)}, ${propertyExpression(node, "transform.rotation.y", bindingAccessor)}, ${propertyExpression(node, "transform.rotation.z", bindingAccessor)});`);
  lines.push(`${variableName}.scale.set(${propertyExpression(node, "transform.scale.x", bindingAccessor)}, ${propertyExpression(node, "transform.scale.y", bindingAccessor)}, ${propertyExpression(node, "transform.scale.z", bindingAccessor)});`);

  return lines;
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
