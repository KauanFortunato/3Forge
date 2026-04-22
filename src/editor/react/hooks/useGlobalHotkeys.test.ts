import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalHotkeys } from "./useGlobalHotkeys";

function createHandlers() {
  return {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onDelete: vi.fn(),
    onFrame: vi.fn(),
    onPlayPause: vi.fn(),
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onToolChange: vi.fn(),
    onToggleTimeline: vi.fn(),
    onDuplicate: vi.fn(),
    onAddKeyframeAtPlayhead: vi.fn(),
    onStopAnimation: vi.fn(),
  };
}

function dispatch(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("useGlobalHotkeys", () => {
  beforeEach(() => {
    // Ensure document.body is focused (no stray input focus from a previous test).
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  it("invokes onToggleTimeline when 't' is pressed with no modifiers and no input focus", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    dispatch({ key: "t" });

    expect(handlers.onToggleTimeline).toHaveBeenCalledTimes(1);
  });

  it("invokes onDuplicate and preventDefault on Ctrl+D and Meta+D", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const ctrlEvent = dispatch({ key: "d", ctrlKey: true });
    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
    expect(ctrlEvent.defaultPrevented).toBe(true);

    const metaEvent = dispatch({ key: "d", metaKey: true });
    expect(handlers.onDuplicate).toHaveBeenCalledTimes(2);
    expect(metaEvent.defaultPrevented).toBe(true);
  });

  it("invokes onAddKeyframeAtPlayhead when 'k' is pressed with no modifiers", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    dispatch({ key: "k" });

    expect(handlers.onAddKeyframeAtPlayhead).toHaveBeenCalledTimes(1);
  });

  it("invokes onStopAnimation when Enter is pressed with no modifiers", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    dispatch({ key: "Enter" });

    expect(handlers.onStopAnimation).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke onToggleTimeline when an <input> is focused (input guard)", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    // Dispatch the event from the input so event.target is the input element.
    dispatch({ key: "t" }, input);

    expect(handlers.onToggleTimeline).not.toHaveBeenCalled();

    input.remove();
  });

  it("does NOT invoke onToggleTimeline when 't' is combined with Shift or Ctrl modifiers", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    dispatch({ key: "t", shiftKey: true });
    dispatch({ key: "t", ctrlKey: true });

    expect(handlers.onToggleTimeline).not.toHaveBeenCalled();
  });
});
