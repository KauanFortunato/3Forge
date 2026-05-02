import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { getMaterialPropertyDefinitions } from "../../materials";
import type { ImageAsset, MaterialAsset, MaterialSpec, NodePropertyDefinition } from "../../types";
import { BufferedInput } from "./BufferedInput";
import { CustomSelect } from "./CustomSelect";
import { NumberDragInput } from "./NumberDragInput";
import { MaterialIcon, XIcon } from "./icons";

interface MaterialAssetEditorProps {
  material: MaterialAsset;
  images?: Array<ImageAsset & { id: string }>;
  usageCount: number;
  onRename: (materialId: string, name: string) => void;
  onUpdate: (
    materialId: string,
    definition: NodePropertyDefinition,
    value: string | number | boolean,
  ) => void;
  onClose: () => void;
}

const SHADOW_PATHS = new Set(["material.castShadow", "material.receiveShadow"]);
const BASE_PATHS = ["material.type", "material.side", "material.mapImageId", "material.color", "material.opacity", "material.transparent"];
const PBR_PATHS = ["material.emissive", "material.emissiveIntensity", "material.roughness", "material.metalness", "material.envMapIntensity"];
const PHYSICAL_PATHS = ["material.transmission", "material.thickness", "material.clearcoat", "material.clearcoatRoughness", "material.ior"];
const ADVANCED_PATHS = ["material.alphaTest", "material.depthTest", "material.depthWrite", "material.wireframe", "material.flatShading", "material.fog", "material.toneMapped"];

export function MaterialAssetEditor({ material, images = [], usageCount, onRename, onUpdate, onClose }: MaterialAssetEditorProps) {
  const definitions = useMemo(() => {
    const all = getMaterialPropertyDefinitions(material.spec.type);
    return all.filter((definition) => !SHADOW_PATHS.has(definition.path));
  }, [material.spec.type]);
  const textureOptions = useMemo(
    () => [
      { label: "None", value: "" },
      ...images.map((image) => ({ label: image.name, value: image.id })),
    ],
    [images],
  );
  const resolvedDefinitions = useMemo(
    () => definitions.map((definition) => definition.path === "material.mapImageId"
      ? { ...definition, options: textureOptions }
      : definition),
    [definitions, textureOptions],
  );
  const groupedDefinitions = useMemo(() => groupMaterialDefinitions(resolvedDefinitions), [resolvedDefinitions]);

  return (
    <div className="material-asset-editor">
      <div className="material-asset-editor__head">
        <span
          className="material-asset-editor__swatch"
          style={{ backgroundColor: normalizeSwatch(material.spec.color) }}
          aria-hidden="true"
        />
        <span className="material-asset-editor__meta">
          <span className="material-asset-editor__title">
            <span className="material-asset-editor__icon" aria-hidden="true">
              <MaterialIcon width={11} height={11} />
            </span>
            <span>Material</span>
          </span>
          <span className="material-asset-editor__sub">
            {`${usageCount} object${usageCount === 1 ? "" : "s"} bound`}
          </span>
        </span>
        <button
          type="button"
          className="ibtn"
          onClick={onClose}
          aria-label="Close material editor"
          title="Close (back to selection)"
        >
          <XIcon width={11} height={11} />
        </button>
      </div>

      <div className="material-asset-editor__body sec sec--field">
        <div className="row">
          <span className="row__lbl">Name</span>
          <span className="text">
            <BufferedInput
              type="text"
              value={material.name}
              onCommit={(value) => onRename(material.id, value)}
            />
          </span>
          <span aria-hidden="true" />
        </div>

        <MaterialPropertyGroup
          title="Base"
          definitions={groupedDefinitions.base}
          spec={material.spec}
          onCommit={(definition, value) => onUpdate(material.id, definition, value)}
        />

        {groupedDefinitions.pbr.length > 0 ? (
          <MaterialPropertyGroup
            title="Standard PBR"
            definitions={groupedDefinitions.pbr}
            spec={material.spec}
            onCommit={(definition, value) => onUpdate(material.id, definition, value)}
          />
        ) : null}

        {groupedDefinitions.physical.length > 0 ? (
          <MaterialPropertyGroup
            title="Physical"
            definitions={groupedDefinitions.physical}
            spec={material.spec}
            onCommit={(definition, value) => onUpdate(material.id, definition, value)}
          />
        ) : null}

        {groupedDefinitions.advanced.length > 0 ? (
          <MaterialPropertyGroup
            title="Advanced"
            definitions={groupedDefinitions.advanced}
            spec={material.spec}
            onCommit={(definition, value) => onUpdate(material.id, definition, value)}
          />
        ) : null}
      </div>
    </div>
  );
}

interface GroupedMaterialDefinitions {
  base: NodePropertyDefinition[];
  pbr: NodePropertyDefinition[];
  physical: NodePropertyDefinition[];
  advanced: NodePropertyDefinition[];
}

function groupMaterialDefinitions(definitions: NodePropertyDefinition[]): GroupedMaterialDefinitions {
  return {
    base: definitions.filter((definition) => BASE_PATHS.includes(definition.path)),
    pbr: definitions.filter((definition) => PBR_PATHS.includes(definition.path)),
    physical: definitions.filter((definition) => PHYSICAL_PATHS.includes(definition.path)),
    advanced: definitions.filter((definition) => ADVANCED_PATHS.includes(definition.path)),
  };
}

interface MaterialPropertyGroupProps {
  title: string;
  definitions: NodePropertyDefinition[];
  spec: MaterialSpec;
  onCommit: (definition: NodePropertyDefinition, value: string | number | boolean) => void;
}

function MaterialPropertyGroup({ title, definitions, spec, onCommit }: MaterialPropertyGroupProps) {
  if (definitions.length === 0) {
    return null;
  }

  return (
    <>
      <div className="sec__sub">{title}</div>
      {definitions.map((definition) => (
        <MaterialPropertyRow
          key={definition.path}
          definition={definition}
          spec={spec}
          onCommit={(value) => onCommit(definition, value)}
        />
      ))}
    </>
  );
}

interface MaterialPropertyRowProps {
  definition: NodePropertyDefinition;
  spec: MaterialSpec;
  onCommit: (value: string | number | boolean) => void;
}

function MaterialPropertyRow({ definition, spec, onCommit }: MaterialPropertyRowProps) {
  const subPath = definition.path.slice("material.".length);
  const rawValue = (spec as unknown as Record<string, unknown>)[subPath];

  if (definition.input === "checkbox") {
    const checked = Boolean(rawValue);
    return (
      <div className="row">
        <span className="row__lbl">{definition.label}</span>
        <label className={`tog${checked ? " is-on" : ""}`} style={{ display: "inline-block" }}>
          <input
            type="checkbox"
            aria-label={definition.label}
            checked={checked}
            onChange={(event) => onCommit(event.target.checked)}
            style={{ position: "absolute", width: "100%", height: "100%", opacity: 0, margin: 0, top: 0, left: 0, cursor: "pointer" }}
          />
        </label>
        <span aria-hidden="true" />
      </div>
    );
  }

  if (definition.input === "select") {
    const stringValue = String(rawValue ?? definition.options?.[0]?.value ?? "");
    return (
      <div className="row">
        <span className="row__lbl">{definition.label}</span>
        <CustomSelect
          ariaLabel={definition.label}
          value={stringValue}
          onChange={(value) => onCommit(value)}
          options={(definition.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
        />
        <span aria-hidden="true" />
      </div>
    );
  }

  if (definition.input === "color") {
    const stringValue = typeof rawValue === "string" ? rawValue : "#ffffff";
    return (
      <div className="row">
        <span className="row__lbl">{definition.label}</span>
        <MaterialColorControl ariaLabel={definition.label} value={stringValue} onCommit={onCommit} />
        <span aria-hidden="true" />
      </div>
    );
  }

  if (definition.input === "number" || definition.input === "degrees") {
    const numericValue = typeof rawValue === "number" ? rawValue : 0;
    return (
      <div className="row">
        <span className="row__lbl">{definition.label}</span>
        <span className="num">
          <NumberDragInput
            type="text"
            inputMode="decimal"
            aria-label={definition.label}
            value={String(Number(numericValue.toFixed(4)))}
            onCommit={(value) => onCommit(value)}
            step={definition.step ?? 0.05}
            precision={3}
          />
        </span>
        <span aria-hidden="true" />
      </div>
    );
  }

  return null;
}

interface MaterialColorControlProps {
  ariaLabel: string;
  value: string;
  onCommit: (value: string) => void;
}

function MaterialColorControl({ ariaLabel, value, onCommit }: MaterialColorControlProps) {
  const [draftValue, setDraftValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value);
    }
  }, [isFocused, value]);

  const swatch = normalizeSwatch(draftValue || value);
  const style: CSSProperties = { color: swatch };

  return (
    <span className="swatch-row">
      <input
        className="swatch"
        type="color"
        aria-label={`${ariaLabel} swatch`}
        value={swatch}
        onFocus={() => setIsFocused(true)}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={() => {
          setIsFocused(false);
          const normalized = normalizeHexColor(draftValue);
          if (normalized && normalized !== value) {
            onCommit(normalized);
          }
        }}
        style={style}
      />
      <BufferedInput
        className="swatch-hex"
        type="text"
        aria-label={ariaLabel}
        value={draftValue}
        onCommit={(next) => {
          const normalized = normalizeHexColor(next);
          if (normalized) {
            onCommit(normalized);
          }
        }}
      />
    </span>
  );
}

function normalizeSwatch(value: string): string {
  return normalizeHexColor(value) ?? "#ffffff";
}

function normalizeHexColor(value: string): string | null {
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
