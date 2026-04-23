import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ROOT_NODE_ID, getDisplayValue, getPropertyDefinitions } from "../../state";
import { getSharedPropertyDefinitions } from "../../sharedProperties";
import type { SharedPropertyResult } from "../../sharedProperties";
import type { EditorNode, FontAsset, GroupPivotPreset, NodeOriginSpec, NodePropertyDefinition } from "../../types";
import {
  BoxIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleFilledIcon,
  CircleIcon,
  GeometryIcon,
  GroupIcon,
  ImagePropertyIcon,
  MaterialIcon,
  MeshIcon,
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
      <div className="panel__empty">
        {emptyMessage ?? "Selecione um objeto para editar."}
      </div>
    );
  }

  const groupedDefinitions = primaryNode ? groupDefinitions(getPropertyDefinitions(primaryNode)) : new Map<string, NodePropertyDefinition[]>();
  const iconForNode = primaryNode?.type === "group" ? <GroupIcon width={14} height={14} /> : <MeshIcon width={14} height={14} />;

  return (
    <div>
      <div className="insp-head">
        <div className="insp-head__top">
          <span className="insp-head__icon">{isMultiSelection ? <GroupIcon width={14} height={14} /> : iconForNode}</span>
          <span className="insp-head__name">{isMultiSelection ? `${selectionNodes.length} objects` : primaryNode?.name}</span>
        </div>
        <span className="insp-head__sub">
          {isMultiSelection ? (
            <SharedScopeSubline
              object={sharedObject}
              transform={sharedTransform}
              geometry={sharedGeometry}
              material={sharedMaterial}
            />
          ) : primaryNode?.type === "group" ? "Group" : "Mesh"}
        </span>
      </div>

      <div className="insp-tabs">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`insp-tab${activeSection === section.id ? " is-active" : ""}`}
            title={section.label}
            aria-label={section.label}
            onClick={() => setActiveSection(section.id)}
          >
            <span className="insp-tab__icon">{section.icon}</span>
            <span>{section.label}</span>
          </button>
        ))}
      </div>

      {activeSection === "object" && isMultiSelection ? (
        <Sec title="Object" meta={renderExcludedNote(sharedObject, selectionNodes)}>
          {sharedObject.definitions.map((definition) => (
            <PropertyRow
              key={definition.path}
              nodes={filterNodesByIds(selectionNodes, sharedObject.includedNodeIds)}
              definition={definition}
              mixedPaths={sharedObject.mixedPaths}
              onNodePropertyChange={onNodePropertyChange}
              onNodesPropertyChange={onNodesPropertyChange}
              onToggleEditable={onToggleEditable}
              allowEditableToggle={false}
            />
          ))}
        </Sec>
      ) : null}

      {activeSection === "object" && primaryNode ? (
        <Sec title="Object">
          <div className="row">
            <span className="row__lbl">Name</span>
            <span className="text">
              <BufferedInput
                type="text"
                value={primaryNode.name}
                onCommit={(value) => onNodeNameChange(primaryNode.id, value)}
              />
            </span>
            <span aria-hidden="true" />
          </div>

          <div className="row">
            <span className="row__lbl">Parent</span>
            <span className="sel">
              <select
                value={primaryNode.parentId ?? ROOT_NODE_ID}
                disabled={primaryNode.id === ROOT_NODE_ID}
                onChange={(event) => onParentChange(primaryNode.id, event.target.value)}
                aria-label="Parent Group"
              >
                {getEligibleParents(primaryNode.id).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
            </span>
            <span aria-hidden="true" />
          </div>

          {(groupedDefinitions.get("Object") ?? []).map((definition) => (
            <PropertyRow
              key={definition.path}
              nodes={[primaryNode]}
              definition={definition}
              onNodePropertyChange={onNodePropertyChange}
              onToggleEditable={onToggleEditable}
            />
          ))}

          {primaryNode.type === "group" ? (
            <div className="row row--wide">
              <span className="row__lbl">Pivot</span>
              <div className="row__inline-actions">
                <span className="sel" style={{ flex: 1 }}>
                  <select
                    aria-label="Group pivot preset"
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
                  <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
                </span>
                <button
                  type="button"
                  className="tbtn is-ghost"
                  onClick={() => onGroupPivotPresetApply(primaryNode.id, groupPivotPreset)}
                >
                  Apply Pivot
                </button>
              </div>
              <p className="row__hint">
                Computes the group pivot from current content bounds and keeps the visible layout unchanged.
              </p>
            </div>
          ) : (
            <>
              <div className="row">
                <span className="row__lbl">Origin X</span>
                <span className="sel">
                  <select
                    value={primaryNode.origin.x}
                    onChange={(event) => onNodeOriginChange(primaryNode.id, { x: event.target.value as NodeOriginSpec["x"] })}
                    aria-label="Origin X"
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                  <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
                </span>
                <span aria-hidden="true" />
              </div>
              <div className="row">
                <span className="row__lbl">Origin Y</span>
                <span className="sel">
                  <select
                    value={primaryNode.origin.y}
                    onChange={(event) => onNodeOriginChange(primaryNode.id, { y: event.target.value as NodeOriginSpec["y"] })}
                    aria-label="Origin Y"
                  >
                    <option value="top">Top</option>
                    <option value="center">Center</option>
                    <option value="bottom">Bottom</option>
                  </select>
                  <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
                </span>
                <span aria-hidden="true" />
              </div>
              <div className="row">
                <span className="row__lbl">Origin Z</span>
                <span className="sel">
                  <select
                    value={primaryNode.origin.z}
                    onChange={(event) => onNodeOriginChange(primaryNode.id, { z: event.target.value as NodeOriginSpec["z"] })}
                    aria-label="Origin Z"
                  >
                    <option value="front">Front</option>
                    <option value="center">Center</option>
                    <option value="back">Back</option>
                  </select>
                  <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
                </span>
                <span aria-hidden="true" />
              </div>
            </>
          )}
        </Sec>
      ) : null}

      {activeSection === "transform" ? (
        <Sec title="Transform" meta={isMultiSelection ? renderExcludedNote(sharedTransform, selectionNodes) : null}>
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
        </Sec>
      ) : null}

      {activeSection === "geometry" && isMultiSelection ? (
        <Sec title="Geometry" meta={renderExcludedNote(sharedGeometry, selectionNodes)}>
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
        </Sec>
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
        <>
          <Sec title="Font">
            <div className="row">
              <span className="row__lbl">Font</span>
              <span className="sel">
                <select
                  value={primaryNode.type === "text" ? primaryNode.fontId : fonts[0]?.id}
                  onChange={(event) => onTextFontChange(primaryNode.id, event.target.value)}
                  aria-label="Active Font"
                >
                  {fonts.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.name}
                    </option>
                  ))}
                </select>
                <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
              </span>
              <span aria-hidden="true" />
            </div>
            <button type="button" className="tbtn is-ghost tbtn--block" onClick={onImportFont}>
              Import font
            </button>
          </Sec>

          <DefinitionSection
            title="Text"
            node={primaryNode}
            definitions={groupedDefinitions.get("Text") ?? []}
            onNodePropertyChange={onNodePropertyChange}
            onToggleEditable={onToggleEditable}
          />
        </>
      ) : null}

      {activeSection === "image" && primaryNode?.type === "image" ? (
        <>
          <Sec title="Image">
            <div className="insp-image-preview">
              <img src={primaryNode.image.src} alt={primaryNode.image.name} />
            </div>
            <p className="row__hint" style={{ marginTop: "var(--sp-3)" }}>
              {primaryNode.image.name} | {primaryNode.image.width} x {primaryNode.image.height} px
            </p>
            <button type="button" className="tbtn is-ghost tbtn--block" onClick={() => onReplaceImage(primaryNode.id)}>
              Replace image
            </button>
          </Sec>

          <DefinitionSection
            title="Geometry"
            node={primaryNode}
            definitions={groupedDefinitions.get("Geometry") ?? []}
            onNodePropertyChange={onNodePropertyChange}
            onToggleEditable={onToggleEditable}
          />
        </>
      ) : null}

      {sections.length === 0 ? (
        <Sec title="Inspector">
          <p className="row__hint">
            {hasGroupSelection
              ? "Material editing is only available when all selected items expose a shared material field."
              : emptyMessage ?? "Selecione um objeto para editar."}
          </p>
        </Sec>
      ) : null}
    </div>
  );
}

interface SecProps {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}

function Sec({ title, meta, children }: SecProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`sec${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="sec__hd"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="sec__hd-chev">
          {collapsed ? <ChevronRightIcon width={8} height={8} /> : <ChevronDownIcon width={8} height={8} />}
        </span>
        <span className="sec__hd-title">{title}</span>
        {meta ? <span className="sec__hd-meta">{meta}</span> : null}
      </button>
      <div className="sec__bd">{children}</div>
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
    <Sec title={title}>
      {definitions.map((definition) => (
        <PropertyRow
          key={definition.path}
          nodes={[node]}
          definition={definition}
          onNodePropertyChange={onNodePropertyChange}
          onToggleEditable={onToggleEditable}
        />
      ))}
    </Sec>
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
    <Sec title="Material" meta={isMultiSelection && excludedNote ? excludedNote : null}>
      {isMultiSelection ? (
        <p className="row__hint" style={{ marginBottom: "var(--sp-3)" }}>
          {`Applying changes to ${selectionCount} selected objects.`}
          {hasGroupSelection ? " Group items are excluded because they do not expose material controls." : ""}
          {hasMixedMaterialTypes ? " Material-specific controls stay hidden while the selection mixes different material types." : ""}
        </p>
      ) : null}

      {definitions.length === 0 ? (
        <p className="row__hint">No shared material properties are available for this selection.</p>
      ) : null}

      <div className="sec__sub">Base</div>
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
          <div className="sec__sub">Standard PBR</div>
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
          <div className="sec__sub">Advanced</div>
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
          <div className="sec__sub">Shadows</div>
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
    </Sec>
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
    <div className="row row--wide">
      <span className="row__lbl">{title}</span>
      <div className="vec">
        {definitions.map((definition) => {
          const axis = definition.path.split(".").at(-1)?.toLowerCase() ?? "x";
          const axisLetter = axis.toUpperCase();
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
            <div
              key={definition.path}
              className={`vec__cell${isEditable ? " is-editable" : ""}`}
              data-axis={axis}
            >
              <span className="vec__axis">{axisLetter}</span>
              <BufferedInput
                className="vec__val"
                type="text"
                inputMode="decimal"
                value={displayValue}
                placeholder={isMixed ? "Mixed" : undefined}
                onCommit={commit}
                aria-label={`${title} ${axisLetter}`}
              />
              {isMultiSelection ? null : (
                <label className={`vec__editable${isEditable ? " is-active" : ""}`} title="Editable at runtime">
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

  let control: ReactNode;
  if (definition.input === "checkbox") {
    const checkedState = hasMixedValue ? false : Boolean(currentValue);
    control = (
      <label className={`tog${checkedState ? " is-on" : ""}`} style={{ display: "inline-block" }}>
        <input
          ref={checkboxRef}
          type="checkbox"
          aria-label={definition.label}
          checked={checkedState}
          onChange={(event) => commitValue(event.target.checked)}
          style={{ position: "absolute", width: "100%", height: "100%", opacity: 0, margin: 0, top: 0, left: 0, cursor: "pointer" }}
        />
      </label>
    );
  } else if (definition.input === "select") {
    control = (
      <span className="sel">
        <select
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
        <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
      </span>
    );
  } else if (definition.input === "color") {
    control = (
      <ColorPropertyControl
        ariaLabel={definition.label}
        value={stringValue}
        placeholder={hasMixedValue ? "Mixed" : undefined}
        mixedFallbackValue={hasMixedValue ? String(currentValue) : undefined}
        onCommit={commitValue}
      />
    );
  } else {
    control = (
      <span className={definition.input === "text" ? "text" : "num"}>
        <BufferedInput
          type="text"
          aria-label={definition.label}
          inputMode={definition.input === "text" ? "text" : "decimal"}
          value={hasMixedValue ? "" : stringValue}
          placeholder={hasMixedValue ? "Mixed" : undefined}
          onCommit={(value) => commitValue(value)}
        />
      </span>
    );
  }

  return (
    <div className="row">
      <span className="row__lbl">{definition.label}</span>
      {control}
      {allowEditableToggle && nodes[0] ? (
        <label className={`row__editable${isEditable ? " is-active" : ""}`} title="Editable at runtime">
          <input
            type="checkbox"
            aria-label={editableLabel}
            checked={isEditable}
            onChange={(event) => onToggleEditable(nodes[0].id, definition, event.target.checked)}
          />
          {isEditable ? <CircleFilledIcon width={10} height={10} /> : <CircleIcon width={10} height={10} />}
        </label>
      ) : (
        <span aria-hidden="true" />
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
  const swatchColor = normalizeColorSwatchValue(draftValue || mixedFallbackValue || value);
  const style: CSSProperties = { color: swatchColor };

  return (
    <span className="swatch-row">
      <input
        className="swatch"
        type="color"
        aria-label={`${ariaLabel} swatch`}
        value={swatchColor}
        onFocus={() => setIsSwatchFocused(true)}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={() => {
          setIsSwatchFocused(false);
          if (normalizedDraftValue && normalizedDraftValue !== value) {
            onCommit(normalizedDraftValue);
          }
        }}
        style={style}
      />
      <BufferedInput
        className="swatch-hex"
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
    </span>
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
        icon: <ObjectDataIcon width={14} height={14} />,
      });
    }
    if (shared.transform.definitions.length > 0) {
      sections.push({
        id: "transform",
        label: "Transform",
        icon: <TransformIcon width={14} height={14} />,
      });
    }
    if (shared.geometry.definitions.length > 0) {
      sections.push({
        id: "geometry",
        label: "Geometry",
        icon: <GeometryIcon width={14} height={14} />,
      });
    }
    if (shared.material.definitions.length > 0) {
      sections.push({
        id: "material",
        label: "Material",
        icon: <MaterialIcon width={14} height={14} />,
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
      icon: <ObjectDataIcon width={14} height={14} />,
    },
    {
      id: "transform",
      label: "Transform",
      icon: <TransformIcon width={14} height={14} />,
    },
  ];

  if (node.type !== "group") {
    sections.push({
      id: "geometry",
      label: "Geometry",
      icon: <GeometryIcon width={14} height={14} />,
    });
    sections.push({
      id: "material",
      label: "Material",
      icon: <MaterialIcon width={14} height={14} />,
    });
  }

  if (node.type === "text") {
    sections.push({
      id: "text",
      label: "Text",
      icon: <TextPropertyIcon width={14} height={14} />,
    });
  }

  if (node.type === "image") {
    sections.push({
      id: "image",
      label: "Image",
      icon: <ImagePropertyIcon width={14} height={14} />,
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
  return note;
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
    return <>Multi-selection</>;
  }

  return <>{present.join(" · ")}</>;
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
