import type {
  MaterialAsset,
  MaterialDepthPacking,
  MaterialSide,
  MaterialSpec,
  MaterialType,
  NodePropertyDefinition,
} from "./types";

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

export const MATERIAL_SIDE_OPTIONS = [
  { label: "Front", value: "front" },
  { label: "Back", value: "back" },
  { label: "Double", value: "double" },
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
  {
    group: "Material",
    path: "material.side",
    label: "Side",
    type: "string",
    input: "select",
    options: [...MATERIAL_SIDE_OPTIONS],
  },
  {
    group: "Material",
    path: "material.mapImageId",
    label: "Texture",
    type: "string",
    input: "select",
    options: [{ label: "None", value: "" }],
  },
  { group: "Material", path: "material.color", label: "Color", type: "color", input: "color" },
  { group: "Material", path: "material.opacity", label: "Opacity", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.transparent", label: "Transparent", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.visible", label: "Material Visible", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.alphaTest", label: "Alpha Test", type: "number", input: "number", step: 0.01, min: 0, max: 1 },
  { group: "Material", path: "material.depthTest", label: "Depth Test", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.depthWrite", label: "Depth Write", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.toneMapped", label: "Tone Mapped", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.wireframe", label: "Wireframe", type: "boolean", input: "checkbox" },
];

const MATERIAL_FOG_DEFINITION: NodePropertyDefinition = {
  group: "Material", path: "material.fog", label: "Fog", type: "boolean", input: "checkbox",
};

const MATERIAL_FLAT_SHADING_DEFINITION: NodePropertyDefinition = {
  group: "Material", path: "material.flatShading", label: "Flat Shading", type: "boolean", input: "checkbox",
};

export const MATERIAL_SHADOW_PROPERTY_DEFINITIONS: NodePropertyDefinition[] = [
  { group: "Material", path: "material.castShadow", label: "Cast Shadow", type: "boolean", input: "checkbox" },
  { group: "Material", path: "material.receiveShadow", label: "Receive Shadow", type: "boolean", input: "checkbox" },
];

const EMISSIVE_DEFINITION: NodePropertyDefinition = {
  group: "Material", path: "material.emissive", label: "Emissive", type: "color", input: "color",
};

const EMISSIVE_INTENSITY_DEFINITION: NodePropertyDefinition = {
  group: "Material", path: "material.emissiveIntensity", label: "Emissive Int.", type: "number", input: "number", step: 0.05, min: 0,
};

const STANDARD_BASE_DEFINITIONS: NodePropertyDefinition[] = [
  EMISSIVE_DEFINITION,
  EMISSIVE_INTENSITY_DEFINITION,
  { group: "Material", path: "material.roughness", label: "Roughness", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.metalness", label: "Metalness", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.envMapIntensity", label: "Env Intensity", type: "number", input: "number", step: 0.05, min: 0 },
];

const PHYSICAL_EXTRA_DEFINITIONS: NodePropertyDefinition[] = [
  { group: "Material", path: "material.ior", label: "IOR", type: "number", input: "number", step: 0.01, min: 1, max: 2.333 },
  { group: "Material", path: "material.transmission", label: "Transmission", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.thickness", label: "Thickness", type: "number", input: "number", step: 0.05, min: 0 },
  { group: "Material", path: "material.clearcoat", label: "Clearcoat", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
  { group: "Material", path: "material.clearcoatRoughness", label: "Clearcoat Rough.", type: "number", input: "number", step: 0.05, min: 0, max: 1 },
];

const TOON_DEFINITIONS: NodePropertyDefinition[] = [EMISSIVE_DEFINITION, EMISSIVE_INTENSITY_DEFINITION, MATERIAL_FOG_DEFINITION];

const LAMBERT_DEFINITIONS: NodePropertyDefinition[] = [
  EMISSIVE_DEFINITION,
  EMISSIVE_INTENSITY_DEFINITION,
  MATERIAL_FLAT_SHADING_DEFINITION,
  MATERIAL_FOG_DEFINITION,
];

const PHONG_DEFINITIONS: NodePropertyDefinition[] = [
  EMISSIVE_DEFINITION,
  EMISSIVE_INTENSITY_DEFINITION,
  MATERIAL_FLAT_SHADING_DEFINITION,
  MATERIAL_FOG_DEFINITION,
];

const BASIC_DEFINITIONS: NodePropertyDefinition[] = [
  MATERIAL_FOG_DEFINITION,
];

const NORMAL_DEFINITIONS: NodePropertyDefinition[] = [
  MATERIAL_FLAT_SHADING_DEFINITION,
];

const DEPTH_DEFINITIONS: NodePropertyDefinition[] = [];

const MATERIAL_TYPE_DEFINITIONS: Record<MaterialType, NodePropertyDefinition[]> = {
  basic: BASIC_DEFINITIONS,
  standard: [...STANDARD_BASE_DEFINITIONS, MATERIAL_FLAT_SHADING_DEFINITION, MATERIAL_FOG_DEFINITION],
  physical: [...STANDARD_BASE_DEFINITIONS, ...PHYSICAL_EXTRA_DEFINITIONS, MATERIAL_FLAT_SHADING_DEFINITION, MATERIAL_FOG_DEFINITION],
  toon: TOON_DEFINITIONS,
  lambert: LAMBERT_DEFINITIONS,
  phong: PHONG_DEFINITIONS,
  normal: NORMAL_DEFINITIONS,
  depth: DEPTH_DEFINITIONS,
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

export function isMaterialSide(value: unknown): value is MaterialSide {
  return value === "front" || value === "back" || value === "double";
}

export function normalizeMaterialSide(value: unknown, fallback: MaterialSide = "front"): MaterialSide {
  return isMaterialSide(value) ? value : fallback;
}

export function isMaterialDepthPacking(value: unknown): value is MaterialDepthPacking {
  return value === "basic" || value === "rgba";
}

export function normalizeMaterialDepthPacking(
  value: unknown,
  fallback: MaterialDepthPacking = "basic",
): MaterialDepthPacking {
  return isMaterialDepthPacking(value) ? value : fallback;
}

export function createMaterialSpec(
  color = "#5ad3ff",
  type: MaterialType = "standard",
): MaterialSpec {
  return {
    type,
    color,
    mapImageId: undefined,
    side: "front",
    emissive: "#000000",
    emissiveIntensity: 1,
    roughness: 0.4,
    metalness: 0.1,
    opacity: 1,
    transparent: true,
    visible: true,
    alphaTest: 0,
    depthTest: true,
    depthWrite: true,
    colorWrite: true,
    dithering: false,
    flatShading: false,
    fog: true,
    toneMapped: true,
    premultipliedAlpha: false,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
    wireframe: false,
    wireframeLinewidth: 1,
    castShadow: true,
    receiveShadow: true,
    envMapIntensity: 1,
    ior: 1.5,
    transmission: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.1,
    thickness: 0,
    reflectivity: 0.5,
    iridescence: 0,
    iridescenceIOR: 1.3,
    iridescenceThicknessRangeStart: 100,
    iridescenceThicknessRangeEnd: 400,
    sheen: 0,
    sheenRoughness: 1,
    sheenColor: "#000000",
    specularIntensity: 1,
    specularColor: "#ffffff",
    attenuationDistance: 0,
    attenuationColor: "#ffffff",
    dispersion: 0,
    anisotropy: 0,
    specular: "#111111",
    shininess: 30,
    depthPacking: "basic",
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
    mapImageId: normalizeOptionalString(source.mapImageId, fallback.mapImageId),
    side: normalizeMaterialSide(source.side, fallback.side),
    emissive: normalizeColor(String(source.emissive ?? fallback.emissive), fallback.emissive),
    emissiveIntensity: Math.max(0, normalizeNumber(source.emissiveIntensity, fallback.emissiveIntensity)),
    roughness: clampNumber(normalizeNumber(source.roughness, fallback.roughness), 0, 1),
    metalness: clampNumber(normalizeNumber(source.metalness, fallback.metalness), 0, 1),
    opacity,
    transparent: typeof source.transparent === "boolean" ? source.transparent : opacity < 1 ? true : fallback.transparent,
    visible: typeof source.visible === "boolean" ? source.visible : fallback.visible,
    alphaTest: clampNumber(normalizeNumber(source.alphaTest, fallback.alphaTest), 0, 1),
    depthTest: typeof source.depthTest === "boolean" ? source.depthTest : fallback.depthTest,
    depthWrite: typeof source.depthWrite === "boolean" ? source.depthWrite : fallback.depthWrite,
    colorWrite: typeof source.colorWrite === "boolean" ? source.colorWrite : fallback.colorWrite,
    dithering: typeof source.dithering === "boolean" ? source.dithering : fallback.dithering,
    flatShading: typeof source.flatShading === "boolean" ? source.flatShading : fallback.flatShading,
    fog: typeof source.fog === "boolean" ? source.fog : fallback.fog,
    toneMapped: typeof source.toneMapped === "boolean" ? source.toneMapped : fallback.toneMapped,
    premultipliedAlpha: typeof source.premultipliedAlpha === "boolean" ? source.premultipliedAlpha : fallback.premultipliedAlpha,
    polygonOffset: typeof source.polygonOffset === "boolean" ? source.polygonOffset : fallback.polygonOffset,
    polygonOffsetFactor: normalizeNumber(source.polygonOffsetFactor, fallback.polygonOffsetFactor),
    polygonOffsetUnits: normalizeNumber(source.polygonOffsetUnits, fallback.polygonOffsetUnits),
    wireframe: typeof source.wireframe === "boolean" ? source.wireframe : fallback.wireframe,
    wireframeLinewidth: Math.max(0, normalizeNumber(source.wireframeLinewidth, fallback.wireframeLinewidth)),
    castShadow: typeof source.castShadow === "boolean" ? source.castShadow : true,
    receiveShadow: typeof source.receiveShadow === "boolean" ? source.receiveShadow : true,
    envMapIntensity: Math.max(0, normalizeNumber(source.envMapIntensity, fallback.envMapIntensity)),
    ior: clampNumber(normalizeNumber(source.ior, fallback.ior), 1, 2.333),
    transmission: clampNumber(normalizeNumber(source.transmission, fallback.transmission), 0, 1),
    clearcoat: clampNumber(normalizeNumber(source.clearcoat, fallback.clearcoat), 0, 1),
    clearcoatRoughness: clampNumber(normalizeNumber(source.clearcoatRoughness, fallback.clearcoatRoughness), 0, 1),
    thickness: Math.max(0, normalizeNumber(source.thickness, fallback.thickness)),
    reflectivity: clampNumber(normalizeNumber(source.reflectivity, fallback.reflectivity), 0, 1),
    iridescence: clampNumber(normalizeNumber(source.iridescence, fallback.iridescence), 0, 1),
    iridescenceIOR: clampNumber(normalizeNumber(source.iridescenceIOR, fallback.iridescenceIOR), 1, 2.333),
    iridescenceThicknessRangeStart: Math.max(0, normalizeNumber(source.iridescenceThicknessRangeStart, fallback.iridescenceThicknessRangeStart)),
    iridescenceThicknessRangeEnd: Math.max(0, normalizeNumber(source.iridescenceThicknessRangeEnd, fallback.iridescenceThicknessRangeEnd)),
    sheen: clampNumber(normalizeNumber(source.sheen, fallback.sheen), 0, 1),
    sheenRoughness: clampNumber(normalizeNumber(source.sheenRoughness, fallback.sheenRoughness), 0, 1),
    sheenColor: normalizeColor(String(source.sheenColor ?? fallback.sheenColor), fallback.sheenColor),
    specularIntensity: clampNumber(normalizeNumber(source.specularIntensity, fallback.specularIntensity), 0, 1),
    specularColor: normalizeColor(String(source.specularColor ?? fallback.specularColor), fallback.specularColor),
    attenuationDistance: Math.max(0, normalizeNumber(source.attenuationDistance, fallback.attenuationDistance)),
    attenuationColor: normalizeColor(String(source.attenuationColor ?? fallback.attenuationColor), fallback.attenuationColor),
    dispersion: Math.max(0, normalizeNumber(source.dispersion, fallback.dispersion)),
    anisotropy: clampNumber(normalizeNumber(source.anisotropy, fallback.anisotropy), 0, 1),
    specular: normalizeColor(String(source.specular ?? fallback.specular), fallback.specular),
    shininess: Math.max(0, normalizeNumber(source.shininess, fallback.shininess)),
    depthPacking: normalizeMaterialDepthPacking(source.depthPacking, fallback.depthPacking),
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

function normalizeOptionalString(value: unknown, fallback?: string): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return fallback;
}
