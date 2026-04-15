import { useEffect, useMemo, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import type { EditorNode } from "../../types";
import type { TreeBranch, TreeDropTarget } from "../ui-types";
import { ChevronDownIcon, ChevronRightIcon, ClosedEyeIcon, EyeIcon, GroupIcon, MeshIcon } from "./icons";

interface SceneGraphPanelProps {
  nodes: EditorNode[];
  animatedNodeIds: Set<string>;
  selectedNodeId: string;
  selectedNodeIds: string[];
  onSelectNode: (nodeId: string, additive: boolean) => void;
  onMoveNode: (nodeId: string, target: TreeDropTarget) => void;
  onToggleVisibility: (nodeId: string) => void;
  onContextMenu: (event: MouseEvent, nodeId: string | null) => void;
}

export function SceneGraphPanel(props: SceneGraphPanelProps) {
  const { nodes, animatedNodeIds, selectedNodeId, selectedNodeIds, onSelectNode, onMoveNode, onToggleVisibility, onContextMenu } = props;
  const branches = useMemo(() => buildTree(nodes), [nodes]);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNodeIdsSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedPathIds = useMemo(() => buildSelectedPathSet(nodeMap, selectedNodeIds), [nodeMap, selectedNodeIds]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TreeDropTarget | null>(null);

  useEffect(() => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      for (const id of selectedPathIds) {
        next.delete(id);
      }
      return next;
    });
  }, [selectedPathIds]);

  const clearDragState = () => {
    setDraggedNodeId(null);
    setDropTarget(null);
  };

  const toggleNode = (nodeId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  return (
    <div
      className="scene-graph"
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onContextMenu(event, null);
        }
      }}
    >
      {branches.map((branch, index) => (
        <SceneGraphBranch
          key={branch.node.id}
          branch={branch}
          parentId={null}
          siblingIndex={index}
          siblingCount={branches.length}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIdsSet}
          selectedPathIds={selectedPathIds}
          collapsedIds={collapsedIds}
          draggedNodeId={draggedNodeId}
          dropTarget={dropTarget}
          onToggleNode={toggleNode}
          onSelectNode={onSelectNode}
          onMoveNode={onMoveNode}
          onToggleVisibility={onToggleVisibility}
          animatedNodeIds={animatedNodeIds}
          onContextMenu={onContextMenu}
          onDragStateChange={(nextDragged, nextDropTarget) => {
            setDraggedNodeId(nextDragged);
            setDropTarget(nextDropTarget);
          }}
          onClearDragState={clearDragState}
        />
      ))}
    </div>
  );
}

interface SceneGraphBranchProps {
  branch: TreeBranch;
  parentId: string | null;
  siblingIndex: number;
  siblingCount: number;
  selectedNodeId: string;
  selectedNodeIds: Set<string>;
  selectedPathIds: Set<string>;
  collapsedIds: Set<string>;
  draggedNodeId: string | null;
  dropTarget: TreeDropTarget | null;
  onToggleNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string, additive: boolean) => void;
  onMoveNode: (nodeId: string, target: TreeDropTarget) => void;
  onToggleVisibility: (nodeId: string) => void;
  animatedNodeIds: Set<string>;
  onContextMenu: (event: MouseEvent, nodeId: string | null) => void;
  onDragStateChange: (draggedNodeId: string | null, target: TreeDropTarget | null) => void;
  onClearDragState: () => void;
}

function SceneGraphBranch(props: SceneGraphBranchProps) {
  const {
    branch,
    parentId,
    siblingIndex,
    siblingCount,
    selectedNodeId,
    selectedNodeIds,
    selectedPathIds,
    collapsedIds,
    draggedNodeId,
    dropTarget,
    onToggleNode,
    onSelectNode,
    onMoveNode,
    onToggleVisibility,
    animatedNodeIds,
    onContextMenu,
    onDragStateChange,
    onClearDragState,
  } = props;

  const isRoot = branch.node.parentId === null;
  const isGroup = branch.node.type === "group";
  const hasChildren = branch.children.length > 0;
  const isCollapsed = isGroup && collapsedIds.has(branch.node.id);
  const isSelected = selectedNodeIds.has(branch.node.id);
  const isAncestor = !isSelected && selectedPathIds.has(branch.node.id);
  const rowDropState = getDropState(dropTarget, branch.node.id);
  const hasAnimation = animatedNodeIds.has(branch.node.id);

  return (
    <div className={`scene-graph__branch${parentId ? " has-parent" : ""}`}>
      <div
        className={[
          "scene-row",
          isSelected ? "is-selected" : "",
          isAncestor ? "is-ancestor" : "",
          isRoot ? "is-root" : "",
          isGroup ? "is-group" : "is-mesh",
          rowDropState ? `is-drop-${rowDropState}` : "",
          draggedNodeId === branch.node.id ? "is-dragging" : "",
        ].filter(Boolean).join(" ")}
        draggable={!isRoot}
        onClick={(event) => onSelectNode(branch.node.id, event.shiftKey)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(event, branch.node.id);
        }}
        onDragStart={(event) => {
          if (isRoot) {
            event.preventDefault();
            return;
          }

          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", branch.node.id);
          onDragStateChange(branch.node.id, null);
        }}
        onDragEnd={onClearDragState}
        onDragOver={(event) => {
          if (!draggedNodeId || draggedNodeId === branch.node.id) {
            return;
          }

          const target = resolveDropTarget(branch, event, siblingIndex, siblingCount);
          if (!target) {
            return;
          }

          event.preventDefault();
          onDragStateChange(draggedNodeId, target);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const sourceNodeId = draggedNodeId ?? event.dataTransfer.getData("text/plain");
          const target = resolveDropTarget(branch, event, siblingIndex, siblingCount);
          if (sourceNodeId && target) {
            onMoveNode(sourceNodeId, target);
          }
          onClearDragState();
        }}
      >
        <div className="scene-row__main">
          {isGroup ? (
            <button
              type="button"
              className="scene-row__toggle"
              onClick={(event) => {
                event.stopPropagation();
                onToggleNode(branch.node.id);
              }}
              aria-label={isCollapsed ? "Expand group" : "Collapse group"}
            >
              {isCollapsed ? <ChevronRightIcon width={12} height={12} /> : <ChevronDownIcon width={12} height={12} />}
            </button>
          ) : (
            <span className="scene-row__toggle scene-row__toggle--spacer" />
          )}

          <span className="scene-row__icon">
            {isGroup ? <GroupIcon width={14} height={14} /> : <MeshIcon width={14} height={14} />}
          </span>

          <span className="scene-row__text">
            <span className="scene-row__name">{branch.node.name}</span>
            <span className="scene-row__subtext">{isGroup ? `${branch.children.length} children` : "Mesh node"}</span>
          </span>
        </div>

        <div className="scene-row__actions">
          <button
            type="button"
            className={`scene-row__action-btn${!branch.node.visible ? " is-hidden" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleVisibility(branch.node.id);
            }}
            title={branch.node.visible ? "Hide item" : "Show item"}
          >
            {branch.node.visible ? <EyeIcon width={14} height={14} /> : <ClosedEyeIcon width={14} height={14} />}
          </button>
        </div>

        <div className="scene-row__meta">
          {hasAnimation ? <span className="scene-row__type scene-row__type--animation">Anim</span> : null}
          <span className="scene-row__type">{isGroup ? "Group" : "Mesh"}</span>
        </div>
      </div>

      {isGroup && !isCollapsed ? (
        <div
          className="scene-graph__children"
          onContextMenu={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              onContextMenu(event, branch.node.id);
            }
          }}
        >
          {branch.children.map((child, index) => (
            <SceneGraphBranch
              key={child.node.id}
              branch={child}
              parentId={branch.node.id}
              siblingIndex={index}
              siblingCount={branch.children.length}
              selectedNodeId={selectedNodeId}
              selectedNodeIds={selectedNodeIds}
              selectedPathIds={selectedPathIds}
              collapsedIds={collapsedIds}
              draggedNodeId={draggedNodeId}
              dropTarget={dropTarget}
              onToggleNode={onToggleNode}
              onSelectNode={onSelectNode}
              onMoveNode={onMoveNode}
              onToggleVisibility={onToggleVisibility}
              animatedNodeIds={animatedNodeIds}
              onContextMenu={onContextMenu}
              onDragStateChange={onDragStateChange}
              onClearDragState={onClearDragState}
            />
          ))}

          <div
            className={`scene-graph__end-drop${dropTarget?.parentId === branch.node.id && dropTarget.position === "end" ? " is-active" : ""}`}
            onDragOver={(event) => {
              if (!draggedNodeId) {
                return;
              }

              event.preventDefault();
              onDragStateChange(draggedNodeId, {
                parentId: branch.node.id,
                index: branch.children.length,
                position: "end",
                rowNodeId: branch.node.id,
              });
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceNodeId = draggedNodeId ?? event.dataTransfer.getData("text/plain");
              if (sourceNodeId) {
                onMoveNode(sourceNodeId, {
                  parentId: branch.node.id,
                  index: branch.children.length,
                  position: "end",
                  rowNodeId: branch.node.id,
                });
              }
              onClearDragState();
            }}
          >
            Drop at end of {branch.node.name}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildTree(nodes: EditorNode[]): TreeBranch[] {
  const byParent = new Map<string | null, EditorNode[]>();

  for (const node of nodes) {
    const bucket = byParent.get(node.parentId) ?? [];
    bucket.push(node);
    byParent.set(node.parentId, bucket);
  }

  const createBranch = (node: EditorNode): TreeBranch => ({
    node,
    children: (byParent.get(node.id) ?? []).map(createBranch),
  });

  return (byParent.get(null) ?? []).map(createBranch);
}

function buildSelectedPathSet(nodeMap: Map<string, EditorNode>, selectedNodeIds: string[]): Set<string> {
  const selectedPathIds = new Set<string>();

  for (const selectedNodeId of selectedNodeIds) {
    let current = nodeMap.get(selectedNodeId) ?? null;
    while (current?.parentId) {
      selectedPathIds.add(current.parentId);
      current = nodeMap.get(current.parentId) ?? null;
    }
  }

  return selectedPathIds;
}

function resolveDropTarget(
  branch: TreeBranch,
  event: DragEvent<HTMLDivElement>,
  siblingIndex: number,
  siblingCount: number,
): TreeDropTarget | null {
  if (branch.node.parentId === null) {
    return {
      parentId: branch.node.id,
      index: branch.children.length,
      position: "inside",
      rowNodeId: branch.node.id,
    };
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const offsetY = event.clientY - rect.top;
  const ratio = rect.height > 0 ? offsetY / rect.height : 0.5;
  const parentId = branch.node.parentId ?? "root";

  if (ratio <= 0.24) {
    return {
      parentId,
      index: siblingIndex,
      position: "before",
      rowNodeId: branch.node.id,
    };
  }

  if (ratio >= 0.76) {
    return {
      parentId,
      index: Math.min(siblingIndex + 1, siblingCount),
      position: "after",
      rowNodeId: branch.node.id,
    };
  }

  if (branch.node.type === "group") {
    return {
      parentId: branch.node.id,
      index: branch.children.length,
      position: "inside",
      rowNodeId: branch.node.id,
    };
  }

  return {
    parentId,
    index: ratio < 0.5 ? siblingIndex : Math.min(siblingIndex + 1, siblingCount),
    position: ratio < 0.5 ? "before" : "after",
    rowNodeId: branch.node.id,
  };
}

function getDropState(target: TreeDropTarget | null, nodeId: string): TreeDropTarget["position"] | null {
  if (!target || target.rowNodeId !== nodeId) {
    return null;
  }

  return target.position;
}
