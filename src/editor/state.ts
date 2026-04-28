import { Euler, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import {
  DEFAULT_ANIMATION_EASE,
  normalizeAnimationValueForProperty,
  createAnimationClip,
  createAnimationKeyframe,
  createAnimationTrack,
  createDefaultAnimation,
  getAnimationValue,
  isAnimationEasePreset,
  isAnimationPropertyPath,
  normalizeAnimation,
  sortTrackKeyframes,
} from "./animation";
import { DEFAULT_FONT_ID, getAvailableFonts, getFontData, normalizeFontLibrary, parseFontAsset } from "./fonts";
import { createTransparentImageAsset, fitImageToMaxSize } from "./images";
import {
  cloneMaterialSpec,
  createMaterialSpec,
  getMaterialPropertyDefinitions,
  MATERIAL_SHADOW_PROPERTY_DEFINITIONS,
  normalizeMaterialLibrary,
  normalizeMaterialSpec,
} from "./materials";
import {
  capturePropertiesFromNode,
  resolveApplicableEntries,
  type PropertyApplyReport,
  type PropertyClipboard,
  type PropertyClipboardScope,
} from "./propertyClipboard";
import { computeGroupContentBounds, getBoundsOriginOffset, transformOffsetByTransform } from "./spatial";
import type {
  AnimationClip,
  AnimationEasePreset,
  AnimationKeyframe,
  AnimationPropertyPath,
  AnimationTrack,
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
  GroupPivotPreset,
  ImageAsset,
  ImageNode,
  MaterialAsset,
  MaterialSpec,
  NodeOriginDepth,
  NodeOriginHorizontal,
  NodeOriginSpec,
  NodeOriginVertical,
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

const OBJECT_PROPERTY_DEFINITIONS: NodePropertyDefinition[] = [
  { group: "Object", path: "visible", label: "Visible", type: "boolean", input: "checkbox" },
];

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

const GROUP_PIVOT_PRESET_ORIGINS: Record<GroupPivotPreset, NodeOriginSpec> = {
  center: { x: "center", y: "center", z: "center" },
  "bottom-center": { x: "center", y: "bottom", z: "center" },
  "top-center": { x: "center", y: "top", z: "center" },
  "left-center": { x: "left", y: "center", z: "center" },
  "right-center": { x: "right", y: "center", z: "center" },
  "front-center": { x: "center", y: "center", z: "front" },
  "back-center": { x: "center", y: "center", z: "back" },
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
    materials: [],
    nodes: [root, panel, accent, title],
    animation: createDefaultAnimation(),
  };
}

function createTransform(): TransformSpec {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function createNodeOrigin(): NodeOriginSpec {
  return {
    x: "center",
    y: "center",
    z: "center",
  };
}

function createPivotOffset(): Vec3Like {
  return {
    x: 0,
    y: 0,
    z: 0,
  };
}

function createMaterial(color = "#5ad3ff"): MaterialSpec {
  return createMaterialSpec(color);
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
    visible: true,
    transform: createTransform(),
    origin: createNodeOrigin(),
    editable: {},
  };

  switch (type) {
    case "group":
      return {
        ...base,
        type: "group",
        pivotOffset: createPivotOffset(),
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
        material: createMaterialSpec("#ffffff", "basic"),
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
    return [...OBJECT_PROPERTY_DEFINITIONS, ...BASE_PROPERTY_DEFINITIONS];
  }

  return [
    ...OBJECT_PROPERTY_DEFINITIONS,
    ...BASE_PROPERTY_DEFINITIONS,
    ...GEOMETRY_DEFINITIONS[node.type],
    ...getMaterialPropertyDefinitions(node.material.type),
    ...MATERIAL_SHADOW_PROPERTY_DEFINITIONS,
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

  if (definition.input === "select") {
    return String(rawValue ?? definition.options?.[0]?.value ?? "");
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

  if (definition.input === "select") {
    const nextValue = String(rawValue ?? fallback ?? "");
    const allowedValues = definition.options?.map((option) => option.value) ?? [];
    return allowedValues.includes(nextValue) ? nextValue : fallback;
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

function normalizeOriginHorizontal(value: unknown, fallback: NodeOriginHorizontal): NodeOriginHorizontal {
  return value === "left" || value === "center" || value === "right" ? value : fallback;
}

function normalizeOriginVertical(value: unknown, fallback: NodeOriginVertical): NodeOriginVertical {
  return value === "top" || value === "center" || value === "bottom" ? value : fallback;
}

function normalizeOriginDepth(value: unknown, fallback: NodeOriginDepth): NodeOriginDepth {
  return value === "front" || value === "center" || value === "back" ? value : fallback;
}

function normalizeNodeOrigin(value: unknown, fallback: NodeOriginSpec): NodeOriginSpec {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const source = value as Record<string, unknown>;
  return {
    x: normalizeOriginHorizontal(source.x, fallback.x),
    y: normalizeOriginVertical(source.y, fallback.y),
    z: normalizeOriginDepth(source.z, fallback.z),
  };
}

function computeOriginPositionDelta(
  node: Exclude<EditorNode, { type: "group" }>,
  previousOrigin: NodeOriginSpec,
  nextOrigin: NodeOriginSpec,
  store: Pick<EditorStore, "getFont">,
): Vec3Like {
  const previousOffset = getTransformedNodeOriginOffset(node, previousOrigin, store);
  const nextOffset = getTransformedNodeOriginOffset(node, nextOrigin, store);
  const localDelta = new Vector3(
    previousOffset.x - nextOffset.x,
    previousOffset.y - nextOffset.y,
    previousOffset.z - nextOffset.z,
  );

  return {
    x: localDelta.x,
    y: localDelta.y,
    z: localDelta.z,
  };
}

function getNodeOriginOffset(
  node: Exclude<EditorNode, { type: "group" }>,
  origin: NodeOriginSpec,
  store: Pick<EditorStore, "getFont">,
): Vec3Like {
  switch (node.type) {
    case "box":
      return {
        x: resolveOriginOffset(-node.geometry.width * 0.5, node.geometry.width * 0.5, origin.x),
        y: resolveOriginOffset(-node.geometry.height * 0.5, node.geometry.height * 0.5, origin.y),
        z: resolveOriginOffset(-node.geometry.depth * 0.5, node.geometry.depth * 0.5, origin.z),
      };
    case "circle":
      return {
        x: resolveOriginOffset(-node.geometry.radius, node.geometry.radius, origin.x),
        y: resolveOriginOffset(-node.geometry.radius, node.geometry.radius, origin.y),
        z: resolveOriginOffset(0, 0, origin.z),
      };
    case "sphere":
      return {
        x: resolveOriginOffset(-node.geometry.radius, node.geometry.radius, origin.x),
        y: resolveOriginOffset(-node.geometry.radius, node.geometry.radius, origin.y),
        z: resolveOriginOffset(-node.geometry.radius, node.geometry.radius, origin.z),
      };
    case "cylinder": {
      const radius = Math.max(node.geometry.radiusTop, node.geometry.radiusBottom);
      return {
        x: resolveOriginOffset(-radius, radius, origin.x),
        y: resolveOriginOffset(-node.geometry.height * 0.5, node.geometry.height * 0.5, origin.y),
        z: resolveOriginOffset(-radius, radius, origin.z),
      };
    }
    case "plane":
    case "image":
      return {
        x: resolveOriginOffset(-node.geometry.width * 0.5, node.geometry.width * 0.5, origin.x),
        y: resolveOriginOffset(-node.geometry.height * 0.5, node.geometry.height * 0.5, origin.y),
        z: resolveOriginOffset(0, 0, origin.z),
      };
    case "text":
      return getTextNodeOriginOffset(node, origin, store);
  }
}

function getTransformedNodeOriginOffset(
  node: Exclude<EditorNode, { type: "group" }>,
  origin: NodeOriginSpec,
  store: Pick<EditorStore, "getFont">,
): Vec3Like {
  const localOffset = getNodeOriginOffset(node, origin, store);
  const transformedOffset = new Vector3(localOffset.x, localOffset.y, localOffset.z);

  transformedOffset.multiply(new Vector3(
    node.transform.scale.x,
    node.transform.scale.y,
    node.transform.scale.z,
  ));
  transformedOffset.applyQuaternion(new Quaternion().setFromEuler(new Euler(
    node.transform.rotation.x,
    node.transform.rotation.y,
    node.transform.rotation.z,
  )));

  return {
    x: transformedOffset.x,
    y: transformedOffset.y,
    z: transformedOffset.z,
  };
}

function getTextNodeOriginOffset(
  node: TextNode,
  origin: NodeOriginSpec,
  store: Pick<EditorStore, "getFont">,
): Vec3Like {
  const font = store.getFont(node.fontId) ?? store.getFont(DEFAULT_FONT_ID);
  if (!font) {
    return { x: 0, y: 0, z: 0 };
  }

  const geometry = new TextGeometry(node.geometry.text || " ", {
    font: parseFontAsset(font),
    size: Math.max(node.geometry.size, 0.01),
    depth: Math.max(node.geometry.depth, 0),
    curveSegments: Math.max(1, Math.round(node.geometry.curveSegments)),
    bevelEnabled: node.geometry.bevelEnabled,
    bevelThickness: Math.max(node.geometry.bevelThickness, 0),
    bevelSize: Math.max(node.geometry.bevelSize, 0),
  });

  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  geometry.dispose();

  if (!bounds) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: resolveOriginOffset(bounds.min.x, bounds.max.x, origin.x),
    y: resolveOriginOffset(bounds.min.y, bounds.max.y, origin.y),
    z: resolveOriginOffset(bounds.min.z, bounds.max.z, origin.z),
  };
}

function resolveOriginOffset(
  min: number,
  max: number,
  origin: NodeOriginSpec["x"] | NodeOriginSpec["y"] | NodeOriginSpec["z"],
): number {
  switch (origin) {
    case "left":
    case "bottom":
    case "back":
      return -min;
    case "right":
    case "top":
    case "front":
      return -max;
    default:
      return -((min + max) * 0.5);
  }
}

function normalizeMaterial(value: unknown, fallback: MaterialSpec): MaterialSpec {
  return normalizeMaterialSpec(value, fallback);
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
  node.visible = typeof source.visible === "boolean" ? source.visible : true;
  node.transform = normalizeTransform(source.transform, node.transform);
  node.origin = normalizeNodeOrigin(source.origin, node.origin);
  if (node.type === "group") {
    node.pivotOffset = normalizeVec3(source.pivotOffset, node.pivotOffset);
  }

  if ("material" in node) {
    node.material = normalizeMaterial(source.material, node.material);
    if (typeof source.materialId === "string" && source.materialId.trim()) {
      (node as { materialId?: string }).materialId = source.materialId.trim();
    }
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
  const importedMaterials = normalizeMaterialLibrary(source.materials);
  const availableMaterialIds = new Set(importedMaterials.map((material) => material.id));
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

    if (node.type !== "group") {
      const candidate = (node as { materialId?: string }).materialId;
      if (candidate && availableMaterialIds.has(candidate)) {
        const asset = importedMaterials.find((entry) => entry.id === candidate);
        if (asset) {
          node.material = cloneMaterialSpec(asset.spec);
        }
      } else if (candidate) {
        delete (node as { materialId?: string }).materialId;
      }
    }
  }

  const animation = normalizeAnimation(source.animation, new Set(importedNodes.map((node) => node.id)));

  return {
    version: 1,
    componentName: typeof source.componentName === "string" ? source.componentName : fallback.componentName,
    fonts: importedFonts,
    materials: importedMaterials,
    nodes: importedNodes,
    animation,
  };
}

interface EditorStoreSnapshot {
  blueprint: ComponentBlueprint;
  selectedNodeId: string;
  selectedNodeIds: string[];
}

export class EditorStore extends EventTarget {
  private _blueprint: ComponentBlueprint;
  private _selectedNodeId: string;
  private _selectedNodeIds: string[];
  private _viewMode: ViewMode = "rendered";
  private _undoStack: EditorStoreSnapshot[] = [];
  private _redoStack: EditorStoreSnapshot[] = [];
  private _activeHistorySnapshot: EditorStoreSnapshot | null = null;
  private _activeHistoryDirty = false;
  private _revision = 0;
  private _propertyClipboard: PropertyClipboard | null = null;

  constructor(initialBlueprint?: unknown) {
    super();
    this._blueprint = normalizeBlueprint(initialBlueprint ?? createDefaultBlueprint());
    this._selectedNodeId = this._blueprint.nodes[0]?.id ?? ROOT_NODE_ID;
    this._selectedNodeIds = this.sanitizeSelectionIds([this._selectedNodeId], this._selectedNodeId);
  }

  get blueprint(): ComponentBlueprint {
    return this._blueprint;
  }

  get selectedNodeId(): string {
    return this._selectedNodeId;
  }

  get selectedNodeIds(): string[] {
    return [...this._selectedNodeIds];
  }

  get selectedNode(): EditorNode | undefined {
    return this.getNode(this._selectedNodeId);
  }

  get selectedNodes(): EditorNode[] {
    return this._selectedNodeIds
      .map((nodeId) => this.getNode(nodeId))
      .filter((node): node is EditorNode => Boolean(node));
  }

  get fonts(): FontAsset[] {
    return getAvailableFonts(this._blueprint.fonts);
  }

  get materials(): MaterialAsset[] {
    return this._blueprint.materials;
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

  get animation() {
    return this._blueprint.animation;
  }

  get activeAnimationClip(): AnimationClip {
    const clip = this.getActiveAnimationClip();
    if (!clip) {
      throw new Error("No active animation clip.");
    }
    return clip;
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

  cancelHistoryTransaction(source: EditorStoreChange["source"] = "history"): boolean {
    if (!this._activeHistorySnapshot) {
      return false;
    }

    const snapshot = this._activeHistorySnapshot;
    const shouldNotify = this._activeHistoryDirty;
    this._activeHistorySnapshot = null;
    this._activeHistoryDirty = false;

    if (shouldNotify) {
      this.restoreSnapshot(snapshot);
      this.notify({ reason: "history", source, nodeId: this._selectedNodeId });
    }

    return shouldNotify;
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

  getMaterial(materialId: string): MaterialAsset | undefined {
    return this._blueprint.materials.find((material) => material.id === materialId);
  }

  getNodesUsingMaterial(materialId: string): EditorNode[] {
    return this._blueprint.nodes.filter((node) => {
      if (node.type === "group") {
        return false;
      }
      return (node as { materialId?: string }).materialId === materialId;
    });
  }

  isNodeSelected(nodeId: string): boolean {
    return this._selectedNodeIds.includes(nodeId);
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

  getSubtreeNodes(nodeId: string): EditorNode[] {
    const ids = new Set([nodeId, ...this.getDescendantIds(nodeId)]);
    return this._blueprint.nodes.filter((node) => ids.has(node.id));
  }

  getSelectionRootIds(nodeIds: string[] = this._selectedNodeIds): string[] {
    const selection = new Set(
      this.sanitizeSelectionIds(nodeIds, this._selectedNodeId).filter((nodeId) => nodeId !== ROOT_NODE_ID),
    );

    return this._blueprint.nodes
      .filter((node) => selection.has(node.id) && !this.hasSelectedAncestor(node.parentId, selection))
      .map((node) => node.id);
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

  updateAnimationConfig(
    patch: Partial<Pick<AnimationClip, "fps" | "durationFrames">>,
    source: EditorStoreChange["source"] = "ui",
  ): void {
    const clip = this.getActiveAnimationClip();
    if (!clip) {
      return;
    }
    const nextFps = typeof patch.fps === "number" && Number.isFinite(patch.fps)
      ? Math.max(1, Math.round(patch.fps))
      : clip.fps;
    const nextDurationFrames = typeof patch.durationFrames === "number" && Number.isFinite(patch.durationFrames)
      ? Math.max(1, Math.round(patch.durationFrames))
      : clip.durationFrames;

    if (nextFps === clip.fps && nextDurationFrames === clip.durationFrames) {
      return;
    }

    this.recordHistorySnapshot();
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      fps: nextFps,
      durationFrames: nextDurationFrames,
      tracks: entry.tracks.map((track) => ({
        ...track,
        keyframes: track.keyframes
          .map((keyframe) => ({
            ...keyframe,
            frame: Math.max(0, Math.min(keyframe.frame, nextDurationFrames)),
          }))
          .filter((keyframe, index, keyframes) => keyframes.findIndex((candidate) => candidate.frame === keyframe.frame) === index),
      })),
    }));
    this.notify({ reason: "animation", source });
  }

  getAnimationClip(clipId: string): AnimationClip | undefined {
    return this._blueprint.animation.clips.find((clip) => clip.id === clipId);
  }

  getAnimationClipByName(name: string): AnimationClip | undefined {
    return this._blueprint.animation.clips.find((clip) => clip.name.toLowerCase() === name.trim().toLowerCase());
  }

  getActiveAnimationClip(): AnimationClip | null {
    return this.getAnimationClip(this._blueprint.animation.activeClipId) ?? this._blueprint.animation.clips[0] ?? null;
  }

  getResolvedAnimationClipTracks(clipId: string): AnimationTrack[] {
    const clip = this.getAnimationClip(clipId);
    return clip?.tracks ?? [];
  }

  setActiveAnimationClip(clipId: string, source: EditorStoreChange["source"] = "ui"): void {
    if (!this.getAnimationClip(clipId) || clipId === this._blueprint.animation.activeClipId) {
      return;
    }

    this._blueprint.animation = {
      ...this._blueprint.animation,
      activeClipId: clipId,
    };
    this.notify({ reason: "animation", source });
  }

  createAnimationClip(name?: string, source: EditorStoreChange["source"] = "ui"): string {
    const clipName = this.makeUniqueAnimationClipName(name?.trim() || `clip_${this._blueprint.animation.clips.length + 1}`);
    this.recordHistorySnapshot();
    const clip = this.appendAnimationClip(clipName);
    this.notify({ reason: "animation", source });
    return clip.id;
  }

  renameAnimationClip(clipId: string, name: string, source: EditorStoreChange["source"] = "ui"): void {
    const clip = this.getAnimationClip(clipId);
    if (!clip) {
      return;
    }

    const nextName = this.makeUniqueAnimationClipName(name.trim() || clip.name, clipId);
    if (nextName === clip.name) {
      return;
    }

    this.recordHistorySnapshot();
    this.updateAnimationClip(clipId, (entry) => ({ ...entry, name: nextName }));
    this.notify({ reason: "animation", source });
  }

  removeAnimationClip(clipId: string, source: EditorStoreChange["source"] = "ui"): void {
    if (this._blueprint.animation.clips.length <= 1) {
      return;
    }

    const clip = this.getAnimationClip(clipId);
    if (!clip) {
      return;
    }

    this.recordHistorySnapshot();
    const fallbackClip = this._blueprint.animation.clips.find((entry) => entry.id !== clipId) ?? this._blueprint.animation.clips[0] ?? null;
    this._blueprint.animation.clips = this._blueprint.animation.clips.filter((entry) => entry.id !== clipId);
    this._blueprint.animation.activeClipId = fallbackClip?.id ?? "";
    this.notify({ reason: "animation", source });
  }

  duplicateAnimationClip(clipId: string, source: EditorStoreChange["source"] = "ui"): string | null {
    const clip = this.getAnimationClip(clipId);
    if (!clip) {
      return null;
    }

    const duplicateName = this.makeUniqueAnimationClipName(`${clip.name} (copy)`);
    this.recordHistorySnapshot();
    const duplicated = createAnimationClip(duplicateName, {
      fps: clip.fps,
      durationFrames: clip.durationFrames,
      tracks: clip.tracks.map((track) => {
        const nextTrack = createAnimationTrack(track.nodeId, track.property);
        nextTrack.keyframes = sortTrackKeyframes(
          track.keyframes.map((keyframe) => createAnimationKeyframe(keyframe.frame, keyframe.value, keyframe.ease)),
        );
        if (track.muted) {
          nextTrack.muted = true;
        }
        return nextTrack;
      }),
    });
    this._blueprint.animation = {
      ...this._blueprint.animation,
      clips: [...this._blueprint.animation.clips, duplicated],
    };
    this.notify({ reason: "animation", source });
    return duplicated.id;
  }

  private updateAnimationClip(clipId: string, updater: (clip: AnimationClip) => AnimationClip): void {
    this._blueprint.animation = {
      ...this._blueprint.animation,
      clips: this._blueprint.animation.clips.map((clip) => clip.id === clipId ? updater(clip) : clip),
    };
  }

  private appendAnimationClip(name: string): AnimationClip {
    const clip = createAnimationClip(name);
    this._blueprint.animation = {
      ...this._blueprint.animation,
      clips: [...this._blueprint.animation.clips, clip],
      activeClipId: clip.id,
    };
    return clip;
  }

  private makeUniqueAnimationClipName(name: string, ignoreClipId?: string): string {
    const base = name.trim() || "clip";
    const used = new Set(
      this._blueprint.animation.clips
        .filter((clip) => clip.id !== ignoreClipId)
        .map((clip) => clip.name.toLowerCase()),
    );
    let candidate = base;
    let suffix = 2;

    while (used.has(candidate.toLowerCase())) {
      candidate = `${base} ${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  getAnimationTrack(trackId: string): AnimationTrack | undefined {
    return this.getActiveAnimationClip()?.tracks.find((track) => track.id === trackId);
  }

  getAnimationTracksForNode(nodeId: string): AnimationTrack[] {
    return this.getResolvedAnimationClipTracks(this._blueprint.animation.activeClipId).filter((track) => track.nodeId === nodeId);
  }

  getAnimationTrackForProperty(nodeId: string, property: AnimationPropertyPath): AnimationTrack | undefined {
    return this.getActiveAnimationClip()?.tracks.find((track) => track.nodeId === nodeId && track.property === property);
  }

  ensureAnimationTrack(
    nodeId: string,
    property: AnimationPropertyPath,
    source: EditorStoreChange["source"] = "ui",
  ): string {
    if (!this.getNode(nodeId)) {
      return "";
    }

    const clip = this.getAnimationClip(this._blueprint.animation.activeClipId)
      ?? this.appendAnimationClip(this.makeUniqueAnimationClipName(`clip_${this._blueprint.animation.clips.length + 1}`));
    const existing = this.getAnimationTrackForProperty(nodeId, property);
    if (existing) {
      return existing.id;
    }

    this.recordHistorySnapshot();
    const track = createAnimationTrack(nodeId, property);
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      tracks: [...entry.tracks, track],
    }));
    this.notify({ reason: "animation", source, nodeId });
    return track.id;
  }

  removeAnimationTrack(trackId: string, source: EditorStoreChange["source"] = "ui"): void {
    const track = this.getAnimationTrack(trackId);
    if (!track) {
      return;
    }
    this.recordHistorySnapshot();
    const clip = this.getActiveAnimationClip();
    if (!clip) {
      return;
    }
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      tracks: entry.tracks.filter((candidate) => candidate.id !== trackId),
    }));
    this.notify({ reason: "animation", source, nodeId: track.nodeId });
  }

  setTrackMuted(clipId: string, trackId: string, muted: boolean, source: EditorStoreChange["source"] = "ui"): void {
    const clip = this.getAnimationClip(clipId);
    const track = clip?.tracks.find((entry) => entry.id === trackId);
    if (!clip || !track) {
      return;
    }

    const currentMuted = track.muted === true;
    if (currentMuted === muted) {
      return;
    }

    this.recordHistorySnapshot();
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      tracks: entry.tracks.map((candidate) => {
        if (candidate.id !== trackId) {
          return candidate;
        }
        if (muted) {
          return { ...candidate, muted: true };
        }
        const { muted: _omit, ...rest } = candidate;
        return rest;
      }),
    }));
    this.notify({ reason: "animation", source, nodeId: track.nodeId });
  }

  addAnimationKeyframe(
    trackId: string,
    frame: number,
    value?: number,
    ease: AnimationEasePreset = DEFAULT_ANIMATION_EASE,
    source: EditorStoreChange["source"] = "ui",
  ): string {
    const track = this.getAnimationTrack(trackId);
    const node = track ? this.getNode(track.nodeId) : undefined;
    if (!track || !node) {
      return "";
    }

    const clip = this.getActiveAnimationClip();
    if (!clip) {
      return "";
    }
    const normalizedFrame = Math.max(0, Math.min(Math.round(frame), clip.durationFrames));
    const nextValue = typeof value === "number" && Number.isFinite(value)
      ? normalizeAnimationValueForProperty(track.property, value)
      : getAnimationValue(node, track.property);

    this.recordHistorySnapshot();
    const keyframe = createAnimationKeyframe(normalizedFrame, nextValue, ease);
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      tracks: entry.tracks.map((candidate) =>
        candidate.id === trackId
          ? {
              ...candidate,
              keyframes: sortTrackKeyframes([
                ...candidate.keyframes.filter((keyCandidate) => keyCandidate.frame !== normalizedFrame),
                keyframe,
              ]),
            }
          : candidate),
    }));
    this.notify({ reason: "animation", source, nodeId: track.nodeId });
    return keyframe.id;
  }

  updateAnimationKeyframe(
    trackId: string,
    keyframeId: string,
    patch: Partial<Pick<AnimationKeyframe, "frame" | "value" | "ease">>,
    source: EditorStoreChange["source"] = "ui",
  ): void {
    const track = this.getAnimationTrack(trackId);
    const keyframe = track?.keyframes.find((entry) => entry.id === keyframeId);
    if (!track || !keyframe) {
      return;
    }

    const clip = this.getActiveAnimationClip();
    if (!clip) {
      return;
    }
    const nextFrame = typeof patch.frame === "number" && Number.isFinite(patch.frame)
      ? Math.max(0, Math.min(Math.round(patch.frame), clip.durationFrames))
      : keyframe.frame;
    const nextValue = typeof patch.value === "number" && Number.isFinite(patch.value)
      ? normalizeAnimationValueForProperty(track.property, patch.value)
      : keyframe.value;
    const nextEase = typeof patch.ease === "string" && isAnimationEasePreset(patch.ease)
      ? patch.ease
      : keyframe.ease;

    if (nextFrame === keyframe.frame && nextValue === keyframe.value && nextEase === keyframe.ease) {
      return;
    }

    this.recordHistorySnapshot();
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      tracks: entry.tracks.map((candidate) => {
        if (candidate.id !== trackId) {
          return candidate;
        }

        const nextKeyframes = candidate.keyframes
          .filter((keyCandidate) => keyCandidate.id === keyframeId || keyCandidate.frame !== nextFrame)
          .map((keyCandidate) => keyCandidate.id === keyframeId
            ? { ...keyCandidate, frame: nextFrame, value: nextValue, ease: nextEase }
            : keyCandidate);

        return {
          ...candidate,
          keyframes: sortTrackKeyframes(nextKeyframes),
        };
      }),
    }));
    this.notify({ reason: "animation", source, nodeId: track.nodeId });
  }

  removeAnimationKeyframe(trackId: string, keyframeId: string, source: EditorStoreChange["source"] = "ui"): void {
    const track = this.getAnimationTrack(trackId);
    if (!track || !track.keyframes.some((entry) => entry.id === keyframeId)) {
      return;
    }
    this.recordHistorySnapshot();
    const clip = this.getActiveAnimationClip();
    if (!clip) {
      return;
    }
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      tracks: entry.tracks.map((candidate) =>
        candidate.id === trackId
          ? { ...candidate, keyframes: candidate.keyframes.filter((keyCandidate) => keyCandidate.id !== keyframeId) }
          : candidate),
    }));
    this.notify({ reason: "animation", source, nodeId: track.nodeId });
  }

  removeAnimationKeyframes(trackId: string, keyframeIds: string[], source: EditorStoreChange["source"] = "ui"): void {
    if (keyframeIds.length === 0) {
      return;
    }
    const track = this.getAnimationTrack(trackId);
    if (!track) {
      return;
    }
    const targetIds = new Set(keyframeIds);
    const hasAny = track.keyframes.some((entry) => targetIds.has(entry.id));
    if (!hasAny) {
      return;
    }
    const clip = this.getActiveAnimationClip();
    if (!clip) {
      return;
    }

    this.recordHistorySnapshot();
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      tracks: entry.tracks.map((candidate) =>
        candidate.id === trackId
          ? { ...candidate, keyframes: candidate.keyframes.filter((keyCandidate) => !targetIds.has(keyCandidate.id)) }
          : candidate),
    }));
    this.notify({ reason: "animation", source, nodeId: track.nodeId });
  }

  shiftAnimationKeyframes(
    trackId: string,
    keyframeIds: string[],
    frameDelta: number,
    source: EditorStoreChange["source"] = "ui",
  ): void {
    if (keyframeIds.length === 0 || !Number.isFinite(frameDelta) || Math.round(frameDelta) === 0) {
      return;
    }
    const track = this.getAnimationTrack(trackId);
    if (!track) {
      return;
    }
    const targetIds = new Set(keyframeIds);
    const hasAny = track.keyframes.some((entry) => targetIds.has(entry.id));
    if (!hasAny) {
      return;
    }
    const clip = this.getActiveAnimationClip();
    if (!clip) {
      return;
    }

    const delta = Math.round(frameDelta);
    this.recordHistorySnapshot();
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      tracks: entry.tracks.map((candidate) => {
        if (candidate.id !== trackId) {
          return candidate;
        }

        const shifted = candidate.keyframes.map((keyCandidate) => targetIds.has(keyCandidate.id)
          ? { ...keyCandidate, frame: Math.max(0, Math.min(keyCandidate.frame + delta, entry.durationFrames)) }
          : keyCandidate);

        // Collision policy: shifted keyframes win over stationary ones on the same frame (last-wins);
        // when multiple shifted keyframes collide, the later one in array order wins.
        const shiftedIds = new Set(
          shifted.filter((keyCandidate) => targetIds.has(keyCandidate.id)).map((keyCandidate) => keyCandidate.id),
        );
        const framesOfShifted = new Map<number, string>();
        for (const keyCandidate of shifted) {
          if (shiftedIds.has(keyCandidate.id)) {
            framesOfShifted.set(keyCandidate.frame, keyCandidate.id);
          }
        }

        const merged = shifted.filter((keyCandidate) => {
          if (shiftedIds.has(keyCandidate.id)) {
            return true;
          }
          const winnerId = framesOfShifted.get(keyCandidate.frame);
          return winnerId === undefined;
        });

        return {
          ...candidate,
          keyframes: sortTrackKeyframes(merged),
        };
      }),
    }));
    this.notify({ reason: "animation", source, nodeId: track.nodeId });
  }

  updateAnimationKeyframes(
    trackId: string,
    keyframeIds: string[],
    patch: { ease?: AnimationEasePreset; value?: number },
    source: EditorStoreChange["source"] = "ui",
  ): void {
    if (keyframeIds.length === 0) {
      return;
    }
    const track = this.getAnimationTrack(trackId);
    if (!track) {
      return;
    }
    const targetIds = new Set(keyframeIds);
    const hasAny = track.keyframes.some((entry) => targetIds.has(entry.id));
    if (!hasAny) {
      return;
    }

    const nextEase = typeof patch.ease === "string" && isAnimationEasePreset(patch.ease) ? patch.ease : undefined;
    const hasValue = typeof patch.value === "number" && Number.isFinite(patch.value);
    if (nextEase === undefined && !hasValue) {
      return;
    }
    const normalizedValue = hasValue ? normalizeAnimationValueForProperty(track.property, patch.value as number) : undefined;

    const clip = this.getActiveAnimationClip();
    if (!clip) {
      return;
    }

    this.recordHistorySnapshot();
    this.updateAnimationClip(clip.id, (entry) => ({
      ...entry,
      tracks: entry.tracks.map((candidate) => {
        if (candidate.id !== trackId) {
          return candidate;
        }

        const nextKeyframes = candidate.keyframes.map((keyCandidate) => {
          if (!targetIds.has(keyCandidate.id)) {
            return keyCandidate;
          }
          return {
            ...keyCandidate,
            ease: nextEase ?? keyCandidate.ease,
            value: normalizedValue !== undefined ? normalizedValue : keyCandidate.value,
          };
        });

        return {
          ...candidate,
          keyframes: sortTrackKeyframes(nextKeyframes),
        };
      }),
    }));
    this.notify({ reason: "animation", source, nodeId: track.nodeId });
  }

  loadBlueprint(rawBlueprint: unknown, source: EditorStoreChange["source"] = "import"): void {
    this.recordHistorySnapshot();
    this._blueprint = normalizeBlueprint(rawBlueprint);
    this._selectedNodeId = this._blueprint.nodes[0]?.id ?? ROOT_NODE_ID;
    this._selectedNodeIds = this.sanitizeSelectionIds([this._selectedNodeId], this._selectedNodeId);
    this.ensureUniqueBindingKeys();
    this.notify({ reason: "import", source });
  }

  selectNode(nodeId: string, source: EditorStoreChange["source"] = "ui", additive = false): void {
    if (!this.getNode(nodeId)) {
      return;
    }

    if (additive) {
      this.toggleNodeSelection(nodeId, source);
      return;
    }

    this.setSelectedNodes([nodeId], source, nodeId);
  }

  setSelectedNodes(
    nodeIds: string[],
    source: EditorStoreChange["source"] = "ui",
    primaryNodeId?: string,
  ): void {
    const nextNodeIds = this.sanitizeSelectionIds(nodeIds, primaryNodeId ?? this._selectedNodeId);
    const nextPrimaryId = this.resolvePrimarySelectionId(nextNodeIds, primaryNodeId ?? null);

    if (
      nextPrimaryId === this._selectedNodeId &&
      nextNodeIds.length === this._selectedNodeIds.length &&
      nextNodeIds.every((nodeId, index) => nodeId === this._selectedNodeIds[index])
    ) {
      return;
    }

    this._selectedNodeId = nextPrimaryId;
    this._selectedNodeIds = nextNodeIds;
    this.notify({ reason: "selection", source, nodeId: nextPrimaryId });
  }

  toggleNodeSelection(nodeId: string, source: EditorStoreChange["source"] = "ui"): void {
    if (!this.getNode(nodeId)) {
      return;
    }

    const nextNodeIds = [...this._selectedNodeIds];
    const currentIndex = nextNodeIds.indexOf(nodeId);

    if (currentIndex >= 0) {
      if (nextNodeIds.length === 1) {
        return;
      }
      nextNodeIds.splice(currentIndex, 1);
      this.setSelectedNodes(nextNodeIds, source, this._selectedNodeId === nodeId ? nextNodeIds.at(-1) : this._selectedNodeId);
      return;
    }

    nextNodeIds.push(nodeId);
    this.setSelectedNodes(nextNodeIds, source, nodeId);
  }

  selectAll(source: EditorStoreChange["source"] = "ui"): void {
    const selectableIds = this._blueprint.nodes
      .filter((node) => node.id !== ROOT_NODE_ID)
      .map((node) => node.id);

    if (selectableIds.length === 0) {
      this.setSelectedNodes([ROOT_NODE_ID], source, ROOT_NODE_ID);
      return;
    }

    const primaryId = selectableIds.includes(this._selectedNodeId)
      ? this._selectedNodeId
      : selectableIds[0];
    this.setSelectedNodes(selectableIds, source, primaryId);
  }

  clearSelection(source: EditorStoreChange["source"] = "ui"): void {
    this.setSelectedNodes([ROOT_NODE_ID], source, ROOT_NODE_ID);
  }

  moveSelectedNodes(
    parentId: string | null,
    siblingIndex: number,
    source: EditorStoreChange["source"] = "ui",
  ): boolean {
    const rootIds = this.getSelectionRootIds();
    const movableIds = rootIds.filter((nodeId) => nodeId !== ROOT_NODE_ID);
    if (movableIds.length === 0) {
      return false;
    }

    if (movableIds.length === 1) {
      return this.moveNode(movableIds[0], parentId, siblingIndex, source);
    }

    const targetParentId = parentId ?? ROOT_NODE_ID;
    const parent = this.getNode(targetParentId);
    if (!parent || parent.type !== "group") {
      return false;
    }

    for (const nodeId of movableIds) {
      const descendants = new Set(this.getDescendantIds(nodeId));
      if (descendants.has(targetParentId) || targetParentId === nodeId) {
        return false;
      }
    }

    this.beginHistoryTransaction();
    let anyMoved = false;
    let insertionIndex = siblingIndex;
    for (const nodeId of movableIds) {
      if (this.moveNode(nodeId, targetParentId, insertionIndex, source)) {
        anyMoved = true;
      }
      insertionIndex += 1;
    }

    if (anyMoved) {
      this.setSelectedNodes(movableIds, source, movableIds.at(-1));
      this.commitHistoryTransaction(source);
      return true;
    }

    this.commitHistoryTransaction(source);
    return false;
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
    this._selectedNodeIds = [node.id];
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
    this._selectedNodeIds = [node.id];
    this.notify({ reason: "structure", source, nodeId: node.id });
    return node.id;
  }

  pasteNodes(nodes: EditorNode[], parentId: string | null, source: EditorStoreChange["source"] = "ui"): string | null {
    return this.pasteNodeSubtrees([nodes], parentId, undefined, source)[0] ?? null;
  }

  pasteNodeSubtrees(
    subtrees: EditorNode[][],
    parentId: string | null,
    siblingIndex?: number,
    source: EditorStoreChange["source"] = "ui",
  ): string[] {
    const targetParentId = this.resolvePasteParentId(parentId);
    if (!targetParentId) {
      return [];
    }

    const normalizedSubtrees = subtrees.filter((subtree) => subtree.length > 0);
    if (normalizedSubtrees.length === 0) {
      return [];
    }

    const newRootIds: string[] = [];
    let nextNodes = this._blueprint.nodes;
    let nextSiblingIndex = typeof siblingIndex === "number" ? siblingIndex : undefined;

    this.recordHistorySnapshot();

    for (const [subtreeIndex, subtree] of normalizedSubtrees.entries()) {
      const rootNode = findClipboardRoot(subtree);
      if (!rootNode) {
        continue;
      }

      const clonedNodes = structuredClone(subtree);
      const idMap = new Map<string, string>();
      const pastedNodes: EditorNode[] = [];

      for (const node of clonedNodes) {
        idMap.set(node.id, generateId(node.type));
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

        pastedNodes.push(remappedNode);
      }

      const newRoot = pastedNodes.find((node) => node.parentId === targetParentId) ?? pastedNodes[0];
      newRoot.name = makeCopyName(newRoot.name);
      newRoot.transform.position.x += 0.45 * (subtreeIndex + 1);
      newRoot.transform.position.z += 0.45 * (subtreeIndex + 1);

      nextNodes = insertSubtreeIntoBlueprint(
        nextNodes,
        pastedNodes,
        targetParentId,
        nextSiblingIndex,
      );
      newRootIds.push(newRoot.id);

      if (typeof nextSiblingIndex === "number") {
        nextSiblingIndex += 1;
      }
    }

    if (newRootIds.length === 0) {
      return [];
    }

    this._blueprint.nodes = nextNodes;
    this._selectedNodeId = newRootIds.at(-1) ?? newRootIds[0];
    this._selectedNodeIds = [...newRootIds];
    this.ensureUniqueBindingKeys();
    this.notify({ reason: "structure", source, nodeId: this._selectedNodeId });
    return newRootIds;
  }

  groupNodes(nodeIds: string[], source: EditorStoreChange["source"] = "ui"): string | null {
    const rootIds = this.getSelectionRootIds(nodeIds);
    if (rootIds.length < 2) {
      return null;
    }

    const rootNodes = rootIds
      .map((nodeId) => this.getNode(nodeId))
      .filter((node): node is EditorNode => Boolean(node));

    const parentId = rootNodes[0]?.parentId ?? ROOT_NODE_ID;
    if (!rootNodes.every((node) => node.parentId === parentId)) {
      return null;
    }

    const siblingOrder = this.getNodeChildren(parentId)
      .map((node) => node.id)
      .filter((nodeId) => rootIds.includes(nodeId));
    const insertionIndex = siblingOrder.length > 0
      ? this.getNodeChildren(parentId).findIndex((node) => node.id === siblingOrder[0])
      : this.getNodeChildren(parentId).length;

    const movingSubtrees = rootIds.map((nodeId) => this.getSubtreeNodes(nodeId)).filter((subtree) => subtree.length > 0);
    const movingIds = new Set(movingSubtrees.flatMap((subtree) => subtree.map((node) => node.id)));
    const groupNode = createNode("group", parentId);
    groupNode.name = "Group";

    let nextNodes = insertSubtreeIntoBlueprint(
      this._blueprint.nodes.filter((node) => !movingIds.has(node.id)),
      [groupNode],
      parentId,
      insertionIndex,
    );

    for (const [index, subtree] of movingSubtrees.entries()) {
      const [rootNode] = subtree;
      if (!rootNode) {
        continue;
      }

      const movedSubtree = structuredClone(subtree);
      movedSubtree[0].parentId = groupNode.id;
      nextNodes = insertSubtreeIntoBlueprint(nextNodes, movedSubtree, groupNode.id, index);
    }

    this.recordHistorySnapshot();
    this._blueprint.nodes = nextNodes;
    this._selectedNodeId = groupNode.id;
    this._selectedNodeIds = [groupNode.id];
    this.notify({ reason: "structure", source, nodeId: groupNode.id });
    return groupNode.id;
  }

  deleteSelected(source: EditorStoreChange["source"] = "ui"): void {
    const rootIds = this.getSelectionRootIds();
    if (rootIds.length <= 1) {
      this.deleteNode(rootIds[0] ?? this._selectedNodeId, source);
      return;
    }

    const idsToDelete = new Set(rootIds.flatMap((nodeId) => [nodeId, ...this.getDescendantIds(nodeId)]));
    const fallbackParentId = this.getNode(rootIds[0])?.parentId ?? ROOT_NODE_ID;

    this.recordHistorySnapshot();
    this._blueprint.nodes = this._blueprint.nodes.filter((node) => !idsToDelete.has(node.id));
    this._blueprint.animation.clips = this._blueprint.animation.clips.map((clip) => ({
      ...clip,
      tracks: clip.tracks.filter((track) => !idsToDelete.has(track.nodeId)),
    }));
    this._selectedNodeIds = this.sanitizeSelectionIds([fallbackParentId], fallbackParentId);
    this._selectedNodeId = this.resolvePrimarySelectionId(this._selectedNodeIds, fallbackParentId);
    this.ensureUniqueBindingKeys();
    this.notify({ reason: "structure", source, nodeId: rootIds[0] });
  }

  deleteNode(nodeId: string, source: EditorStoreChange["source"] = "ui"): void {
    if (nodeId === ROOT_NODE_ID || !this.getNode(nodeId)) {
      return;
    }

    const idsToDelete = new Set([nodeId, ...this.getDescendantIds(nodeId)]);
    const removedNode = this.getNode(nodeId);

    this.recordHistorySnapshot();
    this._blueprint.nodes = this._blueprint.nodes.filter((node) => !idsToDelete.has(node.id));
    this._blueprint.animation.clips = this._blueprint.animation.clips.map((clip) => ({
      ...clip,
      tracks: clip.tracks.filter((track) => !idsToDelete.has(track.nodeId)),
    }));
    this._selectedNodeIds = this.sanitizeSelectionIds([removedNode?.parentId ?? ROOT_NODE_ID], removedNode?.parentId ?? ROOT_NODE_ID);
    this._selectedNodeId = this.resolvePrimarySelectionId(this._selectedNodeIds, removedNode?.parentId ?? ROOT_NODE_ID);
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
    this._selectedNodeIds = [nodeId];
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

  updateNodeOrigin(nodeId: string, origin: Partial<NodeOriginSpec>, source: EditorStoreChange["source"] = "ui"): void {
    const node = this.getNode(nodeId);
    if (!node || node.type === "group") {
      return;
    }

    const nextOrigin: NodeOriginSpec = {
      x: normalizeOriginHorizontal(origin.x, node.origin.x),
      y: normalizeOriginVertical(origin.y, node.origin.y),
      z: normalizeOriginDepth(origin.z, node.origin.z),
    };

    if (
      nextOrigin.x === node.origin.x &&
      nextOrigin.y === node.origin.y &&
      nextOrigin.z === node.origin.z
    ) {
      return;
    }

    const positionDelta = computeOriginPositionDelta(node, node.origin, nextOrigin, this);

    this.recordHistorySnapshot();
    node.transform.position.x += positionDelta.x;
    node.transform.position.y += positionDelta.y;
    node.transform.position.z += positionDelta.z;
    node.origin = nextOrigin;
    this.notify({ reason: "node", source, nodeId });
  }

  setGroupPivotFromPreset(
    nodeId: string,
    preset: GroupPivotPreset,
    source: EditorStoreChange["source"] = "ui",
  ): boolean {
    const node = this.getNode(nodeId);
    if (!node || node.type !== "group") {
      return false;
    }

    const contentBounds = computeGroupContentBounds(node.id, this);
    const nextOffset = contentBounds
      ? getBoundsOriginOffset(contentBounds, GROUP_PIVOT_PRESET_ORIGINS[preset])
      : createPivotOffset();
    const positionDelta = transformOffsetByTransform({
      x: node.pivotOffset.x - nextOffset.x,
      y: node.pivotOffset.y - nextOffset.y,
      z: node.pivotOffset.z - nextOffset.z,
    }, node.transform);

    if (isVec3Equal(node.pivotOffset, nextOffset) && isVec3Equal(positionDelta, createPivotOffset())) {
      return false;
    }

    this.recordHistorySnapshot();
    node.transform.position.x += positionDelta.x;
    node.transform.position.y += positionDelta.y;
    node.transform.position.z += positionDelta.z;
    node.pivotOffset = nextOffset;
    this.notify({ reason: "node", source, nodeId });
    return true;
  }

  toggleNodeVisibility(nodeId: string, source: EditorStoreChange["source"] = "ui"): void {
    const node = this.getNode(nodeId);
    if (!node) {
      return;
    }

    this.recordHistorySnapshot();
    node.visible = !node.visible;
    this.notify({ reason: "node", source, nodeId });
  }

  updateNodeProperty(nodeId: string, definition: NodePropertyDefinition, rawValue: string | number | boolean, source: EditorStoreChange["source"] = "ui"): void {
    const node = this.getNode(nodeId);
    if (!node) {
      return;
    }

    if (node.type !== "group" && definition.path.startsWith("material.")) {
      const boundMaterialId = (node as { materialId?: string }).materialId;
      if (boundMaterialId && this.getMaterial(boundMaterialId)) {
        this.updateMaterialAsset(boundMaterialId, definition, rawValue, source);
        return;
      }
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

  updateNodesProperty(
    nodeIds: string[],
    definition: NodePropertyDefinition,
    rawValue: string | number | boolean,
    source: EditorStoreChange["source"] = "ui",
  ): number {
    const uniqueNodeIds = [...new Set(nodeIds)];
    const isMaterialPath = definition.path.startsWith("material.");
    const updates: Array<{ node: EditorNode; value: unknown }> = [];
    const materialIdsToUpdate = new Set<string>();

    for (const nodeId of uniqueNodeIds) {
      const node = this.getNode(nodeId);
      if (!node) {
        continue;
      }

      if (isMaterialPath && node.type !== "group") {
        const boundMaterialId = (node as { materialId?: string }).materialId;
        if (boundMaterialId && this.getMaterial(boundMaterialId)) {
          materialIdsToUpdate.add(boundMaterialId);
          continue;
        }
      }

      const currentValue = getPropertyValue(node, definition.path);
      if (currentValue === undefined) {
        continue;
      }

      const parsedValue = parseInputValue(definition, rawValue, currentValue);
      if (Object.is(parsedValue, currentValue)) {
        continue;
      }

      updates.push({ node, value: parsedValue });
    }

    let updated = 0;
    for (const materialId of materialIdsToUpdate) {
      const didUpdate = this.updateMaterialAsset(materialId, definition, rawValue, source);
      if (didUpdate) {
        updated += this.getNodesUsingMaterial(materialId).length;
      }
    }

    if (updates.length === 0) {
      return updated;
    }

    this.recordHistorySnapshot();
    for (const { node, value } of updates) {
      setPropertyValue(node, definition.path, value);
    }

    this.notify({ reason: "node", source, nodeId: updates[0].node.id });
    return updated + updates.length;
  }

  get propertyClipboard(): PropertyClipboard | null {
    return this._propertyClipboard;
  }

  /**
   * Captures the primary selection into the in-memory property clipboard.
   * No-op if there is no primary node. Returns the captured clipboard or
   * null.
   */
  capturePropertiesFromSelection(source: EditorStoreChange["source"] = "ui"): PropertyClipboard | null {
    const primary = this.selectedNode;
    if (!primary) {
      return null;
    }

    const clipboard = capturePropertiesFromNode(primary);
    this._propertyClipboard = clipboard;
    this.notify({ reason: "propertyClipboard", source, nodeId: primary.id });
    return clipboard;
  }

  /**
   * Applies the current property clipboard to `targetNodeIds` (defaults to
   * current selection). All writes go through `updateNodeProperty` and are
   * wrapped in a single history transaction so one Paste Special = one
   * undo step.
   *
   * `material.type` entries are applied FIRST so that any subsequent PBR
   * entries land on a target whose material already matches the source.
   */
  applyPropertiesToSelection(
    scope: PropertyClipboardScope,
    targetNodeIds?: string[],
    source: EditorStoreChange["source"] = "ui",
  ): PropertyApplyReport {
    const clipboard = this._propertyClipboard;
    const resolvedIds = [...new Set(targetNodeIds ?? this._selectedNodeIds)];

    const report: PropertyApplyReport = {
      applied: 0,
      skippedIncompatible: 0,
      skippedNoChange: 0,
      perPath: {},
      perNode: {},
      targetNodeIds: resolvedIds,
    };

    if (!clipboard) {
      return report;
    }

    const targets: EditorNode[] = [];
    for (const nodeId of resolvedIds) {
      const node = this.getNode(nodeId);
      if (node) {
        targets.push(node);
      }
    }

    if (targets.length === 0) {
      return report;
    }

    interface PlannedWrite {
      node: EditorNode;
      definition: NodePropertyDefinition | null;
      value: unknown;
      sourcePath: string;
      targetPath: string;
      isMaterialType: boolean;
    }

    const planByTarget = new Map<string, PlannedWrite[]>();

    // Per-target, count incompatibilities for entries the user requested (within scope).
    for (const target of targets) {
      const resolved = resolveApplicableEntries(clipboard, target, scope);
      const applicableSourcePaths = new Set(resolved.map((r) => r.entry.path));

      // Count entries that were filtered to this scope but aren't applicable.
      const scopedEntries = clipboard.entries.filter((entry) => {
        if (scope === "all") {
          return true;
        }
        return entry.scope === scope;
      });

      for (const entry of scopedEntries) {
        if (!applicableSourcePaths.has(entry.path)) {
          this.recordReportBucket(report, entry.path, target.id, "incompatible");
        }
      }

      // Determine the target's projected material type post-apply so that
      // PBR entries (which depend on material.type) are not rejected at
      // plan time for a target that will be promoted by this same apply.
      const materialTypeEntry = resolved.find((item) => item.targetPath === "material.type");
      const projectedMaterialType = materialTypeEntry
        ? projectTargetMaterialType(target, materialTypeEntry.entry.value)
        : target.type === "group"
          ? null
          : target.material.type;

      const definitions = getPropertyDefinitions(target);
      const writes: PlannedWrite[] = [];

      for (const item of resolved) {
        const definition = definitions.find((def) => def.path === item.targetPath);
        if (!definition) {
          // Target does not expose this path under its CURRENT state. If it
          // is a PBR path and the projected material type after applying
          // `material.type` will be `standard`, defer definition lookup to
          // write time (by then material.type has already landed). Otherwise
          // it is a genuine incompatibility.
          if (
            MATERIAL_PBR_DEPENDENT_PATHS.has(item.targetPath) &&
            projectedMaterialType === "standard" &&
            target.type !== "group"
          ) {
            writes.push({
              node: target,
              definition: null,
              value: item.entry.value,
              sourcePath: item.entry.path,
              targetPath: item.targetPath,
              isMaterialType: false,
            });
            continue;
          }
          this.recordReportBucket(report, item.entry.path, target.id, "incompatible");
          continue;
        }

        writes.push({
          node: target,
          definition,
          value: item.entry.value,
          sourcePath: item.entry.path,
          targetPath: item.targetPath,
          isMaterialType: item.targetPath === "material.type",
        });
      }

      planByTarget.set(target.id, writes);
    }

    // Material type changes must be applied first so subsequent PBR writes
    // see the post-change definitions.
    const orderedPlans: PlannedWrite[] = [];
    for (const target of targets) {
      const writes = planByTarget.get(target.id) ?? [];
      for (const write of writes) {
        if (write.isMaterialType) {
          orderedPlans.push(write);
        }
      }
    }
    for (const target of targets) {
      const writes = planByTarget.get(target.id) ?? [];
      for (const write of writes) {
        if (!write.isMaterialType) {
          orderedPlans.push(write);
        }
      }
    }

    if (orderedPlans.length === 0 && report.skippedIncompatible === 0) {
      // Nothing to do at all — don't emit a history transaction.
      return report;
    }

    this.beginHistoryTransaction();
    let anyWritten = false;

    for (const write of orderedPlans) {
      const before = getPropertyValue(write.node, write.targetPath);
      // Re-resolve the definition for material-dependent paths post
      // material.type change; the node object was mutated in place.
      const definitions = getPropertyDefinitions(write.node);
      const liveDefinition = definitions.find((def) => def.path === write.targetPath);
      if (!liveDefinition) {
        this.recordReportBucket(report, write.sourcePath, write.node.id, "incompatible");
        continue;
      }

      const rawValue = this.coerceRawValue(write.value);
      const parsedValue = parseInputValue(liveDefinition, rawValue, before);

      if (deepEqualValue(parsedValue, before)) {
        this.recordReportBucket(report, write.sourcePath, write.node.id, "noChange");
        continue;
      }

      // Write through the validated rail; parseInputValue already ran, but
      // updateNodeProperty will re-run it to keep the invariant in one place.
      this.updateNodeProperty(write.node.id, liveDefinition, rawValue, source);
      // Verify the value actually changed — guard against updateNodeProperty
      // short-circuiting on a parsed-equal scenario.
      const after = getPropertyValue(write.node, write.targetPath);
      if (deepEqualValue(after, before)) {
        this.recordReportBucket(report, write.sourcePath, write.node.id, "noChange");
        continue;
      }

      anyWritten = true;
      this.recordReportBucket(report, write.sourcePath, write.node.id, "applied");
    }

    if (anyWritten) {
      this.commitHistoryTransaction(source);
    } else {
      // Roll back the transaction — nothing useful happened.
      this._activeHistorySnapshot = null;
      this._activeHistoryDirty = false;
    }

    return report;
  }

  /**
   * True iff the clipboard exists AND at least one entry can be applied to
   * the given targets under `scope`.
   */
  canPasteProperties(scope: PropertyClipboardScope, targetNodeIds?: string[]): boolean {
    const clipboard = this._propertyClipboard;
    if (!clipboard) {
      return false;
    }

    const resolvedIds = targetNodeIds ?? this._selectedNodeIds;
    for (const nodeId of resolvedIds) {
      const node = this.getNode(nodeId);
      if (!node) {
        continue;
      }
      if (resolveApplicableEntries(clipboard, node, scope).length > 0) {
        return true;
      }
    }
    return false;
  }

  private recordReportBucket(
    report: PropertyApplyReport,
    path: string,
    nodeId: string,
    kind: "applied" | "incompatible" | "noChange",
  ): void {
    if (!report.perPath[path]) {
      report.perPath[path] = { applied: 0, incompatible: 0, noChange: 0 };
    }
    if (!report.perNode[nodeId]) {
      report.perNode[nodeId] = { applied: 0, incompatible: 0, noChange: 0 };
    }

    if (kind === "applied") {
      report.applied += 1;
      report.perPath[path].applied += 1;
      report.perNode[nodeId].applied += 1;
    } else if (kind === "incompatible") {
      report.skippedIncompatible += 1;
      report.perPath[path].incompatible += 1;
      report.perNode[nodeId].incompatible += 1;
    } else {
      report.skippedNoChange += 1;
      report.perPath[path].noChange += 1;
      report.perNode[nodeId].noChange += 1;
    }
  }

  private coerceRawValue(value: unknown): string | number | boolean {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    return String(value ?? "");
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

  createMaterial(
    options: { name?: string; spec?: MaterialSpec } = {},
    source: EditorStoreChange["source"] = "ui",
  ): string {
    const baseSpec = options.spec ? cloneMaterialSpec(options.spec) : createMaterialSpec();
    const id = generateId("material");
    const proposedName = (options.name ?? "").trim() || this.makeUniqueMaterialName("Material");
    const name = this.makeUniqueMaterialName(proposedName);

    this.recordHistorySnapshot();
    this._blueprint.materials.push({ id, name, spec: baseSpec });
    this.notify({ reason: "material", source });
    return id;
  }

  createMaterialFromNode(
    nodeId: string,
    options: { name?: string; assignToNode?: boolean } = {},
    source: EditorStoreChange["source"] = "ui",
  ): string | null {
    const node = this.getNode(nodeId);
    if (!node || node.type === "group") {
      return null;
    }
    const proposed = (options.name ?? "").trim() || `${node.name} Material`;
    const id = generateId("material");
    const name = this.makeUniqueMaterialName(proposed);

    this.recordHistorySnapshot();
    this._blueprint.materials.push({ id, name, spec: cloneMaterialSpec(node.material) });
    if (options.assignToNode !== false) {
      (node as { materialId?: string }).materialId = id;
    }
    this.notify({ reason: "material", source, nodeId });
    return id;
  }

  renameMaterial(
    materialId: string,
    nextName: string,
    source: EditorStoreChange["source"] = "ui",
  ): boolean {
    const asset = this.getMaterial(materialId);
    if (!asset) {
      return false;
    }
    const proposed = nextName.trim();
    if (!proposed || proposed === asset.name) {
      return false;
    }
    const unique = this.makeUniqueMaterialName(proposed, materialId);

    this.recordHistorySnapshot();
    asset.name = unique;
    this.notify({ reason: "material", source });
    return true;
  }

  updateMaterialAsset(
    materialId: string,
    definition: NodePropertyDefinition,
    rawValue: string | number | boolean,
    source: EditorStoreChange["source"] = "ui",
  ): boolean {
    const asset = this.getMaterial(materialId);
    if (!asset) {
      return false;
    }
    if (!definition.path.startsWith("material.")) {
      return false;
    }
    const subPath = definition.path.slice("material.".length);
    const specRecord = asset.spec as unknown as Record<string, unknown>;
    const currentValue = specRecord[subPath];
    const parsedValue = parseInputValue(definition, rawValue, currentValue);
    if (Object.is(parsedValue, currentValue)) {
      return false;
    }

    this.recordHistorySnapshot();
    specRecord[subPath] = parsedValue;
    for (const node of this.getNodesUsingMaterial(materialId)) {
      if (node.type === "group") {
        continue;
      }
      (node.material as unknown as Record<string, unknown>)[subPath] = parsedValue;
    }
    this.notify({ reason: "material", source });
    return true;
  }

  assignMaterialToNodes(
    nodeIds: string[],
    materialId: string,
    source: EditorStoreChange["source"] = "ui",
  ): number {
    const asset = this.getMaterial(materialId);
    if (!asset) {
      return 0;
    }
    const targets: Exclude<EditorNode, { type: "group" }>[] = [];
    for (const nodeId of [...new Set(nodeIds)]) {
      const node = this.getNode(nodeId);
      if (!node || node.type === "group") {
        continue;
      }
      targets.push(node);
    }
    if (targets.length === 0) {
      return 0;
    }

    this.recordHistorySnapshot();
    for (const node of targets) {
      node.materialId = materialId;
      node.material = cloneMaterialSpec(asset.spec);
    }
    this.notify({ reason: "material", source, nodeId: targets[0].id });
    return targets.length;
  }

  unassignMaterialFromNodes(
    nodeIds: string[],
    source: EditorStoreChange["source"] = "ui",
  ): number {
    const targets: EditorNode[] = [];
    for (const nodeId of [...new Set(nodeIds)]) {
      const node = this.getNode(nodeId);
      if (!node || node.type === "group") {
        continue;
      }
      if ((node as { materialId?: string }).materialId === undefined) {
        continue;
      }
      targets.push(node);
    }
    if (targets.length === 0) {
      return 0;
    }

    this.recordHistorySnapshot();
    for (const node of targets) {
      delete (node as { materialId?: string }).materialId;
    }
    this.notify({ reason: "material", source, nodeId: targets[0].id });
    return targets.length;
  }

  removeMaterial(
    materialId: string,
    source: EditorStoreChange["source"] = "ui",
  ): boolean {
    const index = this._blueprint.materials.findIndex((material) => material.id === materialId);
    if (index < 0) {
      return false;
    }

    this.recordHistorySnapshot();
    this._blueprint.materials.splice(index, 1);
    for (const node of this._blueprint.nodes) {
      if (node.type === "group") {
        continue;
      }
      if ((node as { materialId?: string }).materialId === materialId) {
        delete (node as { materialId?: string }).materialId;
      }
    }
    this.notify({ reason: "material", source });
    return true;
  }

  private makeUniqueMaterialName(proposed: string, excludeId: string | null = null): string {
    const base = proposed.trim() || "Material";
    const taken = new Set(
      this._blueprint.materials
        .filter((material) => material.id !== excludeId)
        .map((material) => material.name),
    );
    if (!taken.has(base)) {
      return base;
    }
    let counter = 2;
    while (taken.has(`${base} ${counter}`)) {
      counter += 1;
    }
    return `${base} ${counter}`;
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
    return this._blueprint.nodes.flatMap((node) => {
      const visiblePaths = new Set(getPropertyDefinitions(node).map((definition) => definition.path));
      return Object.values(node.editable)
        .filter((binding) => visiblePaths.has(binding.path))
        .map((binding) => ({ node, binding }));
    });
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

  private sanitizeSelectionIds(nodeIds: string[], fallbackNodeId: string): string[] {
    const nextNodeIds: string[] = [];
    const seen = new Set<string>();

    for (const nodeId of nodeIds) {
      if (!this.getNode(nodeId) || seen.has(nodeId)) {
        continue;
      }

      seen.add(nodeId);
      nextNodeIds.push(nodeId);
    }

    if (nextNodeIds.length > 0) {
      return nextNodeIds;
    }

    const fallbackId = this.getNode(fallbackNodeId)?.id ?? this._blueprint.nodes[0]?.id ?? ROOT_NODE_ID;
    return this.getNode(fallbackId) ? [fallbackId] : [];
  }

  private resolvePrimarySelectionId(nodeIds: string[], preferredNodeId: string | null): string {
    if (preferredNodeId && nodeIds.includes(preferredNodeId)) {
      return preferredNodeId;
    }

    return nodeIds.at(-1) ?? this._blueprint.nodes[0]?.id ?? ROOT_NODE_ID;
  }

  private hasSelectedAncestor(nodeId: string | null, selection: Set<string>): boolean {
    let currentNodeId = nodeId;
    while (currentNodeId) {
      if (selection.has(currentNodeId)) {
        return true;
      }

      currentNodeId = this.getNode(currentNodeId)?.parentId ?? null;
    }

    return false;
  }

  private snapshotState(): EditorStoreSnapshot {
    return {
      blueprint: structuredClone(this._blueprint),
      selectedNodeId: this._selectedNodeId,
      selectedNodeIds: [...this._selectedNodeIds],
    };
  }

  private restoreSnapshot(snapshot: EditorStoreSnapshot): void {
    this._blueprint = structuredClone(snapshot.blueprint);
    this._selectedNodeIds = this.sanitizeSelectionIds(snapshot.selectedNodeIds, snapshot.selectedNodeId);
    this._selectedNodeId = this.resolvePrimarySelectionId(this._selectedNodeIds, snapshot.selectedNodeId);
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

/**
 * PBR paths whose applicability depends on the resolved material type of
 * the target. When a `material.type` entry is in the plan for a target,
 * these paths must be re-evaluated against the projected post-apply type
 * rather than the target's current type (see `applyPropertiesToSelection`).
 */
const MATERIAL_PBR_DEPENDENT_PATHS: ReadonlySet<string> = new Set<string>([
  "material.emissive",
  "material.roughness",
  "material.metalness",
]);

/**
 * Returns the material type the target will have after applying the given
 * clipboard entry value for `material.type`. Non-group nodes only. Falls
 * back to the target's current type if the entry is missing or malformed.
 */
function projectTargetMaterialType(
  target: EditorNode,
  materialTypeValue: unknown,
): "basic" | "standard" | null {
  if (target.type === "group") {
    return null;
  }
  if (typeof materialTypeValue === "string" && (materialTypeValue === "basic" || materialTypeValue === "standard")) {
    return materialTypeValue;
  }
  return target.material.type;
}

function deepEqualValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualValue(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) {
        return false;
      }
      if (
        !deepEqualValue(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      ) {
        return false;
      }
    }
    return true;
  }

  return false;
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
