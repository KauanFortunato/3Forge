import { useEffect, useRef, useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

interface NumberDragInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onCommit: (value: string) => void;
  /**
   * Base step applied per pixel of horizontal movement. Defaults to 0.1 which
   * mirrors the feel used in most DCC tools (Blender / C4D / Figma).
   */
  step?: number;
  /**
   * Override how the currently-committed string is parsed before a drag
   * starts. Useful when values carry unit suffixes like "45°".
   */
  parseValue?: (value: string) => number;
  /**
   * Maximum decimals preserved when emitting a scrubbed value.
   */
  precision?: number;
  /**
   * Class applied to the drag handle button. Defaults to "num__drag".
   */
  dragClassName?: string;
}

function defaultParse(raw: string): number {
  const cleaned = raw.trim().replace(/[^0-9+\-.eE]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number, precision: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const fixed = value.toFixed(precision);
  return fixed.replace(/\.?0+$/, "") || "0";
}

/**
 * Numeric input with a reference-style drag-to-scrub handle.
 *
 * Renders an `<input>` followed by a `.num__drag` button. The handle uses
 * pointer capture so the drag keeps working even when the cursor leaves the
 * element. Typing, Enter, Tab, blur and Escape behave exactly like the
 * BufferedInput the rest of the editor uses.
 *
 * This component renders inline (fragment-style) — the parent is expected to
 * wrap it in a `.num` / `.vec__cell` container to match the reference layout.
 */
export function NumberDragInput({
  value,
  onCommit,
  step = 0.1,
  parseValue,
  precision = 3,
  onBlur,
  onFocus,
  onKeyDown,
  "aria-label": ariaLabel,
  dragClassName = "num__drag",
  ...inputProps
}: NumberDragInputProps) {
  const [draft, setDraft] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const dragState = useRef<{
    startX: number;
    startValue: number;
    lastValue: number;
    pointerId: number;
  } | null>(null);

  useEffect(() => {
    if (!isFocused && !isDragging) {
      setDraft(value);
    }
  }, [isFocused, isDragging, value]);

  const commitDraft = (next: string) => {
    setIsFocused(false);
    onCommit(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      setDraft(value);
      event.currentTarget.blur();
      return;
    }
    onKeyDown?.(event);
  };

  const resolveStep = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): number => {
    if (event.shiftKey) return step * 0.1;
    if (event.ctrlKey || event.metaKey) return step * 10;
    return step;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const parsed = parseValue ? parseValue(draft || value) : defaultParse(draft || value);
    dragState.current = {
      startX: event.clientX,
      startValue: parsed,
      lastValue: parsed,
      pointerId: event.pointerId,
    };
    draggingRef.current = true;
    setIsDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some environments (jsdom) may not support pointer capture; ignore.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    if (!state) return;
    const dx = event.clientX - state.startX;
    const increment = resolveStep(event);
    const next = state.startValue + dx * increment;
    state.lastValue = next;
    setDraft(formatNumber(next, precision));
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancel = false) => {
    const state = dragState.current;
    if (!state) return;
    const target = event.currentTarget;
    try {
      if (target.hasPointerCapture(state.pointerId)) {
        target.releasePointerCapture(state.pointerId);
      }
    } catch {
      // Ignore release failures in test environments.
    }
    dragState.current = null;
    draggingRef.current = false;
    setIsDragging(false);
    if (cancel) {
      setDraft(value);
      return;
    }
    if (state.lastValue !== state.startValue) {
      const committed = formatNumber(state.lastValue, precision);
      setDraft(committed);
      onCommit(committed);
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    endDrag(event, false);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    endDrag(event, true);
  };

  const handleHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return;
    if (event.key === "Escape") {
      const state = dragState.current;
      const target = event.currentTarget;
      if (state) {
        try {
          if (target.hasPointerCapture(state.pointerId)) {
            target.releasePointerCapture(state.pointerId);
          }
        } catch {
          // Ignore.
        }
        dragState.current = null;
      }
      draggingRef.current = false;
      setIsDragging(false);
      setDraft(value);
    }
  };

  return (
    <>
      <input
        {...inputProps}
        aria-label={ariaLabel}
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          setIsFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          if (draggingRef.current) {
            return;
          }
          commitDraft(draft);
          onBlur?.(event);
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={`${dragClassName}${isDragging ? " is-active" : ""}`}
        aria-label={ariaLabel ? `Scrub ${ariaLabel}` : "Scrub value"}
        // Keyboard editing flows through the sibling <input>; the drag handle is pointer-only.
        tabIndex={-1}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleHandleKeyDown}
      >
        <span aria-hidden="true" className="num__drag-grip" />
      </button>
    </>
  );
}
