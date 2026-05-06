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
const viewportHostMocks = vi.hoisted(() => ({
  onTransformObjectChange: null as null | ((nodeId: string, object: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
  }) => boolean),
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
  ViewportHost: ({
    onSceneReady,
    onTransformObjectChange,
  }: {
    onSceneReady: (scene: typeof fakeScene | null) => void;
    onTransformObjectChange?: typeof viewportHostMocks.onTransformObjectChange;
  }) => {
    viewportHostMocks.onTransformObjectChange = onTransformObjectChange ?? null;
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
    button.classList.contains("landing-recent")
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

function createAiSceneSpecFixture(componentName = "AI Lamp") {
  return {
    componentName,
    objects: [
      {
        type: "box",
        name: "Lamp Base",
        color: "#7c3aed",
        opacity: 1,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        width: 1,
        height: 0.2,
        depth: 1,
        radius: null,
        radiusTop: null,
        radiusBottom: null,
        text: null,
        size: null,
      },
    ],
  };
}

async function openFileMenu() {
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  await screen.findByText("Save As");
}

function fileMenuItem(label: string) {
  const dropdown = document.querySelector(".menu-popover") as HTMLElement | null;
  if (!dropdown) throw new Error("File menu dropdown not found");
  return within(dropdown).getByText(label);
}

describe("App", () => {
  beforeEach(() => {
    setViewportWidth(1280);
    window.localStorage.clear();
    window.sessionStorage.clear();
    recentHandleStore.clear();
    viewportHostMocks.onTransformObjectChange = null;
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
    expect(container.querySelector(".landing-overlay--phone")).toBeTruthy();
    expect(container.querySelector(".landing-hero__brand-mark")).toBeTruthy();
    expect(container.querySelector(".landing-action")).toBeTruthy();
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

  it("shows material controls only in the Material inspector tab", () => {
    persistLocalWorkspace("Material Tab");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    const hierarchyTree = screen.getByRole("tree", { name: "Scene hierarchy" });
    const heroRow = within(hierarchyTree).getByText("Hero Panel").closest('[role="treeitem"]') as HTMLElement;

    fireEvent.click(heroRow);

    expect(screen.getByRole("tab", { name: "Properties" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTitle("Material")).toBeNull();
    expect(screen.queryByLabelText("Side")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Material" }));

    expect(screen.getByTitle("Material")).toBeTruthy();
    expect(screen.getByLabelText("Side")).toBeTruthy();
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

    const keyframes = document.querySelectorAll(".tl-kf");
    expect(keyframes.length).toBe(4);

    fireEvent.click(keyframes[2] as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Accent Plate")).toBeTruthy();
      expect(document.querySelector(".tl-kf.is-selected")).toBeTruthy();
    });
  });

  it("keeps viewport gizmo edits on animated transform channels as temporary overrides", () => {
    const blueprint = createDefaultBlueprint();
    const panelNode = blueprint.nodes.find((node) => node.name === "Hero Panel");
    if (!panelNode) {
      throw new Error("Hero Panel fixture node not found");
    }

    const positionYTrack = createAnimationTrack(panelNode.id, "transform.position.y");
    positionYTrack.keyframes = [
      createAnimationKeyframe(0, 0.8),
      createAnimationKeyframe(10, 1.8),
    ];
    const rotationZTrack = createAnimationTrack(panelNode.id, "transform.rotation.z");
    rotationZTrack.keyframes = [
      createAnimationKeyframe(0, 0),
      createAnimationKeyframe(10, 1),
    ];
    const clip = createAnimationClip("intro", { durationFrames: 24, tracks: [positionYTrack, rotationZTrack] });
    blueprint.animation = {
      activeClipId: clip.id,
      clips: [clip],
    };
    persistWorkspace(blueprint, createWorkspaceProjectContext());
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);

    expect(viewportHostMocks.onTransformObjectChange).toBeTruthy();
    const handled = viewportHostMocks.onTransformObjectChange?.(panelNode.id, {
      position: { x: 0.2, y: 2.25, z: 3.5 },
      rotation: { x: 0, y: 0, z: 0.7 },
      scale: { x: 1, y: 1, z: 1 },
    });

    expect(handled).toBe(true);
    expect(fakeScene.previewAnimationValue).toHaveBeenCalledWith(panelNode.id, "transform.position.y", 2.25);
    expect(fakeScene.previewAnimationValue).toHaveBeenCalledWith(panelNode.id, "transform.rotation.z", 0.7);
    expect(fakeScene.previewAnimationValue).not.toHaveBeenCalledWith(panelNode.id, "transform.position.z", 3.5);
  });

  it("preserves other temporary channel overrides after committing one keyframe", async () => {
    const blueprint = createDefaultBlueprint();
    const panelNode = blueprint.nodes.find((node) => node.name === "Hero Panel");
    if (!panelNode) {
      throw new Error("Hero Panel fixture node not found");
    }

    const positionYTrack = createAnimationTrack(panelNode.id, "transform.position.y");
    positionYTrack.keyframes = [createAnimationKeyframe(10, 1.8)];
    const positionZTrack = createAnimationTrack(panelNode.id, "transform.position.z");
    positionZTrack.keyframes = [createAnimationKeyframe(10, 0.5)];
    const rotationZTrack = createAnimationTrack(panelNode.id, "transform.rotation.z");
    rotationZTrack.keyframes = [createAnimationKeyframe(10, 1)];
    const clip = createAnimationClip("intro", { durationFrames: 24, tracks: [positionYTrack, positionZTrack, rotationZTrack] });
    blueprint.animation = {
      activeClipId: clip.id,
      clips: [clip],
    };
    persistWorkspace(blueprint, createWorkspaceProjectContext());
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    const { container } = render(<App />);
    const hierarchyTree = screen.getByRole("tree", { name: "Scene hierarchy" });
    const heroRow = within(hierarchyTree).getByText("Hero Panel").closest('[role="treeitem"]') as HTMLElement;
    fireEvent.click(heroRow);

    viewportHostMocks.onTransformObjectChange?.(panelNode.id, {
      position: { x: 0, y: 2.25, z: 3.5 },
      rotation: { x: 0, y: 0, z: 0.7 },
      scale: { x: 1, y: 1, z: 1 },
    });

    await waitFor(() => {
      expect((screen.getByLabelText("Position Z") as HTMLInputElement).value).toBe("3.5");
    });

    fakeScene.previewAnimationValue.mockClear();
    const positionKeyButtons = Array.from(container.querySelectorAll(".vec__keyframe")) as HTMLButtonElement[];
    fireEvent.click(positionKeyButtons[2]);

    expect(fakeScene.seekAnimation).toHaveBeenCalledWith(0);
    expect(fakeScene.previewAnimationValue).toHaveBeenCalledWith(panelNode.id, "transform.position.y", 2.25);
    expect(fakeScene.previewAnimationValue).toHaveBeenCalledWith(panelNode.id, "transform.rotation.z", 0.7);
    expect(fakeScene.previewAnimationValue).not.toHaveBeenCalledWith(panelNode.id, "transform.position.z", 3.5);
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

  it("imports an AI scene spec JSON as a real blueprint", async () => {
    const { container } = render(<App />);
    const jsonInput = container.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
    const aiSceneSpec = createAiSceneSpecFixture("External AI Lamp");
    const file = new File([JSON.stringify(aiSceneSpec)], "ai-lamp.json", { type: "application/json" });

    fireEvent.change(jsonInput, { target: { files: [file] } });

    await screen.findByDisplayValue("External AI Lamp");
    expect(screen.getByText("Imported AI scene ai-lamp.json.")).toBeTruthy();
    expect(screen.getByText("blueprint / 2 nodes")).toBeTruthy();
  });

  it("imports an animation-only AI JSON patch onto the current blueprint", async () => {
    const { container } = render(<App />);
    const jsonInput = container.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
    const animationPatch = {
      animation: {
        activeClipId: "clip-main",
        clips: [
          {
            id: "clip-main",
            name: "Main",
            fps: 24,
            durationFrames: 48,
            tracks: [
              {
                id: "track-hero-panel-y",
                targetName: "Hero Panel",
                property: "transform.position.y",
                keyframes: [
                  { id: "key-0", frame: 0, value: 0, ease: "easeInOut" },
                  { id: "key-24", frame: 24, value: 0.5, ease: "backOut" },
                ],
              },
            ],
          },
        ],
      },
    };
    const file = new File([JSON.stringify(animationPatch)], "hero-animation.json", { type: "application/json" });

    fireEvent.change(jsonInput, { target: { files: [file] } });

    await screen.findByText("Imported animation hero-animation.json.");
    expect(screen.getByDisplayValue("3Forge-Component")).toBeTruthy();
    expect(screen.getByText("blueprint / 4 nodes")).toBeTruthy();
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
    fireEvent.click(fileMenuItem("Save"));

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
    fireEvent.click(fileMenuItem("Save"));

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

    const fileMenu = document.querySelector(".menu-popover");
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
    const appShell = container.querySelector(".app");
    const shellBody = container.querySelector(".app__body");
    const footer = container.querySelector("footer.statusbar");

    expect(appShell?.children[2]).toBe(shellBody ?? null);
    expect(appShell?.children[3]).toBe(footer ?? null);
    expect(shellBody?.querySelector(".app__col--center.has-timeline")).toBeTruthy();
    expect(shellBody?.querySelector(".tl")).toBeTruthy();
    expect(screen.getByText("local workspace saved")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Timeline On" }));

    expect(appShell?.children[2]).toBe(shellBody ?? null);
    expect(appShell?.children[3]).toBe(footer ?? null);
    expect(shellBody?.querySelector(".app__col--center.has-timeline")).toBeFalsy();
    expect(shellBody?.querySelector(".tl")).toBeFalsy();
    expect(screen.getByRole("button", { name: "Timeline Off" })).toBeTruthy();
  });

  it("toggles the timeline dock from keyboard and keeps the preference persisted", () => {
    persistLocalWorkspace("Timeline Hotkey");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    const { container } = render(<App />);
    const shellBody = container.querySelector(".app__body");

    expect(shellBody?.querySelector(".tl")).toBeTruthy();
    expect(window.localStorage.getItem("3forge-timeline-visible")).toBe("true");

    fireEvent.keyDown(window, { key: "t" });

    expect(shellBody?.querySelector(".tl")).toBeFalsy();
    expect(screen.getByRole("button", { name: "Timeline Off" })).toBeTruthy();
    expect(window.localStorage.getItem("3forge-timeline-visible")).toBe("false");

    fireEvent.keyDown(window, { key: "t" });

    expect(shellBody?.querySelector(".tl")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Timeline On" })).toBeTruthy();
    expect(window.localStorage.getItem("3forge-timeline-visible")).toBe("true");
  });

  it("does not toggle the timeline dock from keyboard while typing in an input", () => {
    persistLocalWorkspace("Typing Guard");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    const { container } = render(<App />);
    const shellBody = container.querySelector(".app__body");
    const componentNameInput = screen.getByDisplayValue("Typing Guard");

    expect(shellBody?.querySelector(".tl")).toBeTruthy();

    componentNameInput.focus();
    fireEvent.keyDown(componentNameInput, { key: "t" });

    expect(shellBody?.querySelector(".tl")).toBeTruthy();
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
    const sceneRows = container.querySelectorAll(".sg-row");
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
    fireEvent.click(screen.getByRole("tab", { name: "Material" }));
    expect(screen.getByTitle("Material")).toBeTruthy();
    expect(screen.getByLabelText("Color").getAttribute("placeholder")).toBe("Mixed");

    const colorInput = screen.getByLabelText("Color");
    await user.clear(colorInput);
    await user.type(colorInput, "#224466");
    fireEvent.blur(colorInput);

    fireEvent.click(heroRow);
    expect((screen.getByLabelText("Color") as HTMLInputElement).value).toBe("#224466");

    fireEvent.click(accentRow);
    expect((screen.getByLabelText("Color") as HTMLInputElement).value).toBe("#224466");
  });

  it("copies properties from the primary selection via Ctrl+Shift+C and pastes them onto another node with Ctrl+Shift+V", async () => {
    persistLocalWorkspace("Props Clipboard");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);

    const hierarchyTree = screen.getByRole("tree", { name: "Scene hierarchy" });
    const heroRow = within(hierarchyTree).getByText("Hero Panel").closest('[role="treeitem"]') as HTMLElement;
    const accentRow = within(hierarchyTree).getByText("Accent Plate").closest('[role="treeitem"]') as HTMLElement;

    fireEvent.click(heroRow);
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: "C" });

    fireEvent.click(accentRow);
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: "V" });

    // Expect a toast acknowledging the paste.
    const toast = await screen.findByRole("status");
    expect(toast.textContent ?? "").toMatch(/applied/);

    fireEvent.click(accentRow);
    fireEvent.click(screen.getByRole("tab", { name: "Material" }));

    await waitFor(() => {
      const colorInput = screen.getByLabelText("Color") as HTMLInputElement;
      expect(colorInput.value.toLowerCase()).toBe("#7c44de");
    });
  });

  it("shows Copy Properties / Paste Properties / Paste Special in the hierarchy context menu", async () => {
    persistLocalWorkspace("Props Menu");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    const hierarchyTree = screen.getByRole("tree", { name: "Scene hierarchy" });
    const heroRow = within(hierarchyTree).getByText("Hero Panel").closest('[role="treeitem"]') as HTMLElement;

    fireEvent.click(heroRow);
    fireEvent.contextMenu(heroRow);

    const menu = await waitFor(() => {
      const node = document.body.querySelector(".menu-popover--floating");
      if (!node) {
        throw new Error("context menu not rendered");
      }
      return node as HTMLElement;
    });
    expect(within(menu).getByRole("button", { name: /Copy Properties/i })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: /Paste Properties/i })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: /Paste Special/i })).toBeTruthy();
  });

  it("opens the Paste Special submenu with ArrowRight and closes it with ArrowLeft", async () => {
    persistLocalWorkspace("Props Submenu Nav");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    const hierarchyTree = screen.getByRole("tree", { name: "Scene hierarchy" });
    const heroRow = within(hierarchyTree).getByText("Hero Panel").closest('[role="treeitem"]') as HTMLElement;
    const accentRow = within(hierarchyTree).getByText("Accent Plate").closest('[role="treeitem"]') as HTMLElement;

    // Capture properties so Paste Special becomes enabled.
    fireEvent.click(heroRow);
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: "C" });

    fireEvent.click(accentRow);
    fireEvent.contextMenu(accentRow);

    const menu = await waitFor(() => {
      const node = document.body.querySelector(".menu-popover--floating");
      if (!node) {
        throw new Error("context menu not rendered");
      }
      return node as HTMLElement;
    });
    const pasteSpecialButton = within(menu).getByRole("button", { name: /Paste Special/i });
    pasteSpecialButton.focus();

    // ArrowRight opens the submenu.
    fireEvent.keyDown(pasteSpecialButton, { key: "ArrowRight" });

    await waitFor(() => {
      expect(menu.querySelector(".menu-popover__submenu")).toBeTruthy();
    });
    expect(within(menu).getByRole("button", { name: /All compatible/i })).toBeTruthy();

    // ArrowLeft inside the submenu closes it.
    const allCompatibleButton = within(menu).getByRole("button", { name: /All compatible/i });
    allCompatibleButton.focus();
    fireEvent.keyDown(allCompatibleButton, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(menu.querySelector(".menu-popover__submenu")).toBeFalsy();
    });

    // Escape dismisses the whole context menu.
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(document.body.querySelector(".menu-popover--floating")).toBeFalsy();
    });
  });

  it("activates a Paste Special scope via keyboard (Enter on a focused submenu item)", async () => {
    persistLocalWorkspace("Props Submenu Activate");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    const hierarchyTree = screen.getByRole("tree", { name: "Scene hierarchy" });
    const heroRow = within(hierarchyTree).getByText("Hero Panel").closest('[role="treeitem"]') as HTMLElement;
    const accentRow = within(hierarchyTree).getByText("Accent Plate").closest('[role="treeitem"]') as HTMLElement;

    // Capture hero properties first.
    fireEvent.click(heroRow);
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: "C" });

    fireEvent.click(accentRow);
    fireEvent.contextMenu(accentRow);

    const menu = await waitFor(() => {
      const node = document.body.querySelector(".menu-popover--floating");
      if (!node) {
        throw new Error("context menu not rendered");
      }
      return node as HTMLElement;
    });

    const pasteSpecialButton = within(menu).getByRole("button", { name: /Paste Special/i });
    pasteSpecialButton.focus();
    fireEvent.keyDown(pasteSpecialButton, { key: "ArrowRight" });

    await waitFor(() => {
      expect(menu.querySelector(".menu-popover__submenu")).toBeTruthy();
    });

    // Focus the "Material" submenu item and press Enter; the button handles
    // Enter as a native click, which routes the "material" scope through
    // handlePasteProperties.
    const materialItem = within(menu).getByRole("button", { name: /^Material$/i });
    materialItem.focus();
    fireEvent.click(materialItem);

    const toast = await screen.findByRole("status");
    expect(toast.textContent ?? "").toMatch(/applied/);

    // Accent Plate's material color should now match Hero Panel's violet.
    fireEvent.click(accentRow);
    fireEvent.click(screen.getByRole("tab", { name: "Material" }));

    await waitFor(() => {
      const colorInput = screen.getByLabelText("Color") as HTMLInputElement;
      expect(colorInput.value.toLowerCase()).toBe("#7c44de");
    });
  });

  it("disables Paste Special > Geometry when copying box geometry onto a text target (no alias)", async () => {
    persistLocalWorkspace("Props Disabled Scope");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);
    const hierarchyTree = screen.getByRole("tree", { name: "Scene hierarchy" });
    const heroRow = within(hierarchyTree).getByText("Hero Panel").closest('[role="treeitem"]') as HTMLElement;
    const headlineRow = within(hierarchyTree).getByText("Headline").closest('[role="treeitem"]') as HTMLElement;

    // Copy box geometry (width/height/depth) from Hero Panel.
    fireEvent.click(heroRow);
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: "C" });

    // Headline is a text node; box geometry has no compatible alias into text
    // geometry, so the Geometry scope must be disabled in the submenu. This
    // is how the UI communicates the "No compatible properties" state for a
    // specific scope before the user even attempts the paste.
    fireEvent.click(headlineRow);
    fireEvent.contextMenu(headlineRow);

    const menu = await waitFor(() => {
      const node = document.body.querySelector(".menu-popover--floating");
      if (!node) {
        throw new Error("context menu not rendered");
      }
      return node as HTMLElement;
    });

    const pasteSpecialButton = within(menu).getByRole("button", { name: /Paste Special/i });
    pasteSpecialButton.focus();
    fireEvent.keyDown(pasteSpecialButton, { key: "ArrowRight" });

    await waitFor(() => {
      expect(menu.querySelector(".menu-popover__submenu")).toBeTruthy();
    });

    const geometryItem = within(menu).getByRole("button", { name: /^Geometry$/i });
    expect((geometryItem as HTMLButtonElement).disabled).toBe(true);

    // Material scope should remain enabled — material.color et al. are
    // common paths that apply to every non-group node type.
    const materialItem = within(menu).getByRole("button", { name: /^Material$/i });
    expect((materialItem as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the playbar transport in the toolbar when a clip is active and plays on click", () => {
    const blueprint = createDefaultBlueprint();
    blueprint.componentName = "Playbar Fixture";
    const panelNode = blueprint.nodes.find((node) => node.name === "Hero Panel");
    const track = createAnimationTrack(panelNode?.id ?? "panel-node", "transform.position.x");
    track.keyframes = [createAnimationKeyframe(0, 0), createAnimationKeyframe(24, 1)];
    const clip = createAnimationClip("intro", { durationFrames: 48, tracks: [track] });
    blueprint.animation = { activeClipId: clip.id, clips: [clip] };
    persistWorkspace(blueprint, createWorkspaceProjectContext());
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);

    const toolbar = document.querySelector(".toolbar") as HTMLElement | null;
    expect(toolbar).toBeTruthy();
    const playbar = toolbar?.querySelector(".playbar");
    expect(playbar).toBeTruthy();

    fireEvent.click(within(playbar as HTMLElement).getByRole("button", { name: "Play" }));
    expect(fakeScene.playAnimation).toHaveBeenCalledTimes(1);
  });

  it("hides the toolbar playbar when there is no active animation clip", () => {
    persistLocalWorkspace("No Clip Fixture");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);

    const toolbar = document.querySelector(".toolbar") as HTMLElement | null;
    expect(toolbar).toBeTruthy();
    expect(toolbar?.querySelector(".playbar")).toBeNull();
  });

  it("triggers the export package download when the File > Export > ZIP menu item is clicked", async () => {
    persistLocalWorkspace("Export Toolbar");
    markWorkspaceSessionActive();
    mockNavigationType("reload");

    render(<App />);

    const fileMenuButton = screen.getByRole("button", { name: "File" });
    fireEvent.click(fileMenuButton);

    const exportItem = await screen.findByRole("button", { name: /Export/ });
    fireEvent.click(exportItem);

    const zipItem = await screen.findByRole("button", { name: "ZIP file" });
    fireEvent.click(zipItem);

    await waitFor(() => {
      expect(exportPackageMocks.createExportPackageZip).toHaveBeenCalledTimes(1);
    });
  });
});
