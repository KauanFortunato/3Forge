import { EDITOR_AUTOSAVE_KEY, createDefaultBlueprint } from "./state";
import type { ComponentBlueprint } from "./types";

export const WORKSPACE_CONTEXT_KEY = "3forge-workspace-context";
export const RECENT_PROJECTS_KEY = "3forge-recent-projects";
export const SESSION_ACTIVE_PROJECT_KEY = "3forge-session-active-project";
const RECENT_SNAPSHOT_PREFIX = "3forge-recent-snapshot:";
const MAX_RECENT_PROJECTS = 8;

export type WorkspaceSource = "local" | "file-handle" | "imported-file";
export type RecentProjectSource = "file-handle" | "snapshot";

export interface WorkspaceProjectContext {
  source: WorkspaceSource;
  fileName: string | null;
  recentProjectId: string | null;
  fileHandleId: string | null;
  canOverwriteFile: boolean;
  updatedAt: number;
}

export interface PersistedWorkspaceRecord {
  blueprint: ComponentBlueprint;
  context: WorkspaceProjectContext;
}

export interface RecentProjectEntry {
  id: string;
  label: string;
  componentName: string;
  updatedAt: number;
  source: RecentProjectSource;
  fileName: string | null;
  fileHandleId: string | null;
}

export interface WorkspaceBootState {
  persistedWorkspace: PersistedWorkspaceRecord | null;
  recentProjects: RecentProjectEntry[];
  shouldOpenEditor: boolean;
}

interface NavigationPerformanceLike {
  getEntriesByType?: (type: string) => ArrayLike<unknown>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Different browsers throw different DOMException names / codes for quota.
  const dom = error as DOMException;
  return (
    dom.name === "QuotaExceededError" ||
    dom.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    dom.code === 22 ||
    dom.code === 1014
  );
}

function evictRecentSnapshots(storage: StorageLike, keepKey: string): number {
  if (typeof storage.length !== "number" || typeof storage.key !== "function") {
    return 0;
  }
  const keysToDelete: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k && k.startsWith(RECENT_SNAPSHOT_PREFIX) && k !== keepKey) {
      keysToDelete.push(k);
    }
  }
  for (const k of keysToDelete) {
    storage.removeItem(k);
  }
  return keysToDelete.length;
}

/**
 * setItem with one retry after evicting other recent-snapshot entries when the
 * quota fires. Final fallback: warn + skip silently rather than crashing the
 * caller (an import succeeded, the recent-list entry is just expendable).
 */
function safeSetItem(storage: StorageLike, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    const evicted = evictRecentSnapshots(storage, key);
    if (evicted > 0) {
      try {
        storage.setItem(key, value);
        // eslint-disable-next-line no-console
        console.warn(`[workspace] localStorage quota hit; evicted ${evicted} old recent-snapshot entr${evicted === 1 ? "y" : "ies"} and retried "${key}".`);
        return true;
      } catch (retryError) {
        if (!isQuotaError(retryError)) throw retryError;
      }
    }
    // eslint-disable-next-line no-console
    console.warn(`[workspace] localStorage quota exceeded; skipping persist of "${key}".`);
    return false;
  }
}

export function createWorkspaceProjectContext(
  overrides: Partial<WorkspaceProjectContext> = {},
): WorkspaceProjectContext {
  return {
    source: overrides.source ?? "local",
    fileName: overrides.fileName ?? null,
    recentProjectId: overrides.recentProjectId ?? null,
    fileHandleId: overrides.fileHandleId ?? null,
    canOverwriteFile: overrides.canOverwriteFile ?? false,
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}

export function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined"
    && typeof window.localStorage !== "undefined"
    && typeof window.sessionStorage !== "undefined";
}

export function readWorkspaceBootState(
  localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null,
  sessionStorageObject: StorageLike | null = canUseBrowserStorage() ? window.sessionStorage : null,
  performanceObject: NavigationPerformanceLike | null = typeof window !== "undefined" ? window.performance : null,
): WorkspaceBootState {
  const persistedWorkspace = readPersistedWorkspace(localStorageObject);
  const recentProjects = readRecentProjects(localStorageObject);
  const shouldOpenEditor = persistedWorkspace !== null && shouldResumeWorkspaceSession(sessionStorageObject, performanceObject);

  return {
    persistedWorkspace,
    recentProjects,
    shouldOpenEditor,
  };
}

export function shouldResumeWorkspaceSession(
  sessionStorageObject: StorageLike | null,
  performanceObject: NavigationPerformanceLike | null,
): boolean {
  if (!sessionStorageObject) {
    return false;
  }

  return sessionStorageObject.getItem(SESSION_ACTIVE_PROJECT_KEY) === "true" && getNavigationType(performanceObject) === "reload";
}

export function markWorkspaceSessionActive(sessionStorageObject: StorageLike | null = canUseBrowserStorage() ? window.sessionStorage : null): void {
  sessionStorageObject?.setItem(SESSION_ACTIVE_PROJECT_KEY, "true");
}

export function clearWorkspaceSessionActive(sessionStorageObject: StorageLike | null = canUseBrowserStorage() ? window.sessionStorage : null): void {
  sessionStorageObject?.removeItem(SESSION_ACTIVE_PROJECT_KEY);
}

export function readPersistedWorkspace(localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null): PersistedWorkspaceRecord | null {
  if (!localStorageObject) {
    return null;
  }

  const rawBlueprint = localStorageObject.getItem(EDITOR_AUTOSAVE_KEY);
  if (!rawBlueprint) {
    return null;
  }

  try {
    const blueprint = JSON.parse(rawBlueprint) as ComponentBlueprint;
    return {
      blueprint,
      context: readWorkspaceProjectContext(localStorageObject),
    };
  } catch {
    localStorageObject.removeItem(EDITOR_AUTOSAVE_KEY);
    localStorageObject.removeItem(WORKSPACE_CONTEXT_KEY);
    return null;
  }
}

export function persistWorkspace(
  blueprint: ComponentBlueprint,
  context: WorkspaceProjectContext,
  localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null,
): void {
  if (!localStorageObject) {
    return;
  }

  safeSetItem(localStorageObject, EDITOR_AUTOSAVE_KEY, JSON.stringify(blueprint));
  safeSetItem(localStorageObject, WORKSPACE_CONTEXT_KEY, JSON.stringify({
    ...context,
    updatedAt: Date.now(),
  }));
}

export function readWorkspaceProjectContext(
  localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null,
): WorkspaceProjectContext {
  if (!localStorageObject) {
    return createWorkspaceProjectContext();
  }

  const raw = localStorageObject.getItem(WORKSPACE_CONTEXT_KEY);
  if (!raw) {
    return createWorkspaceProjectContext();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceProjectContext>;
    return createWorkspaceProjectContext(parsed);
  } catch {
    localStorageObject.removeItem(WORKSPACE_CONTEXT_KEY);
    return createWorkspaceProjectContext();
  }
}

export function clearPersistedWorkspace(localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null): void {
  localStorageObject?.removeItem(EDITOR_AUTOSAVE_KEY);
  localStorageObject?.removeItem(WORKSPACE_CONTEXT_KEY);
}

export function createRecentProjectEntry(
  overrides: Partial<RecentProjectEntry> & Pick<RecentProjectEntry, "id" | "label" | "componentName" | "source">,
): RecentProjectEntry {
  return {
    id: overrides.id,
    label: overrides.label,
    componentName: overrides.componentName,
    updatedAt: overrides.updatedAt ?? Date.now(),
    source: overrides.source,
    fileName: overrides.fileName ?? null,
    fileHandleId: overrides.fileHandleId ?? null,
  };
}

export function createRecentProjectId(): string {
  return `recent-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildRecentProjectLabel(fileName: string | null, componentName: string): string {
  if (fileName && fileName.trim().length > 0) {
    return fileName;
  }

  return componentName.trim().length > 0 ? componentName : "Untitled Project";
}

export function readRecentProjects(localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null): RecentProjectEntry[] {
  if (!localStorageObject) {
    return [];
  }

  const raw = localStorageObject.getItem(RECENT_PROJECTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as RecentProjectEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.label === "string")
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_RECENT_PROJECTS);
  } catch {
    localStorageObject.removeItem(RECENT_PROJECTS_KEY);
    return [];
  }
}

export function upsertRecentProject(
  entry: RecentProjectEntry,
  localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null,
): RecentProjectEntry[] {
  const nextEntries = [
    entry,
    ...readRecentProjects(localStorageObject).filter((candidate) => candidate.id !== entry.id),
  ]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RECENT_PROJECTS);

  if (localStorageObject) {
    localStorageObject.setItem(RECENT_PROJECTS_KEY, JSON.stringify(nextEntries));
  }

  return nextEntries;
}

export function removeRecentProject(
  recentProjectId: string,
  localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null,
): RecentProjectEntry[] {
  const nextEntries = readRecentProjects(localStorageObject).filter((entry) => entry.id !== recentProjectId);
  if (localStorageObject) {
    localStorageObject.setItem(RECENT_PROJECTS_KEY, JSON.stringify(nextEntries));
    localStorageObject.removeItem(getRecentSnapshotStorageKey(recentProjectId));
  }
  return nextEntries;
}

export function persistRecentSnapshot(
  recentProjectId: string,
  blueprint: ComponentBlueprint,
  localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null,
): void {
  if (!localStorageObject) return;
  safeSetItem(localStorageObject, getRecentSnapshotStorageKey(recentProjectId), JSON.stringify(blueprint));
}

export function readRecentSnapshot(
  recentProjectId: string,
  localStorageObject: StorageLike | null = canUseBrowserStorage() ? window.localStorage : null,
): ComponentBlueprint | null {
  if (!localStorageObject) {
    return null;
  }

  const raw = localStorageObject.getItem(getRecentSnapshotStorageKey(recentProjectId));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ComponentBlueprint;
  } catch {
    localStorageObject.removeItem(getRecentSnapshotStorageKey(recentProjectId));
    return null;
  }
}

export function createWorkspaceFromBootState(bootState: WorkspaceBootState): PersistedWorkspaceRecord {
  return bootState.persistedWorkspace ?? {
    blueprint: createDefaultBlueprint(),
    context: createWorkspaceProjectContext(),
  };
}

export function getRecentSnapshotStorageKey(recentProjectId: string): string {
  return `${RECENT_SNAPSHOT_PREFIX}${recentProjectId}`;
}

function getNavigationType(performanceObject: NavigationPerformanceLike | null): string {
  const entry = performanceObject?.getEntriesByType?.("navigation")?.[0] as { type?: string } | undefined;
  return entry?.type ?? "navigate";
}
