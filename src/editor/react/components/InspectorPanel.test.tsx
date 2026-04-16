import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createDefaultFontAsset } from "../../fonts";
import { createNode, ROOT_NODE_ID } from "../../state";
import { InspectorPanel } from "./InspectorPanel";

function createCommonProps() {
  const rootGroup = createNode("group", null, ROOT_NODE_ID);
  rootGroup.name = "Component Root";
  const wrapperGroup = createNode("group", ROOT_NODE_ID, "group-1");
  wrapperGroup.name = "Wrapper";

  return {
    emptyMessage: "Selecione um objeto para editar.",
    onNodeNameChange: vi.fn(),
    onParentChange: vi.fn(),
    onNodeOriginChange: vi.fn(),
    getEligibleParents: vi.fn(() => [rootGroup, wrapperGroup]),
    onNodePropertyChange: vi.fn(),
    onToggleEditable: vi.fn(),
    onTextFontChange: vi.fn(),
    onImportFont: vi.fn(),
    onReplaceImage: vi.fn(),
  };
}

describe("InspectorPanel", () => {
  it("edits object metadata and transform values for mesh nodes", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.name = "Panel";
    const props = createCommonProps();

    const { container } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    const nameInput = screen.getByDisplayValue("Panel");
    await user.clear(nameInput);
    await user.type(nameInput, "Panel Copy");
    await user.tab();

    const comboBoxes = screen.getAllByRole("combobox");
    await user.selectOptions(comboBoxes[0], "group-1");
    await user.selectOptions(comboBoxes[1], "left");

    await user.click(screen.getByTitle("Transform"));
    const positionXInput = container.querySelector(".transform-cell input[type='text']");
    const editableToggle = container.querySelector(".transform-cell input[type='checkbox']");

    expect(positionXInput).toBeTruthy();
    expect(editableToggle).toBeTruthy();

    await user.clear(positionXInput!);
    await user.type(positionXInput!, "3.5");
    await user.tab();
    await user.click(editableToggle!);

    expect(props.onNodeNameChange).toHaveBeenCalledWith("box-1", "Panel Copy");
    expect(props.onParentChange).toHaveBeenCalledWith("box-1", "group-1");
    expect(props.onNodeOriginChange).toHaveBeenCalledWith("box-1", { x: "left" });
    expect(props.onNodePropertyChange).toHaveBeenCalledWith("box-1", expect.objectContaining({ path: "transform.position.x" }), "3.5");
    expect(props.onToggleEditable).toHaveBeenCalledWith("box-1", expect.objectContaining({ path: "transform.position.x" }), true);
  });

  it("handles font changes and font import on text nodes", async () => {
    const user = userEvent.setup();
    const node = createNode("text", ROOT_NODE_ID, "text-1");
    const defaultFont = createDefaultFontAsset();
    const props = createCommonProps();
    const fonts = [
      defaultFont,
      {
        ...defaultFont,
        id: "fixture-font",
        name: "Fixture Font",
      },
    ];

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={fonts}
      />,
    );

    await user.click(screen.getByTitle("Text"));
    const fontSelect = screen.getByRole("combobox");
    await user.selectOptions(fontSelect, "fixture-font");
    await user.click(screen.getByRole("button", { name: "Import font" }));

    expect(props.onTextFontChange).toHaveBeenCalledWith("text-1", "fixture-font");
    expect(props.onImportFont).toHaveBeenCalledTimes(1);
  });
});
