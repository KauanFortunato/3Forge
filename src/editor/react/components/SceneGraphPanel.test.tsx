import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
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
    const handleSelectNode = vi.fn();

    function ControlledPanel(props: {
      nodes: ReturnType<typeof createHierarchyStore>["blueprint"]["nodes"];
      selectedNodeId: string;
      selectedNodeIds: string[];
    }) {
      const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

      return (
        <SceneGraphPanel
          nodes={props.nodes}
          animatedNodeIds={new Set()}
          selectedNodeId={props.selectedNodeId}
          selectedNodeIds={props.selectedNodeIds}
          collapsedIds={collapsedIds}
          onCollapsedIdsChange={setCollapsedIds}
          onSelectNode={handleSelectNode}
          onMoveNode={vi.fn()}
          onToggleVisibility={vi.fn()}
          onContextMenu={vi.fn()}
        />
      );
    }

    const { rerender } = render(
      <ControlledPanel
        nodes={store.blueprint.nodes}
        selectedNodeId="group-1"
        selectedNodeIds={["group-1"]}
      />,
    );

    const groupRow = screen.getByText("Fixture Group").closest(".scene-row");
    expect(groupRow).toBeTruthy();
    fireEvent.click(within(groupRow as HTMLElement).getByRole("button", { name: "Collapse group" }));

    store.pasteNodeSubtrees([groupSubtree], "group-1");

    rerender(
      <ControlledPanel
        nodes={store.blueprint.nodes}
        selectedNodeId={store.selectedNodeId}
        selectedNodeIds={store.selectedNodeIds}
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
        collapsedIds={new Set()}
        onCollapsedIdsChange={vi.fn()}
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

  it("adds the is-primary class only to the primary row when multiple nodes are selected", () => {
    const store = createHierarchyStore();

    const { container, rerender } = render(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId="plane-1"
        selectedNodeIds={["group-1", "plane-1"]}
        collapsedIds={new Set()}
        onCollapsedIdsChange={vi.fn()}
        onSelectNode={vi.fn()}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    const primaryRows = container.querySelectorAll(".scene-row.is-primary");
    expect(primaryRows).toHaveLength(1);
    const primaryRow = primaryRows[0] as HTMLElement;
    expect(within(primaryRow).getByText("Plane Child")).toBeTruthy();

    // When only one node is selected, no row gets is-primary.
    rerender(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId="plane-1"
        selectedNodeIds={["plane-1"]}
        collapsedIds={new Set()}
        onCollapsedIdsChange={vi.fn()}
        onSelectNode={vi.fn()}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    expect(container.querySelectorAll(".scene-row.is-primary")).toHaveLength(0);
  });

  it("honors externally controlled collapse state changes", () => {
    const store = createHierarchyStore();

    function Harness() {
      const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

      return (
        <>
          <button type="button" onClick={() => setCollapsedIds(new Set(["group-1"]))}>
            Collapse all
          </button>
          <button type="button" onClick={() => setCollapsedIds(new Set())}>
            Expand all
          </button>
          <SceneGraphPanel
            nodes={store.blueprint.nodes}
            animatedNodeIds={new Set()}
            selectedNodeId=""
            selectedNodeIds={[]}
            collapsedIds={collapsedIds}
            onCollapsedIdsChange={setCollapsedIds}
            onSelectNode={vi.fn()}
            onMoveNode={vi.fn()}
            onToggleVisibility={vi.fn()}
            onContextMenu={vi.fn()}
          />
        </>
      );
    }

    render(<Harness />);

    expect(screen.getByText("Plane Child")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("Plane Child")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("Plane Child")).toBeTruthy();
  });
});
