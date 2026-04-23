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
    onSelectAll: vi.fn(),
    onEscapeSelection: vi.fn(),
    onCopyProperties: vi.fn(),
    onPasteProperties: vi.fn(),
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

  it("invokes onSelectAll on Ctrl+A and Meta+A, and prevents default", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const ctrlEvent = dispatch({ key: "a", ctrlKey: true });
    expect(handlers.onSelectAll).toHaveBeenCalledTimes(1);
    expect(ctrlEvent.defaultPrevented).toBe(true);

    const metaEvent = dispatch({ key: "a", metaKey: true });
    expect(handlers.onSelectAll).toHaveBeenCalledTimes(2);
    expect(metaEvent.defaultPrevented).toBe(true);
  });

  it("does NOT invoke onSelectAll when an input is focused", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    dispatch({ key: "a", ctrlKey: true }, input);
    expect(handlers.onSelectAll).not.toHaveBeenCalled();

    input.remove();
  });

  it("does NOT invoke onSelectAll when Shift or Alt modifiers are combined with Ctrl+A", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    dispatch({ key: "a", ctrlKey: true, shiftKey: true });
    dispatch({ key: "a", ctrlKey: true, altKey: true });

    expect(handlers.onSelectAll).not.toHaveBeenCalled();
  });

  it("invokes onEscapeSelection on Escape when no overlay is open and no input is focused", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    dispatch({ key: "Escape" });
    expect(handlers.onEscapeSelection).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke onEscapeSelection when a modal or context menu is open", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    document.body.appendChild(modal);

    dispatch({ key: "Escape" });
    expect(handlers.onEscapeSelection).not.toHaveBeenCalled();
    modal.remove();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    document.body.appendChild(menu);

    dispatch({ key: "Escape" });
    expect(handlers.onEscapeSelection).not.toHaveBeenCalled();
    menu.remove();
  });

  it("does NOT invoke onEscapeSelection when an input is focused", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    dispatch({ key: "Escape" }, input);
    expect(handlers.onEscapeSelection).not.toHaveBeenCalled();

    input.remove();
  });

  it("invokes onCopyProperties on Ctrl+Shift+C and Meta+Shift+C, and prevents default", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const ctrlEvent = dispatch({ key: "c", ctrlKey: true, shiftKey: true });
    expect(handlers.onCopyProperties).toHaveBeenCalledTimes(1);
    expect(handlers.onCopy).not.toHaveBeenCalled();
    expect(ctrlEvent.defaultPrevented).toBe(true);

    const metaEvent = dispatch({ key: "c", metaKey: true, shiftKey: true });
    expect(handlers.onCopyProperties).toHaveBeenCalledTimes(2);
    expect(metaEvent.defaultPrevented).toBe(true);
  });

  it("invokes onPasteProperties on Ctrl+Shift+V and Meta+Shift+V, and prevents default", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const ctrlEvent = dispatch({ key: "v", ctrlKey: true, shiftKey: true });
    expect(handlers.onPasteProperties).toHaveBeenCalledTimes(1);
    expect(handlers.onPaste).not.toHaveBeenCalled();
    expect(ctrlEvent.defaultPrevented).toBe(true);

    const metaEvent = dispatch({ key: "v", metaKey: true, shiftKey: true });
    expect(handlers.onPasteProperties).toHaveBeenCalledTimes(2);
    expect(metaEvent.defaultPrevented).toBe(true);
  });

  it("does NOT invoke onCopyProperties / onPasteProperties when an input is focused", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    dispatch({ key: "c", ctrlKey: true, shiftKey: true }, input);
    dispatch({ key: "v", ctrlKey: true, shiftKey: true }, input);

    expect(handlers.onCopyProperties).not.toHaveBeenCalled();
    expect(handlers.onPasteProperties).not.toHaveBeenCalled();

    input.remove();
  });

  it("does NOT invoke onCopyProperties / onPasteProperties when Alt is combined with Ctrl+Shift", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    dispatch({ key: "c", ctrlKey: true, shiftKey: true, altKey: true });
    dispatch({ key: "v", ctrlKey: true, shiftKey: true, altKey: true });

    expect(handlers.onCopyProperties).not.toHaveBeenCalled();
    expect(handlers.onPasteProperties).not.toHaveBeenCalled();
  });

  it("does NOT invoke onCopyProperties / onPasteProperties when a modal or context menu is open", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalHotkeys(handlers));

    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    document.body.appendChild(overlay);

    dispatch({ key: "c", ctrlKey: true, shiftKey: true });
    dispatch({ key: "v", ctrlKey: true, shiftKey: true });

    expect(handlers.onCopyProperties).not.toHaveBeenCalled();
    expect(handlers.onPasteProperties).not.toHaveBeenCalled();

    overlay.remove();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    document.body.appendChild(menu);

    dispatch({ key: "c", ctrlKey: true, shiftKey: true });
    dispatch({ key: "v", ctrlKey: true, shiftKey: true });

    expect(handlers.onCopyProperties).not.toHaveBeenCalled();
    expect(handlers.onPasteProperties).not.toHaveBeenCalled();

    menu.remove();
  });
});
