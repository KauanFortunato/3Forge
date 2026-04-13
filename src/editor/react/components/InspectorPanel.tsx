import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ROOT_NODE_ID, getDisplayValue, getPropertyDefinitions } from "../../state";
import type { EditorNode, FontAsset, NodePropertyDefinition } from "../../types";
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

type InspectorSectionId = "object" | "transform" | "geometry" | "material" | "text" | "image";

interface InspectorPanelProps {
  node: EditorNode | undefined;
  fonts: FontAsset[];
  onNodeNameChange: (nodeId: string, value: string) => void;
  onParentChange: (nodeId: string, parentId: string) => void;
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
    fonts,
    onNodeNameChange,
    onParentChange,
    getEligibleParents,
    onNodePropertyChange,
    onToggleEditable,
    onTextFontChange,
    onImportFont,
    onReplaceImage,
  } = props;

  const sections = useMemo(() => getSectionsForNode(node), [node]);
  const [activeSection, setActiveSection] = useState<InspectorSectionId>("object");

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSection)) {
      setActiveSection(sections[0]?.id ?? "object");
    }
  }, [activeSection, sections]);

  if (!node) {
    return <p className="panel-empty">Selecione um objeto para editar.</p>;
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
                  <input
                    className="editor-input editor-input--compact"
                    type="text"
                    value={node.name}
                    onChange={(event) => onNodeNameChange(node.id, event.target.value)}
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
            <DefinitionSection
              title="Material"
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
      <div className="transform-group__title">{title}</div>
      <div className="transform-grid">
        {definitions.map((definition) => {
          const axis = definition.path.split(".").at(-1)?.toUpperCase() ?? "?";
          const currentValue = getDisplayValue(node, definition);
          const isEditable = Boolean(node.editable[definition.path]);

          return (
            <div key={definition.path} className={`transform-cell${isEditable ? " is-editable" : ""}`}>
              <span className="transform-cell__axis">{axis}</span>
              <input
                className="editor-input editor-input--compact"
                type="number"
                value={String(currentValue)}
                step={definition.step}
                min={definition.min}
                max={definition.max}
                onChange={(event) => onNodePropertyChange(node.id, definition, event.target.value)}
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
        ) : (
          <input
            className="editor-input editor-input--compact"
            type={definition.input === "color" ? "color" : definition.input === "text" ? "text" : "number"}
            value={String(currentValue)}
            step={definition.step}
            min={definition.min}
            max={definition.max}
            onChange={(event) => onNodePropertyChange(node.id, definition, event.target.value)}
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
