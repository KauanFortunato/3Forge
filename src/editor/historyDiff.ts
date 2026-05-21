/**
 * Structural diff / patch system for the editor blueprint.
 *
 * Stores undo/redo history as small lists of {@link Patch} entries instead of
 * full blueprint snapshots, so memory stays bounded as the scene grows.
 *
 * Patches are RFC 6902-inspired:
 *   - "set" patches replace a primitive (or object/array) at a path. Both the
 *     forward `value` and the reverse `oldValue` are stored so the patch is
 *     reversible.
 *   - "arrayPatch" patches operate on id-keyed arrays (nodes, materials,
 *     assets, animation clips/tracks/keyframes). They store removed/added
 *     items plus before/after id orderings; applying re-builds the array.
 *
 * Path segments can be:
 *   - `string`  — object property key
 *   - `number`  — array index for arrays that are NOT id-keyed
 *   - `{ id }`  — id-based lookup inside an id-keyed array
 */

const ASSET_ARRAY_KEYS = new Set(["images", "models", "hdrs", "fonts"]);

export type PathSegment = string | number | { id: string };
export type Path = readonly PathSegment[];

export interface SetPatch {
  op: "set";
  path: Path;
  value: unknown;
  oldValue: unknown;
}

export interface ArrayPatch {
  op: "arrayPatch";
  path: Path;
  added: Array<{ id: string; item: unknown }>;
  removed: Array<{ id: string; item: unknown }>;
  oldOrder: string[];
  newOrder: string[];
}

export type Patch = SetPatch | ArrayPatch;

export type PatchDirection = "forward" | "reverse";

export function computePatches(before: unknown, after: unknown): Patch[] {
  const out: Patch[] = [];
  diffValue(before, after, [], out);
  return out;
}

export function applyPatches(target: unknown, patches: readonly Patch[], direction: PatchDirection): void {
  const ordered = direction === "reverse" ? [...patches].reverse() : patches;
  for (const patch of ordered) {
    applyOne(target, patch, direction);
  }
}

export function hasChanges(patches: readonly Patch[]): boolean {
  return patches.length > 0;
}

/**
 * Classifies a patch list to decide whether undo/redo can be applied directly
 * to existing scene Object3Ds, or whether a full scene rebuild is required.
 *
 * "lightweight" — every patch is a `set` under `["nodes", { id }, transform|visible, ...]`
 * (no topology changes, no geometry/material edits, no sceneSettings, etc.).
 * The scene can fast-path these by walking the affected ids and updating
 * Object3D fields in place. For USDZ-heavy scenes this avoids re-cloning the
 * cached parsed group on every undo/redo cycle, which was the dominant source
 * of JS heap churn.
 *
 * "heavy" — anything that doesn't match the above. The scene must rebuild.
 */
export interface PatchSummary {
  kind: "lightweight" | "heavy";
  affectedNodeIds: ReadonlySet<string>;
}

const LIGHTWEIGHT_NODE_FIELDS: ReadonlySet<string> = new Set(["transform", "visible"]);

export function summarizePatches(patches: readonly Patch[]): PatchSummary {
  const affected = new Set<string>();
  if (patches.length === 0) {
    return { kind: "lightweight", affectedNodeIds: affected };
  }
  for (const patch of patches) {
    if (patch.op !== "set") {
      return { kind: "heavy", affectedNodeIds: new Set() };
    }
    const path = patch.path;
    if (path.length < 3 || path[0] !== "nodes") {
      return { kind: "heavy", affectedNodeIds: new Set() };
    }
    const idSeg = path[1];
    if (typeof idSeg !== "object" || idSeg === null || !("id" in idSeg)) {
      return { kind: "heavy", affectedNodeIds: new Set() };
    }
    const fieldSeg = path[2];
    if (typeof fieldSeg !== "string" || !LIGHTWEIGHT_NODE_FIELDS.has(fieldSeg)) {
      return { kind: "heavy", affectedNodeIds: new Set() };
    }
    affected.add(idSeg.id);
  }
  return { kind: "lightweight", affectedNodeIds: affected };
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff

function diffValue(before: unknown, after: unknown, path: Path, out: Patch[]): void {
  if (Object.is(before, after)) return;

  const beforeIsContainer = isContainer(before);
  const afterIsContainer = isContainer(after);

  // At least one side is a primitive / null / undefined / type mismatch.
  if (!beforeIsContainer || !afterIsContainer) {
    if (!primitivesEqual(before, after)) {
      out.push({
        op: "set",
        path,
        value: captureValue(path, after),
        oldValue: captureValue(path, before),
      });
    }
    return;
  }

  // Both arrays.
  if (Array.isArray(before) && Array.isArray(after)) {
    diffArray(before, after, path, out);
    return;
  }

  // Both plain objects.
  if (!Array.isArray(before) && !Array.isArray(after)) {
    diffObject(before as Record<string, unknown>, after as Record<string, unknown>, path, out);
    return;
  }

  // Type mismatch (one array, one object).
  out.push({
    op: "set",
    path,
    value: captureValue(path, after),
    oldValue: captureValue(path, before),
  });
}

function diffArray(before: unknown[], after: unknown[], path: Path, out: Patch[]): void {
  const beforeIdKeyed = before.length === 0 || allHaveStringIds(before);
  const afterIdKeyed = after.length === 0 || allHaveStringIds(after);

  if (beforeIdKeyed && afterIdKeyed && (before.length > 0 || after.length > 0)) {
    diffIdKeyedArray(before as Array<{ id: string }>, after as Array<{ id: string }>, path, out);
    return;
  }

  // Opaque arrays: replace wholesale if not deep-equal.
  if (!deepEqual(before, after)) {
    out.push({
      op: "set",
      path,
      value: captureValue(path, after),
      oldValue: captureValue(path, before),
    });
  }
}

function diffIdKeyedArray(
  before: Array<{ id: string }>,
  after: Array<{ id: string }>,
  path: Path,
  out: Patch[],
): void {
  const beforeMap = new Map(before.map((item) => [item.id, item]));
  const afterMap = new Map(after.map((item) => [item.id, item]));

  const removed: ArrayPatch["removed"] = [];
  const added: ArrayPatch["added"] = [];

  for (const [id, item] of beforeMap) {
    if (!afterMap.has(id)) {
      removed.push({ id, item: captureValue(path, item) });
    }
  }
  for (const [id, item] of afterMap) {
    if (!beforeMap.has(id)) {
      added.push({ id, item: captureValue(path, item) });
    }
  }

  const oldOrder = before.map((item) => item.id);
  const newOrder = after.map((item) => item.id);
  const orderChanged = !arraysEqual(oldOrder, newOrder);

  if (removed.length > 0 || added.length > 0 || orderChanged) {
    out.push({ op: "arrayPatch", path, added, removed, oldOrder, newOrder });
  }

  for (const [id, beforeItem] of beforeMap) {
    const afterItem = afterMap.get(id);
    if (afterItem && beforeItem !== afterItem) {
      diffValue(beforeItem, afterItem, [...path, { id }], out);
    }
  }
}

function diffObject(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: Path,
  out: Patch[],
): void {
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    diffValue(before[key], after[key], [...path, key], out);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply

function applyOne(root: unknown, patch: Patch, direction: PatchDirection): void {
  if (patch.op === "set") {
    if (patch.path.length === 0) return;
    const parent = navigate(root, patch.path.slice(0, -1));
    if (parent === undefined || parent === null) return;
    const last = patch.path[patch.path.length - 1];
    const value = direction === "forward" ? patch.value : patch.oldValue;
    setOnContainer(parent, last, value);
    return;
  }

  const arr = navigate(root, patch.path);
  if (!Array.isArray(arr)) return;
  applyArrayPatch(arr as Array<{ id: string }>, patch, direction);
}

function applyArrayPatch(arr: Array<{ id: string }>, patch: ArrayPatch, direction: PatchDirection): void {
  const byId = new Map<string, unknown>();
  for (const item of arr) {
    byId.set(item.id, item);
  }
  if (direction === "forward") {
    for (const r of patch.removed) byId.delete(r.id);
    for (const a of patch.added) byId.set(a.id, a.item);
  } else {
    for (const a of patch.added) byId.delete(a.id);
    for (const r of patch.removed) byId.set(r.id, r.item);
  }

  const targetOrder = direction === "forward" ? patch.newOrder : patch.oldOrder;
  arr.length = 0;
  for (const id of targetOrder) {
    const item = byId.get(id);
    if (item !== undefined) {
      arr.push(item as { id: string });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation

function navigate(root: unknown, path: Path): unknown {
  let current: unknown = root;
  for (const seg of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof seg === "string") {
      current = (current as Record<string, unknown>)[seg];
    } else if (typeof seg === "number") {
      current = (current as unknown[])[seg];
    } else {
      const arr = current as Array<{ id: string }>;
      current = arr.find((item) => item.id === seg.id);
    }
  }
  return current;
}

function setOnContainer(parent: unknown, seg: PathSegment, value: unknown): void {
  if (typeof seg === "string") {
    const obj = parent as Record<string, unknown>;
    if (value === undefined) {
      delete obj[seg];
    } else {
      obj[seg] = value;
    }
    return;
  }
  if (typeof seg === "number") {
    (parent as unknown[])[seg] = value;
    return;
  }
  const arr = parent as Array<{ id: string }>;
  const idx = arr.findIndex((item) => item.id === seg.id);
  if (idx >= 0) {
    arr[idx] = value as { id: string };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function isContainer(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function primitivesEqual(a: unknown, b: unknown): boolean {
  // For values that reach here, at least one is a primitive / null / undefined,
  // OR they're objects of mismatched container kind. Object.is is enough.
  return Object.is(a, b);
}

function allHaveStringIds(arr: unknown[]): boolean {
  return arr.every(
    (item) => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string",
  );
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Snapshot a value for storage inside a patch. Asset entries carry large base64
 * payloads (img/model/hdr.src, font.data) that must not be byte-duplicated, so
 * we shallow-clone them via spread. Anything else is deep-cloned so future
 * in-place mutations of the live blueprint cannot retroactively corrupt the
 * stored patch.
 */
function captureValue(path: Path, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (pathTouchesAssetArray(path)) {
    if (Array.isArray(value)) {
      return value.map((item) => shallowCloneIfObject(item));
    }
    return shallowCloneIfObject(value);
  }
  return structuredClone(value);
}

function shallowCloneIfObject(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return [...value];
  return { ...(value as Record<string, unknown>) };
}

function pathTouchesAssetArray(path: Path): boolean {
  for (const seg of path) {
    if (typeof seg === "string" && ASSET_ARRAY_KEYS.has(seg)) {
      return true;
    }
  }
  return false;
}
