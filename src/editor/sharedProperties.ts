import { getPropertyDefinitions, getPropertyValue } from "./state";
import type { EditorNode, NodePropertyDefinition, NodePropertyPath } from "./types";

export type PropertyScope =
  | "object"
  | "transform"
  | "geometry"
  | "material"
  | "shadow"
  | "appearance"
  | "text"
  | "image"
  | "all";

export interface SharedPropertyResult {
  definitions: NodePropertyDefinition[];
  mixedPaths: Set<string>;
  includedNodeIds: string[];
  excludedNodeIds: string[];
  valuesByPath: Record<string, unknown>;
}

const EMPTY_RESULT: SharedPropertyResult = {
  definitions: [],
  mixedPaths: new Set<string>(),
  includedNodeIds: [],
  excludedNodeIds: [],
  valuesByPath: {},
};

export function classifyPropertyScope(path: NodePropertyPath): PropertyScope {
  if (path === "material.castShadow" || path === "material.receiveShadow") {
    return "shadow";
  }
  if (path.startsWith("transform.")) {
    return "transform";
  }
  if (path.startsWith("origin.")) {
    return "object";
  }
  if (path.startsWith("material.")) {
    return "material";
  }
  if (path.startsWith("geometry.")) {
    if (path === "geometry.text" || path === "geometry.size" || path === "geometry.curveSegments" || path === "geometry.bevelEnabled" || path === "geometry.bevelThickness" || path === "geometry.bevelSize") {
      return "text";
    }
    return "geometry";
  }
  if (path.startsWith("image.")) {
    return "image";
  }
  return "object";
}

export function getSharedPropertyDefinitions(
  nodes: EditorNode[],
  scope?: PropertyScope | PropertyScope[],
): SharedPropertyResult {
  if (nodes.length === 0) {
    return {
      definitions: [],
      mixedPaths: new Set<string>(),
      includedNodeIds: [],
      excludedNodeIds: [],
      valuesByPath: {},
    };
  }

  const scopes = normalizeScopes(scope);
  const shouldFilter = scopes !== null;

  const perNodeDefinitions = nodes.map((node) => filterDefinitionsByScope(getPropertyDefinitions(node), scopes));
  const perNodePaths = perNodeDefinitions.map((definitions) => new Set(definitions.map((definition) => definition.path)));

  const includedNodes: EditorNode[] = [];
  const includedPathSets: Set<string>[] = [];
  const includedDefinitionLists: NodePropertyDefinition[][] = [];
  const excludedNodeIds: string[] = [];

  if (shouldFilter) {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const paths = perNodePaths[index];

      if (paths.size === 0) {
        excludedNodeIds.push(node.id);
        continue;
      }

      const hasOverlapWithOther = nodes.length === 1
        ? true
        : perNodePaths.some((other, otherIndex) => otherIndex !== index && hasAnyOverlap(paths, other));

      if (!hasOverlapWithOther) {
        excludedNodeIds.push(node.id);
        continue;
      }

      includedNodes.push(node);
      includedPathSets.push(paths);
      includedDefinitionLists.push(perNodeDefinitions[index]);
    }
  } else {
    for (let index = 0; index < nodes.length; index += 1) {
      includedNodes.push(nodes[index]);
      includedPathSets.push(perNodePaths[index]);
      includedDefinitionLists.push(perNodeDefinitions[index]);
    }
  }

  if (includedNodes.length === 0) {
    return {
      ...EMPTY_RESULT,
      mixedPaths: new Set<string>(),
      valuesByPath: {},
      excludedNodeIds,
    };
  }

  const baseDefinitions = includedDefinitionLists[0];
  const sharedPaths = new Set<string>();
  for (const definition of baseDefinitions) {
    let sharedByAll = true;
    for (let index = 1; index < includedPathSets.length; index += 1) {
      if (!includedPathSets[index].has(definition.path)) {
        sharedByAll = false;
        break;
      }
    }
    if (sharedByAll) {
      sharedPaths.add(definition.path);
    }
  }

  const definitions = baseDefinitions.filter((definition) => sharedPaths.has(definition.path));

  const mixedPaths = new Set<string>();
  const valuesByPath: Record<string, unknown> = {};

  for (const definition of definitions) {
    const firstValue = getPropertyValue(includedNodes[0], definition.path);
    let mixed = false;
    for (let index = 1; index < includedNodes.length; index += 1) {
      const nextValue = getPropertyValue(includedNodes[index], definition.path);
      if (!deepEqual(firstValue, nextValue)) {
        mixed = true;
        break;
      }
    }
    if (mixed) {
      mixedPaths.add(definition.path);
    } else {
      valuesByPath[definition.path] = firstValue;
    }
  }

  return {
    definitions,
    mixedPaths,
    includedNodeIds: includedNodes.map((node) => node.id),
    excludedNodeIds,
    valuesByPath,
  };
}

function normalizeScopes(scope: PropertyScope | PropertyScope[] | undefined): Set<PropertyScope> | null {
  if (scope === undefined) {
    return null;
  }
  const list = Array.isArray(scope) ? scope : [scope];
  if (list.length === 0 || list.includes("all")) {
    return null;
  }
  return new Set(list);
}

function filterDefinitionsByScope(
  definitions: NodePropertyDefinition[],
  scopes: Set<PropertyScope> | null,
): NodePropertyDefinition[] {
  if (scopes === null) {
    return definitions.slice();
  }
  return definitions.filter((definition) => scopes.has(classifyPropertyScope(definition.path)));
}

function hasAnyOverlap(a: Set<string>, b: Set<string>): boolean {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of smaller) {
    if (larger.has(value)) {
      return true;
    }
  }
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (!deepEqual(a[index], b[index])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(b)) {
    return false;
  }
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}
