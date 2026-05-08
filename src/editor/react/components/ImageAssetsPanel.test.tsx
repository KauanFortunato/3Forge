import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageAssetsPanel, type ProjectImageAsset } from "./ImageAssetsPanel";
import type { ImageSequenceMetadata } from "../../types";

// ---------------------------------------------------------------------------
// Shared A4 test helpers (baseSeq, baseSeqAsset, renderPanel)
// ---------------------------------------------------------------------------

function baseSeq(overrides: Partial<ImageSequenceMetadata> = {}): ImageSequenceMetadata {
  return {
    version: 2,
    type: "image-sequence",
    format: "webp",
    source: "intro.mov",
    framePattern: "frame_%06d.webp",
    frameCount: 4,
    fps: 25,
    width: 320,
    height: 180,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
    frameUrls: ["blob:first", "blob:second", "blob:third", "blob:fourth"],
    ...overrides,
  };
}

function baseSeqAsset(overrides: Partial<ProjectImageAsset> = {}): ProjectImageAsset {
  return {
    id: "seq-1",
    name: "intro.mov",
    mimeType: "application/x-image-sequence",
    src: "blob:first",
    width: 320,
    height: 180,
    sequence: baseSeq(),
    ...overrides,
  };
}

function renderPanel(
  images: ProjectImageAsset[],
  extra: Partial<{ onRepairSequence: (id: string) => void }> = {},
) {
  return render(
    <ImageAssetsPanel
      images={images}
      selectedImageId={null}
      selectedImageNodeCount={0}
      usageById={{}}
      onSelectImage={() => {}}
      onImport={() => {}}
      onApplyToSelection={() => {}}
      onCreateNode={() => {}}
      onReplace={() => {}}
      onRemove={() => {}}
      canRemoveImage={() => true}
      onRepairSequence={extra.onRepairSequence}
    />,
  );
}

// Legacy helper for original describe blocks below
const fixtureImage: ProjectImageAsset = {
  id: "image-hero",
  name: "hero.png",
  mimeType: "image/png",
  src: "data:image/png;base64,fixture",
  width: 512,
  height: 256,
};

function renderPanelWithOverrides(overrides: Partial<Parameters<typeof ImageAssetsPanel>[0]> = {}) {
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
    const props = renderPanelWithOverrides().props;

    expect(screen.getByText("No reusable media yet. Import an image or video to place it in the scene.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import media asset" }));

    expect(props.onImport).toHaveBeenCalledTimes(1);
  });

  it("lists image metadata and selects an asset", () => {
    const props = renderPanelWithOverrides({
      images: [fixtureImage],
      usageById: { [fixtureImage.id]: 2 },
    }).props;

    expect(screen.getByText("hero.png")).toBeTruthy();
    expect(screen.getByText("512 x 256px - 2 uses")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select hero.png" }));

    expect(props.onSelectImage).toHaveBeenCalledWith(fixtureImage.id);
  });

  it("applies, creates, replaces, and removes assets through item actions", () => {
    const props = renderPanelWithOverrides({
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
    renderPanelWithOverrides({
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
    version: 2,
    type: "image-sequence",
    format: "png",
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
    const { container } = renderPanelWithOverrides({ images: [SEQUENCE_ASSET] });
    const badges = container.querySelectorAll(".image-assets-panel__badge");
    expect([...badges].some((b) => b.textContent === "SEQUENCE")).toBe(true);
    expect([...badges].some((b) => b.textContent === "VIDEO")).toBe(false);
  });

  it("shows frameCount / fps / alpha in the sub-line", () => {
    const { container } = renderPanelWithOverrides({ images: [SEQUENCE_ASSET] });
    const sub = container.querySelector(".image-assets-panel__sub");
    expect(sub?.textContent ?? "").toMatch(/5\s*frames/i);
    expect(sub?.textContent ?? "").toMatch(/25\s*fps/i);
    expect(sub?.textContent ?? "").toMatch(/alpha/i);
  });

  it("shows a Play button by default (no autoplay — static thumbnail)", () => {
    const { container } = renderPanelWithOverrides({ images: [SEQUENCE_ASSET] });
    // Static thumbnail: Play button (not Pause) visible
    const playBtn = container.querySelector('button[aria-label*="Play sequence"]');
    expect(playBtn).not.toBeNull();
    // No pause button present initially
    const pauseBtn = container.querySelector('button[aria-label*="Pause sequence"]');
    expect(pauseBtn).toBeNull();
  });

  it("clicking Play starts the preview and advances frames", () => {
    const { container } = renderPanelWithOverrides({ images: [SEQUENCE_ASSET] });
    const thumbImg = container.querySelector(".image-assets-panel__thumb img") as HTMLImageElement;
    expect(thumbImg.src).toContain("blob:frame-1");
    // Click Play to start
    const playBtn = container.querySelector('button[aria-label*="Play sequence"]') as HTMLButtonElement;
    fireEvent.click(playBtn);
    // 25 fps -> 40ms per frame; advance > 40 should land on frame 2.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const thumbImg2 = container.querySelector(".image-assets-panel__thumb img") as HTMLImageElement;
    expect(thumbImg2.src).toContain("blob:frame-2");
  });

  it("clicking Pause after Play stops the preview", () => {
    const { container } = renderPanelWithOverrides({ images: [SEQUENCE_ASSET] });
    // Click Play first
    const playBtn = container.querySelector('button[aria-label*="Play sequence"]') as HTMLButtonElement;
    fireEvent.click(playBtn);
    // Now pause
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
    const { container } = renderPanelWithOverrides({ images: [broken] });
    const warning = container.querySelector(".image-assets-panel__sequence-warning");
    expect(warning).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 12: Static first-frame thumbnail (no autoplay)
// ---------------------------------------------------------------------------

it("renders the first frame as a static thumbnail (no autoplay) when a sequence is added", async () => {
  const { container } = renderPanel([baseSeqAsset()]);
  // Wait one tick to make sure no interval started.
  await new Promise((r) => setTimeout(r, 50));
  const img = container.querySelector("img");
  expect(img?.getAttribute("src")).toBe("blob:first");
  // Play overlay must be visible.
  const playBtn = container.querySelector(".image-assets-panel__seq-play");
  expect(playBtn?.getAttribute("aria-label")).toMatch(/Play sequence preview/);
});

// ---------------------------------------------------------------------------
// Task 13: Subline format · alpha
// ---------------------------------------------------------------------------

it("renders subline `<frameCount> frames @ <fps>fps` and `<format> · <alpha>`", () => {
  const { container } = renderPanel([baseSeqAsset()]);
  const sub = container.querySelector(".image-assets-panel__sub");
  expect(sub?.textContent).toMatch(/4 frames @ 25fps/);
  expect(sub?.textContent).toMatch(/webp · alpha/);
});

// ---------------------------------------------------------------------------
// Task 14: Status pills
// ---------------------------------------------------------------------------

it("renders the auto-repaired pill when sequence.autoRepaired is true", () => {
  const seq = baseSeqAsset({ sequence: baseSeq({ autoRepaired: true }) });
  const { container } = renderPanel([seq]);
  const pill = container.querySelector(".image-assets-panel__pill--auto-repaired");
  expect(pill?.textContent).toBe("auto-repaired");
});

it("renders the legacy png pill when sequence.legacy is true", () => {
  const seq = baseSeqAsset({ sequence: baseSeq({ legacy: true, format: "png" }) });
  const { container } = renderPanel([seq]);
  const pill = container.querySelector(".image-assets-panel__pill--legacy");
  expect(pill?.textContent).toBe("legacy png");
});

it("renders the fallback png pill when fallbackReason is set", () => {
  const seq = baseSeqAsset({
    sequence: baseSeq({ format: "png", fallbackReason: "webp_encoder_unavailable" }),
  });
  const { container } = renderPanel([seq]);
  const pill = container.querySelector(".image-assets-panel__pill--fallback");
  expect(pill?.textContent).toBe("fallback png");
});

// ---------------------------------------------------------------------------
// Task 15: Repair affordance for sequences with no frameUrls
// ---------------------------------------------------------------------------

it("calls onRepairSequence when Repair button is clicked on a sequence with no frameUrls", () => {
  const onRepair = vi.fn();
  const seq = baseSeqAsset({ sequence: baseSeq({ frameUrls: [] }) });
  const { container } = renderPanel([seq], { onRepairSequence: onRepair });
  const button = container.querySelector(".image-assets-panel__repair-btn");
  expect(button?.textContent).toBe("Repair");
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onRepair).toHaveBeenCalledWith(seq.id);
});
