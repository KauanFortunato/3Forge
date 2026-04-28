import type { MouseEvent } from "react";
import type { MaterialAsset } from "../../types";
import { MaterialIcon, PlusIcon, TrashIcon, UnlinkIcon } from "./icons";

interface MaterialsPanelProps {
  materials: MaterialAsset[];
  selectionUsageById: Record<string, number>;
  totalUsageById: Record<string, number>;
  hasSelection: boolean;
  selectionUsesMaterialId: string | null;
  selectedMaterialId: string | null;
  onSelectMaterial: (materialId: string | null) => void;
  onCreate: () => string | null;
  onUnassignSelection: () => void;
  onRemove: (materialId: string) => void;
}

export function MaterialsPanel(props: MaterialsPanelProps) {
  const {
    materials,
    selectionUsageById,
    totalUsageById,
    hasSelection,
    selectionUsesMaterialId,
    selectedMaterialId,
    onSelectMaterial,
    onCreate,
    onUnassignSelection,
    onRemove,
  } = props;

  const handleCreate = () => {
    const id = onCreate();
    if (id) {
      onSelectMaterial(id);
    }
  };

  const stop = (event: MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div className="materials-panel">
      <div className="materials-panel__head">
        <span>Materials</span>
        <div className="materials-panel__head-actions">
          <button
            type="button"
            className="ibtn"
            onClick={handleCreate}
            aria-label="New material"
            title="New material"
          >
            <PlusIcon width={11} height={11} />
          </button>
        </div>
      </div>

      {materials.length === 0 ? (
        <div className="panel__empty">
          No reusable materials yet. Create one to share appearance across objects.
        </div>
      ) : (
        <div className="materials-panel__list">
          {materials.map((material) => {
            const totalUsage = totalUsageById[material.id] ?? 0;
            const selectionUsage = selectionUsageById[material.id] ?? 0;
            const isActive = material.id === selectedMaterialId;
            const canUnlinkFromSelection =
              hasSelection && selectionUsesMaterialId === material.id && selectionUsage > 0;

            return (
              <div
                key={material.id}
                className={`materials-panel__item${isActive ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="materials-panel__item-main"
                  onClick={() => onSelectMaterial(material.id)}
                  title={`Edit ${material.name}`}
                >
                  <span
                    className="materials-panel__swatch"
                    style={{ backgroundColor: normalizeSwatch(material.spec.color) }}
                    aria-hidden="true"
                  />
                  <span className="materials-panel__meta">
                    <span className="materials-panel__name">{material.name}</span>
                    <span className="materials-panel__sub">
                      {`${totalUsage} object${totalUsage === 1 ? "" : "s"} bound`}
                    </span>
                  </span>
                  <span className="materials-panel__icon" aria-hidden="true">
                    <MaterialIcon width={11} height={11} />
                  </span>
                </button>
                <div className="materials-panel__item-actions" onClick={stop}>
                  <button
                    type="button"
                    className="ibtn"
                    onClick={() => {
                      if (canUnlinkFromSelection) {
                        onUnassignSelection();
                      }
                    }}
                    disabled={!canUnlinkFromSelection}
                    aria-label="Unbind selection from this material"
                    title={canUnlinkFromSelection
                      ? "Unbind current selection from this material"
                      : "Select objects bound to this material to unbind"}
                  >
                    <UnlinkIcon width={11} height={11} />
                  </button>
                  <button
                    type="button"
                    className="ibtn ibtn--danger"
                    onClick={() => onRemove(material.id)}
                    aria-label="Delete material"
                    title="Delete material (Del)"
                  >
                    <TrashIcon width={11} height={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function normalizeSwatch(value: string): string {
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
