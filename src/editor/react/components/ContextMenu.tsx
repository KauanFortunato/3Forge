import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ContextMenuState, MenuAction } from "../ui-types";
import { ChevronRightIcon } from "./icons";

interface MenuListProps {
  items: MenuAction[];
  onClose: () => void;
  className?: string;
  onRequestClose?: () => void;
}

export function MenuList({ items, onClose, className, onRequestClose }: MenuListProps) {
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  const [submenuPlacement, setSubmenuPlacement] = useState<"right" | "left">("right");
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const submenuWrapRef = useRef<HTMLDivElement | null>(null);

  // Flip submenu to the left when it would overflow the viewport edge.
  useLayoutEffect(() => {
    if (submenuIndex === null) {
      return;
    }
    const wrap = submenuWrapRef.current;
    const parentButton = buttonRefs.current[submenuIndex];
    if (!wrap || !parentButton) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : rect.right;
    if (rect.right > viewportWidth - 4) {
      setSubmenuPlacement("left");
    } else {
      setSubmenuPlacement("right");
    }
  }, [submenuIndex, items]);

  const handleItemKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
    item: MenuAction,
    hasChildren: boolean,
  ) => {
    if (event.key === "ArrowRight" && hasChildren && !item.disabled) {
      event.preventDefault();
      event.stopPropagation();
      setSubmenuIndex(index);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      if (onRequestClose) {
        onRequestClose();
      }
      return;
    }
  };

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
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              className={`menu-surface__item${item.danger ? " is-danger" : ""}`}
              disabled={item.disabled}
              onKeyDown={(event) => handleItemKeyDown(event, index, item, hasChildren)}
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
              <div
                ref={submenuWrapRef}
                className={`menu-surface__submenu menu-surface__submenu--${submenuPlacement}`}
              >
                <MenuList
                  items={item.children}
                  onClose={onClose}
                  onRequestClose={() => setSubmenuIndex(null)}
                />
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
