import type { ComponentBlueprint, EditorNode, EditorNodeType, Vec3Like } from "./types";

export interface BlueprintDiffObjectRef {
  key: string;
  id?: string;
  name: string;
  type: EditorNodeType;
}

export interface BlueprintDiffFieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface BlueprintDiffChangedObject extends BlueprintDiffObjectRef {
  changes: BlueprintDiffFieldChange[];
}

export interface BlueprintDiffSummary {
  added: BlueprintDiffObjectRef[];
  removed: BlueprintDiffObjectRef[];
  changed: BlueprintDiffChangedObject[];
}

export function compareComponentBlueprints(before: ComponentBlueprint, after: ComponentBlueprint): BlueprintDiffSummary {
  const beforeNodes = indexNodesByStableKey(before.nodes);
  const afterNodes = indexNodesByStableKey(after.nodes);
  const added: BlueprintDiffObjectRef[] = [];
  const removed: BlueprintDiffObjectRef[] = [];
  const changed: BlueprintDiffChangedObject[] = [];

  for (const [key, afterNode] of afterNodes) {
    const beforeNode = beforeNodes.get(key);

    if (!beforeNode) {
      added.push(createNodeRef(afterNode, key));
      continue;
    }

    const changes = compareNodeFields(beforeNode, afterNode);

    if (changes.length > 0) {
      changed.push({
        ...createNodeRef(afterNode, key),
        changes,
      });
    }
  }

  for (const [key, beforeNode] of beforeNodes) {
    if (!afterNodes.has(key)) {
      removed.push(createNodeRef(beforeNode, key));
    }
  }

  return { added, removed, changed };
}

export const summarizeBlueprintDiff = compareComponentBlueprints;

function indexNodesByStableKey(nodes: EditorNode[]): Map<string, EditorNode> {
  const keyCounts = new Map<string, number>();
  const entries: Array<[string, EditorNode]> = [];

  for (const node of nodes) {
    if (node.parentId === null) {
      continue;
    }

    const baseKey = getNodeStableKey(node);
    const count = keyCounts.get(baseKey) ?? 0;
    keyCounts.set(baseKey, count + 1);
    entries.push([count === 0 ? baseKey : `${baseKey}#${count + 1}`, node]);
  }

  return new Map(entries);
}

function getNodeStableKey(node: EditorNode): string {
  return `${node.type}:${normalizeNodeName(node.name)}`;
}

function normalizeNodeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function createNodeRef(node: EditorNode, key = getNodeStableKey(node)): BlueprintDiffObjectRef {
  return {
    key,
    id: node.id || undefined,
    name: node.name,
    type: node.type,
  };
}

function compareNodeFields(before: EditorNode, after: EditorNode): BlueprintDiffFieldChange[] {
  const changes: BlueprintDiffFieldChange[] = [];

  appendChange(changes, "visible", before.visible, after.visible);
  appendChange(changes, "transform.position", before.transform.position, after.transform.position, sameVec3);
  appendChange(changes, "transform.rotation", before.transform.rotation, after.transform.rotation, sameVec3);
  appendChange(changes, "transform.scale", before.transform.scale, after.transform.scale, sameVec3);
  appendGeometryChanges(changes, before, after);
  appendMaterialChanges(changes, before, after);

  return changes;
}

function appendGeometryChanges(changes: BlueprintDiffFieldChange[], before: EditorNode, after: EditorNode): void {
  if (!("geometry" in before) || !("geometry" in after)) {
    return;
  }

  const paths = new Set([...Object.keys(before.geometry), ...Object.keys(after.geometry)]);

  for (const path of paths) {
    appendChange(
      changes,
      `geometry.${path}`,
      before.geometry[path as keyof typeof before.geometry],
      after.geometry[path as keyof typeof after.geometry],
    );
  }
}

function appendMaterialChanges(changes: BlueprintDiffFieldChange[], before: EditorNode, after: EditorNode): void {
  if (!("material" in before) || !("material" in after)) {
    return;
  }

  appendChange(changes, "material.color", before.material.color, after.material.color);
  appendChange(changes, "material.opacity", before.material.opacity, after.material.opacity);
  appendChange(changes, "material.type", before.material.type, after.material.type);
  appendChange(changes, "material.side", before.material.side, after.material.side);
  appendChange(changes, "material.mapImageId", before.material.mapImageId, after.material.mapImageId);
  appendChange(changes, "material.emissive", before.material.emissive, after.material.emissive);
  appendChange(changes, "material.emissiveIntensity", before.material.emissiveIntensity, after.material.emissiveIntensity);
  appendChange(changes, "material.roughness", before.material.roughness, after.material.roughness);
  appendChange(changes, "material.metalness", before.material.metalness, after.material.metalness);
  appendChange(changes, "material.transmission", before.material.transmission, after.material.transmission);
  appendChange(changes, "material.thickness", before.material.thickness, after.material.thickness);
  appendChange(changes, "material.clearcoat", before.material.clearcoat, after.material.clearcoat);
  appendChange(changes, "material.clearcoatRoughness", before.material.clearcoatRoughness, after.material.clearcoatRoughness);
}

function appendChange(
  changes: BlueprintDiffFieldChange[],
  path: string,
  before: unknown,
  after: unknown,
  isEqual: (before: unknown, after: unknown) => boolean = Object.is,
): void {
  if (isEqual(before, after)) {
    return;
  }

  changes.push({ path, before, after });
}

function sameVec3(before: unknown, after: unknown): boolean {
  if (!isVec3Like(before) || !isVec3Like(after)) {
    return false;
  }

  return before.x === after.x && before.y === after.y && before.z === after.z;
}

function isVec3Like(value: unknown): value is Vec3Like {
  return Boolean(
    value
      && typeof value === "object"
      && "x" in value
      && "y" in value
      && "z" in value,
  );
}
