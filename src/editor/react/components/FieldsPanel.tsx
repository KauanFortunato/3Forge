import { getPropertyDefinitions } from "../../state";
import type { EditableFieldEntry } from "../../types";
import { BufferedInput } from "./BufferedInput";

interface FieldsPanelProps {
  entries: EditableFieldEntry[];
  onUpdateBinding: (nodeId: string, path: string, patch: { key?: string; label?: string }) => void;
  onRemoveEditable: (nodeId: string, path: string) => void;
}

export function FieldsPanel({ entries, onUpdateBinding, onRemoveEditable }: FieldsPanelProps) {
  if (entries.length === 0) {
    return (
      <div className="panel__empty">
        Mark properties as editable in the Inspector to generate runtime options here.
      </div>
    );
  }

  return (
    <div>
      {entries.map((entry) => (
        <div key={`${entry.node.id}:${entry.binding.path}`} className="sec sec--field">
          <div className="sec__title">{entry.node.name}</div>
          <div className="sec__path">{entry.binding.path}</div>

          <div className="row">
            <span className="row__lbl">Key</span>
            <span className="text">
              <BufferedInput
                type="text"
                value={entry.binding.key}
                onCommit={(value) => onUpdateBinding(entry.node.id, entry.binding.path, { key: value })}
              />
            </span>
            <span aria-hidden="true" />
          </div>

          <div className="row">
            <span className="row__lbl">Label</span>
            <span className="text">
              <BufferedInput
                type="text"
                value={entry.binding.label}
                onCommit={(value) => onUpdateBinding(entry.node.id, entry.binding.path, { label: value })}
              />
            </span>
            <span aria-hidden="true" />
          </div>

          <button
            type="button"
            className="tbtn is-ghost tbtn--block"
            onClick={() => {
              const definition = getPropertyDefinitions(entry.node).find((item) => item.path === entry.binding.path);
              if (!definition) {
                return;
              }

              onRemoveEditable(entry.node.id, definition.path);
            }}
          >
            Remover campo
          </button>
        </div>
      ))}
    </div>
  );
}
