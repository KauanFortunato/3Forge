import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultBlueprint } from "../state";
import {
  createWorkspaceProjectContext,
  markWorkspaceSessionActive,
  persistWorkspace,
} from "../workspace";
import { App } from "./App";

const fakeScene = {
  setTransformMode: vi.fn(),
  seekAnimation: vi.fn(),
  onAnimationFrameChange: vi.fn(() => () => undefined),
  frameSelection: vi.fn(),
  playAnimation: vi.fn(),
  pauseAnimation: vi.fn(),
  stopAnimation: vi.fn(),
  getNodeAnimationValue: vi.fn(() => null),
};

const recentHandleStore = new Map<string, unknown>();
const fileAccessMocks = vi.hoisted(() => ({
  supportsFileSystemAccess: vi.fn<() => boolean>(() => false),
  openBlueprintWithPicker: vi.fn<() => Promise<unknown>>(),
  readBlueprintFromFile: vi.fn<(file: File) => Promise<unknown>>(async (file: File) => JSON.parse(await file.text())),
  saveBlueprintAs: vi.fn<() => Promise<unknown>>(async () => ({ status: "unsupported" as const })),
  saveBlueprintToExistingHandle: vi.fn<() => Promise<unknown>>(async () => ({ status: "unsupported" as const })),
  getBlueprintFileName: vi.fn<(componentName: string) => string>((componentName: string) => `${componentName || "3forge-component"}.json`),
}));

vi.mock("../fileAccess", async () => {
  const actual = await vi.importActual("../fileAccess");
  return {
    ...actual,
    ...fileAccessMocks,
  };
});

vi.mock("../recentFileHandles", () => ({
  saveRecentFileHandle: vi.fn(async (fileHandleId: string, handle: unknown) => {
    recentHandleStore.set(fileHandleId, handle);
    return true;
  }),
  readRecentFileHandle: vi.fn(async (fileHandleId: string) => recentHandleStore.get(fileHandleId) ?? null),
  removeRecentFileHandle: vi.fn(async (fileHandleId: string) => {
    recentHandleStore.delete(fileHandleId);
    return true;
  }),
}));

vi.mock("./components/ViewportHost", () => ({
  ViewportHost: ({ onSceneReady }: { onSceneReady: (scene: typeof fakeScene | null) => void }) => {
    useEffect(() => {
      onSceneReady(fakeScene);
      return () => onSceneReady(null);
    }, [onSceneReady]);

    return <div data-testid="viewport-host" />;
  },
}));

function mockNavigationType(type: "navigate" | "reload") {
  vi.spyOn(window.performance, "getEntriesByType").mockImplementation((entryType: string) => (
    entryType === "navigation" ? [{ type }] : []
  ) as unknown as PerformanceEntryList);
}

function getRecentOpenButton(container: HTMLElement, pattern: RegExp): HTMLButtonElement {
  const buttons = within(container).getAllByRole("button", { name: pattern });
  const match = buttons.find((button) => button.classList.contains("landing-recent__open"));
  if (!match) {
    throw new Error(`Recent open button not found for ${pattern}`);
  }
  return match as HTMLButtonElement;
}

function persistLocalWorkspace(componentName = "Fixture") {
  const blueprint = createDefaultBlueprint();
  blueprint.componentName = componentName;
  persistWorkspace(blueprint, createWorkspaceProjectContext());
  return blueprint;
}

async function openFileMenu() {
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  await screen.findByText("Save");
}

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    recentHandleStore.clear();
    vi.clearAllMocks();
    mockNavigationType("navigate");
  });

  it("shows the welcome screen again on reentry even when a local project exists", () => {
    persistLocalWorkspace("Return Later");

    render(<App />);

    expect(screen.getByText("3Forge Editor")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue where you left off/i })).toBeTruthy();
    expect(screen.queryByTestId("viewport-host")).toBeNull();
  });

  it("skips the welcome screen on reload when the workspace session is still active", () => {
    persistLocalWorkspace("Reloaded Session");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);

    expect(screen.getByTestId("viewport-host")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue where you left off/i })).toBeNull();
  });

  it("continues from the persisted local project on demand", () => {
    persistLocalWorkspace("Resume Me");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Continue where you left off/i }));

    expect(screen.getByTestId("viewport-host")).toBeTruthy();
    expect(screen.getByDisplayValue("Resume Me")).toBeTruthy();
  });

  it("exits to the launcher without losing the persisted local project", async () => {
    persistLocalWorkspace("Exit Flow");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    await openFileMenu();
    fireEvent.click(screen.getByText("Exit"));

    await screen.findByRole("button", { name: /Continue where you left off/i });
    expect(screen.queryByTestId("viewport-host")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Continue where you left off/i }));
    expect(screen.getByDisplayValue("Exit Flow")).toBeTruthy();
  });

  it("imports a file into recents and reopens it later from the welcome screen", async () => {
    const { container } = render(<App />);
    const jsonInput = container.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
    const blueprint = createDefaultBlueprint();
    blueprint.componentName = "Recent Fixture";
    const file = new File([JSON.stringify(blueprint)], "recent-fixture.json", { type: "application/json" });

    fireEvent.change(jsonInput, { target: { files: [file] } });

    await screen.findByDisplayValue("Recent Fixture");
    await openFileMenu();
    fireEvent.click(screen.getByText("Exit"));

    const recentPanel = screen.getByText("Open recent").closest("section");
    expect(recentPanel).toBeTruthy();
    await within(recentPanel as HTMLElement).findByRole("button", { name: /remove recent-fixture\.json from recents/i });
    const recentButton = getRecentOpenButton(recentPanel as HTMLElement, /recent-fixture\.json/i);
    fireEvent.click(recentButton);

    await screen.findByDisplayValue("Recent Fixture");
    expect(screen.getByTestId("viewport-host")).toBeTruthy();
  });

  it("keeps a history of multiple recent projects instead of overwriting the current one", async () => {
    const { container } = render(<App />);

    for (const name of ["Alpha", "Beta", "Gamma"]) {
      const jsonInput = container.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
      const blueprint = createDefaultBlueprint();
      blueprint.componentName = name;
      const file = new File([JSON.stringify(blueprint)], `${name.toLowerCase()}.json`, { type: "application/json" });

      fireEvent.change(jsonInput, { target: { files: [file] } });
      await screen.findByDisplayValue(name);
      await openFileMenu();
      fireEvent.click(screen.getByText("Exit"));
    }

    const recentPanel = screen.getByText("Open recent").closest("section");
    expect(recentPanel).toBeTruthy();
    expect(getRecentOpenButton(recentPanel as HTMLElement, /alpha\.json/i)).toBeTruthy();
    expect(getRecentOpenButton(recentPanel as HTMLElement, /beta\.json/i)).toBeTruthy();
    expect(getRecentOpenButton(recentPanel as HTMLElement, /gamma\.json/i)).toBeTruthy();
  });

  it("removes a recent project from the launcher when requested", async () => {
    const { container } = render(<App />);

    for (const name of ["Alpha", "Beta"]) {
      const jsonInput = container.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
      const blueprint = createDefaultBlueprint();
      blueprint.componentName = name;
      const file = new File([JSON.stringify(blueprint)], `${name.toLowerCase()}.json`, { type: "application/json" });

      fireEvent.change(jsonInput, { target: { files: [file] } });
      await screen.findByDisplayValue(name);
      await openFileMenu();
      fireEvent.click(screen.getByText("Exit"));
    }

    const recentPanel = screen.getByText("Open recent").closest("section");
    expect(recentPanel).toBeTruthy();
    fireEvent.click(within(recentPanel as HTMLElement).getByRole("button", { name: /remove beta\.json from recents/i }));

    expect(within(recentPanel as HTMLElement).queryByRole("button", { name: /^beta\.json$/i })).toBeNull();
    expect(getRecentOpenButton(recentPanel as HTMLElement, /alpha\.json/i)).toBeTruthy();
  });

  it("saves back to the opened file when overwrite is available", async () => {
    const blueprint = createDefaultBlueprint();
    blueprint.componentName = "Linked File";
    const handle = {
      name: "linked-file.json",
      getFile: vi.fn(async () => new File([JSON.stringify(blueprint)], "linked-file.json", { type: "application/json" })),
      createWritable: vi.fn(),
    };

    fileAccessMocks.supportsFileSystemAccess.mockReturnValue(true);
    fileAccessMocks.openBlueprintWithPicker.mockResolvedValue({
      handle,
      blueprint,
      fileName: "linked-file.json",
    });
    fileAccessMocks.saveBlueprintToExistingHandle.mockResolvedValue({ status: "saved", handle });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Open file/i }));
    await screen.findByDisplayValue("Linked File");
    await openFileMenu();
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(fileAccessMocks.saveBlueprintToExistingHandle).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Saved linked-file.json.")).toBeTruthy();
  });

  it("falls back to Save As when overwrite permission is denied", async () => {
    const blueprint = createDefaultBlueprint();
    blueprint.componentName = "Denied Save";
    const handle = {
      name: "denied-save.json",
      getFile: vi.fn(async () => new File([JSON.stringify(blueprint)], "denied-save.json", { type: "application/json" })),
      createWritable: vi.fn(),
    };
    const saveAsHandle = {
      name: "denied-save-copy.json",
      getFile: vi.fn(async () => new File([JSON.stringify(blueprint)], "denied-save-copy.json", { type: "application/json" })),
      createWritable: vi.fn(),
    };

    fileAccessMocks.supportsFileSystemAccess.mockReturnValue(true);
    fileAccessMocks.openBlueprintWithPicker.mockResolvedValue({
      handle,
      blueprint,
      fileName: "denied-save.json",
    });
    fileAccessMocks.saveBlueprintToExistingHandle.mockResolvedValue({ status: "permission-denied" });
    fileAccessMocks.saveBlueprintAs.mockResolvedValue({ status: "saved", handle: saveAsHandle });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Open file/i }));
    await screen.findByDisplayValue("Denied Save");
    await openFileMenu();
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(fileAccessMocks.saveBlueprintAs).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Saved denied-save-copy.json.")).toBeTruthy();
  });

  it("keeps the footer visible and removes the timeline dock cleanly when the timeline is hidden", () => {
    persistLocalWorkspace("Timeline Layout");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    const { container } = render(<App />);
    const appShell = container.querySelector(".app-shell");
    const shellBody = container.querySelector(".app-shell__body");
    const footer = container.querySelector("footer.statusbar");

    expect(appShell?.children[2]).toBe(shellBody ?? null);
    expect(appShell?.children[3]).toBe(footer ?? null);
    expect(shellBody?.querySelector(".app-shell__timeline-dock")).toBeTruthy();
    expect(screen.getByText("local workspace saved")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Timeline On" }));

    expect(appShell?.children[2]).toBe(shellBody ?? null);
    expect(appShell?.children[3]).toBe(footer ?? null);
    expect(shellBody?.querySelector(".app-shell__timeline-dock")).toBeFalsy();
    expect(screen.getByRole("button", { name: "Timeline Off" })).toBeTruthy();
  });

  it("keeps copy-paste group behaviour working inside the hierarchy", () => {
    persistLocalWorkspace("Copy Paste");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    const { container } = render(<App />);
    const hierarchyPanel = screen.getByText("Hierarchy").closest("section");
    expect(hierarchyPanel).toBeTruthy();

    const componentInput = screen.getByDisplayValue("Copy Paste");
    expect(componentInput).toBeTruthy();
    const sceneRows = container.querySelectorAll(".scene-row");
    fireEvent.click(sceneRows[1] as HTMLElement);
    fireEvent.keyDown(window, { ctrlKey: true, key: "c" });
    fireEvent.keyDown(window, { ctrlKey: true, key: "v" });

    expect(within(hierarchyPanel as HTMLElement).getAllByText(/Copy$/).length).toBeGreaterThanOrEqual(1);
  });
});
