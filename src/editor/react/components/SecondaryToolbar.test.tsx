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
    isTimelineVisible: true,
    onComponentNameChange: () => undefined,
    onUndo: () => undefined,
    onRedo: () => undefined,
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

  it("renders create controls and calls the create handlers", () => {
    const onAddNode = vi.fn();
    const onAddImage = vi.fn();
    render(
      <SecondaryToolbar
        {...makeBaseProps()}
        onAddNode={onAddNode}
        onAddImage={onAddImage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Box" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Image" }));

    expect(onAddNode).toHaveBeenCalledWith("box");
    expect(onAddImage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  });
});
