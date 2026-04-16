import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_AUTOSAVE_KEY, ROOT_NODE_ID, createNode } from "../state";
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

vi.mock("./components/ViewportHost", () => ({
  ViewportHost: ({ onSceneReady }: { onSceneReady: (scene: typeof fakeScene | null) => void }) => {
    useEffect(() => {
      onSceneReady(fakeScene);
      return () => onSceneReady(null);
    }, [onSceneReady]);

    return <div data-testid="viewport-host" />;
  },
}));

function createAutosaveBlueprint() {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";
  const group = createNode("group", ROOT_NODE_ID, "group-1");
  group.name = "Fixture Group";
  const child = createNode("plane", group.id, "plane-1");
  child.name = "Plane Child";

  return {
    version: 1 as const,
    componentName: "Fixture",
    fonts: [],
    nodes: [root, group, child],
    animation: {
      activeClipId: "",
      clips: [],
    },
  };
}

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    window.localStorage.setItem("3forge-autosave-enabled", "true");
    window.localStorage.setItem(EDITOR_AUTOSAVE_KEY, JSON.stringify(createAutosaveBlueprint()));
  });

  it("pastes a copied group into the selected group and reveals it in the hierarchy", () => {
    render(<App />);

    const hierarchyPanel = screen.getByText("Hierarchy").closest("section");
    expect(hierarchyPanel).toBeTruthy();

    const groupRow = within(hierarchyPanel as HTMLElement).getByText("Fixture Group").closest(".scene-row");
    expect(groupRow).toBeTruthy();
    fireEvent.click(within(groupRow as HTMLElement).getByRole("button", { name: "Collapse group" }));
    fireEvent.click(groupRow as HTMLElement);
    fireEvent.keyDown(window, { ctrlKey: true, key: "c" });
    fireEvent.keyDown(window, { ctrlKey: true, key: "v" });

    expect(screen.getByText('Pasted "Fixture Group Copy".')).toBeTruthy();
    expect(within(hierarchyPanel as HTMLElement).getAllByText("Fixture Group Copy")).toHaveLength(1);
    expect(within(hierarchyPanel as HTMLElement).getAllByText("Plane Child")).toHaveLength(2);
  });
});
