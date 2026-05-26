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
    onComponentNameChange: () => undefined,
    onUndo: () => undefined,
    onRedo: () => undefined,
  };
}

describe("SecondaryToolbar", () => {
  it("shows the snapping hint in translate mode", () => {
    render(
      <SecondaryToolbar
        {...makeBaseProps()}
        currentTool="translate"
      />,
    );

    expect(screen.getByText("Hold Shift to snap")).toBeTruthy();
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
