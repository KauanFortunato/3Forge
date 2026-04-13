import type { Object3D } from "three";
import { DEFAULT_FONT_ID, getAvailableFonts, getFontData, normalizeFontLibrary } from "./fonts";
import { createTransparentImageAsset, fitImageToMaxSize } from "./images";
import type {
  BoxNode,
  ComponentBlueprint,
  CylinderNode,
  EditableBinding,
  EditableFieldEntry,
  EditorNode,
  EditorNodeType,
  EditorStoreChange,
  FontAsset,
  GroupNode,
  ImageAsset,
  ImageNode,
  MaterialSpec,
  NodePropertyDefinition,
  NodePropertyPath,
  PlaneNode,
  SphereNode,
  TextNode,
  TransformSpec,
  Vec3Like,
  ViewMode,
} from "./types";

export const ROOT_NODE_ID = "root";
export const EDITOR_AUTOSAVE_KEY = "3Forge-component-editor-blueprint";
const HISTORY_LIMIT = 100;

const DEGREE_TO_RADIAN = Math.PI / 180;
const RADIAN_TO_DEGREE = 180 / Math.PI;

const BASE_PROPERTY_DEFINITIONS: NodePropertyDefinition[] = [
  { group: "Transform", path: "transform.position.x", label: "Position X", type: "number", input: "number", step: 0.1 },
  { group: "Transform", path: "transform.position.y", label: "Position Y", type: "number", input: "number", step: 0.1 },
  { group: "Transform", path: "transform.position.z", label: "Position Z", type: "number", input: "number", step: 0.1 },
  { group: "Transform", path: "transform.rotation.x", label: "Rotation X", type: "number", input: "degrees", step: 1 },
  { group: "Transform", path: "transform.rotation.y", label: "Rotation Y", type: "number", input: "degrees", step: 1 },
  { group: "Transform", path: "transform.rotation.z", label: "Rotation Z", type: "number", input: "degrees", step: 1 },
  { group: "Transform", path: "transform.scale.x", label: "Scale X", type: "number", input: "number", step: 0.1, min: 0.01 },
  { group: "Transform", path: "transform.scale.y", label: "Scale Y", type: "number", input: "number", step: 0.1, min: 0.01 },
  { group: "Transform", path: "transform.scale.z", label: "Scale Z", type: "number", input: "number", step: 0.1, min: 0.01 },
];

const MATERIAL_PROPERTY_DEFINITIONS: NodePropertyDefinition[] = [
  { group: "Material", path: "material.color", label: "Color", type: "color", input: "color" },
  { group: "Material", path: "material.opacity", label: "Opacity", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.wireframe", label: "Wireframe", type: "boolean", input: "checkbox" },
];

const GEOMETRY_DEFINITIONS: Record<Exclude<EditorNodeType, "group">, NodePropertyDefinition[]> = {
  box: [
    { group: "Geometry", path: "geometry.width", label: "Width", type: "number", input: "number", step: 0.1, min: 0.01 },
    { group: "Geometry", path: "geometry.height", label: "Height", type: "number", input: "number", step: 0.1, min: 0.01 },
    { group: "Geometry", path: "geometry.depth", label: "Depth", type: "number", input: "number", step: 0.1, min: 0.01 },
  ],
  circle: [
    { group: "Geometry", path: "geometry.radius", label: "Radius", type: "number", input: "number", step: 0.1, min: 0.01 },
    { group: "Geometry", path: "geometry.segments", label: "Segments", type: "number", input: "number", step: 1, min: 1 },
    { group: "Geometry", path: "geometry.thetaStarts", label: "Theta Starts", type: "number", input: "number", step: 0.1, min: 0.01 },
    { group: "Geometry", path: "geometry.thetaLenght", label: "Theta Lenght", type: "number", input: "number", step: 0.1, min: 0.01 },
  ],
  sphere: [
    { group: "Geometry", path: "geometry.radius", label: "Radius", type: "number", input: "number", step: 0.1, min: 0.01 },
  ],
  cylinder: [
    { group: "Geometry", path: "geometry.radiusTop", label: "Top Radius", type: "number", input: "number", step: 0.1, min: 0.01 },
    { group: "Geometry", path: "geometry.radiusBottom", label: "Bottom Radius", type: "number", input: "number", step: 0.1, min: 0.01 },
    { group: "Geometry", path: "geometry.height", label: "Height", type: "number", input: "number", step: 0.1, min: 0.01 },
  ],
  plane: [
    { group: "Geometry", path: "geometry.width", label: "Width", type: "number", input: "number", step: 0.1, min: 0.01 },
    { group: "Geometry", path: "geometry.height", label: "Height", type: "number", input: "number", step: 0.1, min: 0.01 },
  ],
  image: [
    { group: "Geometry", path: "geometry.width", label: "Width", type: "number", input: "number", step: 0.1, min: 0.01 },
    { group: "Geometry", path: "geometry.height", label: "Height", type: "number", input: "number", step: 0.1, min: 0.01 },
  ],
  text: [
    { group: "Text", path: "geometry.text", label: "Content", type: "string", input: "text" },
    { group: "Text", path: "geometry.size", label: "Size", type: "number", input: "number", step: 0.05, min: 0.01 },
    { group: "Text", path: "geometry.depth", label: "Depth", type: "number", input: "number", step: 0.01, min: 0 },
    { group: "Text", path: "geometry.curveSegments", label: "Curve Segments", type: "number", input: "number", step: 1, min: 1, max: 48 },
    { group: "Text", path: "geometry.bevelEnabled", label: "Bevel", type: "boolean", input: "checkbox" },
    { group: "Text", path: "geometry.bevelThickness", label: "Bevel Thickness", type: "number", input: "number", step: 0.01, min: 0 },
    { group: "Text", path: "geometry.bevelSize", label: "Bevel Size", type: "number", input: "number", step: 0.01, min: 0 },
  ],
};

const DEFAULT_NODE_NAMES: Record<EditorNodeType, string> = {
  group: "Group",
  box: "Box",
  circle: "Circle",
  sphere: "Sphere",
  cylinder: "Cylinder",
  plane: "Plane",
  image: "Image",
  text: "Text",
};

export function createDefaultBlueprint(): ComponentBlueprint {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";

  const panel = createNode("box", root.id);
  panel.name = "Hero Panel";
  panel.geometry.width = 2.6;
  panel.geometry.height = 1.2;
  panel.geometry.depth = 0.24;
  panel.material.color = "#7c44de";
  panel.material.opacity = 0.9;
  panel.transform.position.y = 0.8;

  const accent = createNode("plane", panel.id);
  accent.name = "Accent Plate";
  accent.geometry.width = 2.1;
  accent.geometry.height = 0.35;
  accent.material.color = "#ffffff";
  accent.transform.position.y = 0.55;
  accent.transform.position.z = 0.14;

  const title = createNode("text", panel.id);
  title.name = "Headline";
  title.geometry.text = "3Forge";
  title.geometry.size = 0.28;
  title.geometry.depth = 0.06;
  title.material.color = "#333333";
  title.transform.position.y = 0.5535;
  title.transform.position.z = 0.1584;

  return {
    version: 1,
    componentName: "3Forge-Component",
    fonts: [],
    nodes: [root, panel, accent, title],
  };
}

function createTransform(): TransformSpec {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function createMaterial(color = "#5ad3ff"): MaterialSpec {
  return {
    color,
    opacity: 1,
    wireframe: false,
  };
}

function generateId(prefix = "node"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

type EditorNodeOfType<T extends EditorNodeType> = Extract<EditorNode, { type: T }>;

export function createNode<T extends EditorNodeType>(type: T, parentId: string | null, id = generateId(type)): EditorNodeOfType<T> {
  const base = {
    id,
    name: `${DEFAULT_NODE_NAMES[type]} ${id.slice(-4)}`,
    type,
    parentId,
    transform: createTransform(),
    editable: {},
  };

  switch (type) {
    case "group":
      return {
        ...base,
        type: "group",
      } as EditorNodeOfType<T>;
    case "box":
      return {
        ...base,
        type: "box",
        geometry: { width: 1.6, height: 1, depth: 1 },
        material: createMaterial("#4bd6ff"),
      } as EditorNodeOfType<T>;
    case "circle":
      return {
        ...base,
        type: "circle",
        geometry: { radius: 1, segments: 32, thetaStarts: 6.4, thetaLenght: 1 },
        material: createMaterial("#ff8dcc"),
      } as EditorNodeOfType<T>;
    case "sphere":
      return {
        ...base,
        type: "sphere",
        geometry: { radius: 0.7 },
        material: createMaterial("#8df0ff"),
      } as EditorNodeOfType<T>;
    case "cylinder":
      return {
        ...base,
        type: "cylinder",
        geometry: { radiusTop: 0.5, radiusBottom: 0.5, height: 1.4 },
        material: createMaterial("#9cf579"),
      } as EditorNodeOfType<T>;
    case "plane":
      return {
        ...base,
        type: "plane",
        geometry: { width: 1.8, height: 1.2 },
        material: createMaterial("#f7c84b"),
      } as EditorNodeOfType<T>;
    case "image":
      return {
        ...base,
        type: "image",
        geometry: { width: 1.6, height: 1.6 },
        image: createTransparentImageAsset(),
        material: createMaterial("#ffffff"),
      } as EditorNodeOfType<T>;
    case "text":
      return {
        ...base,
        type: "text",
        fontId: DEFAULT_FONT_ID,
        geometry: {
          text: "New Text",
          size: 0.4,
          depth: 0.08,
          curveSegments: 12,
          bevelEnabled: false,
          bevelThickness: 0.02,
          bevelSize: 0.01,
        },
        material: createMaterial("#f4fbff"),
      } as EditorNodeOfType<T>;
  }
}

export function getPropertyDefinitions(node: EditorNode): NodePropertyDefinition[] {
  if (node.type === "group") {
    return [...BASE_PROPERTY_DEFINITIONS];
  }

  return [
    ...BASE_PROPERTY_DEFINITIONS,
    ...GEOMETRY_DEFINITIONS[node.type],
    ...MATERIAL_PROPERTY_DEFINITIONS,
  ];
}

export function getPropertyValue(node: EditorNode, path: NodePropertyPath): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, node);
}

export function getDisplayValue(node: EditorNode, definition: NodePropertyDefinition): number | string | boolean {
  const rawValue = getPropertyValue(node, definition.path);

  if (definition.input === "degrees" && typeof rawValue === "number") {
    return Number((rawValue * RADIAN_TO_DEGREE).toFixed(2));
  }

  if (definition.input === "checkbox") {
    return Boolean(rawValue);
  }

  if (definition.input === "color") {
    return typeof rawValue === "string" ? normalizeColor(rawValue, "#ffffff") : "#ffffff";
  }

  if (definition.input === "text") {
    return String(rawValue ?? "");
  }

  return typeof rawValue === "number" ? Number(rawValue.toFixed(4)) : String(rawValue ?? "");
}

export function parseInputValue(
  definition: NodePropertyDefinition,
  rawValue: string | number | boolean,
  fallback: unknown,
): unknown {
  if (definition.input === "checkbox") {
    return Boolean(rawValue);
  }

  if (definition.input === "color") {
    return normalizeColor(String(rawValue), String(fallback ?? "#ffffff"));
  }

  if (definition.input === "text") {
    return String(rawValue ?? fallback ?? "");
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  const clamped = clampNumber(numericValue, definition.min, definition.max);
  if (definition.input === "degrees") {
    return clamped * DEGREE_TO_RADIAN;
  }

  return clamped;
}

export function setPropertyValue(node: EditorNode, path: NodePropertyPath, value: unknown): void {
  const segments = path.split(".");
  const lastSegment = segments.pop();
  if (!lastSegment) return;

  const target = segments.reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, node);

  if (target && typeof target === "object") {
    (target as Record<string, unknown>)[lastSegment] = value;
  }
}

export function toCamelCase(input: string): string {
  const normalized = input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");

  if (!normalized) {
    return "field";
  }

  return /^[a-zA-Z_$]/.test(normalized) ? normalized : `field${normalized}`;
}

export function toPascalCase(input: string): string {
  const camel = toCamelCase(input);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function makeDefaultBinding(node: EditorNode, definition: NodePropertyDefinition): EditableBinding {
  return {
    path: definition.path,
    key: toCamelCase(`${node.name} ${definition.label}`),
    label: `${node.name} ${definition.label}`,
    type: definition.type,
  };
}

function clampNumber(value: number, min?: number, max?: number): number {
  let result = value;
  if (typeof min === "number") {
    result = Math.max(min, result);
  }
  if (typeof max === "number") {
    result = Math.min(max, result);
  }
  return result;
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeColor(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function normalizeVec3(value: unknown, fallback: Vec3Like): Vec3Like {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const source = value as Record<string, unknown>;
  return {
    x: normalizeNumber(source.x, fallback.x),
    y: normalizeNumber(source.y, fallback.y),
    z: normalizeNumber(source.z, fallback.z),
  };
}

function normalizeTransform(value: unknown, fallback: TransformSpec): TransformSpec {
  if (!value || typeof value !== "object") {
    return structuredClone(fallback);
  }

  const source = value as Record<string, unknown>;
  return {
    position: normalizeVec3(source.position, fallback.position),
    rotation: normalizeVec3(source.rotation, fallback.rotation),
    scale: normalizeVec3(source.scale, fallback.scale),
  };
}

function normalizeMaterial(value: unknown, fallback: MaterialSpec): MaterialSpec {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const source = value as Record<string, unknown>;
  return {
    color: normalizeColor(String(source.color ?? fallback.color), fallback.color),
    opacity: clampNumber(normalizeNumber(source.opacity, fallback.opacity), 0, 1),
    wireframe: Boolean(source.wireframe ?? fallback.wireframe),
  };
}

function normalizeImageAsset(value: unknown, fallback: ImageAsset): ImageAsset {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const source = value as Record<string, unknown>;
  const src = typeof source.src === "string" && source.src.trim()
    ? source.src
    : fallback.src;

  return {
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : fallback.name,
    mimeType: typeof source.mimeType === "string" && source.mimeType.trim() ? source.mimeType.trim() : fallback.mimeType,
    src,
    width: clampNumber(normalizeNumber(source.width, fallback.width), 1),
    height: clampNumber(normalizeNumber(source.height, fallback.height), 1),
  };
}

function normalizeEditableBindings(node: EditorNode, rawBindings: unknown): Record<NodePropertyPath, EditableBinding> {
  if (!rawBindings || typeof rawBindings !== "object") {
    return {};
  }

  const definitions = new Map(getPropertyDefinitions(node).map((definition) => [definition.path, definition]));
  const result: Record<NodePropertyPath, EditableBinding> = {};

  for (const [path, rawBinding] of Object.entries(rawBindings as Record<string, unknown>)) {
    const definition = definitions.get(path);
    if (!definition || !rawBinding || typeof rawBinding !== "object") {
      continue;
    }

    const source = rawBinding as Record<string, unknown>;
    const defaultBinding = makeDefaultBinding(node, definition);
    result[path] = {
      path,
      key: toCamelCase(String(source.key ?? defaultBinding.key)),
      label: String(source.label ?? defaultBinding.label),
      type: definition.type,
    };
  }

  return result;
}

function normalizeImportedNode(rawNode: unknown): EditorNode | null {
  if (!rawNode || typeof rawNode !== "object") {
    return null;
  }

  const source = rawNode as Record<string, unknown>;
  const type = source.type;
  if (type !== "group" && type !== "box" && type !== "circle" && type !== "sphere" && type !== "cylinder" && type !== "plane" && type !== "text" && type !== "image") {
    return null;
  }

  const node = createNode(
    type,
    source.parentId === null || typeof source.parentId === "string" ? source.parentId : ROOT_NODE_ID,
    typeof source.id === "string" ? source.id : generateId(type),
  );

  node.name = typeof source.name === "string" ? source.name : node.name;
  node.transform = normalizeTransform(source.transform, node.transform);

  if ("material" in node) {
    node.material = normalizeMaterial(source.material, node.material);
  }

  if (source.geometry && typeof source.geometry === "object") {
    const geometry = source.geometry as Record<string, unknown>;
    switch (node.type) {
      case "box":
        node.geometry.width = clampNumber(normalizeNumber(geometry.width, node.geometry.width), 0.01);
        node.geometry.height = clampNumber(normalizeNumber(geometry.height, node.geometry.height), 0.01);
        node.geometry.depth = clampNumber(normalizeNumber(geometry.depth, node.geometry.depth), 0.01);
        break;
      case "circle":
        node.geometry.radius = clampNumber(normalizeNumber(geometry.radius, node.geometry.radius), 0.01);
        node.geometry.segments = clampNumber(normalizeNumber(geometry.segments, node.geometry.segments), 1);
        node.geometry.thetaStarts = clampNumber(normalizeNumber(geometry.thetaStarts, node.geometry.thetaStarts), 0.01);
        node.geometry.thetaLenght = clampNumber(normalizeNumber(geometry.thetaLenght, node.geometry.thetaLenght), 0.01);
      case "sphere":
        node.geometry.radius = clampNumber(normalizeNumber(geometry.radius, node.geometry.radius), 0.01);
        break;
      case "cylinder":
        node.geometry.radiusTop = clampNumber(normalizeNumber(geometry.radiusTop, node.geometry.radiusTop), 0.01);
        node.geometry.radiusBottom = clampNumber(normalizeNumber(geometry.radiusBottom, node.geometry.radiusBottom), 0.01);
        node.geometry.height = clampNumber(normalizeNumber(geometry.height, node.geometry.height), 0.01);
        break;
      case "plane":
        node.geometry.width = clampNumber(normalizeNumber(geometry.width, node.geometry.width), 0.01);
        node.geometry.height = clampNumber(normalizeNumber(geometry.height, node.geometry.height), 0.01);
        break;
      case "image":
        node.geometry.width = clampNumber(normalizeNumber(geometry.width, node.geometry.width), 0.01);
        node.geometry.height = clampNumber(normalizeNumber(geometry.height, node.geometry.height), 0.01);
        node.image = normalizeImageAsset(source.image, node.image);
        break;
      case "text":
        node.geometry.text = typeof geometry.text === "string" ? geometry.text : node.geometry.text;
        node.geometry.size = clampNumber(normalizeNumber(geometry.size, node.geometry.size), 0.01);
        node.geometry.depth = clampNumber(normalizeNumber(geometry.depth, node.geometry.depth), 0);
        node.geometry.curveSegments = clampNumber(normalizeNumber(geometry.curveSegments, node.geometry.curveSegments), 1, 48);
        node.geometry.bevelEnabled = Boolean(geometry.bevelEnabled ?? node.geometry.bevelEnabled);
        node.geometry.bevelThickness = clampNumber(normalizeNumber(geometry.bevelThickness, node.geometry.bevelThickness), 0);
        node.geometry.bevelSize = clampNumber(normalizeNumber(geometry.bevelSize, node.geometry.bevelSize), 0);
        node.fontId = typeof source.fontId === "string" ? source.fontId : DEFAULT_FONT_ID;
        break;
      case "group":
        break;
    }
  }

  node.editable = normalizeEditableBindings(node, source.editable);
  return node;
}

function normalizeBlueprint(rawBlueprint: unknown): ComponentBlueprint {
  const fallback = createDefaultBlueprint();

  if (!rawBlueprint || typeof rawBlueprint !== "object") {
    return fallback;
  }

  const source = rawBlueprint as Record<string, unknown>;
  const importedFonts = normalizeFontLibrary(source.fonts);
  const availableFonts = getAvailableFonts(importedFonts);
  const availableFontIds = new Set(availableFonts.map((font) => font.id));
  const importedNodes = Array.isArray(source.nodes)
    ? source.nodes.map(normalizeImportedNode).filter((node): node is EditorNode => Boolean(node))
    : [];

  const usedIds = new Set<string>();
  for (const node of importedNodes) {
    if (usedIds.has(node.id)) {
      node.id = generateId(node.type);
    }
    usedIds.add(node.id);
  }

  let root = importedNodes.find((node) => node.id === ROOT_NODE_ID && node.type === "group");
  if (!root) {
    root = createNode("group", null, ROOT_NODE_ID);
    root.name = "Component Root";
    importedNodes.unshift(root);
  } else {
    root.parentId = null;
  }

  const groupIds = new Set(importedNodes.filter((node) => node.type === "group").map((node) => node.id));
  for (const node of importedNodes) {
    if (node.id === ROOT_NODE_ID) {
      node.parentId = null;
      continue;
    }

    if (!node.parentId || !groupIds.has(node.parentId)) {
      node.parentId = ROOT_NODE_ID;
    }

    if (node.type === "text" && !availableFontIds.has(node.fontId)) {
      node.fontId = DEFAULT_FONT_ID;
    }
  }

  return {
    version: 1,
    componentName: typeof source.componentName === "string" ? source.componentName : fallback.componentName,
    fonts: importedFonts,
    nodes: importedNodes,
  };
}

interface EditorStoreSnapshot {
  blueprint: ComponentBlueprint;
  selectedNodeId: string;
}

export class EditorStore extends EventTarget {
  private _blueprint: ComponentBlueprint;
  private _selectedNodeId: string;
  private _viewMode: ViewMode = "rendered";
  private _undoStack: EditorStoreSnapshot[] = [];
  private _redoStack: EditorStoreSnapshot[] = [];
  private _activeHistorySnapshot: EditorStoreSnapshot | null = null;
  private _activeHistoryDirty = false;
  private _revision = 0;

  constructor(initialBlueprint?: unknown) {
    super();
    this._blueprint = normalizeBlueprint(initialBlueprint ?? createDefaultBlueprint());
    this._selectedNodeId = this._blueprint.nodes[0]?.id ?? ROOT_NODE_ID;
  }

  get blueprint(): ComponentBlueprint {
    return this._blueprint;
  }

  get selectedNodeId(): string {
    return this._selectedNodeId;
  }

  get selectedNode(): EditorNode | undefined {
    return this.getNode(this._selectedNodeId);
  }

  get fonts(): FontAsset[] {
    return getAvailableFonts(this._blueprint.fonts);
  }

  get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  get revision(): number {
    return this._revision;
  }

  get viewMode(): ViewMode {
    return this._viewMode;
  }

  setViewMode(mode: ViewMode, source: EditorStoreChange["source"] = "ui"): void {
    if (this._viewMode === mode) {
      return;
    }

    this._viewMode = mode;
    this.notify({ reason: "view", source });
  }

  subscribe(listener: (change: EditorStoreChange) => void): () => void {
    const handler = (event: Event) => {
      listener((event as CustomEvent<EditorStoreChange>).detail);
    };

    this.addEventListener("change", handler);
    return () => this.removeEventListener("change", handler);
  }

  getSnapshot(): ComponentBlueprint {
    return structuredClone(this._blueprint);
  }

  beginHistoryTransaction(): void {
    if (this._activeHistorySnapshot) {
      return;
    }

    this._activeHistorySnapshot = this.snapshotState();
    this._activeHistoryDirty = false;
  }

  commitHistoryTransaction(source: EditorStoreChange["source"] = "history"): boolean {
    if (!this._activeHistorySnapshot) {
      return false;
    }

    const snapshot = this._activeHistorySnapshot;
    const shouldCommit = this._activeHistoryDirty;

    this._activeHistorySnapshot = null;
    this._activeHistoryDirty = false;

    if (!shouldCommit) {
      return false;
    }

    this.pushUndoSnapshot(snapshot);
    this._redoStack = [];
    this.notify({ reason: "history", source, nodeId: this._selectedNodeId });
    return true;
  }

  undo(source: EditorStoreChange["source"] = "history"): boolean {
    const previous = this._undoStack.pop();
    if (!previous) {
      return false;
    }

    this._redoStack.push(this.snapshotState());
    this.restoreSnapshot(previous);
    this.notify({ reason: "history", source, nodeId: this._selectedNodeId });
    return true;
  }

  redo(source: EditorStoreChange["source"] = "history"): boolean {
    const next = this._redoStack.pop();
    if (!next) {
      return false;
    }

    this.pushUndoSnapshot(this.snapshotState());
    this.restoreSnapshot(next);
    this.notify({ reason: "history", source, nodeId: this._selectedNodeId });
    return true;
  }

  getNode(nodeId: string): EditorNode | undefined {
    return this._blueprint.nodes.find((node) => node.id === nodeId);
  }

  getFont(fontId: string): FontAsset | undefined {
    return this.fonts.find((font) => font.id === fontId);
  }

  getNodeChildren(parentId: string | null): EditorNode[] {
    return this._blueprint.nodes.filter((node) => node.parentId === parentId);
  }

  getGroupNodes(): GroupNode[] {
    return this._blueprint.nodes.filter((node): node is GroupNode => node.type === "group");
  }

  getEligibleParents(nodeId: string): GroupNode[] {
    const blocked = new Set(this.getDescendantIds(nodeId));
    blocked.add(nodeId);
    return this.getGroupNodes().filter((group) => !blocked.has(group.id));
  }

  getDescendantIds(nodeId: string): string[] {
    const descendants: string[] = [];
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      const children = this._blueprint.nodes.filter((node) => node.parentId === current);
      for (const child of children) {
        descendants.push(child.id);
        queue.push(child.id);
      }
    }

    return descendants;
  }

  updateComponentName(componentName: string, source: EditorStoreChange["source"] = "ui"): void {
    const normalized = componentName.trim() || "HologfxComponent";
    if (normalized === this._blueprint.componentName) {
      return;
    }

    this.recordHistorySnapshot();
    this._blueprint.componentName = normalized;
    this.notify({ reason: "meta", source });
  }

  loadBlueprint(rawBlueprint: unknown, source: EditorStoreChange["source"] = "import"): void {
    this.recordHistorySnapshot();
    this._blueprint = normalizeBlueprint(rawBlueprint);
    this._selectedNodeId = this._blueprint.nodes[0]?.id ?? ROOT_NODE_ID;
    this.ensureUniqueBindingKeys();
    this.notify({ reason: "import", source });
  }

  selectNode(nodeId: string, source: EditorStoreChange["source"] = "ui"): void {
    if (!this.getNode(nodeId) || this._selectedNodeId === nodeId) {
      return;
    }

    this._selectedNodeId = nodeId;
    this.notify({ reason: "selection", source, nodeId });
  }

  addNode(type: EditorNodeType, source: EditorStoreChange["source"] = "ui"): string {
    const selected = this.selectedNode;
    const parentId = selected?.type === "group"
      ? selected.id
      : selected?.parentId ?? ROOT_NODE_ID;

    return this.insertNode(type, parentId, undefined, source);
  }

  addImageNode(image: ImageAsset, source: EditorStoreChange["source"] = "ui"): string {
    const selected = this.selectedNode;
    const parentId = selected?.type === "group"
      ? selected.id
      : selected?.parentId ?? ROOT_NODE_ID;

    return this.insertImageNode(image, parentId, undefined, source);
  }

  insertNode(
    type: EditorNodeType,
    parentId: string | null,
    siblingIndex?: number,
    source: EditorStoreChange["source"] = "ui",
  ): string {
    const targetParentId = this.resolveInsertParentId(parentId);
    const node = createNode(type, targetParentId);

    this.recordHistorySnapshot();
    this._blueprint.nodes = insertSubtreeIntoBlueprint(
      this._blueprint.nodes,
      [node],
      targetParentId,
      siblingIndex,
    );
    this._selectedNodeId = node.id;
    this.notify({ reason: "structure", source, nodeId: node.id });
    return node.id;
  }

  insertImageNode(
    image: ImageAsset,
    parentId: string | null,
    siblingIndex?: number,
    source: EditorStoreChange["source"] = "ui",
  ): string {
    const targetParentId = this.resolveInsertParentId(parentId);
    const node = createNode("image", targetParentId);
    applyImageAssetToNode(node, image);
    node.name = stripExtension(image.name) || node.name;

    this.recordHistorySnapshot();
    this._blueprint.nodes = insertSubtreeIntoBlueprint(
      this._blueprint.nodes,
      [node],
      targetParentId,
      siblingIndex,
    );
    this._selectedNodeId = node.id;
    this.notify({ reason: "structure", source, nodeId: node.id });
    return node.id;
  }

  pasteNodes(nodes: EditorNode[], parentId: string | null, source: EditorStoreChange["source"] = "ui"): string | null {
    if (nodes.length === 0) {
      return null;
    }

    const rootNode = findClipboardRoot(nodes);
    if (!rootNode) {
      return null;
    }

    const targetParentId = this.resolvePasteParentId(parentId);
    if (!targetParentId) {
      return null;
    }

    const clonedNodes = structuredClone(nodes);
    const idMap = new Map<string, string>();
    const normalizedNodes: EditorNode[] = [];

    for (const node of clonedNodes) {
      const nextId = generateId(node.type);
      idMap.set(node.id, nextId);
    }

    for (const node of clonedNodes) {
      const remappedNode = structuredClone(node);
      remappedNode.id = idMap.get(node.id) ?? generateId(node.type);
      remappedNode.parentId = node.id === rootNode.id
        ? targetParentId
        : node.parentId
          ? (idMap.get(node.parentId) ?? targetParentId)
          : targetParentId;

      if (remappedNode.type === "text" && !this.getFont(remappedNode.fontId)) {
        remappedNode.fontId = DEFAULT_FONT_ID;
      }

      normalizedNodes.push(remappedNode);
    }

    const newRoot = normalizedNodes.find((node) => node.parentId === targetParentId) ?? normalizedNodes[0];
    newRoot.name = makeCopyName(newRoot.name);
    newRoot.transform.position.x += 0.45;
    newRoot.transform.position.z += 0.45;

    this.recordHistorySnapshot();
    this._blueprint.nodes.push(...normalizedNodes);
    this._selectedNodeId = newRoot.id;
    this.ensureUniqueBindingKeys();
    this.notify({ reason: "structure", source, nodeId: newRoot.id });
    return newRoot.id;
  }

  deleteSelected(source: EditorStoreChange["source"] = "ui"): void {
    this.deleteNode(this._selectedNodeId, source);
  }

  deleteNode(nodeId: string, source: EditorStoreChange["source"] = "ui"): void {
    if (nodeId === ROOT_NODE_ID || !this.getNode(nodeId)) {
      return;
    }

    const idsToDelete = new Set([nodeId, ...this.getDescendantIds(nodeId)]);
    const removedNode = this.getNode(nodeId);

    this.recordHistorySnapshot();
    this._blueprint.nodes = this._blueprint.nodes.filter((node) => !idsToDelete.has(node.id));
    this._selectedNodeId = removedNode?.parentId ?? ROOT_NODE_ID;
    this.ensureUniqueBindingKeys();
    this.notify({ reason: "structure", source, nodeId });
  }

  reparentNode(nodeId: string, parentId: string | null, source: EditorStoreChange["source"] = "ui"): boolean {
    const node = this.getNode(nodeId);
    if (!node || node.id === ROOT_NODE_ID) {
      return false;
    }

    const targetParentId = parentId ?? ROOT_NODE_ID;
    const parent = this.getNode(targetParentId);
    if (!parent || parent.type !== "group") {
      return false;
    }

    const blocked = new Set(this.getDescendantIds(nodeId));
    if (blocked.has(targetParentId) || targetParentId === nodeId || node.parentId === targetParentId) {
      return false;
    }

    this.recordHistorySnapshot();
    node.parentId = targetParentId;
    this.notify({ reason: "structure", source, nodeId });
    return true;
  }

  moveNode(
    nodeId: string,
    parentId: string | null,
    siblingIndex: number,
    source: EditorStoreChange["source"] = "ui",
  ): boolean {
    const node = this.getNode(nodeId);
    if (!node || node.id === ROOT_NODE_ID) {
      return false;
    }

    const targetParentId = parentId ?? ROOT_NODE_ID;
    const parent = this.getNode(targetParentId);
    if (!parent || parent.type !== "group") {
      return false;
    }

    const blocked = new Set(this.getDescendantIds(nodeId));
    if (blocked.has(targetParentId) || targetParentId === nodeId) {
      return false;
    }

    const movingIds = new Set([nodeId, ...this.getDescendantIds(nodeId)]);
    const movingSubtree = this._blueprint.nodes.filter((entry) => movingIds.has(entry.id));
    if (movingSubtree.length === 0) {
      return false;
    }

    const remainingNodes = this._blueprint.nodes.filter((entry) => !movingIds.has(entry.id));
    const targetSiblings = remainingNodes.filter((entry) => entry.parentId === targetParentId);
    const normalizedIndex = clampInteger(siblingIndex, 0, targetSiblings.length);
    const currentSiblingIndex = this._blueprint.nodes
      .filter((entry) => entry.parentId === node.parentId)
      .findIndex((entry) => entry.id === nodeId);

    if (node.parentId === targetParentId && currentSiblingIndex === normalizedIndex) {
      return false;
    }

    movingSubtree[0].parentId = targetParentId;

    this.recordHistorySnapshot();
    this._blueprint.nodes = insertSubtreeIntoBlueprint(
      remainingNodes,
      movingSubtree,
      targetParentId,
      normalizedIndex,
    );
    this._selectedNodeId = nodeId;
    this.notify({ reason: "structure", source, nodeId });
    return true;
  }

  updateNodeName(nodeId: string, name: string, source: EditorStoreChange["source"] = "ui"): void {
    const node = this.getNode(nodeId);
    if (!node) {
      return;
    }

    const normalized = name.trim() || DEFAULT_NODE_NAMES[node.type];
    if (normalized === node.name) {
      return;
    }

    this.recordHistorySnapshot();
    node.name = normalized;
    this.notify({ reason: "node", source, nodeId });
  }

  updateNodeProperty(nodeId: string, definition: NodePropertyDefinition, rawValue: string | number | boolean, source: EditorStoreChange["source"] = "ui"): void {
    const node = this.getNode(nodeId);
    if (!node) {
      return;
    }

    const currentValue = getPropertyValue(node, definition.path);
    const parsedValue = parseInputValue(definition, rawValue, currentValue);
    if (Object.is(parsedValue, currentValue)) {
      return;
    }

    this.recordHistorySnapshot();
    setPropertyValue(node, definition.path, parsedValue);
    this.notify({ reason: "node", source, nodeId });
  }

  updateTextNodeFont(nodeId: string, fontId: string, source: EditorStoreChange["source"] = "ui"): void {
    const node = this.getNode(nodeId);
    if (!node || node.type !== "text") {
      return;
    }

    if (!this.getFont(fontId) || node.fontId === fontId) {
      return;
    }

    this.recordHistorySnapshot();
    node.fontId = fontId;
    this.notify({ reason: "node", source, nodeId });
  }

  updateImageNodeAsset(nodeId: string, image: ImageAsset, source: EditorStoreChange["source"] = "ui"): void {
    const node = this.getNode(nodeId);
    if (!node || node.type !== "image") {
      return;
    }

    this.recordHistorySnapshot();
    applyImageAssetToNode(node, image, Math.max(node.geometry.width, node.geometry.height));
    if (!node.name || /copy$/i.test(node.name)) {
      node.name = stripExtension(image.name) || node.name;
    }
    this.notify({ reason: "node", source, nodeId });
  }

  addFont(font: FontAsset, source: EditorStoreChange["source"] = "ui"): string {
    const matchingFont = this.fonts.find((item) => getFontData(item) === getFontData(font));
    if (matchingFont) {
      return matchingFont.id;
    }

    this.recordHistorySnapshot();
    this._blueprint.fonts.push({
      ...font,
      source: "imported",
    });
    this.notify({ reason: "font", source });
    return font.id;
  }

  setNodeTransformFromObject(nodeId: string, object: Object3D, source: EditorStoreChange["source"] = "scene"): void {
    const node = this.getNode(nodeId);
    if (!node) {
      return;
    }

    const didChange =
      !isVec3Equal(node.transform.position, object.position) ||
      !isVec3Equal(node.transform.rotation, object.rotation) ||
      !isVec3Equal(node.transform.scale, object.scale);

    if (!didChange) {
      return;
    }

    this.recordHistorySnapshot();
    node.transform.position = {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    };
    node.transform.rotation = {
      x: object.rotation.x,
      y: object.rotation.y,
      z: object.rotation.z,
    };
    node.transform.scale = {
      x: object.scale.x,
      y: object.scale.y,
      z: object.scale.z,
    };

    this.notify({ reason: "node", source, nodeId });
  }

  toggleEditableProperty(nodeId: string, definition: NodePropertyDefinition, enabled: boolean, source: EditorStoreChange["source"] = "ui"): void {
    const node = this.getNode(nodeId);
    if (!node) {
      return;
    }

    this.recordHistorySnapshot();
    if (enabled) {
      const baseBinding = makeDefaultBinding(node, definition);
      node.editable[definition.path] = {
        ...baseBinding,
        key: this.makeUniqueBindingKey(baseBinding.key, nodeId, definition.path),
      };
    } else {
      delete node.editable[definition.path];
    }

    this.notify({ reason: "editable", source, nodeId });
  }

  updateEditableBinding(
    nodeId: string,
    path: NodePropertyPath,
    patch: Partial<Pick<EditableBinding, "key" | "label">>,
    source: EditorStoreChange["source"] = "ui",
  ): void {
    const node = this.getNode(nodeId);
    const binding = node?.editable[path];
    if (!node || !binding) {
      return;
    }

    const nextLabel = typeof patch.label === "string" && patch.label.trim()
      ? patch.label.trim()
      : binding.label;
    const nextKey = typeof patch.key === "string"
      ? this.makeUniqueBindingKey(patch.key, nodeId, path)
      : binding.key;

    if (nextLabel === binding.label && nextKey === binding.key) {
      return;
    }

    this.recordHistorySnapshot();
    if (typeof patch.label === "string" && patch.label.trim()) {
      binding.label = nextLabel;
    }

    if (typeof patch.key === "string") {
      binding.key = nextKey;
    }

    this.notify({ reason: "editable", source, nodeId });
  }

  listEditableFields(): EditableFieldEntry[] {
    return this._blueprint.nodes.flatMap((node) =>
      Object.values(node.editable).map((binding) => ({ node, binding })),
    );
  }

  private ensureUniqueBindingKeys(): void {
    for (const node of this._blueprint.nodes) {
      for (const path of Object.keys(node.editable)) {
        node.editable[path].key = this.makeUniqueBindingKey(node.editable[path].key, node.id, path);
      }
    }
  }

  private resolvePasteParentId(parentId: string | null): string | null {
    const targetParentId = parentId ?? ROOT_NODE_ID;
    const parent = this.getNode(targetParentId);
    if (!parent || parent.type !== "group") {
      return null;
    }

    return targetParentId;
  }

  private resolveInsertParentId(parentId: string | null): string {
    const targetParentId = parentId ?? ROOT_NODE_ID;
    const parent = this.getNode(targetParentId);
    if (!parent || parent.type !== "group") {
      return ROOT_NODE_ID;
    }

    return targetParentId;
  }

  private snapshotState(): EditorStoreSnapshot {
    return {
      blueprint: structuredClone(this._blueprint),
      selectedNodeId: this._selectedNodeId,
    };
  }

  private restoreSnapshot(snapshot: EditorStoreSnapshot): void {
    this._blueprint = structuredClone(snapshot.blueprint);
    this._selectedNodeId = this.getNode(snapshot.selectedNodeId)?.id ?? snapshot.selectedNodeId;

    if (!this.getNode(this._selectedNodeId)) {
      this._selectedNodeId = this._blueprint.nodes[0]?.id ?? ROOT_NODE_ID;
    }
  }

  private recordHistorySnapshot(): void {
    if (this._activeHistorySnapshot) {
      this._activeHistoryDirty = true;
      return;
    }

    this.pushUndoSnapshot(this.snapshotState());
    this._redoStack = [];
  }

  private pushUndoSnapshot(snapshot: EditorStoreSnapshot): void {
    this._undoStack.push(snapshot);
    if (this._undoStack.length > HISTORY_LIMIT) {
      this._undoStack.shift();
    }
  }

  private makeUniqueBindingKey(proposedKey: string, nodeId: string, path: string): string {
    const baseKey = toCamelCase(proposedKey);
    const takenKeys = new Set<string>();

    for (const node of this._blueprint.nodes) {
      for (const binding of Object.values(node.editable)) {
        if (node.id === nodeId && binding.path === path) {
          continue;
        }
        takenKeys.add(binding.key);
      }
    }

    if (!takenKeys.has(baseKey)) {
      return baseKey;
    }

    let suffix = 2;
    while (takenKeys.has(`${baseKey}${suffix}`)) {
      suffix += 1;
    }

    return `${baseKey}${suffix}`;
  }

  private notify(change: EditorStoreChange): void {
    this._revision += 1;
    this.dispatchEvent(new CustomEvent<EditorStoreChange>("change", { detail: change }));
  }
}

function isVec3Equal(
  current: Vec3Like,
  next: { x: number; y: number; z: number },
  epsilon = 0.000001,
): boolean {
  return (
    Math.abs(current.x - next.x) < epsilon &&
    Math.abs(current.y - next.y) < epsilon &&
    Math.abs(current.z - next.z) < epsilon
  );
}

function findClipboardRoot(nodes: EditorNode[]): EditorNode | null {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return nodes.find((node) => !node.parentId || !nodeIds.has(node.parentId)) ?? nodes[0] ?? null;
}

function makeCopyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Copy";
  }

  return /\bcopy$/i.test(trimmed) ? `${trimmed} 2` : `${trimmed} Copy`;
}

function applyImageAssetToNode(
  node: Extract<EditorNode, { type: "image" }>,
  image: ImageAsset,
  maxSize = 2,
): void {
  node.image = {
    ...image,
    width: Math.max(image.width, 1),
    height: Math.max(image.height, 1),
  };

  const fitted = fitImageToMaxSize(node.image.width, node.image.height, maxSize);
  node.geometry.width = fitted.width;
  node.geometry.height = fitted.height;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "").trim();
}

function insertSubtreeIntoBlueprint(
  nodes: EditorNode[],
  subtree: EditorNode[],
  parentId: string,
  siblingIndex?: number,
): EditorNode[] {
  const insertionIndex = findInsertionIndex(nodes, parentId, siblingIndex);
  return [
    ...nodes.slice(0, insertionIndex),
    ...subtree,
    ...nodes.slice(insertionIndex),
  ];
}

function findInsertionIndex(
  nodes: EditorNode[],
  parentId: string,
  siblingIndex?: number,
): number {
  const siblings = nodes.filter((node) => node.parentId === parentId);
  const normalizedIndex = clampInteger(siblingIndex ?? siblings.length, 0, siblings.length);

  if (normalizedIndex === 0) {
    const parentIndex = nodes.findIndex((node) => node.id === parentId);
    if (parentIndex >= 0) {
      return parentIndex + 1;
    }

    return nodes.findIndex((node) => node.parentId === parentId);
  }

  const previousSibling = siblings[normalizedIndex - 1];
  if (!previousSibling) {
    return nodes.length;
  }

  return findSubtreeEndIndex(nodes, previousSibling.id) + 1;
}

function findSubtreeEndIndex(nodes: EditorNode[], nodeId: string): number {
  const subtreeIds = new Set([nodeId, ...getDescendantIdsFromNodes(nodes, nodeId)]);
  let lastMatch = -1;

  for (let index = 0; index < nodes.length; index += 1) {
    if (subtreeIds.has(nodes[index].id)) {
      lastMatch = index;
    }
  }

  return lastMatch >= 0 ? lastMatch : nodes.length - 1;
}

function getDescendantIdsFromNodes(nodes: EditorNode[], nodeId: string): string[] {
  const descendants: string[] = [];
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const node of nodes) {
      if (node.parentId !== current) {
        continue;
      }

      descendants.push(node.id);
      queue.push(node.id);
    }
  }

  return descendants;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
