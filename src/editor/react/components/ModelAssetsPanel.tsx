import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { ModelAsset, ModelAssetStructureNode } from "../../types";
import { ChevronDownIcon, ChevronRightIcon, FileIcon, GroupIcon, MeshIcon, ObjectDataIcon } from "./icons";

interface ModelAssetsPanelProps {
  models: ModelAsset[];
  selectedModelId: string | null;
  usageById: Record<string, number>;
  onSelectModel: (modelId: string | null) => void;
}

export function ModelAssetsPanel(props: ModelAssetsPanelProps) {
  const { models, selectedModelId, usageById, onSelectModel } = props;
  const [expandedModelIds, setExpandedModelIds] = useState<Set<string>>(() => new Set());
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());

  const defaultExpandedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const model of models) {
      for (const root of model.structure?.roots ?? []) {
        ids.add(createNodeKey(model.id, root.id));
      }
    }
    return ids;
  }, [models]);

  const toggleModel = (modelId: string) => {
    setExpandedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const toggleNode = (nodeKey: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) {
        next.delete(nodeKey);
      } else {
        next.add(nodeKey);
      }
      return next;
    });
  };

  return (
    <div className="model-assets-panel">
      <div className="model-assets-panel__head">
        <span>Models</span>
        <span>{models.length} asset{models.length === 1 ? "" : "s"}</span>
      </div>

      {models.length === 0 ? (
        <div className="panel__empty">
          No imported models yet.
        </div>
      ) : (
        <div className="model-assets-panel__list">
          {models.map((model) => {
            const isActive = model.id === selectedModelId;
            const isExpanded = expandedModelIds.has(model.id);
            const structure = model.structure;
            const usage = usageById[model.id] ?? 0;
            return (
              <div
                key={model.id}
                className={`model-assets-panel__item${isActive ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="model-assets-panel__item-main"
                  onClick={() => {
                    onSelectModel(model.id);
                    toggleModel(model.id);
                  }}
                  aria-label={`Inspect ${model.name}`}
                  title={`Inspect ${model.name}`}
                >
                  <span className="model-assets-panel__thumb" aria-hidden="true">
                    <FileIcon width={14} height={14} />
                  </span>
                  <span className="model-assets-panel__meta">
                    <span className="model-assets-panel__name">{model.name}</span>
                    <span className="model-assets-panel__sub">
                      {formatModelSummary(model, usage)}
                    </span>
                  </span>
                  <span className="model-assets-panel__toggle" aria-hidden="true">
                    {isExpanded ? <ChevronDownIcon width={10} height={10} /> : <ChevronRightIcon width={10} height={10} />}
                  </span>
                </button>

                {isExpanded ? (
                  <div className="model-assets-panel__details">
                    {structure ? (
                      <>
                        <div className="model-assets-panel__stats">
                          <span>{structure.nodeCount} nodes</span>
                          <span>{structure.meshCount} meshes</span>
                          <span>{structure.materialCount} materials</span>
                          <span>{structure.textureCount} textures</span>
                        </div>
                        <div className="model-assets-panel__tree" role="tree" aria-label={`${model.name} contents`}>
                          {structure.roots.map((node) => (
                            <ModelTreeNode
                              key={node.id}
                              modelId={model.id}
                              node={node}
                              depth={0}
                              defaultExpandedNodeIds={defaultExpandedNodeIds}
                              expandedNodeIds={expandedNodeIds}
                              onToggleNode={toggleNode}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="model-assets-panel__empty">
                        Structure unavailable for this asset.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ModelTreeNodeProps {
  modelId: string;
  node: ModelAssetStructureNode;
  depth: number;
  defaultExpandedNodeIds: Set<string>;
  expandedNodeIds: Set<string>;
  onToggleNode: (nodeKey: string) => void;
}

function ModelTreeNode(props: ModelTreeNodeProps) {
  const { modelId, node, depth, defaultExpandedNodeIds, expandedNodeIds, onToggleNode } = props;
  const nodeKey = createNodeKey(modelId, node.id);
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodeIds.has(nodeKey) || defaultExpandedNodeIds.has(nodeKey);
  const icon = node.type.toLowerCase() === "mesh"
    ? <MeshIcon width={11} height={11} />
    : hasChildren
      ? <GroupIcon width={11} height={11} />
      : <ObjectDataIcon width={11} height={11} />;

  return (
    <div className="model-assets-panel__tree-row-wrap">
      <button
        type="button"
        className="model-assets-panel__tree-row"
        style={{ "--tree-depth": depth } as CSSProperties}
        onClick={() => {
          if (hasChildren) {
            onToggleNode(nodeKey);
          }
        }}
        disabled={!hasChildren}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
      >
        <span className="model-assets-panel__tree-toggle" aria-hidden="true">
          {hasChildren
            ? isExpanded
              ? <ChevronDownIcon width={9} height={9} />
              : <ChevronRightIcon width={9} height={9} />
            : null}
        </span>
        <span className="model-assets-panel__tree-icon" aria-hidden="true">{icon}</span>
        <span className="model-assets-panel__tree-name">{node.name}</span>
        <span className="model-assets-panel__tree-type">{node.type}</span>
      </button>
      {hasChildren && isExpanded ? (
        <div role="group">
          {node.children.map((child) => (
            <ModelTreeNode
              key={child.id}
              modelId={modelId}
              node={child}
              depth={depth + 1}
              defaultExpandedNodeIds={defaultExpandedNodeIds}
              expandedNodeIds={expandedNodeIds}
              onToggleNode={onToggleNode}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function createNodeKey(modelId: string, nodeId: string): string {
  return `${modelId}:${nodeId}`;
}

function formatModelSummary(model: ModelAsset, usage: number): string {
  const format = model.format.toUpperCase();
  const structure = model.structure;
  if (!structure) {
    return `${format} - ${usage} use${usage === 1 ? "" : "s"}`;
  }
  return `${format} - ${structure.meshCount} mesh${structure.meshCount === 1 ? "" : "es"} - ${usage} use${usage === 1 ? "" : "s"}`;
}
