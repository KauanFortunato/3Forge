import type { EditorNodeType, MaterialType } from "./types";

/**
 * NodeType alias exposed for external consumers that refer to the matrix
 * in terms of a generic "NodeType" (e.g. the clipboard module).
 */
export type NodeType = EditorNodeType;

/**
 * Result describing whether a property path from a source node is compatible
 * with a target node.
 *
 * - "applicable" means the same path exists on the target with the same semantic.
 * - "alias" means the target stores the same semantic value under a different
 *   path (e.g. `plane.width` ↔ `image.width`).
 * - "unsupported" means the path cannot be transferred; `reason` explains why.
 */
export type CompatibilityResult =
  | { status: "applicable"; targetPath: string }
  | { status: "alias"; targetPath: string }
  | { status: "unsupported"; reason: string };

export interface CompatibilityContext {
  sourceMaterialType?: MaterialType;
  targetMaterialType?: MaterialType;
}

const NON_GROUP_TYPES: ReadonlyArray<Exclude<EditorNodeType, "group">> = [
  "box",
  "sphere",
  "circle",
  "cylinder",
  "plane",
  "text",
  "image",
];

/**
 * Transform and origin paths: fully cross-compatible across every node type
 * (including `group`). Kept as a flat, data-driven list so adding a new axis
 * is a one-line change.
 */
const TRANSFORM_PATHS: ReadonlyArray<string> = [
  "transform.position.x",
  "transform.position.y",
  "transform.position.z",
  "transform.rotation.x",
  "transform.rotation.y",
  "transform.rotation.z",
  "transform.scale.x",
  "transform.scale.y",
  "transform.scale.z",
  "origin.x",
  "origin.y",
  "origin.z",
];

/**
 * Top-level, non-group-excluded node properties.
 */
const NODE_TOP_LEVEL_PATHS: ReadonlyArray<string> = ["visible"];

/**
 * Material paths that every non-group node exposes regardless of material
 * type. `material.type` itself is included — swapping types downstream changes
 * which PBR paths are applicable; callers (clipboard) must re-evaluate any
 * queued PBR paths after applying a `material.type` change.
 */
const MATERIAL_COMMON_PATHS: ReadonlyArray<string> = [
  "material.type",
  "material.side",
  "material.mapImageId",
  "material.color",
  "material.opacity",
  "material.transparent",
  "material.visible",
  "material.alphaTest",
  "material.depthTest",
  "material.depthWrite",
  "material.toneMapped",
  "material.wireframe",
];

const MATERIAL_SHADOW_PATHS: ReadonlyArray<string> = [
  "material.castShadow",
  "material.receiveShadow",
];

/**
 * Material paths whose availability depends on the selected material type.
 */
const MATERIAL_STANDARD_PATHS: ReadonlyArray<string> = [
  "material.emissive",
  "material.emissiveIntensity",
  "material.roughness",
  "material.metalness",
  "material.envMapIntensity",
];

const MATERIAL_PHYSICAL_PATHS: ReadonlyArray<string> = [
  "material.ior",
  "material.transmission",
  "material.thickness",
  "material.clearcoat",
  "material.clearcoatRoughness",
];

const MATERIAL_TYPE_ADVANCED_PATHS: ReadonlyArray<string> = [
  "material.flatShading",
  "material.fog",
];

/**
 * Per-type geometry path table (groups have none).
 */
const GEOMETRY_PATHS: Record<Exclude<EditorNodeType, "group">, ReadonlyArray<string>> = {
  box: ["geometry.width", "geometry.height", "geometry.depth"],
  circle: [
    "geometry.radius",
    "geometry.segments",
    "geometry.thetaStarts",
    "geometry.thetaLenght",
  ],
  sphere: ["geometry.radius"],
  cylinder: ["geometry.radiusTop", "geometry.radiusBottom", "geometry.height"],
  plane: ["geometry.width", "geometry.height"],
  image: ["geometry.width", "geometry.height"],
  text: [
    "geometry.text",
    "geometry.size",
    "geometry.depth",
    "geometry.curveSegments",
    "geometry.bevelEnabled",
    "geometry.bevelThickness",
    "geometry.bevelSize",
  ],
};

/**
 * Whitelist of cross-type geometry aliases. Keyed by "sourceType->targetType".
 * Each entry maps a source geometry path to the semantically equivalent
 * target geometry path. Entries are defined in both directions to keep
 * `isPathCompatible` symmetric without dynamic look-ups.
 *
 * Intentionally narrow: only aliases with a clear, matching physical meaning
 * are listed. For example, `sphere.radius` ↔ `cylinder.radiusTop` is *not*
 * listed because the two radii control different axes of the shape.
 */
const GEOMETRY_ALIASES: Record<string, Record<string, string>> = {
  "plane->image": {
    "geometry.width": "geometry.width",
    "geometry.height": "geometry.height",
  },
  "image->plane": {
    "geometry.width": "geometry.width",
    "geometry.height": "geometry.height",
  },
  "sphere->circle": {
    "geometry.radius": "geometry.radius",
  },
  "circle->sphere": {
    "geometry.radius": "geometry.radius",
  },
  "cylinder->box": {
    "geometry.height": "geometry.height",
  },
  "box->cylinder": {
    "geometry.height": "geometry.height",
  },
};

function isNonGroup(type: EditorNodeType): type is Exclude<EditorNodeType, "group"> {
  return type !== "group";
}

function geometryPathsFor(type: EditorNodeType): ReadonlyArray<string> {
  if (!isNonGroup(type)) {
    return [];
  }
  return GEOMETRY_PATHS[type];
}

function hasPath(list: ReadonlyArray<string>, path: string): boolean {
  return list.indexOf(path) !== -1;
}

function isMaterialPath(path: string): boolean {
  return path.startsWith("material.");
}

function isGeometryPath(path: string): boolean {
  return path.startsWith("geometry.");
}

function isTransformPath(path: string): boolean {
  return path.startsWith("transform.") || path.startsWith("origin.");
}

function classifyMaterialPath(path: string): "common" | "shadow" | "typed" | "unknown" {
  if (hasPath(MATERIAL_COMMON_PATHS, path)) {
    return "common";
  }
  if (hasPath(MATERIAL_SHADOW_PATHS, path)) {
    return "shadow";
  }
  if (
    hasPath(MATERIAL_STANDARD_PATHS, path)
    || hasPath(MATERIAL_PHYSICAL_PATHS, path)
    || hasPath(MATERIAL_TYPE_ADVANCED_PATHS, path)
  ) {
    return "typed";
  }
  return "unknown";
}

function materialTypeSupportsPath(materialType: MaterialType, path: string): boolean {
  if (hasPath(MATERIAL_COMMON_PATHS, path) || hasPath(MATERIAL_SHADOW_PATHS, path)) {
    return true;
  }
  if (hasPath(MATERIAL_PHYSICAL_PATHS, path)) {
    return materialType === "physical";
  }
  if (path === "material.roughness" || path === "material.metalness" || path === "material.envMapIntensity") {
    return materialType === "standard" || materialType === "physical";
  }
  if (path === "material.emissive" || path === "material.emissiveIntensity") {
    return materialType === "standard"
      || materialType === "physical"
      || materialType === "toon"
      || materialType === "lambert"
      || materialType === "phong";
  }
  if (path === "material.flatShading") {
    return materialType === "standard"
      || materialType === "physical"
      || materialType === "lambert"
      || materialType === "phong"
      || materialType === "normal";
  }
  if (path === "material.fog") {
    return materialType === "basic"
      || materialType === "standard"
      || materialType === "physical"
      || materialType === "toon"
      || materialType === "lambert"
      || materialType === "phong";
  }
  return false;
}

/**
 * Resolves compatibility for a single `sourcePath` between a `sourceType` and
 * `targetType`.
 *
 * Note about `material.type`: this path is always `applicable` between two
 * non-group nodes, but applying it may change the applicability of the
 * dependent PBR paths (`material.emissive`, `material.roughness`,
 * `material.metalness`). Downstream consumers (e.g. the clipboard) must
 * re-evaluate any queued PBR paths after a `material.type` change is applied.
 */
export function isPathCompatible(
  sourceType: EditorNodeType,
  targetType: EditorNodeType,
  sourcePath: string,
  context: CompatibilityContext = {},
): CompatibilityResult {
  if (isTransformPath(sourcePath)) {
    if (hasPath(TRANSFORM_PATHS, sourcePath)) {
      return { status: "applicable", targetPath: sourcePath };
    }
    return { status: "unsupported", reason: `unknown transform path "${sourcePath}"` };
  }

  if (hasPath(NODE_TOP_LEVEL_PATHS, sourcePath)) {
    return { status: "applicable", targetPath: sourcePath };
  }

  if (isMaterialPath(sourcePath)) {
    if (sourceType === "group") {
      return {
        status: "unsupported",
        reason: "group nodes do not have a material",
      };
    }
    if (targetType === "group") {
      return {
        status: "unsupported",
        reason: "group nodes do not have a material",
      };
    }

    const classification = classifyMaterialPath(sourcePath);
    if (classification === "unknown") {
      return { status: "unsupported", reason: `unknown material path "${sourcePath}"` };
    }

    if (classification === "typed") {
      const sourceMaterialType = context.sourceMaterialType ?? "standard";
      const targetMaterialType = context.targetMaterialType ?? "standard";
      if (!materialTypeSupportsPath(sourceMaterialType, sourcePath)) {
        return {
          status: "unsupported",
          reason: "source material type does not expose this material property",
        };
      }
      if (!materialTypeSupportsPath(targetMaterialType, sourcePath)) {
        return {
          status: "unsupported",
          reason: "target material type does not expose this material property",
        };
      }
    }

    return { status: "applicable", targetPath: sourcePath };
  }

  if (isGeometryPath(sourcePath)) {
    if (sourceType === "group" || targetType === "group") {
      return {
        status: "unsupported",
        reason: "group nodes do not have geometry",
      };
    }

    const sourceGeometry = geometryPathsFor(sourceType);
    if (!hasPath(sourceGeometry, sourcePath)) {
      return {
        status: "unsupported",
        reason: `path "${sourcePath}" does not exist on source type "${sourceType}"`,
      };
    }

    if (sourceType === targetType) {
      return { status: "applicable", targetPath: sourcePath };
    }

    const aliasKey = `${sourceType}->${targetType}`;
    const aliasMap = GEOMETRY_ALIASES[aliasKey];
    if (aliasMap && aliasMap[sourcePath] !== undefined) {
      return { status: "alias", targetPath: aliasMap[sourcePath] };
    }

    return {
      status: "unsupported",
      reason: `geometry path "${sourcePath}" has no equivalent on target type "${targetType}"`,
    };
  }

  return { status: "unsupported", reason: `unknown property path "${sourcePath}"` };
}

/**
 * Returns every path from `sourceType` that can be transferred to `targetType`.
 * The returned shape mirrors what the clipboard consumer needs: the original
 * source path, the resolved target path, and whether that resolution was a
 * direct hit or an alias.
 */
export function getCompatiblePaths(
  sourceType: EditorNodeType,
  targetType: EditorNodeType,
  context: CompatibilityContext = {},
): { path: string; targetPath: string; kind: "applicable" | "alias" }[] {
  const collected: { path: string; targetPath: string; kind: "applicable" | "alias" }[] = [];
  const sourcePaths = collectSourcePaths(sourceType, context);

  for (const path of sourcePaths) {
    const result = isPathCompatible(sourceType, targetType, path, context);
    if (result.status === "applicable" || result.status === "alias") {
      collected.push({ path, targetPath: result.targetPath, kind: result.status });
    }
  }

  return collected;
}

function collectSourcePaths(
  sourceType: EditorNodeType,
  context: CompatibilityContext,
): string[] {
  const paths: string[] = [];
  paths.push(...TRANSFORM_PATHS);
  paths.push(...NODE_TOP_LEVEL_PATHS);

  if (isNonGroup(sourceType)) {
    paths.push(...MATERIAL_COMMON_PATHS);
    paths.push(...MATERIAL_SHADOW_PATHS);

    const sourceMaterialType = context.sourceMaterialType ?? "standard";
    for (const path of [
      ...MATERIAL_STANDARD_PATHS,
      ...MATERIAL_PHYSICAL_PATHS,
      ...MATERIAL_TYPE_ADVANCED_PATHS,
    ]) {
      if (materialTypeSupportsPath(sourceMaterialType, path)) {
        paths.push(path);
      }
    }

    paths.push(...GEOMETRY_PATHS[sourceType]);
  }

  // `NON_GROUP_TYPES` is referenced for exhaustiveness of the geometry table
  // (guards against a new node type silently missing its entry).
  if (NON_GROUP_TYPES.some((t) => t === sourceType && GEOMETRY_PATHS[t] === undefined)) {
    throw new Error(`missing geometry table for node type "${sourceType}"`);
  }

  return paths;
}
