import type { ReactNode } from "react";
import { Modal } from "./Modal";

interface ShortcutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string[];
  label: string;
}

interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Pie menus",
    entries: [
      { keys: ["Z"], label: "View mode pie (Rendered / Solid / Wireframe)" },
      { keys: ["Q"], label: "Transform tool pie (Select / Move / Rotate / Scale)" },
    ],
  },
  {
    title: "Transform tools",
    entries: [
      { keys: ["1"], label: "Select" },
      { keys: ["2"], label: "Move" },
      { keys: ["3"], label: "Rotate" },
      { keys: ["4"], label: "Scale" },
    ],
  },
  {
    title: "Viewport",
    entries: [
      { keys: ["F"], label: "Frame selection" },
      { keys: ["T"], label: "Toggle timeline" },
    ],
  },
  {
    title: "Selection",
    entries: [
      { keys: ["Ctrl", "A"], label: "Select all" },
      { keys: ["Esc"], label: "Clear selection" },
      { keys: ["Delete"], label: "Delete (material / keyframe / node — by context)" },
      { keys: ["Ctrl", "D"], label: "Duplicate selection" },
    ],
  },
  {
    title: "Clipboard",
    entries: [
      { keys: ["Ctrl", "C"], label: "Copy node" },
      { keys: ["Ctrl", "V"], label: "Paste node" },
      { keys: ["Ctrl", "Shift", "C"], label: "Copy properties" },
      { keys: ["Ctrl", "Shift", "V"], label: "Paste properties" },
    ],
  },
  {
    title: "History",
    entries: [
      { keys: ["Ctrl", "Z"], label: "Undo" },
      { keys: ["Ctrl", "Y"], label: "Redo" },
      { keys: ["Ctrl", "Shift", "Z"], label: "Redo (alt)" },
    ],
  },
  {
    title: "File",
    entries: [
      { keys: ["Ctrl", "N"], label: "New project" },
      { keys: ["Ctrl", "O"], label: "Open project" },
      { keys: ["Ctrl", "S"], label: "Save" },
      { keys: ["Ctrl", "Shift", "S"], label: "Save As" },
    ],
  },
  {
    title: "Animation",
    entries: [
      { keys: ["Space"], label: "Play / Pause" },
      { keys: ["Enter"], label: "Stop animation" },
      { keys: ["K"], label: "Add keyframe at playhead" },
    ],
  },
];

export function ShortcutDialog({ isOpen, onClose }: ShortcutDialogProps) {
  return (
    <Modal title="Shortcuts" isOpen={isOpen} onClose={onClose} size="wide">
      <p className="row__hint" style={{ marginTop: 0, marginBottom: "var(--sp-4)" }}>
        On macOS use ⌘ Cmd instead of Ctrl. Shortcuts are disabled while typing in inputs.
      </p>

      <div className="shortcut-groups">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="shortcut-group">
            <h3 className="shortcut-group__title">{group.title}</h3>
            <dl className="shortcut-group__list">
              {group.entries.map((entry) => (
                <div key={`${group.title}-${entry.keys.join("+")}-${entry.label}`} className="shortcut-row">
                  <dt className="shortcut-row__keys">{renderKeyCombo(entry.keys)}</dt>
                  <dd className="shortcut-row__label">{entry.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}

function renderKeyCombo(keys: string[]): ReactNode {
  return keys.map((key, index) => (
    <span key={`${key}-${index}`} className="shortcut-row__key-combo">
      {index > 0 ? <span className="shortcut-row__plus" aria-hidden="true">+</span> : null}
      <span className="kbd">{key}</span>
    </span>
  ));
}
