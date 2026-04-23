import { Modal } from "./Modal";

interface ShortcutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  ["Q", "Select"],
  ["W", "Move"],
  ["E", "Rotate"],
  ["R", "Scale"],
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
      <div>
        {SHORTCUTS.map(([key, description]) => (
          <div key={key} className="row">
            <span className="row__lbl"><span className="kbd">{key}</span></span>
            <span>{description}</span>
            <span aria-hidden="true" />
          </div>
        ))}
      </div>
    </Modal>
  );
}
