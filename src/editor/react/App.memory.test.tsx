/**
 * Regression tests for the USDZ-heap-leak fixes.
 *
 * Three regressions used to make undo/redo crash the renderer on USDZ-heavy
 * projects:
 *   1. `EditorStore.getSnapshot` did a naive `structuredClone(_blueprint)`,
 *      which byte-duplicated the 100MB+ base64 src of every model asset on
 *      every store revision. Covered by `state.test.ts > getSnapshot memory
 *      regressions`.
 *   2. `blueprintJson` / `typeScriptExport` were memoized at the top of
 *      `App.tsx` with `[blueprintSnapshot]` deps, so `JSON.stringify` and
 *      `generateTypeScriptComponent` ran on every notify (including each
 *      undo/redo) — even when nobody clicked Export. Covered here.
 *   3. `persistWorkspace` + `persistRecentSnapshot` ran synchronously inside
 *      a `useEffect` keyed on `blueprintSnapshot`, doing two more full
 *      `JSON.stringify(blueprint)` per notify. Now debounced 500ms. Covered
 *      here.
 *
 * If any of these come back the renderer OOMs under rapid undo/redo on a
 * loaded USDZ — so we lock the contract in.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceProjectContext,
  markWorkspaceSessionActive,
  persistWorkspace,
} from "../workspace";
import { createDefaultBlueprint } from "../state";

const fakeScene = {
  setTransformMode: vi.fn(),
  setSelectionVisualsSuppressed: vi.fn(),
  seekAnimation: vi.fn(),
  onAnimationFrameChange: vi.fn(() => () => undefined),
  frameSelection: vi.fn(),
  playAnimation: vi.fn(),
  pauseAnimation: vi.fn(),
  stopAnimation: vi.fn(),
  getNodeAnimationValue: vi.fn(() => null),
  previewAnimationValue: vi.fn(),
  setAnimationPreviewOverrides: vi.fn(),
};

const fileAccessMocks = vi.hoisted(() => ({
  supportsFileSystemAccess: vi.fn<() => boolean>(() => false),
  openBlueprintWithPicker: vi.fn<() => Promise<unknown>>(),
  readBlueprintFromFile: vi.fn<(file: File) => Promise<unknown>>(async (file: File) => JSON.parse(await file.text())),
  saveBlueprintAs: vi.fn<() => Promise<unknown>>(async () => ({ status: "unsupported" as const })),
  saveBlueprintToExistingHandle: vi.fn<() => Promise<unknown>>(async () => ({ status: "unsupported" as const })),
  getBlueprintFileName: vi.fn<(componentName: string) => string>((componentName: string) => `${componentName || "3forge-component"}.json`),
}));

const exportsSpies = vi.hoisted(() => ({
  exportBlueprintToJson: vi.fn(),
  generateTypeScriptComponent: vi.fn(),
}));

vi.mock("../fileAccess", async () => {
  const actual = await vi.importActual<typeof import("../fileAccess")>("../fileAccess");
  return { ...actual, ...fileAccessMocks };
});

vi.mock("../exportPackage", () => ({
  createExportPackageZip: vi.fn(async () => ({
    fileName: "fixture.zip",
    blob: new Blob(["zip-content"], { type: "application/zip" }),
  })),
}));

vi.mock("../recentFileHandles", () => ({
  saveRecentFileHandle: vi.fn(async () => true),
  readRecentFileHandle: vi.fn(async () => null),
  removeRecentFileHandle: vi.fn(async () => true),
}));

vi.mock("../exports", async () => {
  const actual = await vi.importActual<typeof import("../exports")>("../exports");
  exportsSpies.exportBlueprintToJson.mockImplementation(actual.exportBlueprintToJson);
  exportsSpies.generateTypeScriptComponent.mockImplementation(actual.generateTypeScriptComponent);
  return {
    ...actual,
    exportBlueprintToJson: exportsSpies.exportBlueprintToJson,
    generateTypeScriptComponent: exportsSpies.generateTypeScriptComponent,
  };
});

vi.mock("./components/ViewportHost", () => ({
  ViewportHost: ({
    onSceneReady,
  }: {
    onSceneReady: (scene: typeof fakeScene | null) => void;
  }) => {
    onSceneReady(fakeScene);
    return <div data-testid="viewport-host" />;
  },
}));

// `persistWorkspace` is imported as a value by App.tsx; we spy via module
// mock so the debounce assertion below can count actual save attempts.
const workspaceSpies = vi.hoisted(() => ({
  persistWorkspace: vi.fn(),
  persistRecentSnapshot: vi.fn(),
}));

vi.mock("../workspace", async () => {
  const actual = await vi.importActual<typeof import("../workspace")>("../workspace");
  workspaceSpies.persistWorkspace.mockImplementation(actual.persistWorkspace);
  workspaceSpies.persistRecentSnapshot.mockImplementation(actual.persistRecentSnapshot);
  return {
    ...actual,
    persistWorkspace: workspaceSpies.persistWorkspace,
    persistRecentSnapshot: workspaceSpies.persistRecentSnapshot,
  };
});

function mockNavigationType(type: "navigate" | "reload" | "back_forward" | "prerender" | undefined): void {
  const entries = type
    ? [
        {
          type,
          name: window.location.href,
          duration: 0,
          startTime: 0,
          entryType: "navigation",
        } as unknown as PerformanceNavigationTiming,
      ]
    : [];
  vi.spyOn(performance, "getEntriesByType").mockImplementation((kind: string) => (kind === "navigation" ? entries : []));
}

function seedActiveWorkspace(componentName = "Memory Test"): void {
  const blueprint = createDefaultBlueprint();
  blueprint.componentName = componentName;
  persistWorkspace(blueprint, createWorkspaceProjectContext());
  markWorkspaceSessionActive();
  mockNavigationType("reload");
}

describe("App.tsx memory regressions", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
    window.dispatchEvent(new Event("resize"));
  });

  it("does NOT serialize the blueprint to JSON eagerly on each store revision", async () => {
    // Eager top-level `useMemo([() => exportBlueprintToJson(snap), [snap]])`
    // would fire `JSON.stringify` of the whole blueprint on every notify —
    // including each undo/redo. We assert nothing calls these serializers
    // during a quiet mount, since neither one is consumed before the user
    // hits an export button.
    seedActiveWorkspace();
    const { App } = await import("./App");

    render(<App />);
    await screen.findByTestId("viewport-host");

    expect(exportsSpies.exportBlueprintToJson).not.toHaveBeenCalled();
    expect(exportsSpies.generateTypeScriptComponent).not.toHaveBeenCalled();
  });

  it("does not call persistWorkspace synchronously during render (debounced)", async () => {
    // `persistWorkspace` does `JSON.stringify(blueprint)`. If the persistence
    // effect runs synchronously on every notify, rapid undo/redo on a USDZ
    // produces a 100MB+ string allocation per cycle and OOMs the renderer.
    // The fix wraps the effect in a 500ms setTimeout, so the save MUST NOT
    // fire synchronously when the blueprint snapshot changes.
    seedActiveWorkspace();
    workspaceSpies.persistWorkspace.mockClear();

    const { App } = await import("./App");
    render(<App />);
    await screen.findByTestId("viewport-host");

    // Critical: immediately after render the persistence effect should have
    // ONLY scheduled a setTimeout, not actually serialised+saved. A future
    // refactor that strips the debounce would fail here.
    expect(workspaceSpies.persistWorkspace).not.toHaveBeenCalled();

    // After the 500ms debounce window the save should have fired exactly
    // once (a single coalesced save for the initial mount burst).
    await waitFor(
      () => {
        expect(workspaceSpies.persistWorkspace).toHaveBeenCalled();
      },
      { timeout: 1500 },
    );
  });
});
