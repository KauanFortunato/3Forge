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

    const groupRow = screen.getByText("Fixture Group").closest(".sg-row");
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

    const primaryRows = container.querySelectorAll(".sg-row.is-primary");
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
    expect(container.querySelectorAll(".sg-row.is-primary")).toHaveLength(0);
  });

  it("filters visible nodes by substring match on the search query", () => {
    const store = createHierarchyStore();

    render(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId=""
        selectedNodeIds={[]}
        collapsedIds={new Set()}
        onCollapsedIdsChange={vi.fn()}
        onSelectNode={vi.fn()}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText("Search nodes…");
    fireEvent.change(searchInput, { target: { value: "Plane" } });

    expect(screen.getByText("Plane Child")).toBeTruthy();
    expect(screen.queryByText("Fixture Group")).toBeTruthy(); // ancestor of match stays visible
    expect(screen.queryByText("Component Root")).toBeTruthy(); // root ancestor stays visible
  });

  it("performs case-insensitive matching", () => {
    const store = createHierarchyStore();

    render(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId=""
        selectedNodeIds={[]}
        collapsedIds={new Set()}
        onCollapsedIdsChange={vi.fn()}
        onSelectNode={vi.fn()}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText("Search nodes…");
    fireEvent.change(searchInput, { target: { value: "plane" } });

    expect(screen.getByText("Plane Child")).toBeTruthy();

    fireEvent.change(searchInput, { target: { value: "FIXTURE" } });
    expect(screen.getByText("Fixture Group")).toBeTruthy();
  });

  it("restores the full node list when the query is cleared", () => {
    const store = createHierarchyStore();

    render(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId=""
        selectedNodeIds={[]}
        collapsedIds={new Set()}
        onCollapsedIdsChange={vi.fn()}
        onSelectNode={vi.fn()}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText("Search nodes…") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "Plane" } });
    fireEvent.change(searchInput, { target: { value: "" } });

    expect(screen.getByText("Component Root")).toBeTruthy();
    expect(screen.getByText("Fixture Group")).toBeTruthy();
    expect(screen.getByText("Plane Child")).toBeTruthy();
  });

  it("shows an empty-state message when no nodes match the query", () => {
    const store = createHierarchyStore();

    render(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId=""
        selectedNodeIds={[]}
        collapsedIds={new Set()}
        onCollapsedIdsChange={vi.fn()}
        onSelectNode={vi.fn()}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText("Search nodes…");
    fireEvent.change(searchInput, { target: { value: "nothingmatches" } });

    expect(screen.getByText("No nodes match")).toBeTruthy();
    expect(screen.queryByText("Component Root")).toBeNull();
    expect(screen.queryByText("Fixture Group")).toBeNull();
    expect(screen.queryByText("Plane Child")).toBeNull();
  });

  it("does not modify selection or collapse state while searching", () => {
    const store = createHierarchyStore();
    const handleSelectNode = vi.fn();
    const handleCollapsedIdsChange = vi.fn();

    render(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId=""
        selectedNodeIds={[]}
        collapsedIds={new Set(["group-1"])}
        onCollapsedIdsChange={handleCollapsedIdsChange}
        onSelectNode={handleSelectNode}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    // "Fixture Group" is collapsed — "Plane Child" should not be visible.
    expect(screen.queryByText("Plane Child")).toBeNull();

    handleCollapsedIdsChange.mockClear();

    const searchInput = screen.getByPlaceholderText("Search nodes…");
    fireEvent.change(searchInput, { target: { value: "Plane" } });

    // Typing a search query must not fire selection or collapse callbacks.
    expect(handleSelectNode).not.toHaveBeenCalled();
    expect(handleCollapsedIdsChange).not.toHaveBeenCalled();

    fireEvent.change(searchInput, { target: { value: "" } });

    expect(handleSelectNode).not.toHaveBeenCalled();
    expect(handleCollapsedIdsChange).not.toHaveBeenCalled();

    // And the tree still reflects the original collapse state.
    expect(screen.queryByText("Plane Child")).toBeNull();
  });

  it("clears the search query when Escape is pressed in the input", () => {
    const store = createHierarchyStore();

    render(
      <SceneGraphPanel
        nodes={store.blueprint.nodes}
        animatedNodeIds={new Set()}
        selectedNodeId=""
        selectedNodeIds={[]}
        collapsedIds={new Set()}
        onCollapsedIdsChange={vi.fn()}
        onSelectNode={vi.fn()}
        onMoveNode={vi.fn()}
        onToggleVisibility={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText("Search nodes…") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "Plane" } });
    expect(searchInput.value).toBe("Plane");

    fireEvent.keyDown(searchInput, { key: "Escape" });

    expect(searchInput.value).toBe("");
    expect(screen.getByText("Component Root")).toBeTruthy();
    expect(screen.getByText("Fixture Group")).toBeTruthy();
    expect(screen.getByText("Plane Child")).toBeTruthy();
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
