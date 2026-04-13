import { getPropertyDefinitions } from "../../state";
import type { EditableFieldEntry } from "../../types";

interface FieldsPanelProps {
  entries: EditableFieldEntry[];
  onUpdateBinding: (nodeId: string, path: string, patch: { key?: string; label?: string }) => void;
  onRemoveEditable: (nodeId: string, path: string) => void;
}

export function FieldsPanel({ entries, onUpdateBinding, onRemoveEditable }: FieldsPanelProps) {
  if (entries.length === 0) {
    return <p className="panel-empty">Marque propriedades como editaveis para gerar opcoes de runtime.</p>;
  }

  return (
    <div className="editable-fields">
      {entries.map((entry) => (
        <div key={`${entry.node.id}:${entry.binding.path}`} className="editable-card">
          <div className="editable-card__title">{entry.node.name}</div>
          <div className="editable-card__path">{entry.binding.path}</div>

          <label className="field-block">
            <span className="field-block__label">Key</span>
            <input
              className="editor-input"
              type="text"
              value={entry.binding.key}
              onChange={(event) => onUpdateBinding(entry.node.id, entry.binding.path, { key: event.target.value })}
            />
          </label>

          <label className="field-block">
            <span className="field-block__label">Label</span>
            <input
              className="editor-input"
              type="text"
              value={entry.binding.label}
              onChange={(event) => onUpdateBinding(entry.node.id, entry.binding.path, { label: event.target.value })}
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
