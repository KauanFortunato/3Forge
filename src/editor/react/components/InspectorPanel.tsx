import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ROOT_NODE_ID, getDisplayValue, getPropertyDefinitions } from "../../state";
import { getSharedPropertyDefinitions } from "../../sharedProperties";
import type { SharedPropertyResult } from "../../sharedProperties";
import type { EditorNode, FontAsset, GroupPivotPreset, ImageAsset, MaterialAsset, NodeOriginSpec, NodePropertyDefinition } from "../../types";
import {
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
import { CustomSelect } from "./CustomSelect";
import { NumberDragInput } from "./NumberDragInput";

interface InspectorPanelProps {
  node: EditorNode | undefined;
  nodes?: EditorNode[];
  mode?: "all" | "properties" | "material";
  emptyMessage?: string;
  fonts: FontAsset[];
  materials?: MaterialAsset[];
  images?: Array<ImageAsset & { id: string }>;
  onNodeNameChange: (nodeId: string, value: string) => void;
  onParentChange: (nodeId: string, parentId: string) => void;
  onNodeOriginChange: (nodeId: string, origin: Partial<NodeOriginSpec>) => void;
  onGroupPivotPresetApply: (nodeId: string, preset: GroupPivotPreset) => void;
  getEligibleParents: (nodeId: string) => EditorNode[];
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onNodesPropertyChange?: (nodeIds: string[], definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onPropertyEditStart?: () => void;
  onPropertyEditEnd?: () => void;
  onPropertyEditCancel?: () => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
  onTextFontChange: (nodeId: string, fontId: string) => void;
  onImportFont: () => void;
  onReplaceImage: (nodeId: string) => void;
  onAssignImageAsset?: (nodeId: string, imageId: string) => void;
  onUnassignImageAsset?: (nodeId: string) => void;
  onUnbindMaterial?: (nodeIds: string[]) => void;
  onAssignMaterial?: (nodeIds: string[], materialId: string) => void;
}

const NUMERIC_INPUT_TYPES = new Set<NodePropertyDefinition["input"]>(["number", "degrees"]);

function isNumericDefinition(definition: NodePropertyDefinition): boolean {
  return NUMERIC_INPUT_TYPES.has(definition.input);
}

export function InspectorPanel(props: InspectorPanelProps) {
  const {
    node,
    nodes,
    mode = "all",
    emptyMessage,
    fonts,
    materials,
    images = [],
    onNodeNameChange,
    onParentChange,
    onNodeOriginChange,
    onGroupPivotPresetApply,
    getEligibleParents,
    onNodePropertyChange,
    onNodesPropertyChange,
    onPropertyEditStart,
    onPropertyEditEnd,
    onPropertyEditCancel,
    onToggleEditable,
    onTextFontChange,
    onImportFont,
    onReplaceImage,
    onAssignImageAsset,
    onUnassignImageAsset,
    onUnbindMaterial,
    onAssignMaterial,
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
  const [groupPivotPreset, setGroupPivotPreset] = useState<GroupPivotPreset>("center");

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

  const sections = getSectionsForSelection(primaryNode, selectionNodes, {
    object: sharedObject,
    transform: sharedTransform,
    geometry: sharedGeometry,
    material: sharedMaterial,
  });

  const showObject = mode !== "material" && sections.some((section) => section === "object");
  const showTransform = mode !== "material" && sections.some((section) => section === "transform");
  const showGeometry = mode !== "material" && sections.some((section) => section === "geometry");
  const showMaterial = mode !== "properties" && sections.some((section) => section === "material");
  const showText = mode !== "material" && sections.some((section) => section === "text");
  const showImage = mode !== "material" && sections.some((section) => section === "image");

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

      {showObject && isMultiSelection ? (
        <Sec
          title="Object"
          icon={<ObjectDataIcon width={12} height={12} />}
          meta={renderExcludedNote(sharedObject, selectionNodes)}
        >
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

      {showObject && primaryNode ? (
        <Sec title="Object" icon={<ObjectDataIcon width={12} height={12} />}>
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
            <CustomSelect
              value={primaryNode.parentId ?? ROOT_NODE_ID}
              disabled={primaryNode.id === ROOT_NODE_ID}
              onChange={(value) => onParentChange(primaryNode.id, value)}
              ariaLabel="Parent Group"
              options={getEligibleParents(primaryNode.id).map((group) => ({ value: group.id, label: group.name }))}
            />
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
                <CustomSelect
                  ariaLabel="Group pivot preset"
                  value={groupPivotPreset}
                  onChange={(value) => setGroupPivotPreset(value as GroupPivotPreset)}
                  style={{ flex: 1 }}
                  options={[
                    { value: "center", label: "Center" },
                    { value: "bottom-center", label: "Bottom Center" },
                    { value: "top-center", label: "Top Center" },
                    { value: "left-center", label: "Left Center" },
                    { value: "right-center", label: "Right Center" },
                    { value: "front-center", label: "Front Center" },
                    { value: "back-center", label: "Back Center" },
                  ]}
                />
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
                <CustomSelect
                  value={primaryNode.origin.x}
                  onChange={(value) => onNodeOriginChange(primaryNode.id, { x: value as NodeOriginSpec["x"] })}
                  ariaLabel="Origin X"
                  options={[
                    { value: "left", label: "Left" },
                    { value: "center", label: "Center" },
                    { value: "right", label: "Right" },
                  ]}
                />
                <span aria-hidden="true" />
              </div>
              <div className="row">
                <span className="row__lbl">Origin Y</span>
                <CustomSelect
                  value={primaryNode.origin.y}
                  onChange={(value) => onNodeOriginChange(primaryNode.id, { y: value as NodeOriginSpec["y"] })}
                  ariaLabel="Origin Y"
                  options={[
                    { value: "top", label: "Top" },
                    { value: "center", label: "Center" },
                    { value: "bottom", label: "Bottom" },
                  ]}
                />
                <span aria-hidden="true" />
              </div>
              <div className="row">
                <span className="row__lbl">Origin Z</span>
                <CustomSelect
                  value={primaryNode.origin.z}
                  onChange={(value) => onNodeOriginChange(primaryNode.id, { z: value as NodeOriginSpec["z"] })}
                  ariaLabel="Origin Z"
                  options={[
                    { value: "front", label: "Front" },
                    { value: "center", label: "Center" },
                    { value: "back", label: "Back" },
                  ]}
                />
                <span aria-hidden="true" />
              </div>
            </>
          )}
        </Sec>
      ) : null}

      {showTransform ? (
        <Sec
          title="Transform"
          icon={<TransformIcon width={12} height={12} />}
          meta={isMultiSelection ? renderExcludedNote(sharedTransform, selectionNodes) : null}
        >
          <TransformAxisGroup
            title="Position"
            nodes={isMultiSelection ? filterNodesByIds(selectionNodes, sharedTransform.includedNodeIds) : primaryNode ? [primaryNode] : []}
            definitions={sharedTransform.definitions.filter((definition) => definition.path.startsWith("transform.position"))}
            mixedPaths={sharedTransform.mixedPaths}
            onNodePropertyChange={onNodePropertyChange}
            onNodesPropertyChange={onNodesPropertyChange}
            onPropertyEditStart={onPropertyEditStart}
            onPropertyEditEnd={onPropertyEditEnd}
            onPropertyEditCancel={onPropertyEditCancel}
            onToggleEditable={onToggleEditable}
          />

          <TransformAxisGroup
            title="Rotation"
            nodes={isMultiSelection ? filterNodesByIds(selectionNodes, sharedTransform.includedNodeIds) : primaryNode ? [primaryNode] : []}
            definitions={sharedTransform.definitions.filter((definition) => definition.path.startsWith("transform.rotation"))}
            mixedPaths={sharedTransform.mixedPaths}
            onNodePropertyChange={onNodePropertyChange}
            onNodesPropertyChange={onNodesPropertyChange}
            onPropertyEditStart={onPropertyEditStart}
            onPropertyEditEnd={onPropertyEditEnd}
            onPropertyEditCancel={onPropertyEditCancel}
            onToggleEditable={onToggleEditable}
          />

          <TransformAxisGroup
            title="Scale"
            nodes={isMultiSelection ? filterNodesByIds(selectionNodes, sharedTransform.includedNodeIds) : primaryNode ? [primaryNode] : []}
            definitions={sharedTransform.definitions.filter((definition) => definition.path.startsWith("transform.scale"))}
            mixedPaths={sharedTransform.mixedPaths}
            onNodePropertyChange={onNodePropertyChange}
            onNodesPropertyChange={onNodesPropertyChange}
            onPropertyEditStart={onPropertyEditStart}
            onPropertyEditEnd={onPropertyEditEnd}
            onPropertyEditCancel={onPropertyEditCancel}
            onToggleEditable={onToggleEditable}
          />
        </Sec>
      ) : null}

      {showGeometry && isMultiSelection ? (
        <Sec
          title="Geometry"
          icon={<GeometryIcon width={12} height={12} />}
          meta={renderExcludedNote(sharedGeometry, selectionNodes)}
        >
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

      {showGeometry && primaryNode ? (
        <DefinitionSection
          title="Geometry"
          icon={<GeometryIcon width={12} height={12} />}
          node={primaryNode}
          definitions={groupedDefinitions.get("Geometry") ?? []}
          onNodePropertyChange={onNodePropertyChange}
          onToggleEditable={onToggleEditable}
        />
      ) : null}

      {showMaterial ? (
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
          materials={materials}
          onUnbindMaterial={onUnbindMaterial}
          onAssignMaterial={onAssignMaterial}
        />
      ) : null}

      {showText && primaryNode ? (
        <>
          <Sec title="Font" icon={<TextPropertyIcon width={12} height={12} />}>
            <div className="row">
              <span className="row__lbl">Font</span>
              <CustomSelect
                value={primaryNode.type === "text" ? primaryNode.fontId : fonts[0]?.id}
                onChange={(value) => onTextFontChange(primaryNode.id, value)}
                ariaLabel="Active Font"
                options={fonts.map((font) => ({ value: font.id, label: font.name }))}
              />
              <span aria-hidden="true" />
            </div>
            <button type="button" className="tbtn is-ghost tbtn--block" onClick={onImportFont}>
              Import font
            </button>
          </Sec>

          <DefinitionSection
            title="Text"
            icon={<TextPropertyIcon width={12} height={12} />}
            node={primaryNode}
            definitions={groupedDefinitions.get("Text") ?? []}
            onNodePropertyChange={onNodePropertyChange}
            onToggleEditable={onToggleEditable}
          />
        </>
      ) : null}

      {showImage && primaryNode?.type === "image" ? (
        <Sec title="Image" icon={<ImagePropertyIcon width={12} height={12} />}>
          <div className="insp-image-preview">
            <img src={primaryNode.image.src} alt={primaryNode.image.name} />
          </div>
          <p className="row__hint" style={{ marginTop: "var(--sp-3)" }}>
            {primaryNode.image.name} | {primaryNode.image.width} x {primaryNode.image.height} px
          </p>
          {images.length > 0 ? (
            <div className="row">
              <span className="row__lbl">Asset</span>
              <CustomSelect
                ariaLabel="Image asset"
                value={primaryNode.imageId ?? "__inline__"}
                onChange={(value) => {
                  if (value === "__inline__") {
                    onUnassignImageAsset?.(primaryNode.id);
                    return;
                  }
                  onAssignImageAsset?.(primaryNode.id, value);
                }}
                options={[
                  { value: "__inline__", label: "Inline texture" },
                  ...images.map((image) => ({ value: image.id, label: image.name })),
                ]}
              />
              <span aria-hidden="true" />
            </div>
          ) : null}
          <button type="button" className="tbtn is-ghost tbtn--block" onClick={() => onReplaceImage(primaryNode.id)}>
            Replace image
          </button>
        </Sec>
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

      {mode === "material" && !showMaterial ? (
        <Sec title="Material" icon={<MaterialIcon width={12} height={12} />}>
          <p className="row__hint">
            {hasGroupSelection
              ? "Groups do not expose material controls. Select a mesh, text, or image node to edit material fields."
              : "No material properties are available for this selection."}
          </p>
        </Sec>
      ) : null}
    </div>
  );
}

interface SecProps {
  title: string;
  icon?: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

function Sec({ title, icon, meta, defaultOpen = true, children }: SecProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`sec${open ? "" : " is-collapsed"}`}>
      <button
        type="button"
        className="sec__hd"
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sec__hd-chev">
          {open ? <ChevronDownIcon width={8} height={8} /> : <ChevronRightIcon width={8} height={8} />}
        </span>
        {icon ? <span className="sec__hd-icon" aria-hidden="true">{icon}</span> : null}
        <span className="sec__hd-title">{title}</span>
        {meta ? <span className="sec__hd-meta">{meta}</span> : null}
      </button>
      <div className="sec__bd">{children}</div>
    </div>
  );
}

interface DefinitionSectionProps {
  title: string;
  icon?: ReactNode;
  node: EditorNode;
  definitions: NodePropertyDefinition[];
  onNodePropertyChange: (nodeId: string, definition: NodePropertyDefinition, value: string | number | boolean) => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
}

function DefinitionSection(props: DefinitionSectionProps) {
  const { title, icon, node, definitions, onNodePropertyChange, onToggleEditable } = props;

  return (
    <Sec title={title} icon={icon}>
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
  onPropertyEditStart?: () => void;
  onPropertyEditEnd?: () => void;
  onPropertyEditCancel?: () => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
  allowEditableToggle?: boolean;
  hasGroupSelection?: boolean;
  hasMixedMaterialTypes?: boolean;
  materials?: MaterialAsset[];
  onUnbindMaterial?: (nodeIds: string[]) => void;
  onAssignMaterial?: (nodeIds: string[], materialId: string) => void;
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
    materials,
    onUnbindMaterial,
    onAssignMaterial,
  } = props;
  const isMultiSelection = selectionCount > 1;

  const meshNodes = nodes.filter((node) => node.type !== "group") as Array<EditorNode & { materialId?: string }>;
  const meshNodeIds = meshNodes.map((node) => node.id);

  const bindingState: { kind: "inline" } | { kind: "shared"; materialId: string } | { kind: "mixed" } | null = (() => {
    if (meshNodes.length === 0) {
      return null;
    }
    const ids = new Set(meshNodes.map((node) => node.materialId ?? null));
    if (ids.size > 1) {
      return { kind: "mixed" };
    }
    const onlyId = meshNodes[0]?.materialId;
    if (!onlyId) {
      return { kind: "inline" };
    }
    return { kind: "shared", materialId: onlyId };
  })();

  const sharedAsset = bindingState?.kind === "shared"
    ? materials?.find((entry) => entry.id === bindingState.materialId) ?? null
    : null;

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
    <Sec
      title="Material"
      icon={<MaterialIcon width={12} height={12} />}
      meta={isMultiSelection && excludedNote ? excludedNote : null}
    >
      {bindingState && (onAssignMaterial || onUnbindMaterial) ? (
        <div className="row">
          <span className="row__lbl">Material</span>
          <CustomSelect
            ariaLabel="Material binding"
            value={bindingState.kind === "shared"
              ? bindingState.materialId
              : bindingState.kind === "mixed"
                ? "__mixed__"
                : "__inline__"}
            onChange={(value) => {
              if (value === "__mixed__") {
                return;
              }
              if (value === "__inline__") {
                onUnbindMaterial?.(meshNodeIds);
                return;
              }
              onAssignMaterial?.(meshNodeIds, value);
            }}
            options={[
              ...(bindingState.kind === "mixed" ? [{ value: "__mixed__", label: "Mixed" }] : []),
              { value: "__inline__", label: "Inline (this object only)" },
              ...(materials ?? []).map((asset) => ({ value: asset.id, label: asset.name })),
            ]}
          />
          <span aria-hidden="true" />
        </div>
      ) : null}

      {sharedAsset ? (
        <p className="row__hint" style={{ marginTop: 0, marginBottom: "var(--sp-3)" }}>
          {`Shared "${sharedAsset.name}" — edits propagate to every bound object.`}
        </p>
      ) : null}

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
  onPropertyEditStart?: () => void;
  onPropertyEditEnd?: () => void;
  onPropertyEditCancel?: () => void;
  onToggleEditable: (nodeId: string, definition: NodePropertyDefinition, enabled: boolean) => void;
}

function TransformAxisGroup(props: TransformAxisGroupProps) {
  const {
    title,
    nodes,
    definitions,
    mixedPaths,
    onNodePropertyChange,
    onNodesPropertyChange,
    onPropertyEditStart,
    onPropertyEditEnd,
    onPropertyEditCancel,
    onToggleEditable,
  } = props;
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
              <NumberDragInput
                className="vec__val"
                type="text"
                inputMode="decimal"
                value={displayValue}
                placeholder={isMixed ? "Mixed" : undefined}
                onCommit={commit}
                onPreview={commit}
                onEditStart={onPropertyEditStart}
                onEditEnd={onPropertyEditEnd}
                onEditCancel={onPropertyEditCancel}
                aria-label={`${title} ${axisLetter}`}
                dragClassName="vec__drag"
                scrubOnInput
                step={definition.step ?? (definition.input === "degrees" ? 1 : 0.1)}
                precision={definition.input === "degrees" ? 2 : 3}
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
    const options = [
      ...(hasMixedValue ? [{ value: "__mixed__", label: "Mixed" }] : []),
      ...(definition.options ?? []).map((option) => ({ value: option.value, label: option.label })),
    ];
    control = (
      <CustomSelect
        ariaLabel={definition.label}
        value={hasMixedValue ? "__mixed__" : stringValue}
        onChange={commitValue}
        options={options}
      />
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
  } else if (isNumericDefinition(definition)) {
    control = (
      <span className="num">
        <NumberDragInput
          type="text"
          aria-label={definition.label}
          inputMode="decimal"
          value={hasMixedValue ? "" : stringValue}
          placeholder={hasMixedValue ? "Mixed" : undefined}
          onCommit={(value) => commitValue(value)}
          step={definition.step ?? (definition.input === "degrees" ? 1 : 0.1)}
          precision={definition.input === "degrees" ? 2 : 3}
        />
      </span>
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

type InspectorSectionId = "object" | "transform" | "geometry" | "material" | "text" | "image";

function getSectionsForSelection(
  node: EditorNode | undefined,
  selectionNodes: EditorNode[],
  shared: SharedScopeBundle,
): InspectorSectionId[] {
  if (selectionNodes.length === 0) {
    return [];
  }

  if (selectionNodes.length > 1) {
    const sections: InspectorSectionId[] = [];
    if (shared.object.definitions.length > 0) sections.push("object");
    if (shared.transform.definitions.length > 0) sections.push("transform");
    if (shared.geometry.definitions.length > 0) sections.push("geometry");
    if (shared.material.definitions.length > 0) sections.push("material");
    return sections;
  }

  if (!node) {
    return [];
  }

  const sections: InspectorSectionId[] = ["object", "transform"];

  if (node.type !== "group") {
    sections.push("geometry");
    sections.push("material");
  }

  if (node.type === "text") {
    sections.push("text");
  }

  if (node.type === "image") {
    sections.push("image");
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
