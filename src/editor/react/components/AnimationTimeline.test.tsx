import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAnimationClip, createAnimationKeyframe, createAnimationTrack } from "../../animation";
import { createNode, ROOT_NODE_ID } from "../../state";
import { AnimationTimeline } from "./AnimationTimeline";
import type { ComponentAnimation } from "../../types";

function makeBaseProps() {
  return {
    onFrameChange: vi.fn(),
    onAnimationConfigChange: vi.fn(),
    onCreateClip: vi.fn(),
    onSelectClip: vi.fn(),
    onRenameClip: vi.fn(),
    onRemoveClip: vi.fn(),
    onAddTrack: vi.fn(),
    onRemoveTrack: vi.fn(),
    onAddKeyframe: vi.fn(),
    onSelectTrack: vi.fn(),
    onSelectKeyframe: vi.fn(),
    onUpdateKeyframe: vi.fn(),
    onRemoveKeyframe: vi.fn(),
    onDuplicateClip: vi.fn(),
    onSetTrackMuted: vi.fn(),
    onRemoveKeyframes: vi.fn(),
    onShiftKeyframes: vi.fn(),
    onBeginKeyframeDrag: vi.fn(),
    onEndKeyframeDrag: vi.fn(),
  };
}

describe("AnimationTimeline", () => {
  it("switches between selected-object view and full timeline view", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    root.name = "Component Root";

    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    firstNode.name = "Hero Panel";

    const secondNode = createNode("plane", ROOT_NODE_ID, "plane-1");
    secondNode.name = "Accent Plate";

    const firstTrack = createAnimationTrack(firstNode.id, "transform.position.x");
    firstTrack.keyframes.push(createAnimationKeyframe(0, 0));
    firstTrack.keyframes.push(createAnimationKeyframe(12, 1));

    const secondTrack = createAnimationTrack(secondNode.id, "transform.position.y");
    secondTrack.keyframes.push(createAnimationKeyframe(0, 0));
    secondTrack.keyframes.push(createAnimationKeyframe(18, 2));

    const clip = createAnimationClip("main", {
      durationFrames: 48,
      tracks: [firstTrack, secondTrack],
    });

    const animation: ComponentAnimation = {
      activeClipId: clip.id,
      clips: [clip],
    };

    render(
      <AnimationTimeline
        animation={animation}
        nodes={[root, firstNode, secondNode]}
        selectedNode={firstNode}
        currentFrame={0}
        selectedTrackId={null}
        selectedKeyframeId={null}
        {...makeBaseProps()}
      />,
    );

    const channelRegion = document.querySelector(".tl__tracks") as HTMLElement | null;
    const dopeSheetRegion = document.querySelector(".tl__lanes") as HTMLElement | null;

    expect(channelRegion).toBeTruthy();
    expect(dopeSheetRegion).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Channel to add" })).toBeTruthy();
    expect(within(channelRegion as HTMLElement).getByText("Hero Panel")).toBeTruthy();
    expect(within(channelRegion as HTMLElement).queryByText("Accent Plate")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All keyframes" }));

    expect(within(channelRegion as HTMLElement).getByText("Hero Panel")).toBeTruthy();
    expect(within(channelRegion as HTMLElement).getByText("Accent Plate")).toBeTruthy();
  });

  it("preserves timeline scroll position when selection changes", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    root.name = "Component Root";

    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    firstNode.name = "Hero Panel";

    const secondNode = createNode("plane", ROOT_NODE_ID, "plane-1");
    secondNode.name = "Accent Plate";

    const firstTrack = createAnimationTrack(firstNode.id, "transform.position.x");
    firstTrack.keyframes.push(createAnimationKeyframe(0, 0));
    firstTrack.keyframes.push(createAnimationKeyframe(12, 1));

    const secondTrack = createAnimationTrack(secondNode.id, "transform.position.y");
    secondTrack.keyframes.push(createAnimationKeyframe(0, 0));
    secondTrack.keyframes.push(createAnimationKeyframe(18, 2));

    const clip = createAnimationClip("main", {
      durationFrames: 48,
      tracks: [firstTrack, secondTrack],
    });

    const animation: ComponentAnimation = {
      activeClipId: clip.id,
      clips: [clip],
    };

    const props = {
      animation,
      nodes: [root, firstNode, secondNode],
      currentFrame: 0,
      selectedTrackId: firstTrack.id,
      selectedKeyframeId: null,
      ...makeBaseProps(),
    };

    const { rerender } = render(
      <AnimationTimeline
        {...props}
        selectedNode={firstNode}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "All keyframes" }));

    const channelRegion = document.querySelector(".tl__tracks") as HTMLElement;
    const dopeSheetRegion = document.querySelector(".tl__lanes") as HTMLElement;

    channelRegion.scrollTop = 132;
    dopeSheetRegion.scrollTop = 132;

    rerender(
      <AnimationTimeline
        {...props}
        selectedNode={secondNode}
        selectedTrackId={secondTrack.id}
      />,
    );

    expect(channelRegion.scrollTop).toBe(132);
    expect(dopeSheetRegion.scrollTop).toBe(132);
  });

  it("exposes a mute button next to each channel track", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    root.name = "Component Root";

    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    firstNode.name = "Hero Panel";

    const firstTrack = createAnimationTrack(firstNode.id, "transform.position.x");
    firstTrack.keyframes.push(createAnimationKeyframe(0, 0));
    firstTrack.keyframes.push(createAnimationKeyframe(12, 1));

    const clip = createAnimationClip("main", {
      durationFrames: 48,
      tracks: [firstTrack],
    });

    const animation: ComponentAnimation = {
      activeClipId: clip.id,
      clips: [clip],
    };

    render(
      <AnimationTimeline
        animation={animation}
        nodes={[root, firstNode]}
        selectedNode={firstNode}
        currentFrame={0}
        selectedTrackId={null}
        selectedKeyframeId={null}
        {...makeBaseProps()}
      />,
    );

    const muteButton = screen.getByRole("button", { name: /mute channel/i });
    expect(muteButton).toBeTruthy();

    // Mute button sits inside the track row's actions cluster.
    const trackRow = muteButton.closest(".tl-track") as HTMLElement | null;
    expect(trackRow).toBeTruthy();
    expect(muteButton.parentElement?.classList.contains("tl-track__actions")).toBe(true);
  });

  it("positions keyframes as percentages of the clip duration (alignment regression)", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    root.name = "Component Root";

    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.name = "Hero Panel";

    const track = createAnimationTrack(node.id, "transform.position.x");
    track.keyframes.push(createAnimationKeyframe(0, 0));
    track.keyframes.push(createAnimationKeyframe(25, 1));
    track.keyframes.push(createAnimationKeyframe(50, 2));
    track.keyframes.push(createAnimationKeyframe(75, 3));
    track.keyframes.push(createAnimationKeyframe(100, 4));

    const clip = createAnimationClip("main", {
      durationFrames: 100,
      tracks: [track],
    });

    const animation: ComponentAnimation = {
      activeClipId: clip.id,
      clips: [clip],
    };

    render(
      <AnimationTimeline
        animation={animation}
        nodes={[root, node]}
        selectedNode={node}
        currentFrame={0}
        selectedTrackId={track.id}
        selectedKeyframeId={null}
        {...makeBaseProps()}
      />,
    );

    const keyframes = Array.from(document.querySelectorAll<HTMLElement>(".tl-kf"));
    expect(keyframes).toHaveLength(5);

    const expectedPercents = [0, 25, 50, 75, 100];
    keyframes.forEach((element, index) => {
      expect(element.style.left).toBe(`${expectedPercents[index]}%`);
    });
  });

  it("places the playhead at a percentage of the duration", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    root.name = "Component Root";

    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.name = "Hero Panel";

    const track = createAnimationTrack(node.id, "transform.position.x");
    track.keyframes.push(createAnimationKeyframe(0, 0));

    const clip = createAnimationClip("main", {
      durationFrames: 120,
      tracks: [track],
    });

    const animation: ComponentAnimation = {
      activeClipId: clip.id,
      clips: [clip],
    };

    render(
      <AnimationTimeline
        animation={animation}
        nodes={[root, node]}
        selectedNode={node}
        currentFrame={60}
        selectedTrackId={null}
        selectedKeyframeId={null}
        {...makeBaseProps()}
      />,
    );

    const playhead = document.querySelector<HTMLElement>(".tl__playhead");
    expect(playhead).toBeTruthy();
    expect(playhead?.style.left).toBe("50%");
  });

  it("renders ruler labels anchored at 0% and 100% of the duration", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    root.name = "Component Root";

    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.name = "Hero Panel";

    const track = createAnimationTrack(node.id, "transform.position.x");
    track.keyframes.push(createAnimationKeyframe(0, 0));

    const clip = createAnimationClip("main", {
      durationFrames: 100,
      tracks: [track],
    });

    const animation: ComponentAnimation = {
      activeClipId: clip.id,
      clips: [clip],
    };

    render(
      <AnimationTimeline
        animation={animation}
        nodes={[root, node]}
        selectedNode={node}
        currentFrame={0}
        selectedTrackId={null}
        selectedKeyframeId={null}
        {...makeBaseProps()}
      />,
    );

    const labels = Array.from(document.querySelectorAll<HTMLElement>(".tl__ruler-line"));
    expect(labels.length).toBeGreaterThan(0);

    const firstLabel = labels[0];
    const lastLabel = labels[labels.length - 1];

    expect(firstLabel.textContent).toBe("0");
    expect(firstLabel.style.left).toBe("0%");

    expect(lastLabel.textContent).toBe("100");
    expect(lastLabel.style.left).toBe("100%");
  });
});
