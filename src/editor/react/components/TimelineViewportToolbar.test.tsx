import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelineViewportToolbar } from "./TimelineViewportToolbar";

function makeBaseProps() {
  return {
    currentTool: "select" as const,
    sceneMode: "2d" as const,
    showGridOverlay: false,
    showSafeArea: false,
    backgroundColor: "#000000",
    onToolChange: vi.fn(),
    onToggleGridOverlay: vi.fn(),
    onToggleSafeArea: vi.fn(),
    onBackgroundColorChange: vi.fn(),
  };
}

describe("TimelineViewportToolbar", () => {
  it("switches transform tools", () => {
    const props = makeBaseProps();
    render(<TimelineViewportToolbar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));

    expect(props.onToolChange).toHaveBeenNthCalledWith(1, "translate");
    expect(props.onToolChange).toHaveBeenNthCalledWith(2, "rotate");
    expect(props.onToolChange).toHaveBeenNthCalledWith(3, "scale");
  });

  it("only shows overlay buttons in 2D mode", () => {
    const props = makeBaseProps();
    const { rerender } = render(<TimelineViewportToolbar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Show grid overlay" }));
    fireEvent.click(screen.getByRole("button", { name: "Show safe area" }));
    expect(props.onToggleGridOverlay).toHaveBeenCalledTimes(1);
    expect(props.onToggleSafeArea).toHaveBeenCalledTimes(1);

    rerender(<TimelineViewportToolbar {...props} sceneMode="3d" />);
    expect(screen.queryByRole("button", { name: "Show grid overlay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show safe area" })).toBeNull();
  });

  it("changes the viewport background color", () => {
    const props = makeBaseProps();
    render(<TimelineViewportToolbar {...props} />);

    fireEvent.change(screen.getByLabelText("Viewport background"), {
      target: { value: "#123456" },
    });

    expect(props.onBackgroundColorChange).toHaveBeenCalledWith("#123456");
  });
});
