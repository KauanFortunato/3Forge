import type { MaterialAsset, MaterialSpec, MaterialType, NodePropertyDefinition } from "./types";

export const MATERIAL_TYPE_OPTIONS = [
  { label: "BasicMaterial", value: "basic" },
  { label: "LambertMaterial", value: "lambert" },
  { label: "PhongMaterial", value: "phong" },
  { label: "StandardMaterial", value: "standard" },
  { label: "PhysicalMaterial", value: "physical" },
  { label: "ToonMaterial", value: "toon" },
  { label: "NormalMaterial", value: "normal" },
  { label: "DepthMaterial", value: "depth" },
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

export const MATERIAL_SHADOW_PROPERTY_DEFINITIONS: NodePropertyDefinition[] = [
  { group: "Material", path: "material.castShadow", label: "Cast Shadow", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.receiveShadow", label: "Receive Shadow", type: "boolean", input: "checkbox" },
];

const EMISSIVE_DEFINITION: NodePropertyDefinition = {
  group: "Material", path: "material.emissive", label: "Emissive", type: "color", input: "color",
};

const STANDARD_BASE_DEFINITIONS: NodePropertyDefinition[] = [
  EMISSIVE_DEFINITION,
  { group: "Material", path: "material.roughness", label: "Roughness", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.metalness", label: "Metalness", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
];

const PHYSICAL_EXTRA_DEFINITIONS: NodePropertyDefinition[] = [
  { group: "Material", path: "material.ior", label: "IOR", type: "number", input: "number", step: 0.01, min: 1, max: 2.333 },
  { group: "Material", path: "material.transmission", label: "Transmission", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.thickness", label: "Thickness", type: "number", input: "number", step: 0.05, min: 0 },
  { group: "Material", path: "material.clearcoat", label: "Clearcoat", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.clearcoatRoughness", label: "Clearcoat Rough.", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
];

const TOON_DEFINITIONS: NodePropertyDefinition[] = [EMISSIVE_DEFINITION];

const LAMBERT_DEFINITIONS: NodePropertyDefinition[] = [EMISSIVE_DEFINITION];

const PHONG_DEFINITIONS: NodePropertyDefinition[] = [
  EMISSIVE_DEFINITION,
  { group: "Material", path: "material.specular", label: "Specular", type: "color", input: "color" },
  { group: "Material", path: "material.shininess", label: "Shininess", type: "number", input: "number", step: 1, min: 0 },
];

const MATERIAL_TYPE_DEFINITIONS: Record<MaterialType, NodePropertyDefinition[]> = {
  basic: [],
  standard: STANDARD_BASE_DEFINITIONS,
  physical: [...STANDARD_BASE_DEFINITIONS, ...PHYSICAL_EXTRA_DEFINITIONS],
  toon: TOON_DEFINITIONS,
  lambert: LAMBERT_DEFINITIONS,
  phong: PHONG_DEFINITIONS,
  normal: [],
  depth: [],
};

export function isMaterialType(value: unknown): value is MaterialType {
  return (
    value === "basic"
    || value === "standard"
    || value === "physical"
    || value === "toon"
    || value === "lambert"
    || value === "phong"
    || value === "normal"
    || value === "depth"
  );
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
    castShadow: true,
    receiveShadow: true,
    ior: 1.5,
    transmission: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.1,
    thickness: 0,
    specular: "#111111",
    shininess: 30,
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
    castShadow: typeof source.castShadow === "boolean" ? source.castShadow : true,
    receiveShadow: typeof source.receiveShadow === "boolean" ? source.receiveShadow : true,
    ior: clampNumber(normalizeNumber(source.ior, fallback.ior), 1, 2.333),
    transmission: clampNumber(normalizeNumber(source.transmission, fallback.transmission), 0, 1),
    clearcoat: clampNumber(normalizeNumber(source.clearcoat, fallback.clearcoat), 0, 1),
    clearcoatRoughness: clampNumber(normalizeNumber(source.clearcoatRoughness, fallback.clearcoatRoughness), 0, 1),
    thickness: Math.max(0, normalizeNumber(source.thickness, fallback.thickness)),
    specular: normalizeColor(String(source.specular ?? fallback.specular), fallback.specular),
    shininess: Math.max(0, normalizeNumber(source.shininess, fallback.shininess)),
  };
}

export function cloneMaterialSpec(spec: MaterialSpec): MaterialSpec {
  return { ...spec };
}

export function normalizeMaterialAsset(value: unknown, fallbackSpec: MaterialSpec): MaterialAsset | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : null;
  if (!id) {
    return null;
  }

  const name = typeof source.name === "string" && source.name.trim()
    ? source.name.trim()
    : "Material";

  return {
    id,
    name,
    spec: normalizeMaterialSpec(source.spec, fallbackSpec),
  };
}

export function normalizeMaterialLibrary(value: unknown): MaterialAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const fallbackSpec = createMaterialSpec();
  const seen = new Set<string>();
  const result: MaterialAsset[] = [];
  for (const entry of value) {
    const asset = normalizeMaterialAsset(entry, fallbackSpec);
    if (!asset || seen.has(asset.id)) {
      continue;
    }
    seen.add(asset.id);
    result.push(asset);
  }
  return result;
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
