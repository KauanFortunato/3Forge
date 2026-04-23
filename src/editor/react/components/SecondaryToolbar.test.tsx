import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SecondaryToolbar } from "./SecondaryToolbar";

function makeBaseProps() {
  return {
    componentName: "HeroBanner",
    selectedLabel: "Panel | Mesh",
    nodeCount: 4,
    canUndo: true,
    canRedo: true,
    currentTool: "select" as const,
    viewMode: "rendered" as const,
    isTimelineVisible: true,
    onComponentNameChange: () => undefined,
    onUndo: () => undefined,
    onRedo: () => undefined,
    onToolChange: () => undefined,
    onViewModeChange: () => undefined,
    onFrame: () => undefined,
    onToggleTimeline: () => undefined,
  };
}

describe("SecondaryToolbar", () => {
  it("shows the snapping hint in translate mode when no playback is active", () => {
    render(
      <SecondaryToolbar
        {...makeBaseProps()}
        currentTool="translate"
      />,
    );

    expect(screen.getByText("Hold Shift to snap")).toBeTruthy();
  });

  it("shows the timeline toggle state via aria-label", () => {
    render(
      <SecondaryToolbar
        {...makeBaseProps()}
        isTimelineVisible={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Timeline Off" })).toBeTruthy();
  });

  it("renders the playbar transport when playback props are provided", () => {
    const onPlayToggle = vi.fn();
    render(
      <SecondaryToolbar
        {...makeBaseProps()}
        playback={{
          isPlaying: false,
          currentFrame: 42,
          durationFrames: 120,
          onPlayToggle,
          onStop: vi.fn(),
          onRewind: vi.fn(),
          onFastForward: vi.fn(),
          onSkipBack: vi.fn(),
          onSkipForward: vi.fn(),
        }}
      />,
    );

    const playbar = document.querySelector(".playbar");
    expect(playbar).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlayToggle).toHaveBeenCalledTimes(1);
  });

  it("does not render the playbar when playback is null", () => {
    render(
      <SecondaryToolbar
        {...makeBaseProps()}
        playback={null}
      />,
    );

    expect(document.querySelector(".playbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  });

  it("renders the Export button when onExport is provided and calls it on click", () => {
    const onExport = vi.fn();
    render(
      <SecondaryToolbar
        {...makeBaseProps()}
        onExport={onExport}
      />,
    );

    const button = screen.getByRole("button", { name: "Export" });
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
