import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createDefaultFontAsset } from "../../fonts";
import { createTransparentImageAsset } from "../../images";
import { createMaterialSpec } from "../../materials";
import { createNode, ROOT_NODE_ID } from "../../state";
import type { MaterialAsset } from "../../types";
import { InspectorPanel } from "./InspectorPanel";
import { MaterialAssetEditor } from "./MaterialAssetEditor";

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
    onGroupPivotPresetApply: vi.fn(),
    getEligibleParents: vi.fn(() => [rootGroup, wrapperGroup]),
    onNodePropertyChange: vi.fn(),
    onNodesPropertyChange: vi.fn(),
    onToggleEditable: vi.fn(),
    onTextFontChange: vi.fn(),
    onImportFont: vi.fn(),
    onReplaceImage: vi.fn(),
    onAssignImageAsset: vi.fn(),
    onUnassignImageAsset: vi.fn(),
  };
}

async function selectCustomOption(user: ReturnType<typeof userEvent.setup>, ariaName: string, optionName: string) {
  await user.click(screen.getByRole("combobox", { name: ariaName }));
  await user.click(screen.getByRole("option", { name: optionName }));
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
    fireEvent.blur(nameInput);

    await selectCustomOption(user, "Parent Group", "Wrapper");
    await selectCustomOption(user, "Origin X", "Left");
    await user.click(screen.getByLabelText("Visible"));
    await user.click(screen.getByLabelText("Editable Visible"));

    const positionXInput = container.querySelector(".vec__cell input[type='text']");
    const editableToggle = container.querySelector(".vec__cell input[type='checkbox']");

    expect(positionXInput).toBeTruthy();
    expect(editableToggle).toBeTruthy();

    await user.clear(positionXInput!);
    await user.type(positionXInput!, "3.5");
    fireEvent.blur(positionXInput!);
    await user.click(editableToggle!);

    expect(props.onNodeNameChange).toHaveBeenCalledWith("box-1", "Panel Copy");
    expect(props.onParentChange).toHaveBeenCalledWith("box-1", "group-1");
    expect(props.onNodeOriginChange).toHaveBeenCalledWith("box-1", { x: "left" });
    expect(props.onNodePropertyChange).toHaveBeenCalledWith("box-1", expect.objectContaining({ path: "visible" }), false);
    expect(props.onToggleEditable).toHaveBeenCalledWith("box-1", expect.objectContaining({ path: "visible" }), true);
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

    await selectCustomOption(user, "Active Font", "Fixture Font");
    await user.click(screen.getByRole("button", { name: "Import font" }));

    expect(props.onTextFontChange).toHaveBeenCalledWith("text-1", "fixture-font");
    expect(props.onImportFont).toHaveBeenCalledTimes(1);
  });

  it("assigns an existing image asset from the image inspector", async () => {
    const user = userEvent.setup();
    const node = createNode("image", ROOT_NODE_ID, "image-1");
    const props = createCommonProps();
    const fixtureAsset = {
      ...createTransparentImageAsset(),
      id: "asset-hero",
      name: "Hero Texture",
      width: 128,
      height: 64,
    };

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        images={[fixtureAsset]}
      />,
    );

    await selectCustomOption(user, "Image asset", "Hero Texture");

    expect(props.onAssignImageAsset).toHaveBeenCalledWith("image-1", "asset-hero");
  });

  it("applies a group pivot preset from current content", async () => {
    const user = userEvent.setup();
    const node = createNode("group", ROOT_NODE_ID, "group-1");
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    await selectCustomOption(user, "Group pivot preset", "Bottom Center");
    await user.click(screen.getByRole("button", { name: "Apply Pivot" }));

    expect(props.onGroupPivotPresetApply).toHaveBeenCalledWith("group-1", "bottom-center");
  });

  it("edits group visibility in the object section", async () => {
    const user = userEvent.setup();
    const node = createNode("group", ROOT_NODE_ID, "group-1");
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    await user.click(screen.getByLabelText("Visible"));
    await user.click(screen.getByLabelText("Editable Visible"));

    expect(props.onNodePropertyChange).toHaveBeenCalledWith("group-1", expect.objectContaining({ path: "visible" }), false);
    expect(props.onToggleEditable).toHaveBeenCalledWith("group-1", expect.objectContaining({ path: "visible" }), true);
  });

  it("renders castShadow/receiveShadow controls only inside the Shadows sub-section (no duplicate)", () => {
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();

    const { container } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    // Exactly one input labeled "Cast Shadow" and one "Receive Shadow"
    expect(screen.getAllByLabelText("Cast Shadow")).toHaveLength(1);
    expect(screen.getAllByLabelText("Receive Shadow")).toHaveLength(1);

    // The Shadows sub-header should render exactly once within the material section
    const materialSections = Array.from(container.querySelectorAll(".sec")).filter((el) => (
      el.querySelector(".sec__hd-title")?.textContent?.trim() === "Material"
    ));
    expect(materialSections.length).toBeGreaterThan(0);
    const materialCard = materialSections[0] as HTMLElement;
    const shadowSubHeaders = Array.from(
      materialCard.querySelectorAll(".sec__sub"),
    ).filter((el) => el.textContent?.trim() === "Shadows");
    expect(shadowSubHeaders).toHaveLength(1);
  });

  it("renders material side as a Base select in the inspector", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    expect(screen.getByLabelText("Side")).toBeTruthy();

    await selectCustomOption(user, "Side", "Double");

    expect(props.onNodePropertyChange).toHaveBeenCalledWith(
      "box-1",
      expect.objectContaining({ path: "material.side" }),
      "double",
    );
  });

  it("renders reusable image assets as material texture options", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();
    const texture = {
      ...createTransparentImageAsset(),
      id: "image-texture-1",
      name: "Grid Texture",
    };

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        images={[texture]}
      />,
    );

    expect(screen.getByLabelText("Texture")).toBeTruthy();

    await selectCustomOption(user, "Texture", "Grid Texture");

    expect(props.onNodePropertyChange).toHaveBeenCalledWith(
      "box-1",
      expect.objectContaining({ path: "material.mapImageId" }),
      "image-texture-1",
    );
  });

  it("buffers swatch color changes until the picker loses focus", () => {
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.material.color = "#112233";
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    const colorInput = screen.getByLabelText("Color") as HTMLInputElement;
    const swatchInput = screen.getByLabelText("Color swatch") as HTMLInputElement;

    expect(props.onNodePropertyChange).not.toHaveBeenCalled();
    expect(colorInput.value).toBe("#112233");

    fireEvent.change(swatchInput, { target: { value: "#123456" } });

    expect(props.onNodePropertyChange).not.toHaveBeenCalled();
    expect(colorInput.value).toBe("#123456");

    fireEvent.blur(swatchInput);

    expect(props.onNodePropertyChange).toHaveBeenCalledTimes(1);
    expect(props.onNodePropertyChange).toHaveBeenCalledWith("box-1", expect.objectContaining({ path: "material.color" }), "#123456");
  });

  it("keeps the hex field on the previous inspector flow", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.material.color = "#445566";
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    const colorInput = screen.getByLabelText("Color") as HTMLInputElement;
    await user.clear(colorInput);
    await user.type(colorInput, "#ff00ff");

    expect(colorInput.value).toBe("#ff00ff");
    expect(props.onNodePropertyChange).not.toHaveBeenCalled();

    fireEvent.blur(colorInput);

    expect(props.onNodePropertyChange).toHaveBeenCalledTimes(1);
    expect(props.onNodePropertyChange).toHaveBeenCalledWith("box-1", expect.objectContaining({ path: "material.color" }), "#ff00ff");
  });

  it("normalizes confirmed hex input back into the field value", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.material.color = "#112233";
    const props = createCommonProps();

    const { rerender } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    const colorInput = screen.getByLabelText("Color") as HTMLInputElement;
    await user.clear(colorInput);
    await user.type(colorInput, "#abc");
    fireEvent.blur(colorInput);

    expect(props.onNodePropertyChange).toHaveBeenCalledWith("box-1", expect.objectContaining({ path: "material.color" }), "#aabbcc");

    node.material.color = "#aabbcc";
    rerender(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    expect((screen.getByLabelText("Color") as HTMLInputElement).value).toBe("#aabbcc");
  });

  it("edits shared material fields across a multi-selection with mixed values", async () => {
    const user = userEvent.setup();
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    const secondNode = createNode("plane", ROOT_NODE_ID, "plane-1");
    firstNode.material.color = "#112233";
    secondNode.material.color = "#ffffff";
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={undefined}
        nodes={[firstNode, secondNode]}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    expect(screen.getByText("2 objects")).toBeTruthy();
    expect(screen.getByTitle("Material")).toBeTruthy();
    expect(screen.getByTitle("Object")).toBeTruthy();
    expect(screen.getByTitle("Transform")).toBeTruthy();


    const colorInput = screen.getByLabelText("Color") as HTMLInputElement;
    expect(colorInput.placeholder).toBe("Mixed");

    await user.clear(colorInput);
    await user.type(colorInput, "#abcdef");
    fireEvent.blur(colorInput);

    expect(props.onNodesPropertyChange).toHaveBeenCalledTimes(1);
    expect(props.onNodesPropertyChange).toHaveBeenCalledWith(
      ["box-1", "plane-1"],
      expect.objectContaining({ path: "material.color" }),
      "#abcdef",
    );
  });

  it("does not commit swatch changes before the color picker closes", async () => {
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.material.color = "#112233";
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    const swatchInput = screen.getByLabelText("Color swatch");

    fireEvent.focus(swatchInput);
    fireEvent.change(swatchInput, { target: { value: "#654321" } });

    expect(props.onNodePropertyChange).not.toHaveBeenCalled();

    fireEvent.blur(swatchInput);

    expect(props.onNodePropertyChange).toHaveBeenCalledTimes(1);
    expect(props.onNodePropertyChange).toHaveBeenCalledWith("box-1", expect.objectContaining({ path: "material.color" }), "#654321");
  });

  it("exposes only Object and Transform when a multi-selection includes a group", () => {
    const boxNode = createNode("box", ROOT_NODE_ID, "box-1");
    const groupNode = createNode("group", ROOT_NODE_ID, "group-1");
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={undefined}
        nodes={[boxNode, groupNode]}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    expect(screen.getByTitle("Object")).toBeTruthy();
    expect(screen.getByTitle("Transform")).toBeTruthy();
    expect(screen.queryByTitle("Material")).toBeNull();
    expect(screen.queryByTitle("Geometry")).toBeNull();
  });

  it("hides material-type-specific controls for heterogeneous material selections", () => {
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    const secondNode = createNode("plane", ROOT_NODE_ID, "plane-1");
    firstNode.material.type = "basic";
    secondNode.material.type = "standard";
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={undefined}
        nodes={[firstNode, secondNode]}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    expect(screen.getByText(/Material-specific controls stay hidden while the selection mixes different material types\./)).toBeTruthy();
    expect(screen.queryByLabelText("Roughness")).toBeNull();
    expect(screen.getByLabelText("Type")).toBeTruthy();
  });

  it("does not commit a mixed numeric material field on focus and blur without typing", async () => {
    const user = userEvent.setup();
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    const secondNode = createNode("plane", ROOT_NODE_ID, "plane-1");
    firstNode.material.opacity = 0.9;
    secondNode.material.opacity = 0.35;
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={undefined}
        nodes={[firstNode, secondNode]}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    const opacityInput = screen.getByLabelText("Opacity");
    expect((opacityInput as HTMLInputElement).placeholder).toBe("Mixed");

    await user.click(opacityInput);
    await user.tab();

    expect(props.onNodesPropertyChange).not.toHaveBeenCalled();
  });

  it("commits an explicit numeric value for a mixed material field", async () => {
    const user = userEvent.setup();
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    const secondNode = createNode("plane", ROOT_NODE_ID, "plane-1");
    firstNode.material.opacity = 0.9;
    secondNode.material.opacity = 0.35;
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={undefined}
        nodes={[firstNode, secondNode]}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    const opacityInput = screen.getByLabelText("Opacity");
    await user.click(opacityInput);
    await user.type(opacityInput, "0.5");
    await user.tab();

    expect(props.onNodesPropertyChange).toHaveBeenCalledTimes(1);
    expect(props.onNodesPropertyChange).toHaveBeenCalledWith(
      ["box-1", "plane-1"],
      expect.objectContaining({ path: "material.opacity" }),
      "0.5",
    );
  });

  it("renders and edits shared Transform values across two boxes", async () => {
    const user = userEvent.setup();
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    const secondNode = createNode("box", ROOT_NODE_ID, "box-2");
    secondNode.transform.position.x = 3;
    const props = createCommonProps();

    const { container } = render(
      <InspectorPanel
        {...props}
        node={undefined}
        nodes={[firstNode, secondNode]}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    expect(screen.getByText("2 objects")).toBeTruthy();
    expect(screen.getByTitle("Transform")).toBeTruthy();


    const transformInputs = container.querySelectorAll(".vec__cell input[type='text']");
    expect(transformInputs.length).toBe(9);

    const positionX = transformInputs[0] as HTMLInputElement;
    expect(positionX.placeholder).toBe("Mixed");
    expect(positionX.value).toBe("");

    await user.click(positionX);
    await user.type(positionX, "1.5");
    await user.tab();

    expect(props.onNodesPropertyChange).toHaveBeenCalledWith(
      ["box-1", "box-2"],
      expect.objectContaining({ path: "transform.position.x" }),
      "1.5",
    );
  });

  it("edits full material and shadow fields across two same-type boxes", async () => {
    const user = userEvent.setup();
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    const secondNode = createNode("box", ROOT_NODE_ID, "box-2");
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={undefined}
        nodes={[firstNode, secondNode]}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    expect(screen.getByLabelText("Roughness")).toBeTruthy();
    expect(screen.getByLabelText("Metalness")).toBeTruthy();
    expect(screen.getByLabelText("Cast Shadow")).toBeTruthy();
    expect(screen.getByLabelText("Receive Shadow")).toBeTruthy();

    await user.click(screen.getByLabelText("Cast Shadow"));

    expect(props.onNodesPropertyChange).toHaveBeenCalledWith(
      ["box-1", "box-2"],
      expect.objectContaining({ path: "material.castShadow" }),
      false,
    );
  });

  it("hides Geometry for cross-type selections while keeping Material and Transform", () => {
    const boxNode = createNode("box", ROOT_NODE_ID, "box-1");
    const sphereNode = createNode("sphere", ROOT_NODE_ID, "sphere-1");
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={undefined}
        nodes={[boxNode, sphereNode]}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    expect(screen.getByTitle("Transform")).toBeTruthy();
    expect(screen.getByTitle("Material")).toBeTruthy();
    expect(screen.queryByTitle("Geometry")).toBeNull();

    expect(screen.getByLabelText("Color")).toBeTruthy();
  });

  it("shows a Mixed placeholder for a transform axis with different values", () => {
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    const secondNode = createNode("box", ROOT_NODE_ID, "box-2");
    firstNode.transform.position.y = 1;
    secondNode.transform.position.y = 4;
    const props = createCommonProps();

    const { container } = render(
      <InspectorPanel
        {...props}
        node={undefined}
        nodes={[firstNode, secondNode]}
        fonts={[createDefaultFontAsset()]}
      />,
    );


    const cells = Array.from(container.querySelectorAll(".vec__cell input[type='text']")) as HTMLInputElement[];
    const positionX = cells[0];
    const positionY = cells[1];

    expect(positionX.placeholder).toBe("");
    expect(positionX.value).toBe("0");
    expect(positionY.placeholder).toBe("Mixed");
    expect(positionY.value).toBe("");
  });

  it("toggles a section open/closed when its header is clicked and swaps the chevron", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();

    const { container } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    const transformSection = Array.from(container.querySelectorAll(".sec")).find((el) => (
      el.querySelector(".sec__hd-title")?.textContent?.trim() === "Transform"
    )) as HTMLElement;
    expect(transformSection).toBeTruthy();

    // Starts open: no is-collapsed class, chevron-down path.
    expect(transformSection.classList.contains("is-collapsed")).toBe(false);
    const header = transformSection.querySelector(".sec__hd") as HTMLButtonElement;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    const openChev = transformSection.querySelector(".sec__hd-chev svg path") as SVGPathElement;
    const openD = openChev.getAttribute("d") ?? "";
    expect(openD.startsWith("m3.4")).toBe(true);

    await user.click(header);

    expect(transformSection.classList.contains("is-collapsed")).toBe(true);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    const closedChev = transformSection.querySelector(".sec__hd-chev svg path") as SVGPathElement;
    const closedD = closedChev.getAttribute("d") ?? "";
    expect(closedD.startsWith("m5.2")).toBe(true);

    await user.click(header);
    expect(transformSection.classList.contains("is-collapsed")).toBe(false);
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses sections independently", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();

    const { container } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    const sections = Array.from(container.querySelectorAll(".sec")) as HTMLElement[];
    const transform = sections.find((el) => el.querySelector(".sec__hd-title")?.textContent?.trim() === "Transform") as HTMLElement;
    const material = sections.find((el) => el.querySelector(".sec__hd-title")?.textContent?.trim() === "Material") as HTMLElement;
    expect(transform).toBeTruthy();
    expect(material).toBeTruthy();

    await user.click(transform.querySelector(".sec__hd") as HTMLButtonElement);

    expect(transform.classList.contains("is-collapsed")).toBe(true);
    expect(material.classList.contains("is-collapsed")).toBe(false);
  });

  it("keeps collapsed section bodies in the DOM so tests can still resolve their inputs", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    // Color input is part of Material (initially open).
    expect(screen.getByLabelText("Color")).toBeTruthy();

    // Collapse the Material section and verify the Color input stays in the DOM.
    await user.click(screen.getByTitle("Material"));
    expect(screen.getByLabelText("Color")).toBeTruthy();
  });

  it("scrubs a numeric material property when the drag handle is dragged", () => {
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.material.opacity = 0.5;
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    const opacityInput = screen.getByLabelText("Opacity") as HTMLInputElement;
    const dragHandle = screen.getByLabelText("Scrub Opacity") as HTMLButtonElement;
    expect(opacityInput.value).toBe("0.5");

    fireEvent.pointerDown(dragHandle, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(dragHandle, { clientX: 110, pointerId: 1 });
    fireEvent.pointerUp(dragHandle, { clientX: 110, pointerId: 1 });

    // opacity definition step is 0.05 → 10px * 0.05 = 0.5 → 0.5 + 0.5 = 1
    expect(props.onNodePropertyChange).toHaveBeenCalledTimes(1);
    expect(props.onNodePropertyChange).toHaveBeenCalledWith(
      "box-1",
      expect.objectContaining({ path: "material.opacity" }),
      expect.stringMatching(/^1(\.0+)?$/),
    );
  });

  it("scrubs a Transform axis when its drag handle is dragged", () => {
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.transform.position.x = 0;
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    const dragHandle = screen.getByLabelText("Scrub Position X") as HTMLButtonElement;

    fireEvent.pointerDown(dragHandle, { button: 0, clientX: 200, pointerId: 2 });
    fireEvent.pointerMove(dragHandle, { clientX: 212, pointerId: 2 });
    fireEvent.pointerUp(dragHandle, { clientX: 212, pointerId: 2 });

    // position step 0.1 × 12px = 1.2
    expect(props.onNodePropertyChange).toHaveBeenCalledTimes(1);
    expect(props.onNodePropertyChange).toHaveBeenCalledWith(
      "box-1",
      expect.objectContaining({ path: "transform.position.x" }),
      "1.2",
    );
  });

  it("still lets the user type into a numeric input alongside drag-to-scrub", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.material.opacity = 0.5;
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    const opacityInput = screen.getByLabelText("Opacity") as HTMLInputElement;
    await user.clear(opacityInput);
    await user.type(opacityInput, "0.25");
    await user.tab();

    expect(props.onNodePropertyChange).toHaveBeenCalledWith(
      "box-1",
      expect.objectContaining({ path: "material.opacity" }),
      "0.25",
    );
  });

  it("cancels a drag-scrub on pointer cancel and restores the original value", () => {
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.material.opacity = 0.5;
    const props = createCommonProps();

    render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
      />,
    );

    const opacityInput = screen.getByLabelText("Opacity") as HTMLInputElement;
    const dragHandle = screen.getByLabelText("Scrub Opacity") as HTMLButtonElement;

    fireEvent.pointerDown(dragHandle, { button: 0, clientX: 100, pointerId: 3 });
    fireEvent.pointerMove(dragHandle, { clientX: 180, pointerId: 3 });
    fireEvent.pointerCancel(dragHandle, { clientX: 180, pointerId: 3 });

    expect(props.onNodePropertyChange).not.toHaveBeenCalled();
    expect(opacityInput.value).toBe("0.5");
  });

  it("renders and edits asset material boolean, number, and select definitions", async () => {
    const user = userEvent.setup();
    const material: MaterialAsset = {
      id: "material-1",
      name: "Studio Plastic",
      spec: {
        ...createMaterialSpec("#445566", "standard"),
        side: "front",
        wireframe: false,
        alphaTest: 0.2,
      },
    };
    const onUpdate = vi.fn();
    const texture = {
      ...createTransparentImageAsset(),
      id: "asset-texture",
      name: "Asset Texture",
    };

    render(
      <MaterialAssetEditor
        material={material}
        images={[texture]}
        usageCount={2}
        onRename={vi.fn()}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );

    await selectCustomOption(user, "Side", "Back");
    await selectCustomOption(user, "Texture", "Asset Texture");
    await user.click(screen.getByLabelText("Wireframe"));

    const alphaTest = screen.getByLabelText("Alpha Test") as HTMLInputElement;
    await user.clear(alphaTest);
    await user.type(alphaTest, "0.35");
    await user.tab();

    expect(onUpdate).toHaveBeenCalledWith(
      "material-1",
      expect.objectContaining({ path: "material.side" }),
      "back",
    );
    expect(onUpdate).toHaveBeenCalledWith(
      "material-1",
      expect.objectContaining({ path: "material.wireframe" }),
      true,
    );
    expect(onUpdate).toHaveBeenCalledWith(
      "material-1",
      expect.objectContaining({ path: "material.mapImageId" }),
      "asset-texture",
    );
    expect(onUpdate).toHaveBeenCalledWith(
      "material-1",
      expect.objectContaining({ path: "material.alphaTest" }),
      "0.35",
    );
  });
});

describe("InspectorPanel keyframe and runtime-field controls", () => {
  it("renders a diamond on animatable rows only and keeps the <> toggle independent", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.name = "Panel";
    const props = createCommonProps();
    const onInsertOrUpdateKeyframe = vi.fn();
    const onRemoveKeyframe = vi.fn();

    const activeAnimationClip = {
      id: "clip-1",
      name: "main",
      fps: 24,
      durationFrames: 60,
      tracks: [
        {
          id: "track-1",
          nodeId: "box-1",
          property: "transform.position.y" as const,
          keyframes: [
            { id: "k-0", frame: 0, value: 1.5, ease: "easeInOut" as const },
          ],
        },
      ],
    };

    const { container } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        currentFrame={0}
        activeAnimationClip={activeAnimationClip}
        onInsertOrUpdateKeyframe={onInsertOrUpdateKeyframe}
        onRemoveKeyframe={onRemoveKeyframe}
      />,
    );

    // 1. Every transform axis cell renders a diamond button.
    const diamondsInTransform = container.querySelectorAll(".vec__cell .vec__keyframe");
    expect(diamondsInTransform.length).toBeGreaterThanOrEqual(9); // pos + rot + scale = 9 axes.

    // 2. Material/geometry rows have no diamond — they aren't animatable.
    const materialColorRow = Array.from(container.querySelectorAll(".row")).find((row) =>
      row.querySelector(".row__lbl")?.textContent === "Color",
    );
    expect(materialColorRow).toBeTruthy();
    expect(materialColorRow?.querySelector(".row__keyframe")).toBeNull();

    // 3. The diamond on a keyed (transform.position.y at frame 0) cell reports filled / pressed.
    const positionYCell = container.querySelector(".vec__cell[data-axis='y']");
    const positionYDiamond = positionYCell?.querySelector(".vec__keyframe");
    expect(positionYDiamond).toBeTruthy();
    expect(positionYDiamond?.getAttribute("aria-pressed")).toBe("true");
    expect(positionYDiamond?.classList.contains("is-key")).toBe(true);
    expect((positionYCell?.querySelector("input") as HTMLInputElement | null)?.value).toBe("1.5");

    // The unkeyed X cell is a plain (non-animated) diamond.
    const positionXCell = container.querySelector(".vec__cell[data-axis='x']");
    const positionXDiamond = positionXCell?.querySelector(".vec__keyframe");
    expect(positionXDiamond?.getAttribute("aria-pressed")).toBe("false");

    // 4. Clicking the diamond fires onInsertOrUpdateKeyframe with currentFrame and never the
    //    runtime-editable toggle.
    await user.click(positionXDiamond as HTMLButtonElement);
    expect(onInsertOrUpdateKeyframe).toHaveBeenCalledTimes(1);
    expect(onInsertOrUpdateKeyframe).toHaveBeenCalledWith(
      "box-1",
      "transform.position.x",
      0,
      expect.any(Number),
    );
    expect(props.onToggleEditable).not.toHaveBeenCalled();

    // 5. Clicking the <> editable toggle fires onToggleEditable but NOT the keyframe handler.
    const editableInputs = container.querySelectorAll(".vec__editable input[type='checkbox']");
    expect(editableInputs.length).toBeGreaterThan(0);
    await user.click(editableInputs[0] as HTMLInputElement);
    expect(props.onToggleEditable).toHaveBeenCalledTimes(1);
    expect(onInsertOrUpdateKeyframe).toHaveBeenCalledTimes(1); // unchanged.
  });

  it("clicking a keyed diamond removes the keyframe instead of inserting", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();
    const onInsertOrUpdateKeyframe = vi.fn();
    const onRemoveKeyframe = vi.fn();

    const activeAnimationClip = {
      id: "clip-1",
      name: "main",
      fps: 24,
      durationFrames: 60,
      tracks: [
        {
          id: "track-1",
          nodeId: "box-1",
          property: "transform.position.x" as const,
          keyframes: [{ id: "k-0", frame: 6, value: 0.5, ease: "easeInOut" as const }],
        },
      ],
    };

    const { container } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        currentFrame={6}
        activeAnimationClip={activeAnimationClip}
        onInsertOrUpdateKeyframe={onInsertOrUpdateKeyframe}
        onRemoveKeyframe={onRemoveKeyframe}
      />,
    );

    const xDiamond = container.querySelector(".vec__cell[data-axis='x'] .vec__keyframe") as HTMLButtonElement;
    expect(xDiamond.getAttribute("aria-pressed")).toBe("true");

    await user.click(xDiamond);

    expect(onRemoveKeyframe).toHaveBeenCalledWith("box-1", "transform.position.x", 6, 0.5);
    expect(onInsertOrUpdateKeyframe).not.toHaveBeenCalled();
  });

  it("clicking a keyed diamond with a temporary override updates the keyframe", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();
    const onInsertOrUpdateKeyframe = vi.fn();
    const onRemoveKeyframe = vi.fn();

    const activeAnimationClip = {
      id: "clip-1",
      name: "main",
      fps: 24,
      durationFrames: 60,
      tracks: [
        {
          id: "track-1",
          nodeId: "box-1",
          property: "transform.position.x" as const,
          keyframes: [{ id: "k-0", frame: 6, value: 0.5, ease: "easeInOut" as const }],
        },
      ],
    };

    const { container } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        currentFrame={6}
        activeAnimationClip={activeAnimationClip}
        animationOverrides={{ "box-1:transform.position.x": { frame: 6, value: 2.75 } }}
        onInsertOrUpdateKeyframe={onInsertOrUpdateKeyframe}
        onRemoveKeyframe={onRemoveKeyframe}
      />,
    );

    const xDiamond = container.querySelector(".vec__cell[data-axis='x'] .vec__keyframe") as HTMLButtonElement;
    expect(xDiamond.getAttribute("aria-label")).toBe("Update keyframe");

    await user.click(xDiamond);

    expect(onInsertOrUpdateKeyframe).toHaveBeenCalledWith("box-1", "transform.position.x", 6, 2.75);
    expect(onRemoveKeyframe).not.toHaveBeenCalled();
  });

  it("shows temporary animation overrides and commits that visible value with the diamond", async () => {
    const user = userEvent.setup();
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();
    const onInsertOrUpdateKeyframe = vi.fn();

    const activeAnimationClip = {
      id: "clip-1",
      name: "main",
      fps: 24,
      durationFrames: 60,
      tracks: [
        {
          id: "track-1",
          nodeId: "box-1",
          property: "transform.position.x" as const,
          keyframes: [
            { id: "k-0", frame: 1, value: 5, ease: "linear" as const },
            { id: "k-1", frame: 10, value: 10, ease: "linear" as const },
          ],
        },
      ],
    };

    const { container } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        currentFrame={5.5}
        activeAnimationClip={activeAnimationClip}
        animationOverrides={{ "box-1:transform.position.x": { frame: 5.5, value: 20 } }}
        onInsertOrUpdateKeyframe={onInsertOrUpdateKeyframe}
      />,
    );

    const positionXCell = container.querySelector(".vec__cell[data-axis='x']");
    expect((positionXCell?.querySelector("input") as HTMLInputElement | null)?.value).toBe("20");

    await user.click(positionXCell?.querySelector(".vec__keyframe") as HTMLButtonElement);
    expect(onInsertOrUpdateKeyframe).toHaveBeenCalledWith("box-1", "transform.position.x", 5.5, 20);
  });

  it("updates animated numeric fields as the playhead moves and falls back after overrides are cleared", () => {
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    const props = createCommonProps();
    const activeAnimationClip = {
      id: "clip-1",
      name: "main",
      fps: 24,
      durationFrames: 60,
      tracks: [
        {
          id: "track-1",
          nodeId: "box-1",
          property: "transform.position.x" as const,
          keyframes: [
            { id: "k-0", frame: 1, value: 5, ease: "linear" as const },
            { id: "k-1", frame: 10, value: 10, ease: "linear" as const },
          ],
        },
      ],
    };

    const { container, rerender } = render(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        currentFrame={1}
        activeAnimationClip={activeAnimationClip}
      />,
    );

    const getPositionXValue = () =>
      (container.querySelector(".vec__cell[data-axis='x'] input") as HTMLInputElement | null)?.value;

    expect(getPositionXValue()).toBe("5");

    rerender(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        currentFrame={5.5}
        activeAnimationClip={activeAnimationClip}
      />,
    );
    expect(getPositionXValue()).toBe("7.5");

    rerender(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        currentFrame={5.5}
        activeAnimationClip={activeAnimationClip}
        animationOverrides={{ "box-1:transform.position.x": { frame: 5.5, value: 20 } }}
      />,
    );
    expect(getPositionXValue()).toBe("20");

    rerender(
      <InspectorPanel
        {...props}
        node={node}
        fonts={[createDefaultFontAsset()]}
        currentFrame={6}
        activeAnimationClip={activeAnimationClip}
      />,
    );
    expect(Number(getPositionXValue())).toBeCloseTo(7.7778);
  });
});
