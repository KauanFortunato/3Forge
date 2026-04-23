import { isPathCompatible } from "./propertyCompatibility";
import { getPropertyDefinitions, getPropertyValue } from "./state";
import type { EditorNode, EditorNodeType, MaterialType } from "./types";

/**
 * Top-level scope buckets used by Paste Special.
 *
 * Scope classification for capture + filtering:
 * - `transform.*` or `origin.*` -> "transform"
 * - `material.castShadow` / `material.receiveShadow` -> "shadow"
 * - `material.*` (rest, incl. `material.type`) -> "material"
 * - `geometry.*` -> "geometry"
 * - top-level `"visible"` -> "material" (see note below)
 *
 * Note on `"visible"`: we bucket the top-level `visible` flag under
 * "material" rather than giving it its own scope. The rationale is that
 * in the UX it pairs with render-facing flags (`material.visible`, shadow
 * toggles) — a user copying "material look" from node A typically expects
 * the visibility state to ride along. Transforming it would feel wrong.
 */
export type PropertyClipboardScope =
  | "all"
  | "transform"
  | "geometry"
  | "material"
  | "shadow";

export interface PropertyClipboardEntry {
  path: string;
  scope: PropertyClipboardScope;
  value: unknown;
}

export interface PropertyClipboard {
  sourceNodeId: string;
  sourceType: EditorNodeType;
  sourceMaterialType: MaterialType | null;
  capturedAt: number;
  entries: PropertyClipboardEntry[];
}

export interface PropertyApplyReport {
  applied: number;
  skippedIncompatible: number;
  skippedNoChange: number;
  perPath: Record<
    string,
    {
      applied: number;
      incompatible: number;
      noChange: number;
    }
  >;
  perNode: Record<
    string,
    {
      applied: number;
      incompatible: number;
      noChange: number;
    }
  >;
  targetNodeIds: string[];
}

const MATERIAL_SHADOW_PATHS = new Set<string>([
  "material.castShadow",
  "material.receiveShadow",
]);

const MATERIAL_TYPE_PATH = "material.type";

/**
 * Paths that must never be captured by the clipboard. Position copy would
 * teleport the target onto the source — unwanted in a 3D authoring tool.
 * This mirrors Figma's "Paste properties" convention, which also excludes
 * position. Rotation and scale stay capturable. Multi-edit of position
 * through the inspector uses a different code path (direct
 * `updateNodesProperty`) and is not affected.
 */
const NON_CAPTURABLE_PATHS: ReadonlySet<string> = new Set([
  "transform.position.x",
  "transform.position.y",
  "transform.position.z",
]);

/**
 * Maps a property path to one of the clipboard scope buckets. Returns
 * `null` for paths we do not understand (those are skipped at capture).
 */
export function classifyClipboardScope(path: string): PropertyClipboardScope | null {
  if (path.startsWith("transform.") || path.startsWith("origin.")) {
    return "transform";
  }
  if (MATERIAL_SHADOW_PATHS.has(path)) {
    return "shadow";
  }
  if (path.startsWith("material.")) {
    return "material";
  }
  if (path.startsWith("geometry.")) {
    return "geometry";
  }
  if (path === "visible") {
    return "material";
  }
  return null;
}

function resolveSourceMaterialType(source: EditorNode): MaterialType | null {
  if (source.type === "group") {
    return null;
  }
  return source.material.type;
}

/**
 * Captures every path the source node currently exposes via
 * `getPropertyDefinitions`. Scope filtering is NOT applied here — a single
 * capture can drive any Paste Special flavor downstream.
 *
 * Values are deep-cloned via `structuredClone` to avoid aliasing the source
 * node's nested objects.
 */
export function capturePropertiesFromNode(source: EditorNode): PropertyClipboard {
  const definitions = getPropertyDefinitions(source);
  const entries: PropertyClipboardEntry[] = [];

  for (const definition of definitions) {
    // Skip paths that are explicitly non-capturable (e.g. position).
    // Additional guard alongside the `classifyClipboardScope` null-skip.
    if (NON_CAPTURABLE_PATHS.has(definition.path)) {
      continue;
    }
    const scope = classifyClipboardScope(definition.path);
    if (scope === null) {
      continue;
    }
    const value = getPropertyValue(source, definition.path);
    if (value === undefined) {
      continue;
    }
    entries.push({
      path: definition.path,
      scope,
      value: structuredClone(value),
    });
  }

  return {
    sourceNodeId: source.id,
    sourceType: source.type,
    sourceMaterialType: resolveSourceMaterialType(source),
    capturedAt: Date.now(),
    entries,
  };
}

function scopeMatches(
  entryScope: PropertyClipboardScope,
  requested: PropertyClipboardScope,
): boolean {
  if (requested === "all") {
    return true;
  }
  return entryScope === requested;
}

/**
 * Resolves which entries in `clipboard` would be applied to `target` under
 * the given `scope` filter. Pure — does not mutate anything.
 *
 * Special handling for `material.type`: when the scope admits material
 * entries AND the clipboard carries a `material.type` entry, we compute
 * PBR applicability assuming the target will *first* receive the source's
 * material type. This makes the resolved list match what `applyPropertiesToSelection`
 * will actually do at write-time.
 */
export function resolveApplicableEntries(
  clipboard: PropertyClipboard,
  target: EditorNode,
  scope: PropertyClipboardScope,
): Array<{
  entry: PropertyClipboardEntry;
  targetPath: string;
  kind: "applicable" | "alias";
}> {
  const filtered = clipboard.entries.filter((entry) => scopeMatches(entry.scope, scope));
  if (filtered.length === 0) {
    return [];
  }

  const materialTypeEntry = filtered.find((entry) => entry.path === MATERIAL_TYPE_PATH);

  // Determine the material type the target will have *after* the apply, so
  // PBR paths can be evaluated against the post-apply state.
  const sourceMaterialType = clipboard.sourceMaterialType ?? undefined;
  const effectiveTargetMaterialType: MaterialType | undefined = (() => {
    if (target.type === "group") {
      return undefined;
    }
    if (materialTypeEntry && typeof materialTypeEntry.value === "string") {
      const next = materialTypeEntry.value as MaterialType;
      if (next === "basic" || next === "standard") {
        return next;
      }
    }
    return target.material.type;
  })();

  const context = {
    sourceMaterialType,
    targetMaterialType: effectiveTargetMaterialType,
  };

  const resolved: Array<{
    entry: PropertyClipboardEntry;
    targetPath: string;
    kind: "applicable" | "alias";
  }> = [];

  for (const entry of filtered) {
    const result = isPathCompatible(
      clipboard.sourceType,
      target.type,
      entry.path,
      context,
    );
    if (result.status === "applicable" || result.status === "alias") {
      resolved.push({
        entry,
        targetPath: result.targetPath,
        kind: result.status,
      });
    }
  }

  return resolved;
}

/**
 * Returns the union of scopes for which at least one entry in the
 * clipboard can be applied to at least one target. `"all"` is always
 * reported when any other scope is reportable.
 */
export function getAvailableScopes(
  clipboard: PropertyClipboard,
  targets: EditorNode[],
): PropertyClipboardScope[] {
  if (targets.length === 0 || clipboard.entries.length === 0) {
    return [];
  }

  const scopes: PropertyClipboardScope[] = ["transform", "geometry", "material", "shadow"];
  const available = new Set<PropertyClipboardScope>();

  for (const scope of scopes) {
    for (const target of targets) {
      if (resolveApplicableEntries(clipboard, target, scope).length > 0) {
        available.add(scope);
        break;
      }
    }
  }

  const result: PropertyClipboardScope[] = scopes.filter((scope) => available.has(scope));
  if (result.length > 0) {
    result.push("all");
  }
  return result;
}
