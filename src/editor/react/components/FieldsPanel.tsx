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
      <div className="panel-empty panel-empty--card">
        <strong className="panel-empty__title">No Runtime Fields Yet</strong>
        <span className="panel-empty__body">Mark properties as editable in the Inspector to generate runtime options here.</span>
      </div>
    );
  }

  return (
    <div className="editable-fields">
      {entries.map((entry) => (
        <div key={`${entry.node.id}:${entry.binding.path}`} className="editable-card">
          <div className="editable-card__title">{entry.node.name}</div>
          <div className="editable-card__path">{entry.binding.path}</div>

          <label className="field-block">
            <span className="field-block__label">Key</span>
            <BufferedInput
              className="editor-input"
              type="text"
              value={entry.binding.key}
              onCommit={(value) => onUpdateBinding(entry.node.id, entry.binding.path, { key: value })}
            />
          </label>

          <label className="field-block">
            <span className="field-block__label">Label</span>
            <BufferedInput
              className="editor-input"
              type="text"
              value={entry.binding.label}
              onCommit={(value) => onUpdateBinding(entry.node.id, entry.binding.path, { label: value })}
            />
          </label>

          <button
            type="button"
            className="tool-button tool-button--full"
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
