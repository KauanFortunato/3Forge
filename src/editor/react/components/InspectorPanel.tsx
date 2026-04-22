import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ROOT_NODE_ID, getDisplayValue, getPropertyDefinitions } from "../../state";
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
  const sharedMaterialDefinitions = useMemo(
    () => getSharedMaterialDefinitions(selectionNodes),
    [selectionNodes],
  );
  const hasGroupSelection = isMultiSelection && selectionNodes.some((entry) => entry.type === "group");
  const hasMixedMaterialTypes = isMultiSelection
    && new Set(
      selectionNodes
        .filter((entry): entry is Exclude<EditorNode, { type: "group" }> => entry.type !== "group")
        .map((entry) => entry.material.type),
    ).size > 1;
  const sections = useMemo(
    () => getSectionsForSelection(primaryNode, selectionNodes, sharedMaterialDefinitions),
    [primaryNode, selectionNodes, sharedMaterialDefinitions],
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
            <span className="inspector-node-strip__title">{isMultiSelection ? `${selectionNodes.length} objects` : primaryNode?.name}</span>
            <span className="inspector-node-strip__meta">
              {isMultiSelection ? "Multi-selection" : primaryNode?.type === "group" ? "Group" : "Mesh"}
            </span>
          </div>

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

          {activeSection === "transform" && primaryNode ? (
            <section className="inspector-card">
              <div className="inspector-card__header">
                <h4>Transform</h4>
              </div>

              <TransformAxisGroup
                title="Position"
                node={primaryNode}
                definitions={groupedDefinitions.get("Transform")?.filter((definition) => definition.path.startsWith("transform.position")) ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />

              <TransformAxisGroup
                title="Rotation"
                node={primaryNode}
                definitions={groupedDefinitions.get("Transform")?.filter((definition) => definition.path.startsWith("transform.rotation")) ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />

              <TransformAxisGroup
                title="Scale"
                node={primaryNode}
                definitions={groupedDefinitions.get("Transform")?.filter((definition) => definition.path.startsWith("transform.scale")) ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />
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
              nodes={isMultiSelection ? selectionNodes : primaryNode ? [primaryNode] : []}
              definitions={isMultiSelection ? sharedMaterialDefinitions : groupedDefinitions.get("Material") ?? []}
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
  definitions: NodePropertyDefinition[];
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
    definitions,
    onNodePropertyChange,
    onNodesPropertyChange,
    onToggleEditable,
    allowEditableToggle = true,
    hasGroupSelection = false,
    hasMixedMaterialTypes = false,
  } = props;
  const isMultiSelection = nodes.length > 1;

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
      </div>

      {isMultiSelection ? (
        <p className="field-help">
          {`Applying changes to ${nodes.length} selected objects.`}
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
  node: EditorNode;
  definitions: NodePropertyDefinition[];
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
}

function TransformAxisGroup(props: TransformAxisGroupProps) {
  const { title, node, definitions, onNodePropertyChange, onToggleEditable } = props;

  return (
    <div className="transform-group">
      <div className="inspector-sub-header"><span>{title}</span></div>
      <div className="transform-grid">
        {definitions.map((definition) => {
          const axis = definition.path.split(".").at(-1)?.toUpperCase() ?? "?";
          const currentValue = getDisplayValue(node, definition);
          const isEditable = Boolean(node.editable[definition.path]);

          return (
            <div key={definition.path} className={`transform-cell${isEditable ? " is-editable" : ""}`}>
              <span className="transform-cell__axis">{axis}</span>
              <BufferedInput
                className="editor-input editor-input--compact"
                type="text"
                inputMode="decimal"
                value={String(currentValue)}
                onCommit={(value) => onNodePropertyChange(node.id, definition, value)}
              />
              <label className={`transform-cell__editable${isEditable ? " is-active" : ""}`} title="Editable at runtime">
                <input
                  type="checkbox"
                  checked={isEditable}
                  onChange={(event) => onToggleEditable(node.id, definition, event.target.checked)}
                />
                {isEditable ? <CircleFilledIcon width={10} height={10} /> : <CircleIcon width={10} height={10} />}
              </label>
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
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onNodesPropertyChange?: (nodeIds: string[], definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
  allowEditableToggle?: boolean;
}

function PropertyRow({
  nodes,
  definition,
  onNodePropertyChange,
  onNodesPropertyChange,
  onToggleEditable,
  allowEditableToggle = true,
}: PropertyRowProps) {
  const isMultiSelection = nodes.length > 1;
  const currentValues = nodes.map((node) => getDisplayValue(node, definition));
  const currentValue = currentValues[0];
  const hasMixedValue = currentValues.some((value) => !Object.is(value, currentValue));
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

function getSectionsForSelection(
  node: EditorNode | undefined,
  selectionNodes: EditorNode[],
  sharedMaterialDefinitions: NodePropertyDefinition[],
): InspectorSection[] {
  if (selectionNodes.length === 0) {
    return [];
  }

  if (selectionNodes.length > 1) {
    return sharedMaterialDefinitions.length > 0
      ? [{
          id: "material",
          label: "Material",
          icon: <MaterialIcon width={16} height={16} />,
        }]
      : [];
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

function getSharedMaterialDefinitions(nodes: EditorNode[]): NodePropertyDefinition[] {
  const materialDefinitionLists = nodes.map((node) => getPropertyDefinitions(node).filter((definition) => definition.group === "Material"));
  if (materialDefinitionLists.some((definitions) => definitions.length === 0)) {
    return [];
  }

  const sharedPaths = materialDefinitionLists.slice(1).reduce((paths, definitions) => {
    const currentPaths = new Set(definitions.map((definition) => definition.path));
    return new Set([...paths].filter((path) => currentPaths.has(path)));
  }, new Set(materialDefinitionLists[0]?.map((definition) => definition.path) ?? []));

  return (materialDefinitionLists[0] ?? []).filter((definition) => sharedPaths.has(definition.path));
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
