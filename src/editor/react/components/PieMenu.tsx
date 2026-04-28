import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

export interface PieMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  isActive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface PieMenuProps {
  open: boolean;
  position: { x: number; y: number };
  items: PieMenuItem[];
  onClose: () => void;
  /**
   * Hotkey key (event.key, lowercased) that opened this menu. When set, the
   * menu commits the highlighted item on keyup of that key, mimicking the
   * Blender press-hold-release pattern.
   */
  hotkey?: string;
  /** Pixel radius from the center to each item button. */
  radius?: number;
  ariaLabel?: string;
  title?: string;
}

const DEFAULT_RADIUS = 128;
const DEAD_ZONE = 56;

export function PieMenu({
  open,
  position,
  items,
  onClose,
  hotkey,
  radius = DEFAULT_RADIUS,
  ariaLabel,
  title,
}: PieMenuProps) {
  const [highlight, setHighlight] = useState<number | null>(null);
  const positionedItems = useMemo(() => arrangeItems(items, radius), [items, radius]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  const highlightRef = useRef<number | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    highlightRef.current = highlight;
  }, [highlight]);

  useEffect(() => {
    if (!open) {
      setHighlight(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dx = event.clientX - position.x;
      const dy = event.clientY - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < DEAD_ZONE) {
        setHighlight(null);
        return;
      }
      const angle = Math.atan2(dy, dx);
      const index = closestItemIndex(itemsRef.current.length, angle);
      if (itemsRef.current[index]?.disabled) {
        setHighlight(null);
        return;
      }
      setHighlight(index);
    };

    const commit = () => {
      const idx = highlightRef.current;
      const items = itemsRef.current;
      if (idx !== null && items[idx] && !items[idx].disabled) {
        items[idx].onSelect();
      }
      onClose();
    };

    const handlePointerDown = (event: PointerEvent) => {
      // Click outside the container without a highlighted item closes silently.
      const target = event.target as Node | null;
      if (containerRef.current && target && containerRef.current.contains(target)) {
        return;
      }
      const idx = highlightRef.current;
      const items = itemsRef.current;
      if (idx !== null && items[idx] && !items[idx].disabled) {
        event.preventDefault();
        items[idx].onSelect();
      }
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (hotkey && event.key.toLowerCase() === hotkey) {
        event.preventDefault();
        commit();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [open, position.x, position.y, hotkey, onClose]);

  if (!open || items.length === 0) {
    return null;
  }

  const style: CSSProperties = {
    "--pie-x": `${position.x}px`,
    "--pie-y": `${position.y}px`,
    "--pie-r": `${radius}px`,
  } as CSSProperties;

  const activeItem = highlight !== null ? items[highlight] : null;
  const labelText = activeItem?.label ?? title ?? ariaLabel ?? "";

  return createPortal(
    <div
      ref={containerRef}
      className="pie-menu"
      style={style}
      role="menu"
      aria-label={ariaLabel ?? title ?? "Pie menu"}
    >
      <div className="pie-menu__center" aria-hidden={!labelText}>
        {labelText ? <span className="pie-menu__center-label">{labelText}</span> : null}
        {activeItem?.description ? (
          <span className="pie-menu__center-desc">{activeItem.description}</span>
        ) : null}
      </div>

      {positionedItems.map(({ item, x, y, index }) => {
        const isHighlighted = highlight === index;
        const isCurrent = item.isActive;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={
              "pie-menu__item"
              + (isHighlighted ? " is-highlighted" : "")
              + (isCurrent ? " is-current" : "")
            }
            style={{ "--pie-item-x": `${x}px`, "--pie-item-y": `${y}px` } as CSSProperties}
            onPointerEnter={() => {
              if (!item.disabled) {
                setHighlight(index);
              }
            }}
            onClick={() => {
              if (!item.disabled) {
                item.onSelect();
              }
              onClose();
            }}
            title={item.label}
          >
            {item.icon ? <span className="pie-menu__item-icon" aria-hidden="true">{item.icon}</span> : null}
            <span className="pie-menu__item-label">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function arrangeItems(items: PieMenuItem[], radius: number) {
  const total = items.length;
  if (total === 0) {
    return [];
  }
  return items.map((item, index) => {
    const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
    return {
      item,
      index,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
}

function closestItemIndex(total: number, angle: number): number {
  if (total === 0) {
    return -1;
  }
  // Map our angle (with 0 at +x axis) to the same convention used to lay items out (start at top, clockwise).
  const normalised = (angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  const slice = (Math.PI * 2) / total;
  return Math.round(normalised / slice) % total;
}
