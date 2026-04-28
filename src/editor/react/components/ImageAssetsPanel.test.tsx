import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageAssetsPanel, type ProjectImageAsset } from "./ImageAssetsPanel";

const fixtureImage: ProjectImageAsset = {
  id: "image-hero",
  name: "hero.png",
  mimeType: "image/png",
  src: "data:image/png;base64,fixture",
  width: 512,
  height: 256,
};

function renderPanel(overrides: Partial<Parameters<typeof ImageAssetsPanel>[0]> = {}) {
  const props: Parameters<typeof ImageAssetsPanel>[0] = {
    images: [],
    selectedImageId: null,
    selectedImageNodeCount: 0,
    usageById: {},
    onSelectImage: vi.fn(),
    onImport: vi.fn(),
    onApplyToSelection: vi.fn(),
    onCreateNode: vi.fn(),
    onReplace: vi.fn(),
    onRemove: vi.fn(),
    canRemoveImage: vi.fn(() => true),
    ...overrides,
  };

  render(<ImageAssetsPanel {...props} />);
  return props;
}

describe("ImageAssetsPanel", () => {
  it("renders the empty state and import action", () => {
    const props = renderPanel();

    expect(screen.getByText("No reusable images yet. Import an image asset to place it in the scene.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import image asset" }));

    expect(props.onImport).toHaveBeenCalledTimes(1);
  });

  it("lists image metadata and selects an asset", () => {
    const props = renderPanel({
      images: [fixtureImage],
      usageById: { [fixtureImage.id]: 2 },
    });

    expect(screen.getByText("hero.png")).toBeTruthy();
    expect(screen.getByText("512 x 256px - 2 uses")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select hero.png" }));

    expect(props.onSelectImage).toHaveBeenCalledWith(fixtureImage.id);
  });

  it("applies, creates, replaces, and removes assets through item actions", () => {
    const props = renderPanel({
      images: [fixtureImage],
      selectedImageNodeCount: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply image asset to selected image nodes" }));
    fireEvent.click(screen.getByRole("button", { name: "Create image node from asset" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace image asset" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove image asset" }));

    expect(props.onApplyToSelection).toHaveBeenCalledWith(fixtureImage);
    expect(props.onCreateNode).toHaveBeenCalledWith(fixtureImage);
    expect(props.onReplace).toHaveBeenCalledWith(fixtureImage.id);
    expect(props.onRemove).toHaveBeenCalledWith(fixtureImage.id);
  });

  it("disables apply without image node selection and remove when the asset is protected", () => {
    renderPanel({
      images: [fixtureImage],
      selectedImageNodeCount: 0,
      canRemoveImage: vi.fn(() => false),
    });

    expect(screen.getByRole("button", { name: "Apply image asset to selected image nodes" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Remove image asset" })).toHaveProperty("disabled", true);
  });
});
