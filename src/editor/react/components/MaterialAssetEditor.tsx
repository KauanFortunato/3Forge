import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { getMaterialPropertyDefinitions } from "../../materials";
import type { MaterialAsset, MaterialSpec, NodePropertyDefinition } from "../../types";
import { BufferedInput } from "./BufferedInput";
import { CustomSelect } from "./CustomSelect";
import { NumberDragInput } from "./NumberDragInput";
import { MaterialIcon, XIcon } from "./icons";

interface MaterialAssetEditorProps {
  material: MaterialAsset;
  usageCount: number;
  onRename: (materialId: string, name: string) => void;
  onUpdate: (
    materialId: string,
    definition: NodePropertyDefinition,
    value: string | number | boolean,
  ) => void;
  onClose: () => void;
}

const ASSIGNABLE_PATHS: ReadonlyArray<string> = [
  "material.type",
  "material.color",
  "material.opacity",
  "material.roughness",
  "material.metalness",
  "material.emissive",
];

export function MaterialAssetEditor({ material, usageCount, onRename, onUpdate, onClose }: MaterialAssetEditorProps) {
  const definitions = useMemo(() => {
    const all = getMaterialPropertyDefinitions(material.spec.type);
    return all.filter((definition) => ASSIGNABLE_PATHS.includes(definition.path));
  }, [material.spec.type]);

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

        {definitions.map((definition) => (
          <MaterialPropertyRow
            key={definition.path}
            definition={definition}
            spec={material.spec}
            onCommit={(value) => onUpdate(material.id, definition, value)}
          />
        ))}
      </div>
    </div>
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

  if (definition.input === "number") {
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
