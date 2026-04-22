import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnimationClip, createAnimationKeyframe, createAnimationTrack } from "../animation";
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
const exportPackageMocks = vi.hoisted(() => ({
  createExportPackageZip: vi.fn(async () => ({
    fileName: "fixture.zip",
    blob: new Blob(["zip-content"], { type: "application/zip" }),
  })),
}));

vi.mock("../fileAccess", async () => {
  const actual = await vi.importActual("../fileAccess");
  return {
    ...actual,
    ...fileAccessMocks,
  };
});

vi.mock("../exportPackage", () => ({
  createExportPackageZip: exportPackageMocks.createExportPackageZip,
}));

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
  const buttons = within(container).getAllByRole("button");
  const match = buttons.find((button) => (
    button.classList.contains("landing-recent__open")
      && pattern.test(button.textContent ?? "")
  ));
  if (!match) {
    throw new Error(`Recent open button not found for ${pattern}`);
  }
  return match as HTMLButtonElement;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
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
    setViewportWidth(1280);
    window.localStorage.clear();
    window.sessionStorage.clear();
    recentHandleStore.clear();
    vi.clearAllMocks();
    mockNavigationType("navigate");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("shows the welcome screen again on reentry even when a local project exists", () => {
    persistLocalWorkspace("Return Later");

    render(<App />);

    expect(screen.getByText("3Forge Editor")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue where you left off/i })).toBeTruthy();
    expect(screen.queryByTestId("viewport-host")).toBeNull();
  });

  it("adapts the launcher copy for phone layouts", () => {
    persistLocalWorkspace("Pocket Resume");
    setViewportWidth(390);

    const { container } = render(<App />);

    expect(screen.getByRole("heading", { name: "3Forge" })).toBeTruthy();
    expect(screen.getByText("Phone mode is focused on loading projects and playing timelines. Use tablet or desktop for full editing.")).toBeTruthy();
    expect(screen.getByText("Recent projects")).toBeTruthy();
    expect(screen.queryByText("Full editor")).toBeNull();
    expect(container.querySelector(".app-shell--landing")).toBeTruthy();
    expect(container.querySelector(".landing-page__logo-image")).toBeTruthy();
    expect(container.querySelector(".landing-page__quick-actions")).toBeTruthy();
  });

  it("skips the welcome screen on reload when the workspace session is still active", () => {
    persistLocalWorkspace("Reloaded Session");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);

    expect(screen.getByTestId("viewport-host")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue where you left off/i })).toBeNull();
  });

  it("switches to a phone viewer shell on narrow screens", () => {
    persistLocalWorkspace("Pocket Review");
    markWorkspaceSessionActive();
    mockNavigationType("reload");
    setViewportWidth(390);

    render(<App />);

    expect(screen.getByRole("heading", { name: "Pocket Review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Exit project" })).toBeTruthy();
    expect(screen.getByTestId("viewport-host")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "File" })).toBeNull();
    expect(screen.queryByDisplayValue("Pocket Review")).toBeNull();
  });

  it("keeps the editor chrome available on tablet layouts", () => {
    persistLocalWorkspace("Tablet Edit");
    markWorkspaceSessionActive();
    mockNavigationType("reload");
    setViewportWidth(900);

    render(<App />);

    expect(screen.getByRole("button", { name: "File" })).toBeTruthy();
    expect(screen.getByDisplayValue("Tablet Edit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Exit project" })).toBeNull();
  });

  it("offers playback controls on phone layouts without mounting the editor timeline", () => {
    const blueprint = createDefaultBlueprint();
    blueprint.componentName = "Phone Motion";
    const panelNode = blueprint.nodes.find((node) => node.name === "Hero Panel");
    const track = createAnimationTrack(panelNode?.id ?? blueprint.nodes[1]?.id ?? "node", "transform.position.y");
    track.keyframes = [
      createAnimationKeyframe(0, 0.8),
      createAnimationKeyframe(24, 1.3),
    ];
    const clip = createAnimationClip("intro", { durationFrames: 48, tracks: [track] });
    blueprint.animation = {
      activeClipId: clip.id,
      clips: [clip],
    };
    persistWorkspace(blueprint, createWorkspaceProjectContext());
    markWorkspaceSessionActive();
    mockNavigationType("reload");
    setViewportWidth(390);

    render(<App />);

    expect(screen.getByRole("combobox", { name: "Animation clip" })).toBeTruthy();
    expect(screen.queryByText("Tracks")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
    expect(fakeScene.playAnimation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Stop animation" }));
    expect(fakeScene.stopAnimation).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("slider", { name: "Animation progress" }), { target: { value: "12" } });
    expect(fakeScene.seekAnimation).toHaveBeenCalledWith(12);
  });

  it("lets all-keyframes mode select and edit keys from other objects", async () => {
    const blueprint = createDefaultBlueprint();
    blueprint.componentName = "Timeline Focus";
    const panelNode = blueprint.nodes.find((node) => node.name === "Hero Panel");
    const accentNode = blueprint.nodes.find((node) => node.name === "Accent Plate");
    const panelTrack = createAnimationTrack(panelNode?.id ?? "panel-node", "transform.position.x");
    panelTrack.keyframes = [
      createAnimationKeyframe(0, 0),
      createAnimationKeyframe(12, 1),
    ];
    const accentTrack = createAnimationTrack(accentNode?.id ?? "accent-node", "transform.position.y");
    accentTrack.keyframes = [
      createAnimationKeyframe(0, 0.55),
      createAnimationKeyframe(18, 1.2),
    ];
    const clip = createAnimationClip("intro", { durationFrames: 48, tracks: [panelTrack, accentTrack] });
    blueprint.animation = {
      activeClipId: clip.id,
      clips: [clip],
    };
    persistWorkspace(blueprint, createWorkspaceProjectContext());
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "All keyframes" }));

    const keyframes = document.querySelectorAll(".animation-keyframe");
    expect(keyframes.length).toBe(4);

    fireEvent.click(keyframes[2] as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText("Accent Plate | Mesh")).toBeTruthy();
      expect(document.querySelector(".animation-keyframe.is-selected")).toBeTruthy();
    });
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

  it("keeps distinct linked file handles for different recent blueprints", async () => {
    const alphaBlueprint = createDefaultBlueprint();
    alphaBlueprint.componentName = "Alpha Linked";
    const betaBlueprint = createDefaultBlueprint();
    betaBlueprint.componentName = "Beta Linked";

    const alphaHandle = {
      name: "alpha-linked.json",
      getFile: vi.fn(async () => new File([JSON.stringify(alphaBlueprint)], "alpha-linked.json", { type: "application/json" })),
      createWritable: vi.fn(),
    };
    const betaHandle = {
      name: "beta-linked.json",
      getFile: vi.fn(async () => new File([JSON.stringify(betaBlueprint)], "beta-linked.json", { type: "application/json" })),
      createWritable: vi.fn(),
    };

    fileAccessMocks.supportsFileSystemAccess.mockReturnValue(true);
    fileAccessMocks.openBlueprintWithPicker
      .mockResolvedValueOnce({
        handle: alphaHandle,
        blueprint: alphaBlueprint,
        fileName: "alpha-linked.json",
      })
      .mockResolvedValueOnce({
        handle: betaHandle,
        blueprint: betaBlueprint,
        fileName: "beta-linked.json",
      });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Open file/i }));
    await screen.findByDisplayValue("Alpha Linked");
    await openFileMenu();
    fireEvent.click(screen.getByText("Exit"));

    fireEvent.click(screen.getByRole("button", { name: /Open file/i }));
    await screen.findByDisplayValue("Beta Linked");
    await openFileMenu();
    fireEvent.click(screen.getByText("Exit"));

    const recentPanel = screen.getByText("Open recent").closest("section");
    expect(recentPanel).toBeTruthy();

    fireEvent.click(getRecentOpenButton(recentPanel as HTMLElement, /alpha-linked\.json/i));
    await screen.findByDisplayValue("Alpha Linked");
    expect(screen.queryByDisplayValue("Beta Linked")).toBeNull();
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

  it("shows File > Export submenu entries and triggers ZIP package download", async () => {
    persistLocalWorkspace("Package Fixture");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    await openFileMenu();

    const fileMenu = document.querySelector(".menu-bar__dropdown .menu-surface");
    expect(fileMenu).toBeTruthy();

    fireEvent.mouseEnter(within(fileMenu as HTMLElement).getByRole("button", { name: "Export" }));

    await screen.findByRole("button", { name: "TypeScript" });
    expect(screen.getByRole("button", { name: "Blueprint" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ZIP file" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ZIP file" }));

    await waitFor(() => {
      expect(exportPackageMocks.createExportPackageZip).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });
  });

  it("toggles collapse and expand all from the hierarchy header", () => {
    persistLocalWorkspace("Hierarchy Toggle");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    const hierarchyTree = screen.getByRole("tree", { name: "Scene hierarchy" });

    expect(within(hierarchyTree).getByText("Hero Panel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(within(hierarchyTree).queryByText("Hero Panel")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand all" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));

    expect(within(hierarchyTree).getByText("Hero Panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeTruthy();
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

  it("toggles the timeline dock from keyboard and keeps the preference persisted", () => {
    persistLocalWorkspace("Timeline Hotkey");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    const { container } = render(<App />);
    const shellBody = container.querySelector(".app-shell__body");

    expect(shellBody?.querySelector(".app-shell__timeline-dock")).toBeTruthy();
    expect(window.localStorage.getItem("3forge-timeline-visible")).toBe("true");

    fireEvent.keyDown(window, { key: "t" });

    expect(shellBody?.querySelector(".app-shell__timeline-dock")).toBeFalsy();
    expect(screen.getByRole("button", { name: "Timeline Off" })).toBeTruthy();
    expect(window.localStorage.getItem("3forge-timeline-visible")).toBe("false");

    fireEvent.keyDown(window, { key: "t" });

    expect(shellBody?.querySelector(".app-shell__timeline-dock")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Timeline On" })).toBeTruthy();
    expect(window.localStorage.getItem("3forge-timeline-visible")).toBe("true");
  });

  it("does not toggle the timeline dock from keyboard while typing in an input", () => {
    persistLocalWorkspace("Typing Guard");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    const { container } = render(<App />);
    const shellBody = container.querySelector(".app-shell__body");
    const componentNameInput = screen.getByDisplayValue("Typing Guard");

    expect(shellBody?.querySelector(".app-shell__timeline-dock")).toBeTruthy();

    componentNameInput.focus();
    fireEvent.keyDown(componentNameInput, { key: "t" });

    expect(shellBody?.querySelector(".app-shell__timeline-dock")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Timeline On" })).toBeTruthy();
    expect(window.localStorage.getItem("3forge-timeline-visible")).toBe("true");
  });

  it("lists the timeline toggle hotkey in the shortcuts dialog", async () => {
    persistLocalWorkspace("Shortcut Help");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(await screen.findByRole("button", { name: "Shortcuts" }));

    expect(await screen.findByRole("heading", { name: "Shortcuts" })).toBeTruthy();
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByText("Toggle timeline")).toBeTruthy();
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

  it("supports shared material editing from a real multi-selection in the inspector", async () => {
    const user = userEvent.setup();
    persistLocalWorkspace("Multi Material");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    const hierarchyTree = screen.getByRole("tree", { name: "Scene hierarchy" });
    const heroRow = within(hierarchyTree).getByText("Hero Panel").closest('[role="treeitem"]') as HTMLElement;
    const accentRow = within(hierarchyTree).getByText("Accent Plate").closest('[role="treeitem"]') as HTMLElement;

    fireEvent.click(heroRow);
    fireEvent.click(accentRow, { shiftKey: true });

    expect(screen.getByText("2 objects")).toBeTruthy();
    expect(screen.getByLabelText("Color").getAttribute("placeholder")).toBe("Mixed");

    const colorInput = screen.getByLabelText("Color");
    await user.clear(colorInput);
    await user.type(colorInput, "#224466");
    fireEvent.blur(colorInput);

    fireEvent.click(heroRow);
    await user.click(screen.getByTitle("Material"));
    expect((screen.getByLabelText("Color") as HTMLInputElement).value).toBe("#224466");

    fireEvent.click(accentRow);
    await user.click(screen.getByTitle("Material"));
    expect((screen.getByLabelText("Color") as HTMLInputElement).value).toBe("#224466");
  });
});
