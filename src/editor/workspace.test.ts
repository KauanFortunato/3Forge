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
