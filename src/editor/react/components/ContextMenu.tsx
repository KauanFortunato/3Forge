import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ContextMenuState, MenuAction } from "../ui-types";
import { ChevronRightIcon } from "./icons";

interface MenuListProps {
  items: MenuAction[];
  onClose: () => void;
  className?: string;
}

export function MenuList({ items, onClose, className }: MenuListProps) {
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);

  return (
    <div className={`menu-surface ${className ?? ""}`.trim()}>
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={`${item.id}-${index}`} className="menu-surface__separator" />;
        }

        const hasChildren = Boolean(item.children?.length);
        const isOpen = submenuIndex === index && hasChildren;

        return (
          <div
            key={item.id}
            className="menu-surface__item-wrap"
            onMouseEnter={() => setSubmenuIndex(hasChildren ? index : null)}
          >
            <button
              type="button"
              className={`menu-surface__item${item.danger ? " is-danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                if (hasChildren) {
                  setSubmenuIndex((current) => (current === index ? null : index));
                  return;
                }

                item.onSelect?.();
                onClose();
              }}
            >
              <span className="menu-surface__label">
                {item.icon ? <span className="menu-surface__icon">{item.icon}</span> : null}
                <span>{item.label}</span>
              </span>
              <span className="menu-surface__meta">
                {item.shortcut ? <span>{item.shortcut}</span> : null}
                {hasChildren ? <ChevronRightIcon width={14} height={14} /> : null}
              </span>
            </button>

            {isOpen && item.children ? (
              <div className="menu-surface__submenu">
                <MenuList items={item.children} onClose={onClose} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface ContextMenuProps {
  state: ContextMenuState | null;
  onClose: () => void;
}

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const position = useMemo(
    () => (state ? { left: state.x, top: state.y } : undefined),
    [state],
  );

  useEffect(() => {
    if (!state) {
      return;
    }

    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [state, onClose]);

  if (!state || !position) {
    return null;
  }

  return createPortal(
    <div ref={rootRef} className="context-menu" style={position} onContextMenu={(event) => event.preventDefault()}>
      <MenuList items={state.items} onClose={onClose} />
    </div>,
    document.body,
  );
}
