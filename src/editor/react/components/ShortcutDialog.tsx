import { Modal } from "./Modal";

interface ShortcutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  ["1", "Select"],
  ["2", "Move"],
  ["3", "Rotate"],
  ["4", "Scale"],
  ["F", "Frame selection"],
  ["T", "Toggle timeline"],
  ["Ctrl + Z", "Undo"],
  ["Ctrl + Y", "Redo"],
  ["Ctrl + C", "Copy selection"],
  ["Ctrl + V", "Paste copy"],
  ["Ctrl + Shift + C", "Copy properties"],
  ["Ctrl + Shift + V", "Paste properties"],
  ["Delete", "Remove selection"],
];

export function ShortcutDialog({ isOpen, onClose }: ShortcutDialogProps) {
  return (
    <Modal title="Shortcuts" isOpen={isOpen} onClose={onClose}>
      <div className="shortcut-list">
        {SHORTCUTS.map(([key, description]) => (
          <div key={key} className="shortcut-item">
            <span>{key}</span>
            <span>{description}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
