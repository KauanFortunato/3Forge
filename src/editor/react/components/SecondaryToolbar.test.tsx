import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SecondaryToolbar } from "./SecondaryToolbar";

describe("SecondaryToolbar", () => {
  it("shows the snapping hint in translate mode and dispatches center alignment", async () => {
    const user = userEvent.setup();
    const onAlignToParentCenter = vi.fn();

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
        canAlignToParentCenter
        onComponentNameChange={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onToolChange={() => undefined}
        onViewModeChange={() => undefined}
        onFrame={() => undefined}
        onAlignToParentCenter={onAlignToParentCenter}
        onToggleTimeline={() => undefined}
      />,
    );

    expect(screen.getByText("Hold Shift to snap")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Align rendered center to parent group origin" }));

    expect(onAlignToParentCenter).toHaveBeenCalledTimes(1);
  });

  it("keeps center alignment disabled when the current selection cannot use it", () => {
    render(
      <SecondaryToolbar
        componentName="HeroBanner"
        selectedLabel="2 selected"
        nodeCount={4}
        canUndo
        canRedo
        currentTool="select"
        viewMode="rendered"
        isTimelineVisible
        canAlignToParentCenter={false}
        onComponentNameChange={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onToolChange={() => undefined}
        onViewModeChange={() => undefined}
        onFrame={() => undefined}
        onAlignToParentCenter={() => undefined}
        onToggleTimeline={() => undefined}
      />,
    );

    expect((screen.getByRole("button", { name: "Align rendered center to parent group origin" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
