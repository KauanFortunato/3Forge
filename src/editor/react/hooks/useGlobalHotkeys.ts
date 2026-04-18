import { useEffect } from "react";

interface HotkeyHandlers {
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onFrame: () => void;
  onPlayPause: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onToolChange: (mode: "select" | "translate" | "rotate" | "scale") => void;
}

export function useGlobalHotkeys(handlers: HotkeyHandlers): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (isTyping) {
        return;
      }

      if (event.key === "Delete") {
        event.preventDefault();
        handlers.onDelete();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        handlers.onPlayPause();
        return;
      }

      const isUndo = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z";
      const isRedo = (event.ctrlKey && event.key.toLowerCase() === "y")
        || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "z");
      const isNew = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "n";
      const isOpen = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "o";
      const isSave = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "s";
      const isSaveAs = event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s";
      const isCopy = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "c";
      const isPaste = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "v";

      if (isNew) {
        event.preventDefault();
        handlers.onNew();
        return;
      }

      if (isOpen) {
        event.preventDefault();
        handlers.onOpen();
        return;
      }

      if (isSaveAs) {
        event.preventDefault();
        handlers.onSaveAs();
        return;
      }

      if (isSave) {
        event.preventDefault();
        handlers.onSave();
        return;
      }

      if (isUndo) {
        event.preventDefault();
        handlers.onUndo();
        return;
      }

      if (isRedo) {
        event.preventDefault();
        handlers.onRedo();
        return;
      }

      if (isCopy) {
        event.preventDefault();
        handlers.onCopy();
        return;
      }

      if (isPaste) {
        event.preventDefault();
        handlers.onPaste();
        return;
      }

      if (event.code === "Digit1" || event.code === "Numpad1") {
        event.preventDefault();
        handlers.onToolChange("select");
        return;
      }

      if (event.code === "Digit2" || event.code === "Numpad2") {
        event.preventDefault();
        handlers.onToolChange("translate");
        return;
      }

      if (event.code === "Digit3" || event.code === "Numpad3") {
        event.preventDefault();
        handlers.onToolChange("rotate");
        return;
      }

      if (event.code === "Digit4" || event.code === "Numpad4") {
        event.preventDefault();
        handlers.onToolChange("scale");
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        handlers.onFrame();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
