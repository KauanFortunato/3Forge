import type { MaterialSpec, MaterialType, NodePropertyDefinition } from "./types";

export const MATERIAL_TYPE_OPTIONS = [
  { label: "BasicMaterial", value: "basic" },
  { label: "StandardMaterial", value: "standard" },
] as const;

const MATERIAL_COMMON_PROPERTY_DEFINITIONS: NodePropertyDefinition[] = [
  {
    group: "Material",
    path: "material.type",
    label: "Type",
    type: "string",
    input: "select",
    options: [...MATERIAL_TYPE_OPTIONS],
  },
  { group: "Material", path: "material.color", label: "Color", type: "color", input: "color" },
  { group: "Material", path: "material.opacity", label: "Opacity", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.transparent", label: "Transparent", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.visible", label: "Material Visible", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.alphaTest", label: "Alpha Test", type: "number", input: "number", step: 0.01, min: 0, max: 1 },
  { group: "Material", path: "material.depthTest", label: "Depth Test", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.depthWrite", label: "Depth Write", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.wireframe", label: "Wireframe", type: "boolean", input: "checkbox" },
];

const MATERIAL_TYPE_DEFINITIONS: Record<MaterialType, NodePropertyDefinition[]> = {
  basic: [],
  standard: [
    { group: "Material", path: "material.emissive", label: "Emissive", type: "color", input: "color" },
    { group: "Material", path: "material.roughness", label: "Roughness", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
    { group: "Material", path: "material.metalness", label: "Metalness", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  ],
};

export function isMaterialType(value: unknown): value is MaterialType {
  return value === "basic" || value === "standard";
}

export function normalizeMaterialType(value: unknown, fallback: MaterialType = "standard"): MaterialType {
  return isMaterialType(value) ? value : fallback;
}

export function createMaterialSpec(
  color = "#5ad3ff",
  type: MaterialType = "standard",
): MaterialSpec {
  return {
    type,
    color,
    emissive: "#000000",
    roughness: 0.4,
    metalness: 0.1,
    opacity: 1,
    transparent: true,
    visible: true,
    alphaTest: 0,
    depthTest: true,
    depthWrite: true,
    wireframe: false,
  };
}

export function getMaterialPropertyDefinitions(materialType: MaterialType): NodePropertyDefinition[] {
  const resolvedType = normalizeMaterialType(materialType);
  return [
    ...MATERIAL_COMMON_PROPERTY_DEFINITIONS,
    ...MATERIAL_TYPE_DEFINITIONS[resolvedType],
  ];
}

export function normalizeMaterialSpec(value: unknown, fallback: MaterialSpec): MaterialSpec {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const source = value as Record<string, unknown>;
  const opacity = clampNumber(normalizeNumber(source.opacity, fallback.opacity), 0, 1);

  return {
    type: normalizeMaterialType(source.type, fallback.type),
    color: normalizeColor(String(source.color ?? fallback.color), fallback.color),
    emissive: normalizeColor(String(source.emissive ?? fallback.emissive), fallback.emissive),
    roughness: clampNumber(normalizeNumber(source.roughness, fallback.roughness), 0, 1),
    metalness: clampNumber(normalizeNumber(source.metalness, fallback.metalness), 0, 1),
    opacity,
    transparent: typeof source.transparent === "boolean" ? source.transparent : opacity < 1 ? true : fallback.transparent,
    visible: typeof source.visible === "boolean" ? source.visible : fallback.visible,
    alphaTest: clampNumber(normalizeNumber(source.alphaTest, fallback.alphaTest), 0, 1),
    depthTest: typeof source.depthTest === "boolean" ? source.depthTest : fallback.depthTest,
    depthWrite: typeof source.depthWrite === "boolean" ? source.depthWrite : fallback.depthWrite,
    wireframe: typeof source.wireframe === "boolean" ? source.wireframe : fallback.wireframe,
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
