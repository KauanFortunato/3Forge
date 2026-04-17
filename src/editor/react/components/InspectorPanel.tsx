import { useEffect, useMemo, useState } from "react";
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
  emptyMessage?: string;
  fonts: FontAsset[];
  onNodeNameChange: (nodeId: string, value: string) => void;
  onParentChange: (nodeId: string, parentId: string) => void;
  onNodeOriginChange: (nodeId: string, origin: Partial<NodeOriginSpec>) => void;
  onGroupPivotPresetApply: (nodeId: string, preset: GroupPivotPreset) => void;
  getEligibleParents: (nodeId: string) => EditorNode[];
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
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
    emptyMessage,
    fonts,
    onNodeNameChange,
    onParentChange,
    onNodeOriginChange,
    onGroupPivotPresetApply,
    getEligibleParents,
    onNodePropertyChange,
    onToggleEditable,
    onTextFontChange,
    onImportFont,
    onReplaceImage,
  } = props;

  const sections = useMemo(() => getSectionsForNode(node), [node]);
  const [activeSection, setActiveSection] = useState<InspectorSectionId>("object");
  const [groupPivotPreset, setGroupPivotPreset] = useState<GroupPivotPreset>("center");

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSection)) {
      setActiveSection(sections[0]?.id ?? "object");
    }
  }, [activeSection, sections]);

  useEffect(() => {
    setGroupPivotPreset("center");
  }, [node?.id]);

  if (!node) {
    return <p className="panel-empty">{emptyMessage ?? "Selecione um objeto para editar."}</p>;
  }

  const groupedDefinitions = groupDefinitions(getPropertyDefinitions(node));

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
              onClick={() => setActiveSection(section.id)}
            >
              {section.icon}
            </button>
          ))}
        </div>

        <div className="inspector-section-body">
          <div className="inspector-node-strip">
            <span className="inspector-node-strip__title">{node.name}</span>
            <span className="inspector-node-strip__meta">{node.type === "group" ? "Group" : "Mesh"}</span>
          </div>

          {activeSection === "object" ? (
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
                    value={node.name}
                    onCommit={(value) => onNodeNameChange(node.id, value)}
                  />
                </label>

                <label className="field-block">
                  <span className="field-block__label">Parent Group</span>
                  <select
                    className="editor-select"
                    value={node.parentId ?? ROOT_NODE_ID}
                    disabled={node.id === ROOT_NODE_ID}
                    onChange={(event) => onParentChange(node.id, event.target.value)}
                  >
                    {getEligibleParents(node.id).map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>

                {node.type === "group" ? (
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
                        onClick={() => onGroupPivotPresetApply(node.id, groupPivotPreset)}
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
                          value={node.origin.x}
                          onChange={(event) => onNodeOriginChange(node.id, { x: event.target.value as NodeOriginSpec["x"] })}
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
                          value={node.origin.y}
                          onChange={(event) => onNodeOriginChange(node.id, { y: event.target.value as NodeOriginSpec["y"] })}
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
                          value={node.origin.z}
                          onChange={(event) => onNodeOriginChange(node.id, { z: event.target.value as NodeOriginSpec["z"] })}
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
              </div>

              <TransformAxisGroup
                title="Position"
                node={node}
                definitions={groupedDefinitions.get("Transform")?.filter((definition) => definition.path.startsWith("transform.position")) ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />

              <TransformAxisGroup
                title="Rotation"
                node={node}
                definitions={groupedDefinitions.get("Transform")?.filter((definition) => definition.path.startsWith("transform.rotation")) ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />

              <TransformAxisGroup
                title="Scale"
                node={node}
                definitions={groupedDefinitions.get("Transform")?.filter((definition) => definition.path.startsWith("transform.scale")) ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />
            </section>
          ) : null}

          {activeSection === "geometry" ? (
            <DefinitionSection
              title="Geometry"
              node={node}
              definitions={groupedDefinitions.get("Geometry") ?? []}
              onNodePropertyChange={onNodePropertyChange}
              onToggleEditable={onToggleEditable}
            />
          ) : null}

          {activeSection === "material" ? (
            <MaterialDefinitionSection
              node={node}
              definitions={groupedDefinitions.get("Material") ?? []}
              onNodePropertyChange={onNodePropertyChange}
              onToggleEditable={onToggleEditable}
            />
          ) : null}

          {activeSection === "text" ? (
            <div className="inspector-stack">
              <section className="inspector-card">
                <div className="inspector-card__header">
                  <h4>Font</h4>
                </div>

                <label className="field-block">
                  <span className="field-block__label">Active Font</span>
                  <select
                    className="editor-select"
                    value={node.type === "text" ? node.fontId : fonts[0]?.id}
                    onChange={(event) => onTextFontChange(node.id, event.target.value)}
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
                node={node}
                definitions={groupedDefinitions.get("Text") ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />
            </div>
          ) : null}

          {activeSection === "image" && node.type === "image" ? (
            <div className="inspector-stack">
              <section className="inspector-card">
                <div className="inspector-card__header">
                  <h4>Image</h4>
                </div>
                <div className="image-preview">
                  <img src={node.image.src} alt={node.image.name} className="image-preview__img" />
                </div>
                <p className="field-help">
                  {node.image.name} | {node.image.width} x {node.image.height} px
                </p>
                <button type="button" className="tool-button" onClick={() => onReplaceImage(node.id)}>
                  Replace image
                </button>
              </section>

              <DefinitionSection
                title="Geometry"
                node={node}
                definitions={groupedDefinitions.get("Geometry") ?? []}
                onNodePropertyChange={onNodePropertyChange}
                onToggleEditable={onToggleEditable}
              />
            </div>
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
            node={node}
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
  node: EditorNode;
  definitions: NodePropertyDefinition[];
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
}

function MaterialDefinitionSection(props: MaterialDefinitionSectionProps) {
  const { node, definitions, onNodePropertyChange, onToggleEditable } = props;

  const basePaths = ["material.type", "material.color", "material.opacity", "material.transparent"];
  const pbrPaths = ["material.emissive", "material.roughness", "material.metalness"];
  
  const baseProps = definitions.filter((d) => basePaths.includes(definitionPath(d.path)));
  const pbrProps = definitions.filter((d) => pbrPaths.includes(definitionPath(d.path)));
  const advancedProps = definitions.filter((d) => !basePaths.includes(definitionPath(d.path)) && !pbrPaths.includes(definitionPath(d.path)));

  function definitionPath(path: string): string {
    return path;
  }

  return (
    <section className="inspector-card">
      <div className="inspector-card__header">
        <h4>Material</h4>
      </div>

      <div className="inspector-properties">
        <div className="inspector-sub-header"><span>Base</span></div>
        {baseProps.map((def) => (
          <PropertyRow key={def.path} node={node} definition={def} onNodePropertyChange={onNodePropertyChange} onToggleEditable={onToggleEditable} />
        ))}

        {pbrProps.length > 0 && (
          <>
            <div className="inspector-sub-header"><span>Standard PBR</span></div>
            {pbrProps.map((def) => (
              <PropertyRow key={def.path} node={node} definition={def} onNodePropertyChange={onNodePropertyChange} onToggleEditable={onToggleEditable} />
            ))}
          </>
        )}

        {advancedProps.length > 0 && (
          <>
            <div className="inspector-sub-header"><span>Advanced</span></div>
            {advancedProps.map((def) => (
              <PropertyRow key={def.path} node={node} definition={def} onNodePropertyChange={onNodePropertyChange} onToggleEditable={onToggleEditable} />
            ))}
          </>
        )}
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
  node: EditorNode;
  definition: NodePropertyDefinition;
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
}

function PropertyRow({ node, definition, onNodePropertyChange, onToggleEditable }: PropertyRowProps) {
  const currentValue = getDisplayValue(node, definition);
  const isEditable = Boolean(node.editable[definition.path]);
  const stringValue = String(currentValue);

  return (
    <div className={`inspector-property${isEditable ? " is-editable" : ""}`}>
      <span className="inspector-property__label">{definition.label}</span>

      <div className="inspector-property__control">
        {definition.input === "checkbox" ? (
          <input
            type="checkbox"
            className="editor-checkbox"
            checked={Boolean(currentValue)}
            onChange={(event) => onNodePropertyChange(node.id, definition, event.target.checked)}
          />
        ) : definition.input === "select" ? (
          <select
            className="editor-select"
            value={stringValue}
            onChange={(event) => onNodePropertyChange(node.id, definition, event.target.value)}
          >
            {(definition.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : definition.input === "color" ? (
          <div className="inspector-color-control">
            <BufferedInput
              className="editor-input editor-input--compact inspector-color-control__hex"
              type="text"
              value={stringValue}
              onCommit={(value) => onNodePropertyChange(node.id, definition, value)}
            />
            <input
              className="inspector-color-control__swatch"
              type="color"
              value={normalizeColorSwatchValue(stringValue)}
              onChange={(event) => onNodePropertyChange(node.id, definition, event.target.value)}
            />
          </div>
        ) : (
          <BufferedInput
            className="editor-input editor-input--compact"
            type="text"
            inputMode={definition.input === "text" ? "text" : "decimal"}
            value={stringValue}
            onCommit={(value) => onNodePropertyChange(node.id, definition, value)}
          />
        )}
      </div>

      <label className={`inspector-property__editable${isEditable ? " is-active" : ""}`} title="Editable at runtime">
        <input
          type="checkbox"
          checked={isEditable}
          onChange={(event) => onToggleEditable(node.id, definition, event.target.checked)}
        />
        {isEditable ? <CircleFilledIcon width={10} height={10} /> : <CircleIcon width={10} height={10} />}
      </label>
    </div>
  );
}

function normalizeColorSwatchValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }

  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return "#ffffff";
}

function getSectionsForNode(node: EditorNode | undefined): InspectorSection[] {
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
  }

  if (node.type !== "group") {
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

function groupDefinitions(definitions: NodePropertyDefinition[]): Map<string, NodePropertyDefinition[]> {
  const groups = new Map<string, NodePropertyDefinition[]>();
  for (const definition of definitions) {
    const bucket = groups.get(definition.group) ?? [];
    bucket.push(definition);
    groups.set(definition.group, bucket);
  }
  return groups;
}
