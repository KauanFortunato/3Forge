import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SecondaryToolbar } from "./SecondaryToolbar";

describe("SecondaryToolbar", () => {
  it("shows the snapping hint in translate mode", () => {
    render(
      <SecondaryToolbar
        componentName="HeroBanner"
        selectedLabel="Panel | Mesh"
        nodeCount={4}
        canUndo
        canRedo
        currentTool="translate"
        viewMode="rendered"
        isTimelineVisible
        onComponentNameChange={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onToolChange={() => undefined}
        onViewModeChange={() => undefined}
        onFrame={() => undefined}
        onToggleTimeline={() => undefined}
      />,
    );

    expect(screen.getByText("Hold Shift to snap")).toBeTruthy();
  });

  it("shows the timeline toggle state in the label", () => {
    render(
      <SecondaryToolbar
        componentName="HeroBanner"
        selectedLabel="Panel | Mesh"
        nodeCount={4}
        canUndo
        canRedo
        currentTool="select"
        viewMode="rendered"
        isTimelineVisible={false}
        onComponentNameChange={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onToolChange={() => undefined}
        onViewModeChange={() => undefined}
        onFrame={() => undefined}
        onToggleTimeline={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Timeline Off" })).toBeTruthy();
  });
});
