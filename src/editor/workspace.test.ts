import { describe, expect, it } from "vitest";
import { createDefaultBlueprint } from "./state";
import {
  createRecentProjectEntry,
  createWorkspaceProjectContext,
  markWorkspaceSessionActive,
  persistRecentSnapshot,
  persistWorkspace,
  readRecentProjects,
  readRecentSnapshot,
  readWorkspaceBootState,
  readPersistedWorkspace,
  removeRecentProject,
  upsertRecentProject,
} from "./workspace";

function createStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("workspace", () => {
  it("reopens the editor on reload when the workspace session is active", () => {
    const localStorageObject = createStorage();
    const sessionStorageObject = createStorage();
    const blueprint = createDefaultBlueprint();
    blueprint.componentName = "Reload Fixture";

    persistWorkspace(blueprint, createWorkspaceProjectContext(), localStorageObject);
    markWorkspaceSessionActive(sessionStorageObject);

    const bootState = readWorkspaceBootState(localStorageObject, sessionStorageObject, {
      getEntriesByType: () => [{ type: "reload" }],
    });

    expect(bootState.shouldOpenEditor).toBe(true);
    expect(bootState.persistedWorkspace?.blueprint.componentName).toBe("Reload Fixture");
  });

  it("shows the welcome screen again on reentry even when the local workspace still exists", () => {
    const localStorageObject = createStorage();
    const sessionStorageObject = createStorage();
    const blueprint = createDefaultBlueprint();

    persistWorkspace(blueprint, createWorkspaceProjectContext(), localStorageObject);
    markWorkspaceSessionActive(sessionStorageObject);

    const bootState = readWorkspaceBootState(localStorageObject, sessionStorageObject, {
      getEntriesByType: () => [{ type: "navigate" }],
    });

    expect(bootState.persistedWorkspace).not.toBeNull();
    expect(bootState.shouldOpenEditor).toBe(false);
  });

  it("keeps recent snapshots available until explicitly removed", () => {
    const localStorageObject = createStorage();
    const blueprint = createDefaultBlueprint();
    blueprint.componentName = "Recent Snapshot";

    const entry = createRecentProjectEntry({
      id: "recent-a",
      label: "recent-a.json",
      componentName: "Recent Snapshot",
      source: "snapshot",
    });

    upsertRecentProject(entry, localStorageObject);
    persistRecentSnapshot(entry.id, blueprint, localStorageObject);

    expect(readRecentProjects(localStorageObject)).toHaveLength(1);
    expect(readRecentSnapshot(entry.id, localStorageObject)?.componentName).toBe("Recent Snapshot");

    removeRecentProject(entry.id, localStorageObject);
    expect(readRecentProjects(localStorageObject)).toHaveLength(0);
    expect(readRecentSnapshot(entry.id, localStorageObject)).toBeNull();
  });

  it("round-trips the persisted workspace context with the current blueprint", () => {
    const localStorageObject = createStorage();
    const blueprint = createDefaultBlueprint();
    const context = createWorkspaceProjectContext({
      source: "file-handle",
      fileName: "fixture.json",
      recentProjectId: "recent-1",
      fileHandleId: "handle-1",
      canOverwriteFile: true,
    });

    persistWorkspace(blueprint, context, localStorageObject);
    const persistedWorkspace = readPersistedWorkspace(localStorageObject);

    expect(persistedWorkspace?.blueprint.componentName).toBe(blueprint.componentName);
    expect(persistedWorkspace?.context.fileName).toBe("fixture.json");
    expect(persistedWorkspace?.context.fileHandleId).toBe("handle-1");
  });
});
