import { describe, expect, it } from "vitest";
import { createDefaultBlueprint } from "./state";
import {
  __resetWorkspaceQuotaCache,
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
  stripTransientFieldsForPersistence,
  upsertRecentProject,
} from "./workspace";
import type { ComponentBlueprint } from "./types";

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

describe("workspace quota suppression (Phase 8 regression)", () => {
  function createQuotaStorage(): {
    storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
    setItemCalls: { key: string; threw: boolean }[];
  } {
    // Quota-bounded storage stub: throws a DOMException with name
    // QuotaExceededError on every setItem so we can verify the safeSetItem
    // guards behave as documented.
    const setItemCalls: { key: string; threw: boolean }[] = [];
    const storage = {
      getItem: () => null,
      setItem(key: string, _value: string) {
        // jsdom's DOMException doesn't reliably extend Error; use a plain
        // Error with a manually-set `name` so isQuotaError's name check
        // recognises it without depending on jsdom's prototype chain.
        const err = new Error("Quota exceeded");
        err.name = "QuotaExceededError";
        setItemCalls.push({ key, threw: true });
        throw err;
      },
      removeItem: (_key: string) => undefined,
    };
    return { storage, setItemCalls };
  }

  it("warns once per key when localStorage quota is exceeded, then suppresses future warnings (LINEUP_LEFT regression)", () => {
    // Before the suppression: a tight React re-render loop on a large
    // blueprint produced one quota-exceeded console.warn per render. Now
    // each key is warned about exactly once and subsequent attempts to
    // persist the same key short-circuit silently.
    __resetWorkspaceQuotaCache();
    const { storage } = createQuotaStorage();
    const blueprint = createDefaultBlueprint();
    const context = createWorkspaceProjectContext();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(msg); };
    try {
      // First fire: BOTH safeSetItem calls inside persistWorkspace go through
      // the throw path and each logs its quota warning once. That's 2 warns.
      persistWorkspace(blueprint, context, storage);
      // Subsequent fires (mimicking the React re-render loop): both keys are
      // already in the suppression cache, so safeSetItem returns false
      // silently without logging anything additional.
      persistWorkspace(blueprint, context, storage);
      persistWorkspace(blueprint, context, storage);
      persistWorkspace(blueprint, context, storage);
    } finally {
      console.warn = originalWarn;
    }
    // The two distinct keys (EDITOR_AUTOSAVE_KEY + WORKSPACE_CONTEXT_KEY)
    // each generate exactly one warning across the four persist attempts.
    expect(warnings.length).toBe(2);
    expect(warnings.every((w) => w.includes("quota exceeded"))).toBe(true);
    // Distinct keys mentioned, not the same one twice.
    const keysMentioned = new Set(warnings.map((w) => w.match(/"([^"]+)"/)?.[1] ?? ""));
    expect(keysMentioned.size).toBe(2);
  });

  it("re-arms the warning when a key successfully persists again (suppression is not permanent)", () => {
    // Once the user shrinks the blueprint or frees up space, a successful
    // write must clear the suppression so future quota errors are logged.
    __resetWorkspaceQuotaCache();
    let shouldThrow = true;
    const storage = {
      getItem: () => null,
      setItem(_key: string, _value: string) {
        if (shouldThrow) {
          // jsdom's DOMException doesn't reliably extend Error; mint a plain
          // Error with a manually-set `name` so isQuotaError can recognise it.
          const err = new Error("Quota exceeded");
          err.name = "QuotaExceededError";
          throw err;
        }
      },
      removeItem: () => undefined,
    };
    const blueprint = createDefaultBlueprint();
    const context = createWorkspaceProjectContext();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(msg); };
    try {
      // First call: throws → 2 warnings + 2 keys suppressed.
      persistWorkspace(blueprint, context, storage);
      expect(warnings.length).toBe(2);
      // Storage stops throwing — simulates user freeing localStorage space.
      shouldThrow = false;
      // Second call: succeeds → suppression cleared, no new warnings.
      persistWorkspace(blueprint, context, storage);
      // Storage starts throwing again — simulates re-import of a larger
      // blueprint. Warnings fire again (suppression was correctly reset).
      shouldThrow = true;
      persistWorkspace(blueprint, context, storage);
      expect(warnings.length).toBe(4);
    } finally {
      console.warn = originalWarn;
    }
  });
});

function makeBlueprintWithSequence(): ComponentBlueprint {
  return {
    version: 1,
    componentName: "test",
    sceneMode: "2d",
    nodes: [
      {
        id: "img-1",
        name: "PITCH_IN",
        type: "image",
        parentId: null,
        visible: true,
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        origin: { x: 0, y: 0, z: 0 },
        editable: {},
        geometry: { width: 7, height: 4 },
        image: {
          name: "PITCH_IN.mov",
          mimeType: "application/x-image-sequence",
          src: "blob:frame-1",
          width: 1920,
          height: 1080,
          sequence: {
            version: 1,
            type: "image-sequence",
            source: "PITCH_IN.mov",
            framePattern: "frame_%06d.png",
            frameCount: 200,
            fps: 25,
            width: 1920,
            height: 1080,
            durationSec: 8,
            loop: true,
            alpha: true,
            pixelFormat: "rgba",
            frameUrls: Array.from({ length: 200 }, (_, i) => `blob:frame-${i + 1}`),
          },
        },
        material: { type: "basic", color: "#ffffff", emissive: "#000000", opacity: 1, transparent: true, alphaTest: 0 },
      } as never,
    ],
    fonts: [],
    images: [],
    materials: [],
    animation: { clips: [] },
  } as unknown as ComponentBlueprint;
}

describe("stripTransientFieldsForPersistence", () => {
  it("strips frameUrls from image-sequence nodes", () => {
    const bp = makeBlueprintWithSequence();
    const stripped = stripTransientFieldsForPersistence(bp);
    const node = stripped.nodes[0];
    expect(node.type).toBe("image");
    if (node.type !== "image") return;
    expect(node.image.sequence?.frameUrls).toEqual([]);
    // The other sequence metadata is preserved.
    expect(node.image.sequence?.frameCount).toBe(200);
    expect(node.image.sequence?.fps).toBe(25);
    expect(node.image.sequence?.alpha).toBe(true);
  });

  it("doesn't mutate the input blueprint", () => {
    const bp = makeBlueprintWithSequence();
    const inputUrls = (bp.nodes[0] as { image: { sequence: { frameUrls: string[] } } }).image.sequence.frameUrls;
    const inputLength = inputUrls.length;
    stripTransientFieldsForPersistence(bp);
    expect(inputUrls.length).toBe(inputLength);  // input untouched
  });

  it("strips frameUrls from blueprint.images asset library entries too", () => {
    const bp = makeBlueprintWithSequence();
    bp.images = [{
      id: "asset-1",
      name: "PITCH_IN.mov",
      mimeType: "application/x-image-sequence",
      src: "blob:frame-1",
      width: 1920,
      height: 1080,
      sequence: {
        version: 1, type: "image-sequence", source: "PITCH_IN.mov",
        framePattern: "frame_%06d.png", frameCount: 200, fps: 25,
        width: 1920, height: 1080, durationSec: 8, loop: true,
        alpha: true, pixelFormat: "rgba",
        frameUrls: Array.from({ length: 200 }, (_, i) => `blob:f-${i + 1}`),
      },
    }] as never;
    const stripped = stripTransientFieldsForPersistence(bp);
    expect(stripped.images[0].sequence?.frameUrls).toEqual([]);
    expect(stripped.images[0].sequence?.frameCount).toBe(200);
  });

  it("leaves non-sequence image nodes alone", () => {
    const bp = makeBlueprintWithSequence();
    bp.nodes.push({
      id: "img-2",
      name: "logo",
      type: "image",
      parentId: null,
      visible: true,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      origin: { x: 0, y: 0, z: 0 },
      editable: {},
      geometry: { width: 1, height: 1 },
      image: { name: "logo.png", mimeType: "image/png", src: "blob:logo", width: 100, height: 100 },
      material: { type: "basic", color: "#ffffff", emissive: "#000000", opacity: 1, transparent: false, alphaTest: 0 },
    } as never);
    const stripped = stripTransientFieldsForPersistence(bp);
    const logo = stripped.nodes[1];
    expect(logo.type).toBe("image");
    if (logo.type !== "image") return;
    expect(logo.image.mimeType).toBe("image/png");
    expect(logo.image.sequence).toBeUndefined();
  });
});
