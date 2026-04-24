import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent } from "react";
import type { EditorNode } from "../../types";
import type { TreeBranch, TreeDropTarget } from "../ui-types";
import {
  BoxIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  ClosedEyeIcon,
  CopyIcon,
  CylinderIcon,
  EyeIcon,
  GroupIcon,
  ImageIcon,
  MeshIcon,
  PlaneIcon,
  SearchIcon,
  SphereIcon,
  TextPropertyIcon,
  TrashIcon,
} from "./icons";

interface SceneGraphPanelProps {
  nodes: EditorNode[];
  animatedNodeIds: Set<string>;
  selectedNodeId: string;
  selectedNodeIds: string[];
  collapsedIds: Set<string>;
  onCollapsedIdsChange: (collapsedIds: Set<string>) => void;
  onSelectNode: (nodeId: string, additive: boolean) => void;
  onMoveNode: (nodeId: string, target: TreeDropTarget) => void;
  onToggleVisibility: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onContextMenu: (event: MouseEvent, nodeId: string | null) => void;
}

export function SceneGraphPanel(props: SceneGraphPanelProps) {
  const {
    nodes,
    animatedNodeIds,
    selectedNodeId,
    selectedNodeIds,
    collapsedIds,
    onCollapsedIdsChange,
    onSelectNode,
    onMoveNode,
    onToggleVisibility,
    onDuplicateNode = () => {},
    onDeleteNode = () => {},
    onContextMenu,
  } = props;
  const branches = useMemo(() => buildTree(nodes), [nodes]);
  const firstBranchId = branches[0]?.node.id ?? null;
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const validNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const selectedNodeIdsSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedPathIds = useMemo(() => buildSelectedPathSet(nodeMap, selectedNodeIds), [nodeMap, selectedNodeIds]);
  const selectionRevealIds = useMemo(() => buildSelectionRevealSet(selectedNodeIds, selectedPathIds), [selectedNodeIds, selectedPathIds]);
  const selectionRevealKey = useMemo(() => Array.from(selectionRevealIds).sort().join("|"), [selectionRevealIds]);
  const lastSelectionRevealKeyRef = useRef<string | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TreeDropTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const trimmedQuery = searchQuery.trim();
  const hasActiveQuery = trimmedQuery.length > 0;
  const visibleNodeIds = useMemo(
    () => (hasActiveQuery ? buildQueryMatchSet(branches, trimmedQuery) : null),
    [branches, hasActiveQuery, trimmedQuery],
  );

  useEffect(() => {
    const next = new Set<string>();
    for (const id of collapsedIds) {
      if (validNodeIds.has(id)) {
        next.add(id);
      }
    }

    if (next.size === collapsedIds.size) {
      let changed = false;
      for (const id of collapsedIds) {
        if (!next.has(id)) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        return;
      }
    }

    onCollapsedIdsChange(next);
  }, [collapsedIds, onCollapsedIdsChange, validNodeIds]);

  useEffect(() => {
    if (lastSelectionRevealKeyRef.current === selectionRevealKey) {
      return;
    }
    lastSelectionRevealKeyRef.current = selectionRevealKey;

    const next = new Set(collapsedIds);
    for (const id of selectionRevealIds) {
      next.delete(id);
    }

    if (next.size === collapsedIds.size) {
      let changed = false;
      for (const id of collapsedIds) {
        if (!next.has(id)) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        return;
      }
    }

    onCollapsedIdsChange(next);
  }, [collapsedIds, onCollapsedIdsChange, selectionRevealIds, selectionRevealKey]);

  const toggleNode = (nodeId: string) => {
    const next = new Set(collapsedIds);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    onCollapsedIdsChange(next);
  };

  const clearDragState = () => {
    setDraggedNodeId(null);
    setDropTarget(null);
  };

  const allRows: BranchRow[] = useMemo(() => flattenBranches(branches, collapsedIds, 0, null), [branches, collapsedIds]);
  const rows: BranchRow[] = useMemo(() => {
    if (!visibleNodeIds) {
      return allRows;
    }
    return allRows.filter((row) => visibleNodeIds.has(row.branch.node.id));
  }, [allRows, visibleNodeIds]);
  const showEmptyState = hasActiveQuery && rows.length === 0;

  return (
    <div className="sg-panel">
      <div className="sg-toolbar">
        <div className={`sg-search${hasActiveQuery ? " is-active" : ""}`}>
          <span className="sg-search__icon" aria-hidden="true">
            <SearchIcon width={11} height={11} />
          </span>
          <input
            type="text"
            className="sg-search__input"
            placeholder="Search nodes…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchQuery.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                setSearchQuery("");
              }
            }}
            aria-label="Search nodes"
          />
        </div>
      </div>
      {showEmptyState ? (
        <div className="sg-tree__empty" role="status">No nodes match</div>
      ) : (
        <div
          className="sg-tree"
          role="tree"
          aria-label="Scene hierarchy"
          tabIndex={selectedNodeIds.length === 0 ? 0 : -1}
          onKeyDown={(event) => {
            if (selectedNodeIds.length > 0 || !firstBranchId) {
              return;
            }

            if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              onSelectNode(firstBranchId, false);
            }
          }}
          onContextMenu={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              onContextMenu(event, null);
            }
          }}
        >
          {rows.map((row) => (
            <SceneGraphRow
              key={row.branch.node.id}
              row={row}
              selectedNodeId={selectedNodeId}
              selectedNodeIds={selectedNodeIdsSet}
              selectedPathIds={selectedPathIds}
              collapsedIds={collapsedIds}
              draggedNodeId={draggedNodeId}
              dropTarget={dropTarget}
              animatedNodeIds={animatedNodeIds}
              onToggleNode={toggleNode}
              onSelectNode={onSelectNode}
              onMoveNode={onMoveNode}
              onToggleVisibility={onToggleVisibility}
              onDuplicateNode={onDuplicateNode}
              onDeleteNode={onDeleteNode}
              onContextMenu={onContextMenu}
              onDragStateChange={(nextDragged, nextDropTarget) => {
                setDraggedNodeId(nextDragged);
                setDropTarget(nextDropTarget);
              }}
              onClearDragState={clearDragState}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface BranchRow {
  branch: TreeBranch;
  depth: number;
  parentId: string | null;
  siblingIndex: number;
  siblingCount: number;
}

function flattenBranches(
  branches: TreeBranch[],
  collapsedIds: Set<string>,
  depth: number,
  parentId: string | null,
): BranchRow[] {
  const rows: BranchRow[] = [];
  branches.forEach((branch, siblingIndex) => {
    rows.push({
      branch,
      depth,
      parentId,
      siblingIndex,
      siblingCount: branches.length,
    });
    const isGroup = branch.node.type === "group";
    const isCollapsed = isGroup && collapsedIds.has(branch.node.id);
    if (isGroup && !isCollapsed && branch.children.length > 0) {
      rows.push(...flattenBranches(branch.children, collapsedIds, depth + 1, branch.node.id));
    }
  });
  return rows;
}

interface SceneGraphRowProps {
  row: BranchRow;
  selectedNodeId: string;
  selectedNodeIds: Set<string>;
  selectedPathIds: Set<string>;
  collapsedIds: Set<string>;
  draggedNodeId: string | null;
  dropTarget: TreeDropTarget | null;
  animatedNodeIds: Set<string>;
  onToggleNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string, additive: boolean) => void;
  onMoveNode: (nodeId: string, target: TreeDropTarget) => void;
  onToggleVisibility: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onContextMenu: (event: MouseEvent, nodeId: string | null) => void;
  onDragStateChange: (draggedNodeId: string | null, target: TreeDropTarget | null) => void;
  onClearDragState: () => void;
}

function SceneGraphRow(props: SceneGraphRowProps) {
  const {
    row,
    selectedNodeId,
    selectedNodeIds,
    selectedPathIds,
    collapsedIds,
    draggedNodeId,
    dropTarget,
    animatedNodeIds,
    onToggleNode,
    onSelectNode,
    onMoveNode,
    onToggleVisibility,
    onDuplicateNode,
    onDeleteNode,
    onContextMenu,
    onDragStateChange,
    onClearDragState,
  } = props;
  const { branch, depth, siblingIndex, siblingCount } = row;

  const isRoot = branch.node.parentId === null;
  const isGroup = branch.node.type === "group";
  const hasChildren = branch.children.length > 0;
  const isCollapsed = isGroup && collapsedIds.has(branch.node.id);
  const isSelected = selectedNodeIds.has(branch.node.id);
  const isPrimary = isSelected && selectedNodeIds.size > 1 && selectedNodeId === branch.node.id;
  const isAncestor = !isSelected && selectedPathIds.has(branch.node.id);
  const rowDropState = getDropState(dropTarget, branch.node.id);
  const hasAnimation = animatedNodeIds.has(branch.node.id);

  const indentStyle: CSSProperties = { "--indent": String(depth) } as CSSProperties;

  return (
    <div
      className={[
        "sg-row",
        isSelected ? "is-selected" : "",
        isPrimary ? "is-primary" : "",
        isAncestor ? "is-ancestor" : "",
        isRoot ? "is-root" : "",
        isGroup ? "is-group" : "is-mesh",
        rowDropState ? `is-drop-${rowDropState}` : "",
        draggedNodeId === branch.node.id ? "is-dragging" : "",
      ].filter(Boolean).join(" ")}
      role="treeitem"
      style={indentStyle}
      tabIndex={isSelected ? 0 : -1}
      aria-selected={isSelected}
      aria-expanded={isGroup ? !isCollapsed : undefined}
      draggable={!isRoot}
      onClick={(event) => onSelectNode(branch.node.id, event.shiftKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectNode(branch.node.id, event.shiftKey);
        }

        if (isGroup && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          const shouldExpand = event.key === "ArrowRight";
          if (shouldExpand === isCollapsed) {
            event.preventDefault();
            onToggleNode(branch.node.id);
          }
        }
      }}
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
      <div className="sg-row__main">
        <button
          type="button"
          className={`sg-row__chev${hasChildren && isGroup ? "" : " is-hidden"}`}
          onClick={(event) => {
            event.stopPropagation();
            if (isGroup) {
              onToggleNode(branch.node.id);
            }
          }}
          aria-label={isCollapsed ? "Expand group" : "Collapse group"}
          tabIndex={-1}
        >
          {isGroup ? (
            isCollapsed ? <ChevronRightIcon width={10} height={10} /> : <ChevronDownIcon width={10} height={10} />
          ) : null}
        </button>

        <span className="sg-row__icon">{getNodeTypeIcon(branch.node)}</span>

        <span className="sg-row__name">{branch.node.name}</span>
      </div>

      <span className="sg-row__badge">
        {hasAnimation ? "anim" : isGroup ? `${branch.children.length}` : ""}
      </span>

      <div className="sg-row__actions">
        <button
          type="button"
          className={`sg-row__ibtn${!branch.node.visible ? " is-off" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleVisibility(branch.node.id);
          }}
          title={branch.node.visible ? "Hide item" : "Show item"}
          tabIndex={-1}
        >
          {branch.node.visible ? <EyeIcon width={12} height={12} /> : <ClosedEyeIcon width={12} height={12} />}
        </button>
        <button
          type="button"
          className="sg-row__ibtn"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicateNode(branch.node.id);
          }}
          title="Duplicate"
          tabIndex={-1}
          disabled={isRoot}
        >
          <CopyIcon width={11} height={11} />
        </button>
        <button
          type="button"
          className="sg-row__ibtn"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteNode(branch.node.id);
          }}
          title="Delete"
          tabIndex={-1}
          disabled={isRoot}
        >
          <TrashIcon width={11} height={11} />
        </button>
      </div>
    </div>
  );
}

function getNodeTypeIcon(node: EditorNode) {
  const iconProps = { width: 12, height: 12 };

  switch (node.type) {
    case "group":
      return <GroupIcon {...iconProps} />;
    case "box":
      return <BoxIcon {...iconProps} />;
    case "circle":
      return <CircleIcon {...iconProps} />;
    case "sphere":
      return <SphereIcon {...iconProps} />;
    case "cylinder":
      return <CylinderIcon {...iconProps} />;
    case "plane":
      return <PlaneIcon {...iconProps} />;
    case "text":
      return <TextPropertyIcon {...iconProps} />;
    case "image":
      return <ImageIcon {...iconProps} />;
    default:
      return <MeshIcon {...iconProps} />;
  }
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

function buildQueryMatchSet(branches: TreeBranch[], query: string): Set<string> {
  const needle = query.toLowerCase();
  const result = new Set<string>();

  const visit = (branch: TreeBranch, ancestors: string[]): boolean => {
    let subtreeMatches = false;
    for (const child of branch.children) {
      if (visit(child, [...ancestors, branch.node.id])) {
        subtreeMatches = true;
      }
    }

    const selfMatches = branch.node.name.toLowerCase().includes(needle);
    if (selfMatches || subtreeMatches) {
      result.add(branch.node.id);
      if (selfMatches) {
        for (const ancestorId of ancestors) {
          result.add(ancestorId);
        }
      }
      return true;
    }

    return false;
  };

  for (const branch of branches) {
    visit(branch, []);
  }

  return result;
}

function buildSelectionRevealSet(selectedNodeIds: string[], selectedPathIds: Set<string>): Set<string> {
  const revealIds = new Set(selectedPathIds);
  for (const nodeId of selectedNodeIds) {
    revealIds.add(nodeId);
  }
  return revealIds;
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
