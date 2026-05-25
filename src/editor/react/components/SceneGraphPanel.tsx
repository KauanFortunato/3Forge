import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent } from "react";
import type { EditorNode, ModelAsset, ModelAssetStructureNode, ModelNode } from "../../types";
import { ROOT_NODE_ID } from "../../state";
import type { TreeBranch, TreeDropTarget } from "../ui-types";
import {
  BoxIcon,
  CapsuleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  ClosedEyeIcon,
  ConeIcon,
  CopyIcon,
  CylinderIcon,
  EyeIcon,
  GroupIcon,
  ImageIcon,
  MeshIcon,
  ModelIcon,
  PlaneIcon,
  PolyhedronIcon,
  RingIcon,
  SearchIcon,
  SphereIcon,
  TextPropertyIcon,
  TorusIcon,
  TorusKnotIcon,
  TrashIcon,
} from "./icons";

interface SceneGraphPanelProps {
  nodes: EditorNode[];
  models?: ModelAsset[];
  animatedNodeIds: Set<string>;
  selectedNodeId: string;
  selectedNodeIds: string[];
  selectedPartId?: string | null;
  collapsedIds: Set<string>;
  onCollapsedIdsChange: (collapsedIds: Set<string>) => void;
  onSelectNode: (nodeId: string, additive: boolean) => void;
  onSelectPart?: (modelNodeId: string, partId: string | null) => void;
  onMoveNode: (nodeId: string, target: TreeDropTarget) => void;
  onToggleVisibility: (nodeId: string) => void;
  onTogglePartVisibility?: (modelNodeId: string, partId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onContextMenu: (event: MouseEvent, nodeId: string | null) => void;
}

// Composite key for part-collapse state in the shared collapsedIds set.
// Format: `${modelNodeId}::${partIndexPath}` — picked because both segments
// can't contain "::" (node IDs are uuids/`root`, part IDs are dotted indices).
function partCollapseKey(modelNodeId: string, partId: string): string {
  return `${modelNodeId}::${partId}`;
}

export function SceneGraphPanel(props: SceneGraphPanelProps) {
  const {
    nodes,
    models = [],
    animatedNodeIds,
    selectedNodeId,
    selectedNodeIds,
    selectedPartId = null,
    collapsedIds,
    onCollapsedIdsChange,
    onSelectNode,
    onSelectPart = () => {},
    onMoveNode,
    onToggleVisibility,
    onTogglePartVisibility = () => {},
    onDuplicateNode = () => {},
    onDeleteNode = () => {},
    onContextMenu,
  } = props;
  const branches = useMemo(() => buildTree(nodes), [nodes]);
  const modelsById = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
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
      // Two flavours of collapse keys live in this set:
      //   - plain node IDs (group / model nodes from the blueprint)
      //   - composite part keys "<modelNodeId>::<partId>" produced by
      //     partCollapseKey() for synthetic part rows
      // Keep node IDs that still exist, and keep all composite keys whose
      // owning model node still exists.
      if (id.includes("::")) {
        const [ownerId] = id.split("::");
        if (ownerId && validNodeIds.has(ownerId)) {
          next.add(id);
        }
        continue;
      }
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

  const allRows: Row[] = useMemo(
    () => flattenBranches(branches, collapsedIds, 0, null, modelsById),
    [branches, collapsedIds, modelsById],
  );
  const rows: Row[] = useMemo(() => {
    if (!visibleNodeIds) {
      return allRows;
    }
    return allRows.filter((row) => visibleNodeIds.has(row.kind === "node" ? row.branch.node.id : row.modelNodeId));
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
          <div className="sg-tree__content">
            {rows.map((row) => {
              if (row.kind === "part") {
                const modelNode = nodes.find((n) => n.id === row.modelNodeId) as ModelNode | undefined;
                const isHidden = modelNode?.partVisibility?.[row.partId] === false;
                const isSelected =
                  selectedNodeId === row.modelNodeId && selectedPartId === row.partId;
                return (
                  <SceneGraphPartRow
                    key={`${row.modelNodeId}::${row.partId}`}
                    row={row}
                    isSelected={isSelected}
                    isHidden={!!isHidden}
                    isCollapsed={collapsedIds.has(partCollapseKey(row.modelNodeId, row.partId))}
                    onToggleCollapse={() => {
                      const key = partCollapseKey(row.modelNodeId, row.partId);
                      const next = new Set(collapsedIds);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      onCollapsedIdsChange(next);
                    }}
                    onSelect={() => onSelectPart(row.modelNodeId, row.partId)}
                    onToggleVisibility={() => onTogglePartVisibility(row.modelNodeId, row.partId)}
                  />
                );
              }
              return (
                <SceneGraphRow
                  key={row.branch.node.id}
                  row={row}
                  modelsById={modelsById}
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface BranchRow {
  kind: "node";
  branch: TreeBranch;
  depth: number;
  parentId: string | null;
  siblingIndex: number;
  siblingCount: number;
}

interface PartRow {
  kind: "part";
  modelNodeId: string;
  partId: string;
  name: string;
  type: string;
  hasChildren: boolean;
  meshCount: number;
  depth: number;
}

type Row = BranchRow | PartRow;

function flattenBranches(
  branches: TreeBranch[],
  collapsedIds: Set<string>,
  depth: number,
  parentId: string | null,
  modelsById: Map<string, ModelAsset>,
): Row[] {
  const rows: Row[] = [];
  branches.forEach((branch, siblingIndex) => {
    rows.push({
      kind: "node",
      branch,
      depth,
      parentId,
      siblingIndex,
      siblingCount: branches.length,
    });
    const isGroup = branch.node.type === "group";
    const isCollapsed = (isGroup || branch.node.type === "model") && collapsedIds.has(branch.node.id);

    if (isGroup && !isCollapsed && branch.children.length > 0) {
      rows.push(...flattenBranches(branch.children, collapsedIds, depth + 1, branch.node.id, modelsById));
    }

    // Append synthetic part rows from the model's structure when expanded.
    if (branch.node.type === "model" && !isCollapsed) {
      const modelNode = branch.node as ModelNode;
      const asset = modelsById.get(modelNode.modelId);
      const structureRoots = asset?.structure?.roots;
      if (structureRoots && structureRoots.length > 0) {
        for (const partRoot of structureRoots) {
          appendPartRows(rows, partRoot, modelNode.id, depth + 1, collapsedIds);
        }
      }
    }
  });
  return rows;
}

function appendPartRows(
  rows: Row[],
  part: ModelAssetStructureNode,
  modelNodeId: string,
  depth: number,
  collapsedIds: Set<string>,
): void {
  rows.push({
    kind: "part",
    modelNodeId,
    partId: part.id,
    name: part.name,
    type: part.type,
    hasChildren: part.children.length > 0,
    meshCount: part.meshCount,
    depth,
  });
  const key = partCollapseKey(modelNodeId, part.id);
  if (collapsedIds.has(key)) return;
  for (const child of part.children) {
    appendPartRows(rows, child, modelNodeId, depth + 1, collapsedIds);
  }
}

interface SceneGraphRowProps {
  row: BranchRow;
  modelsById: Map<string, ModelAsset>;
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

  const isSceneRootNode = branch.node.parentId === null;
  const isLegacyRootGroup = branch.node.id === ROOT_NODE_ID && branch.node.type === "group" && branch.node.parentId === null;
  const isGroup = branch.node.type === "group";
  const isModel = branch.node.type === "model";
  // A model node is "expandable" when its imported structure has parts —
  // chevron + collapse work the same way as groups in that case.
  const modelStructure = isModel
    ? props.modelsById.get((branch.node as ModelNode).modelId)?.structure
    : undefined;
  const modelHasParts = (modelStructure?.roots.length ?? 0) > 0;
  const isExpandable = isGroup || (isModel && modelHasParts);
  const hasChildren = isGroup ? branch.children.length > 0 : modelHasParts;
  const isCollapsed = isExpandable && collapsedIds.has(branch.node.id);
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
        isSceneRootNode ? "is-root" : "",
        isGroup ? "is-group" : isModel ? "is-model" : "is-mesh",
        !branch.node.visible ? "is-hidden-node" : "",
        rowDropState ? `is-drop-${rowDropState}` : "",
        draggedNodeId === branch.node.id ? "is-dragging" : "",
      ].filter(Boolean).join(" ")}
      role="treeitem"
      style={indentStyle}
      tabIndex={isSelected ? 0 : -1}
      aria-selected={isSelected}
      aria-expanded={isGroup ? !isCollapsed : undefined}
      draggable={!isLegacyRootGroup}
      onClick={(event) => onSelectNode(branch.node.id, event.shiftKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectNode(branch.node.id, event.shiftKey);
        }

        if (isExpandable && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
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
        if (isLegacyRootGroup) {
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
          className={`sg-row__chev${hasChildren && isExpandable ? "" : " is-hidden"}`}
          onClick={(event) => {
            event.stopPropagation();
            if (isExpandable) {
              onToggleNode(branch.node.id);
            }
          }}
          aria-label={isCollapsed ? "Expand group" : "Collapse group"}
          tabIndex={-1}
        >
          {isExpandable ? (
            isCollapsed ? <ChevronRightIcon width={10} height={10} /> : <ChevronDownIcon width={10} height={10} />
          ) : null}
        </button>

        <span className="sg-row__icon">{getNodeTypeIcon(branch.node)}</span>

        <span className="sg-row__name">{branch.node.name}</span>
      </div>

      <span className="sg-row__badge">
        {hasAnimation ? "anim" : isGroup ? `${branch.children.length}` : ""}
      </span>

      <button
        type="button"
        className={`sg-row__ibtn sg-row__ibtn--vis${!branch.node.visible ? " is-off" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleVisibility(branch.node.id);
        }}
        title={branch.node.visible ? "Hide item" : "Show item"}
        tabIndex={-1}
      >
        {branch.node.visible ? <EyeIcon width={12} height={12} /> : <ClosedEyeIcon width={12} height={12} />}
      </button>

      <div className="sg-row__actions">
        <button
          type="button"
          className="sg-row__ibtn"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicateNode(branch.node.id);
          }}
          title="Duplicate"
          tabIndex={-1}
          disabled={isLegacyRootGroup}
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
          disabled={false}
        >
          <TrashIcon width={11} height={11} />
        </button>
      </div>
    </div>
  );
}

interface SceneGraphPartRowProps {
  row: PartRow;
  isSelected: boolean;
  isHidden: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
  onToggleVisibility: () => void;
}

function SceneGraphPartRow(props: SceneGraphPartRowProps) {
  const { row, isSelected, isHidden, isCollapsed, onToggleCollapse, onSelect, onToggleVisibility } = props;
  const indentStyle: CSSProperties = { "--indent": String(row.depth) } as CSSProperties;
  const isMeshLike = row.type === "mesh" || row.type === "Mesh";

  return (
    <div
      className={[
        "sg-row",
        "sg-row--part",
        isSelected ? "is-selected" : "",
        isHidden ? "is-hidden-part" : "",
        isMeshLike ? "is-mesh" : "is-group",
      ].filter(Boolean).join(" ")}
      role="treeitem"
      style={indentStyle}
      tabIndex={isSelected ? 0 : -1}
      aria-selected={isSelected}
      aria-expanded={row.hasChildren ? !isCollapsed : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
        if (row.hasChildren && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          const shouldExpand = event.key === "ArrowRight";
          if (shouldExpand === isCollapsed) {
            event.preventDefault();
            onToggleCollapse();
          }
        }
      }}
    >
      <div className="sg-row__main">
        <button
          type="button"
          className={`sg-row__chev${row.hasChildren ? "" : " is-hidden"}`}
          onClick={(event) => {
            event.stopPropagation();
            if (row.hasChildren) onToggleCollapse();
          }}
          aria-label={isCollapsed ? "Expand part" : "Collapse part"}
          tabIndex={-1}
        >
          {row.hasChildren ? (
            isCollapsed ? <ChevronRightIcon width={10} height={10} /> : <ChevronDownIcon width={10} height={10} />
          ) : null}
        </button>
        <span className="sg-row__icon">
          {isMeshLike ? <MeshIcon width={12} height={12} /> : <GroupIcon width={12} height={12} />}
        </span>
        <span className="sg-row__name">{row.name}</span>
      </div>
      <span className="sg-row__badge">
        {row.hasChildren ? `${row.meshCount}` : ""}
      </span>
      <button
        type="button"
        className={`sg-row__ibtn sg-row__ibtn--vis${isHidden ? " is-off" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleVisibility();
        }}
        title={isHidden ? "Show part" : "Hide part"}
        tabIndex={-1}
      >
        {isHidden ? <ClosedEyeIcon width={12} height={12} /> : <EyeIcon width={12} height={12} />}
      </button>
      <div className="sg-row__actions" />
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
    case "cone":
      return <ConeIcon {...iconProps} />;
    case "capsule":
      return <CapsuleIcon {...iconProps} />;
    case "ring":
      return <RingIcon {...iconProps} />;
    case "torus":
      return <TorusIcon {...iconProps} />;
    case "torusKnot":
      return <TorusKnotIcon {...iconProps} />;
    case "dodecahedron":
    case "icosahedron":
    case "octahedron":
    case "tetrahedron":
      return <PolyhedronIcon {...iconProps} />;
    case "plane":
      return <PlaneIcon {...iconProps} />;
    case "text":
      return <TextPropertyIcon {...iconProps} />;
    case "image":
      return <ImageIcon {...iconProps} />;
    case "model":
      return <ModelIcon {...iconProps} />;
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
  const rect = event.currentTarget.getBoundingClientRect();
  const offsetY = event.clientY - rect.top;
  const ratio = rect.height > 0 ? offsetY / rect.height : 0.5;
  const parentId = branch.node.parentId ?? null;

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
