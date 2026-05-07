import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  const utils = render(<ImageAssetsPanel {...props} />);
  return { ...utils, props };
}

describe("ImageAssetsPanel", () => {
  it("renders the empty state and import action", () => {
    const props = renderPanel().props;

    expect(screen.getByText("No reusable media yet. Import an image or video to place it in the scene.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import media asset" }));

    expect(props.onImport).toHaveBeenCalledTimes(1);
  });

  it("lists image metadata and selects an asset", () => {
    const props = renderPanel({
      images: [fixtureImage],
      usageById: { [fixtureImage.id]: 2 },
    }).props;

    expect(screen.getByText("hero.png")).toBeTruthy();
    expect(screen.getByText("512 x 256px - 2 uses")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select hero.png" }));

    expect(props.onSelectImage).toHaveBeenCalledWith(fixtureImage.id);
  });

  it("applies, creates, replaces, and removes assets through item actions", () => {
    const props = renderPanel({
      images: [fixtureImage],
      selectedImageNodeCount: 1,
    }).props;

    fireEvent.click(screen.getByRole("button", { name: "Apply image asset to selected media nodes" }));
    fireEvent.click(screen.getByRole("button", { name: "Create media node from image asset" }));
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

    expect(screen.getByRole("button", { name: "Apply image asset to selected media nodes" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Remove image asset" })).toHaveProperty("disabled", true);
  });
});

const SEQUENCE_ASSET: ProjectImageAsset = {
  id: "seq-1",
  name: "PITCH_IN.mov",
  mimeType: "application/x-image-sequence",
  src: "blob:frame-1",
  width: 1920,
  height: 1080,
  sequence: {
    version: 1,
    type: "image-sequence",
    source: "PITCH_IN.mov",
    framePattern: "frame_%06d.png",
    frameCount: 5,
    fps: 25,
    width: 1920,
    height: 1080,
    durationSec: 0.2,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
    frameUrls: ["blob:frame-1", "blob:frame-2", "blob:frame-3", "blob:frame-4", "blob:frame-5"],
  },
};

describe("ImageAssetsPanel - image-sequence support", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a SEQUENCE badge for image-sequence assets (not VIDEO)", () => {
    const { container } = renderPanel({ images: [SEQUENCE_ASSET] });
    const badges = container.querySelectorAll(".image-assets-panel__badge");
    expect([...badges].some((b) => b.textContent === "SEQUENCE")).toBe(true);
    expect([...badges].some((b) => b.textContent === "VIDEO")).toBe(false);
  });

  it("shows frameCount / fps / alpha in the sub-line", () => {
    const { container } = renderPanel({ images: [SEQUENCE_ASSET] });
    const sub = container.querySelector(".image-assets-panel__sub");
    expect(sub?.textContent ?? "").toMatch(/5\s*frames/i);
    expect(sub?.textContent ?? "").toMatch(/25\s*fps/i);
    expect(sub?.textContent ?? "").toMatch(/alpha/i);
  });

  it("autoplays sequence and shows a Pause button by default (sequences play like a video thumbnail)", () => {
    const { container } = renderPanel({ images: [SEQUENCE_ASSET] });
    // The autoplay effect runs on mount; the Pause button should be visible.
    const pauseBtn = container.querySelector('button[aria-label*="Pause sequence"]');
    expect(pauseBtn).not.toBeNull();
  });

  it("autoplay advances frames at fps automatically (no click needed)", () => {
    const { container } = renderPanel({ images: [SEQUENCE_ASSET] });
    const thumbImg = container.querySelector(".image-assets-panel__thumb img") as HTMLImageElement;
    expect(thumbImg.src).toContain("blob:frame-1");
    // 25 fps -> 40ms per frame; advance > 40 should land on frame 2.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const thumbImg2 = container.querySelector(".image-assets-panel__thumb img") as HTMLImageElement;
    expect(thumbImg2.src).toContain("blob:frame-2");
  });

  it("clicking Pause stops the autoplay", () => {
    const { container } = renderPanel({ images: [SEQUENCE_ASSET] });
    // Already auto-playing. Click Pause.
    const pauseBtn = container.querySelector('button[aria-label*="Pause sequence"]') as HTMLButtonElement;
    expect(pauseBtn).not.toBeNull();
    fireEvent.click(pauseBtn);
    const frozenImg = container.querySelector(".image-assets-panel__thumb img") as HTMLImageElement;
    const frozenSrc = frozenImg.src;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const afterImg = container.querySelector(".image-assets-panel__thumb img") as HTMLImageElement;
    expect(afterImg.src).toBe(frozenSrc);
  });

  it("warns when frameUrls is empty (frames missing)", () => {
    const broken: ProjectImageAsset = {
      ...SEQUENCE_ASSET,
      sequence: { ...SEQUENCE_ASSET.sequence!, frameUrls: [], frameCount: 0 },
    };
    const { container } = renderPanel({ images: [broken] });
    const warning = container.querySelector(".image-assets-panel__sequence-warning");
    expect(warning).not.toBeNull();
  });
});
