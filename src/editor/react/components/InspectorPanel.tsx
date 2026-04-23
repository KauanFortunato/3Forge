import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ROOT_NODE_ID, getDisplayValue, getPropertyDefinitions } from "../../state";
import { getSharedPropertyDefinitions } from "../../sharedProperties";
import type { SharedPropertyResult } from "../../sharedProperties";
import type { EditorNode, FontAsset, GroupPivotPreset, NodeOriginSpec, NodePropertyDefinition } from "../../types";
import {
  CircleFilledIcon,
  CircleIcon,
  GeometryIcon,
  ImagePropertyIcon,
  MaterialIcon,
  ObjectDataIcon,
  TextPropertyIcon,
  TransformIcon,
} from "./icons";
import { BufferedInput } from "./BufferedInput";

type InspectorSectionId = "object" | "transform" | "geometry" | "material" | "text" | "image";

interface InspectorPanelProps {
  node: EditorNode | undefined;
  nodes?: EditorNode[];
  emptyMessage?: string;
  fonts: FontAsset[];
  onNodeNameChange: (nodeId: string, value: string) => void;
  onParentChange: (nodeId: string, parentId: string) => void;
  onNodeOriginChange: (nodeId: string, origin: Partial<NodeOriginSpec>) => void;
  onGroupPivotPresetApply: (nodeId: string, preset: GroupPivotPreset) => void;
  getEligibleParents: (nodeId: string) => EditorNode[];
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onNodesPropertyChange?: (nodeIds: string[], definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
  onTextFontChange: (nodeId: string, fontId: string) => void;
  onImportFont: () => void;
  onReplaceImage: (nodeId: string) => void;
}

interface InspectorSection {
  id: InspectorSectionId;
  label: string;
  icon: ReactNode;
}

export function InspectorPanel(props: InspectorPanelProps) {
  const {
    node,
    nodes,
    emptyMessage,
    fonts,
    onNodeNameChange,
    onParentChange,
    onNodeOriginChange,
    onGroupPivotPresetApply,
    getEligibleParents,
    onNodePropertyChange,
    onNodesPropertyChange,
    onToggleEditable,
    onTextFontChange,
    onImportFont,
    onReplaceImage,
  } = props;

  const selectionNodes = useMemo(() => {
    if (nodes && nodes.length > 0) {
      return nodes;
    }
    return node ? [node] : [];
  }, [node, nodes]);
  const isMultiSelection = selectionNodes.length > 1;
  const primaryNode = isMultiSelection ? undefined : selectionNodes[0];

  const sharedObject = useMemo(
    () => getSharedPropertyDefinitions(selectionNodes, "object"),
    [selectionNodes],
  );
  const sharedTransform = useMemo(
    () => getSharedPropertyDefinitions(selectionNodes, "transform"),
    [selectionNodes],
  );
  const sharedGeometry = useMemo(
    () => getSharedPropertyDefinitions(selectionNodes, "geometry"),
    [selectionNodes],
  );
  const sharedMaterial = useMemo(
    () => getSharedPropertyDefinitions(selectionNodes, ["material", "shadow"]),
    [selectionNodes],
  );

  const sharedMaterialDefinitions = sharedMaterial.definitions;
  const hasMixedMaterialTypes = sharedMaterial.mixedPaths.has("material.type");
  const hasGroupSelection = isMultiSelection && selectionNodes.some((entry) => entry.type === "group");
  const sections = useMemo(
    () => getSectionsForSelection(primaryNode, selectionNodes, {
      object: sharedObject,
      transform: sharedTransform,
      geometry: sharedGeometry,
      material: sharedMaterial,
    }),
    [primaryNode, selectionNodes, sharedObject, sharedTransform, sharedGeometry, sharedMaterial],
  );
  const [activeSection, setActiveSection] = useState<InspectorSectionId>("object");
  const [groupPivotPreset, setGroupPivotPreset] = useState<GroupPivotPreset>("center");

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSection)) {
      setActiveSection(sections[0]?.id ?? "object");
    }
  }, [activeSection, sections]);

  useEffect(() => {
    setGroupPivotPreset("center");
  }, [primaryNode?.id]);

  if (selectionNodes.length === 0) {
    return (
      <div className="panel-empty panel-empty--card">
        <strong className="panel-empty__title">Inspector</strong>
        <span className="panel-empty__body">{emptyMessage ?? "Selecione um objeto para editar."}</span>
      </div>
    );
  }

  const groupedDefinitions = primaryNode ? groupDefinitions(getPropertyDefinitions(primaryNode)) : new Map<string, NodePropertyDefinition[]>();

  return (
    <div className="inspector-shell">
      <div className="inspector-layout">
        <div className="inspector-section-tabs">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`inspector-section-tab${activeSection === section.id ? " is-active" : ""}`}
              title={section.label}
              aria-label={section.label}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="inspector-section-tab__icon">{section.icon}</span>
              <span className="inspector-section-tab__label">{section.label}</span>
            </button>
          ))}
        </div>

        <div className="inspector-section-body">
          <div className="inspector-node-strip">
            <div className="inspector-node-strip__titles">
              <span className="inspector-node-strip__title">{isMultiSelection ? `${selectionNodes.length} objects` : primaryNode?.name}</span>
              {isMultiSelection ? (
                <SharedScopeSubline
                  object={sharedObject}
                  transform={sharedTransform}
                  geometry={sharedGeometry}
                  material={sharedMaterial}
                />
              ) : null}
            </div>
            <span className="inspector-node-strip__meta">
              {isMultiSelection ? "Multi-selection" : primaryNode?.type === "group" ? "Group" : "Mesh"}
            </span>
          </div>

          {activeSection === "object" && isMultiSelection ? (
            <section className="inspector-card">
              <div className="inspector-card__header">
                <h4>Object</h4>
                {renderExcludedNote(sharedObject, selectionNodes)}
              </div>

              <div className="inspector-simple-grid">
                {sharedObject.definitions.map((definition) => (
                  <div key={definition.path} className="field-block field-block--wide">
                    <PropertyRow
                      nodes={filterNodesByIds(selectionNodes, sharedObject.includedNodeIds)}
                      definition={definition}
                      mixedPaths={sharedObject.mixedPaths}
                      onNodePropertyChange={onNodePropertyChange}
                      onNodesPropertyChange={onNodesPropertyChange}
                      onToggleEditable={onToggleEditable}
                      allowEditableToggle={false}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {activeSection === "object" && primaryNode ? (
            <section className="inspector-card">
              <div className="inspector-card__header">
                <h4>Object</h4>
              </div>

              <div className="inspector-simple-grid">
                <label className="field-block">
                  <span className="field-block__label">Node Name</span>
                  <BufferedInput
                    className="editor-input editor-input--compact"
                    type="text"
                    value={primaryNode.name}
                    onCommit={(value) => onNodeNameChange(primaryNode.id, value)}
                  />
                </label>

                <label className="field-block">
                  <span className="field-block__label">Parent Group</span>
                  <select
                    className="editor-select"
                    value={primaryNode.parentId ?? ROOT_NODE_ID}
                    disabled={primaryNode.id === ROOT_NODE_ID}
                    onChange={(event) => onParentChange(primaryNode.id, event.target.value)}
                  >
                    {getEligibleParents(primaryNode.id).map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>

                {(groupedDefinitions.get("Object") ?? []).map((definition) => (
                  <div key={definition.path} className="field-block field-block--wide">
                    <PropertyRow
                      nodes={[primaryNode]}
                      definition={definition}
                      onNodePropertyChange={onNodePropertyChange}
                      onToggleEditable={onToggleEditable}
                    />
                  </div>
                ))}

                {primaryNode.type === "group" ? (
                  <div className="field-block field-block--wide">
                    <span className="field-block__label">Pivot From Content</span>
                    <div className="inspector-inline-actions">
                      <select
                        aria-label="Group pivot preset"
                        className="editor-select"
                        value={groupPivotPreset}
                        onChange={(event) => setGroupPivotPreset(event.target.value as GroupPivotPreset)}
                      >
                        <option value="center">Center</option>
                        <option value="bottom-center">Bottom Center</option>
                        <option value="top-center">Top Center</option>
                        <option value="left-center">Left Center</option>
                        <option value="right-center">Right Center</option>
                        <option value="front-center">Front Center</option>
                        <option value="back-center">Back Center</option>
                      </select>

                      <button
                        type="button"
                        className="tool-button"
                        onClick={() => onGroupPivotPresetApply(primaryNode.id, groupPivotPreset)}
                      >
                        Apply Pivot
                      </button>
                    </div>
                    <p className="field-block__hint">
                      Computes the group pivot from current content bounds and keeps the visible layout unchanged.
                    </p>
                  </div>
                ) : (
                  <div className="field-block field-block--wide">
                    <span className="field-block__label">Origin</span>
                    <div className="inspector-origin-grid">
                      <label className="inspector-origin-field">
                        <span>X</span>
                        <select
                          className="editor-select"
                          value={primaryNode.origin.x}
                          onChange={(event) => onNodeOriginChange(primaryNode.id, { x: event.target.value as NodeOriginSpec["x"] })}
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </label>

                      <label className="inspector-origin-field">
                        <span>Y</span>
                        <select
                          className="editor-select"
                          value={primaryNode.origin.y}
                          onChange={(event) => onNodeOriginChange(primaryNode.id, { y: event.target.value as NodeOriginSpec["y"] })}
                        >
                          <option value="top">Top</option>
                          <option value="center">Center</option>
                          <option value="bottom">Bottom</option>
                        </select>
                      </label>

                      <label className="inspector-origin-field">
                        <span>Z</span>
                        <select
                          className="editor-select"
                          value={primaryNode.origin.z}
                          onChange={(event) => onNodeOriginChange(primaryNode.id, { z: event.target.value as NodeOriginSpec["z"] })}
                        >
                          <option value="front">Front</option>
                          <option value="center">Center</option>
                          <option value="back">Back</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeSection === "transform" ? (
            <section className="inspector-card">
              <div className="inspector-card__header">
                <h4>Transform</h4>
                {isMultiSelection ? renderExcludedNote(sharedTransform, selectionNodes) : null}
              </div>

              <TransformAxisGroup
                title="Position"
                nodes={isMultiSelection ? filterNodesByIds(selectionNodes, sharedTransform.includedNodeIds) : primaryNode ? [primaryNode] : []}
                definitions={sharedTransform.definitions.filter((definition) => definition.path.startsWith("transform.position"))}
                mixedPaths={sharedTransform.mixedPaths}
                onNodePropertyChange={onNodePropertyChange}
                onNodesPropertyChange={onNodesPropertyChange}
                onToggleEditable={onToggleEditable}
              />

              <TransformAxisGroup
                title="Rotation"
                nodes={isMultiSelection ? filterNodesByIds(selectionNodes, sharedTransform.includedNodeIds) : primaryNode ? [primaryNode] : []}
                definitions={sharedTransform.definitions.filter((definition) => definition.path.startsWith("transform.rotation"))}
                mixedPaths={sharedTransform.mixedPaths}
                onNodePropertyChange={onNodePropertyChange}
                onNodesPropertyChange={onNodesPropertyChange}
                onToggleEditable={onToggleEditable}
              />

              <TransformAxisGroup
                title="Scale"
                nodes={isMultiSelection ? filterNodesByIds(selectionNodes, sharedTransform.includedNodeIds) : primaryNode ? [primaryNode] : []}
                definitions={sharedTransform.definitions.filter((definition) => definition.path.startsWith("transform.scale"))}
                mixedPaths={sharedTransform.mixedPaths}
                onNodePropertyChange={onNodePropertyChange}
                onNodesPropertyChange={onNodesPropertyChange}
                onToggleEditable={onToggleEditable}
              />
            </section>
          ) : null}

          {activeSection === "geometry" && isMultiSelection ? (
            <section className="inspector-card">
              <div className="inspector-card__header">
                <h4>Geometry</h4>
                {renderExcludedNote(sharedGeometry, selectionNodes)}
              </div>

              <div className="inspector-properties">
                {sharedGeometry.definitions.map((definition) => (
                  <PropertyRow
                    key={definition.path}
                    nodes={filterNodesByIds(selectionNodes, sharedGeometry.includedNodeIds)}
                    definition={definition}
                    mixedPaths={sharedGeometry.mixedPaths}
                    onNodePropertyChange={onNodePropertyChange}
                    onNodesPropertyChange={onNodesPropertyChange}
                    onToggleEditable={onToggleEditable}
                    allowEditableToggle={false}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {activeSection === "geometry" && primaryNode ? (
            <DefinitionSection
              title="Geometry"
              node={primaryNode}
              definitions={groupedDefinitions.get("Geometry") ?? []}
              onNodePropertyChange={onNodePropertyChange}
              onToggleEditable={onToggleEditable}
            />
          ) : null}

          {activeSection === "material" ? (
            <MaterialDefinitionSection
              nodes={isMultiSelection ? filterNodesByIds(selectionNodes, sharedMaterial.includedNodeIds) : primaryNode ? [primaryNode] : []}
              selectionCount={isMultiSelection ? selectionNodes.length : 1}
              definitions={isMultiSelection ? sharedMaterialDefinitions : groupedDefinitions.get("Material") ?? []}
              mixedPaths={isMultiSelection ? sharedMaterial.mixedPaths : undefined}
              excludedNote={isMultiSelection ? buildExcludedNote(sharedMaterial, selectionNodes) : undefined}
              onNodePropertyChange={onNodePropertyChange}
              onNodesPropertyChange={onNodesPropertyChange}
              onToggleEditable={onToggleEditable}
              allowEditableToggle={!isMultiSelection}
              hasGroupSelection={hasGroupSelection}
              hasMixedMaterialTypes={hasMixedMaterialTypes}
            />
          ) : null}

          {activeSection === "text" && primaryNode ? (
            <div className="inspector-stack">
              <section className="inspector-card">
                <div className="inspector-card__header">
                  <h4>Font</h4>
                </div>

                <label className="field-block">
                  <span className="field-block__label">Active Font</span>
                  <select
                    className="editor-select"
                    value={primaryNode.type === "text" ? primaryNode.fontId : fonts[0]?.id}
                    onChange={(event) => onTextFontChange(primaryNode.id, event.target.value)}
                  >
                    {fonts.map((font) => (
                      <option key={font.id} value={font.id}>
                        {font.name}
                      </option>
                    ))}
                  </select>
                </label>

                <button type="button" className="tool-button" onClick={onImportFont}>
                  Import font
                </button>
              </section>

              <DefinitionSection
                title="Text"
                node={primaryNode}
                definitions={groupedDefinitions.get("Text") ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />
            </div>
          ) : null}

          {activeSection === "image" && primaryNode?.type === "image" ? (
            <div className="inspector-stack">
              <section className="inspector-card">
                <div className="inspector-card__header">
                  <h4>Image</h4>
                </div>
                <div className="image-preview">
                  <img src={primaryNode.image.src} alt={primaryNode.image.name} className="image-preview__img" />
                </div>
                <p className="field-help">
                  {primaryNode.image.name} | {primaryNode.image.width} x {primaryNode.image.height} px
                </p>
                <button type="button" className="tool-button" onClick={() => onReplaceImage(primaryNode.id)}>
                  Replace image
                </button>
              </section>

              <DefinitionSection
                title="Geometry"
                node={primaryNode}
                definitions={groupedDefinitions.get("Geometry") ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />
            </div>
          ) : null}

          {sections.length === 0 ? (
            <section className="inspector-card">
              <div className="inspector-card__header">
                <h4>Inspector</h4>
              </div>
              <p className="field-help">
                {hasGroupSelection
                  ? "Material editing is only available when all selected items expose a shared material field."
                  : emptyMessage ?? "Selecione um objeto para editar."}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface DefinitionSectionProps {
  title: string;
  node: EditorNode;
  definitions: NodePropertyDefinition[];
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
}

function DefinitionSection(props: DefinitionSectionProps) {
  const { title, node, definitions, onNodePropertyChange, onToggleEditable } = props;

  return (
    <section className="inspector-card">
      <div className="inspector-card__header">
        <h4>{title}</h4>
      </div>

      <div className="inspector-properties">
        {definitions.map((definition) => (
          <PropertyRow
            key={definition.path}
            nodes={[node]}
            definition={definition}
            onNodePropertyChange={onNodePropertyChange}
            onToggleEditable={onToggleEditable}
          />
        ))}
      </div>
    </section>
  );
}

interface MaterialDefinitionSectionProps {
  nodes: EditorNode[];
  selectionCount: number;
  definitions: NodePropertyDefinition[];
  mixedPaths?: Set<string>;
  excludedNote?: string;
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onNodesPropertyChange?: (nodeIds: string[], definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
  allowEditableToggle?: boolean;
  hasGroupSelection?: boolean;
  hasMixedMaterialTypes?: boolean;
}

function MaterialDefinitionSection(props: MaterialDefinitionSectionProps) {
  const {
    nodes,
    selectionCount,
    definitions,
    mixedPaths,
    excludedNote,
    onNodePropertyChange,
    onNodesPropertyChange,
    onToggleEditable,
    allowEditableToggle = true,
    hasGroupSelection = false,
    hasMixedMaterialTypes = false,
  } = props;
  const isMultiSelection = selectionCount > 1;

  const basePaths = ["material.type", "material.color", "material.opacity", "material.transparent"];
  const pbrPaths = ["material.emissive", "material.roughness", "material.metalness"];
  const shadowPaths = ["material.castShadow", "material.receiveShadow"];

  const baseProps = definitions.filter((definition) => basePaths.includes(definition.path));
  const pbrProps = definitions.filter((definition) => pbrPaths.includes(definition.path));
  const shadowProps = definitions.filter((definition) => shadowPaths.includes(definition.path));
  const advancedProps = definitions.filter(
    (definition) =>
      !basePaths.includes(definition.path)
      && !pbrPaths.includes(definition.path)
      && !shadowPaths.includes(definition.path),
  );

  return (
    <section className="inspector-card">
      <div className="inspector-card__header">
        <h4>Material</h4>
        {isMultiSelection && excludedNote ? (
          <span className="inspector-card__note">{excludedNote}</span>
        ) : null}
      </div>

      {isMultiSelection ? (
        <p className="field-help">
          {`Applying changes to ${selectionCount} selected objects.`}
          {hasGroupSelection ? " Group items are excluded because they do not expose material controls." : ""}
          {hasMixedMaterialTypes ? " Material-specific controls stay hidden while the selection mixes different material types." : ""}
        </p>
      ) : null}

      {definitions.length === 0 ? (
        <p className="field-help">No shared material properties are available for this selection.</p>
      ) : null}

      <div className="inspector-properties">
        <div className="inspector-sub-header"><span>Base</span></div>
        {baseProps.map((definition) => (
          <PropertyRow
            key={definition.path}
            nodes={nodes}
            definition={definition}
            mixedPaths={mixedPaths}
            onNodePropertyChange={onNodePropertyChange}
            onNodesPropertyChange={onNodesPropertyChange}
            onToggleEditable={onToggleEditable}
            allowEditableToggle={allowEditableToggle}
          />
        ))}

        {pbrProps.length > 0 ? (
          <>
            <div className="inspector-sub-header"><span>Standard PBR</span></div>
            {pbrProps.map((definition) => (
              <PropertyRow
                key={definition.path}
                nodes={nodes}
                definition={definition}
                mixedPaths={mixedPaths}
                onNodePropertyChange={onNodePropertyChange}
                onNodesPropertyChange={onNodesPropertyChange}
                onToggleEditable={onToggleEditable}
                allowEditableToggle={allowEditableToggle}
              />
            ))}
          </>
        ) : null}

        {advancedProps.length > 0 ? (
          <>
            <div className="inspector-sub-header"><span>Advanced</span></div>
            {advancedProps.map((definition) => (
              <PropertyRow
                key={definition.path}
                nodes={nodes}
                definition={definition}
                mixedPaths={mixedPaths}
                onNodePropertyChange={onNodePropertyChange}
                onNodesPropertyChange={onNodesPropertyChange}
                onToggleEditable={onToggleEditable}
                allowEditableToggle={allowEditableToggle}
              />
            ))}
          </>
        ) : null}

        {shadowProps.length > 0 ? (
          <>
            <div className="inspector-sub-header"><span>Shadows</span></div>
            {shadowProps.map((definition) => (
              <PropertyRow
                key={definition.path}
                nodes={nodes}
                definition={definition}
                mixedPaths={mixedPaths}
                onNodePropertyChange={onNodePropertyChange}
                onNodesPropertyChange={onNodesPropertyChange}
                onToggleEditable={onToggleEditable}
                allowEditableToggle={allowEditableToggle}
              />
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

interface TransformAxisGroupProps {
  title: string;
  nodes: EditorNode[];
  definitions: NodePropertyDefinition[];
  mixedPaths?: Set<string>;
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onNodesPropertyChange?: (nodeIds: string[], definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
}

function TransformAxisGroup(props: TransformAxisGroupProps) {
  const { title, nodes, definitions, mixedPaths, onNodePropertyChange, onNodesPropertyChange, onToggleEditable } = props;
  const isMultiSelection = nodes.length > 1;
  const primaryNode = nodes[0];

  if (!primaryNode) {
    return null;
  }

  return (
    <div className="transform-group">
      <div className="inspector-sub-header"><span>{title}</span></div>
      <div className="transform-grid">
        {definitions.map((definition) => {
          const axis = definition.path.split(".").at(-1)?.toUpperCase() ?? "?";
          const isMixed = mixedPaths?.has(definition.path) ?? false;
          const displayValue = isMixed ? "" : String(getDisplayValue(primaryNode, definition));
          const isEditable = !isMultiSelection && Boolean(primaryNode.editable[definition.path]);

          const commit = (value: string) => {
            if (isMixed && value.trim() === "") {
              return;
            }
            if (isMultiSelection) {
              onNodesPropertyChange?.(nodes.map((entry) => entry.id), definition, value);
              return;
            }
            onNodePropertyChange(primaryNode.id, definition, value);
          };

          return (
            <div key={definition.path} className={`transform-cell${isEditable ? " is-editable" : ""}`}>
              <span className="transform-cell__axis">{axis}</span>
              <BufferedInput
                className="editor-input editor-input--compact"
                type="text"
                inputMode="decimal"
                value={displayValue}
                placeholder={isMixed ? "Mixed" : undefined}
                onCommit={commit}
              />
              {isMultiSelection ? (
                <span className="transform-cell__editable" aria-hidden="true" />
              ) : (
                <label className={`transform-cell__editable${isEditable ? " is-active" : ""}`} title="Editable at runtime">
                  <input
                    type="checkbox"
                    checked={isEditable}
                    onChange={(event) => onToggleEditable(primaryNode.id, definition, event.target.checked)}
                  />
                  {isEditable ? <CircleFilledIcon width={10} height={10} /> : <CircleIcon width={10} height={10} />}
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PropertyRowProps {
  nodes: EditorNode[];
  definition: NodePropertyDefinition;
  mixedPaths?: Set<string>;
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onNodesPropertyChange?: (nodeIds: string[], definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
  allowEditableToggle?: boolean;
}

function PropertyRow({
  nodes,
  definition,
  mixedPaths,
  onNodePropertyChange,
  onNodesPropertyChange,
  onToggleEditable,
  allowEditableToggle = true,
}: PropertyRowProps) {
  const isMultiSelection = nodes.length > 1;
  const currentValues = nodes.map((node) => getDisplayValue(node, definition));
  const currentValue = currentValues[0];
  const hasMixedValue = mixedPaths?.has(definition.path)
    ?? currentValues.some((value) => !Object.is(value, currentValue));
  const isEditable = nodes.length === 1 && Boolean(nodes[0]?.editable[definition.path]);
  const stringValue = String(currentValue);
  const editableLabel = `Editable ${definition.label}`;
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (checkboxRef.current && definition.input === "checkbox") {
      checkboxRef.current.indeterminate = hasMixedValue;
    }
  }, [definition.input, hasMixedValue]);

  const commitValue = (value: string | number | boolean) => {
    if (hasMixedValue && typeof value === "string" && value.trim() === "") {
      return;
    }

    if (isMultiSelection) {
      onNodesPropertyChange?.(nodes.map((node) => node.id), definition, value);
      return;
    }

    const primaryNode = nodes[0];
    if (!primaryNode) {
      return;
    }
    onNodePropertyChange(primaryNode.id, definition, value);
  };

  return (
    <div className={`inspector-property${isEditable ? " is-editable" : ""}`}>
      <span className="inspector-property__label">{definition.label}</span>

      <div className="inspector-property__control">
        {definition.input === "checkbox" ? (
          <input
            ref={checkboxRef}
            type="checkbox"
            className="editor-checkbox"
            aria-label={definition.label}
            checked={hasMixedValue ? false : Boolean(currentValue)}
            onChange={(event) => commitValue(event.target.checked)}
          />
        ) : definition.input === "select" ? (
          <select
            className="editor-select"
            aria-label={definition.label}
            value={hasMixedValue ? "__mixed__" : stringValue}
            onChange={(event) => commitValue(event.target.value)}
          >
            {hasMixedValue ? <option value="__mixed__">Mixed</option> : null}
            {(definition.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : definition.input === "color" ? (
          <ColorPropertyControl
            ariaLabel={definition.label}
            value={stringValue}
            placeholder={hasMixedValue ? "Mixed" : undefined}
            mixedFallbackValue={hasMixedValue ? String(currentValue) : undefined}
            onCommit={commitValue}
          />
        ) : (
          <BufferedInput
            className="editor-input editor-input--compact"
            type="text"
            aria-label={definition.label}
            inputMode={definition.input === "text" ? "text" : "decimal"}
            value={hasMixedValue ? "" : stringValue}
            placeholder={hasMixedValue ? "Mixed" : undefined}
            onCommit={(value) => commitValue(value)}
          />
        )}
      </div>

      {allowEditableToggle && nodes[0] ? (
        <label className={`inspector-property__editable${isEditable ? " is-active" : ""}`} title="Editable at runtime">
          <input
            type="checkbox"
            aria-label={editableLabel}
            checked={isEditable}
            onChange={(event) => onToggleEditable(nodes[0].id, definition, event.target.checked)}
          />
          {isEditable ? <CircleFilledIcon width={10} height={10} /> : <CircleIcon width={10} height={10} />}
        </label>
      ) : (
        <span className="inspector-property__editable" aria-hidden="true" />
      )}
    </div>
  );
}

interface ColorPropertyControlProps {
  ariaLabel: string;
  value: string;
  placeholder?: string;
  mixedFallbackValue?: string;
  onCommit: (value: string) => void;
}

function ColorPropertyControl({ ariaLabel, value, placeholder, mixedFallbackValue, onCommit }: ColorPropertyControlProps) {
  const [draftValue, setDraftValue] = useState(value);
  const [isSwatchFocused, setIsSwatchFocused] = useState(false);

  useEffect(() => {
    if (!isSwatchFocused) {
      setDraftValue(value);
    }
  }, [isSwatchFocused, value]);

  const normalizedDraftValue = normalizeCommittedColorValue(draftValue);

  return (
    <div className="inspector-color-control">
      <BufferedInput
        className="editor-input editor-input--compact inspector-color-control__hex"
        type="text"
        aria-label={ariaLabel}
        value={draftValue}
        placeholder={placeholder}
        onCommit={(nextValue) => {
          const normalizedValue = normalizeCommittedColorValue(nextValue);
          if (!normalizedValue) {
            return;
          }
          onCommit(normalizedValue);
        }}
      />
      <input
        className="inspector-color-control__swatch"
        type="color"
        aria-label={`${ariaLabel} swatch`}
        value={normalizeColorSwatchValue(draftValue || mixedFallbackValue || value)}
        onFocus={() => setIsSwatchFocused(true)}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={() => {
          setIsSwatchFocused(false);
          if (normalizedDraftValue && normalizedDraftValue !== value) {
            onCommit(normalizedDraftValue);
          }
        }}
      />
    </div>
  );
}

function normalizeColorSwatchValue(value: string): string {
  return normalizeCommittedColorValue(value) ?? "#ffffff";
}

function normalizeCommittedColorValue(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }

  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return null;
}

interface SharedScopeBundle {
  object: SharedPropertyResult;
  transform: SharedPropertyResult;
  geometry: SharedPropertyResult;
  material: SharedPropertyResult;
}

function getSectionsForSelection(
  node: EditorNode | undefined,
  selectionNodes: EditorNode[],
  shared: SharedScopeBundle,
): InspectorSection[] {
  if (selectionNodes.length === 0) {
    return [];
  }

  if (selectionNodes.length > 1) {
    const sections: InspectorSection[] = [];
    if (shared.object.definitions.length > 0) {
      sections.push({
        id: "object",
        label: "Object",
        icon: <ObjectDataIcon width={16} height={16} />,
      });
    }
    if (shared.transform.definitions.length > 0) {
      sections.push({
        id: "transform",
        label: "Transform",
        icon: <TransformIcon width={16} height={16} />,
      });
    }
    if (shared.geometry.definitions.length > 0) {
      sections.push({
        id: "geometry",
        label: "Geometry",
        icon: <GeometryIcon width={16} height={16} />,
      });
    }
    if (shared.material.definitions.length > 0) {
      sections.push({
        id: "material",
        label: "Material",
        icon: <MaterialIcon width={16} height={16} />,
      });
    }
    return sections;
  }

  if (!node) {
    return [];
  }

  const sections: InspectorSection[] = [
    {
      id: "object",
      label: "Object",
      icon: <ObjectDataIcon width={16} height={16} />,
    },
    {
      id: "transform",
      label: "Transform",
      icon: <TransformIcon width={16} height={16} />,
    },
  ];

  if (node.type !== "group") {
    sections.push({
      id: "geometry",
      label: "Geometry",
      icon: <GeometryIcon width={16} height={16} />,
    });
    sections.push({
      id: "material",
      label: "Material",
      icon: <MaterialIcon width={16} height={16} />,
    });
  }

  if (node.type === "text") {
    sections.push({
      id: "text",
      label: "Text",
      icon: <TextPropertyIcon width={16} height={16} />,
    });
  }

  if (node.type === "image") {
    sections.push({
      id: "image",
      label: "Image",
      icon: <ImagePropertyIcon width={16} height={16} />,
    });
  }

  return sections;
}

function filterNodesByIds(nodes: EditorNode[], ids: string[]): EditorNode[] {
  if (ids.length === nodes.length) {
    return nodes;
  }
  const allowed = new Set(ids);
  return nodes.filter((node) => allowed.has(node.id));
}

function describeExcludedNodes(result: SharedPropertyResult, selectionNodes: EditorNode[]): string | null {
  if (result.excludedNodeIds.length === 0) {
    return null;
  }
  const lookup = new Map(selectionNodes.map((node) => [node.id, node]));
  const excluded = result.excludedNodeIds.map((id) => lookup.get(id)).filter((node): node is EditorNode => Boolean(node));
  const groups = excluded.filter((node) => node.type === "group").length;
  const others = excluded.length - groups;

  if (groups > 0 && others === 0) {
    return `excluding ${groups} ${groups === 1 ? "group" : "groups"}`;
  }
  if (groups === 0 && others > 0) {
    return `excluding ${others} ${others === 1 ? "object" : "objects"}`;
  }
  return `excluding ${excluded.length} ${excluded.length === 1 ? "item" : "items"}`;
}

function buildExcludedNote(result: SharedPropertyResult, selectionNodes: EditorNode[]): string | undefined {
  return describeExcludedNodes(result, selectionNodes) ?? undefined;
}

function renderExcludedNote(result: SharedPropertyResult, selectionNodes: EditorNode[]): ReactNode {
  const note = describeExcludedNodes(result, selectionNodes);
  if (!note) {
    return null;
  }
  return <span className="inspector-card__note">{note}</span>;
}

interface SharedScopeSublineProps {
  object: SharedPropertyResult;
  transform: SharedPropertyResult;
  geometry: SharedPropertyResult;
  material: SharedPropertyResult;
}

function SharedScopeSubline({ object, transform, geometry, material }: SharedScopeSublineProps) {
  const present: string[] = [];
  const hidden: string[] = [];

  const record = (label: string, hasShared: boolean) => {
    if (hasShared) {
      present.push(label);
    } else {
      hidden.push(label);
    }
  };

  record("object", object.definitions.length > 0);
  record("transform", transform.definitions.length > 0);
  record("geometry", geometry.definitions.length > 0);
  record("material", material.definitions.length > 0);

  if (hidden.length === 0 || present.length === 0) {
    return null;
  }

  return <span className="inspector-node-strip__subline">{present.join(" · ")}</span>;
}

function groupDefinitions(definitions: NodePropertyDefinition[]): Map<string, NodePropertyDefinition[]> {
  const groups = new Map<string, NodePropertyDefinition[]>();
  for (const definition of definitions) {
    const bucket = groups.get(definition.group) ?? [];
    bucket.push(definition);
    groups.set(definition.group, bucket);
  }
  return groups;
}
