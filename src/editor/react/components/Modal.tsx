import { useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  size?: "default" | "wide";
  keepMounted?: boolean;
  children: ReactNode;
}

export function Modal({ title, isOpen, onClose, size = "default", keepMounted = false, children }: ModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen && !keepMounted) {
    return null;
  }

  if (!isOpen) {
    return createPortal(
      <div hidden>{children}</div>,
      document.body,
    );
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal${size === "wide" ? " modal--wide" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__hd">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Fechar">
            X
          </button>
        </div>
        <div className="modal__bd">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
