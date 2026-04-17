import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorStore, ROOT_NODE_ID, createNode } from "../../state";
import { SceneGraphPanel } from "./SceneGraphPanel";

function createHierarchyStore() {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";
  const group = createNode("group", ROOT_NODE_ID, "group-1");
  group.name = "Fixture Group";
  const child = createNode("plane", group.id, "plane-1");
  child.name = "Plane Child";

  return new EditorStore({
    version: 1,
    componentName: "Fixture",
    fonts: [],
    nodes: [root, group, child],
    animation: {
      activeClipId: "",
      clips: [],
    },
  });
}

describe("SceneGraphPanel", () => {
  it("reveals a pasted group immediately even when the parent group was collapsed", () => {
    const store = createHierarchyStore();
    const groupSubtree = store.getSubtreeNodes("group-1");

    const { rerender } = render(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId="group-1"
        selectedNodeIds={["group-1"]}
        onSelectNode={vi.fn()}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    const groupRow = screen.getByText("Fixture Group").closest(".scene-row");
    expect(groupRow).toBeTruthy();
    fireEvent.click(within(groupRow as HTMLElement).getByRole("button", { name: "Collapse group" }));

    store.pasteNodeSubtrees([groupSubtree], "group-1");

    rerender(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId={store.selectedNodeId}
        selectedNodeIds={store.selectedNodeIds}
        onSelectNode={vi.fn()}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    expect(screen.getByText("Fixture Group Copy")).toBeTruthy();
    expect(screen.getAllByText("Plane Child")).toHaveLength(2);
  });

  it("allows keyboard users to enter the tree when nothing is selected", () => {
    const store = createHierarchyStore();
    const handleSelectNode = vi.fn();

    render(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId=""
        selectedNodeIds={[]}
        onSelectNode={handleSelectNode}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    const tree = screen.getByRole("tree", { name: "Scene hierarchy" });
    expect(tree.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(tree, { key: "ArrowDown" });

    expect(handleSelectNode).toHaveBeenCalledWith(ROOT_NODE_ID, false);
  });
});
