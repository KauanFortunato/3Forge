import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelineViewportToolbar } from "./TimelineViewportToolbar";

function makeBaseProps() {
  return {
    currentTool: "select" as const,
    sceneMode: "2d" as const,
    showGridOverlay: false,
    showSafeArea: false,
    showCheckerboardBg: false,
    isRecordingViewport: false,
    backgroundColor: "#000000",
    onTakeSnapshot: vi.fn(),
    onToggleRecording: vi.fn(),
    onToolChange: vi.fn(),
    onToggleGridOverlay: vi.fn(),
    onToggleSafeArea: vi.fn(),
    onToggleCheckerboardBg: vi.fn(),
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

  it("triggers viewport capture actions in 2D and 3D modes", () => {
    const props = makeBaseProps();
    const { rerender } = render(<TimelineViewportToolbar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Take viewport snapshot" }));
    fireEvent.click(screen.getByRole("button", { name: "Record viewport" }));

    expect(props.onTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(props.onToggleRecording).toHaveBeenCalledTimes(1);

    rerender(<TimelineViewportToolbar {...props} sceneMode="3d" isRecordingViewport />);
    fireEvent.click(screen.getByRole("button", { name: "Stop viewport recording" }));

    expect(props.onToggleRecording).toHaveBeenCalledTimes(2);
  });

  it("only shows overlay buttons in 2D mode", () => {
    const props = makeBaseProps();
    const { rerender } = render(<TimelineViewportToolbar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Show grid overlay" }));
    fireEvent.click(screen.getByRole("button", { name: "Show safe area" }));
    fireEvent.click(screen.getByRole("button", { name: "Show checkerboard background" }));
    expect(props.onToggleGridOverlay).toHaveBeenCalledTimes(1);
    expect(props.onToggleSafeArea).toHaveBeenCalledTimes(1);
    expect(props.onToggleCheckerboardBg).toHaveBeenCalledTimes(1);

    rerender(<TimelineViewportToolbar {...props} sceneMode="3d" />);
    expect(screen.queryByRole("button", { name: "Show grid overlay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show safe area" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show checkerboard background" })).toBeNull();
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
