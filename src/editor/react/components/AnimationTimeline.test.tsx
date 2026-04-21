import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAnimationClip, createAnimationKeyframe, createAnimationTrack } from "../../animation";
import { createNode, ROOT_NODE_ID } from "../../state";
import { AnimationTimeline } from "./AnimationTimeline";
import type { ComponentAnimation } from "../../types";

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
        isPlaying={false}
        selectedTrackId={null}
        selectedKeyframeId={null}
        onPlayToggle={vi.fn()}
        onStop={vi.fn()}
        onFrameChange={vi.fn()}
        onAnimationConfigChange={vi.fn()}
        onCreateClip={vi.fn()}
        onSelectClip={vi.fn()}
        onRenameClip={vi.fn()}
        onRemoveClip={vi.fn()}
        onAddTrack={vi.fn()}
        onRemoveTrack={vi.fn()}
        onAddKeyframe={vi.fn()}
        onSelectTrack={vi.fn()}
        onSelectKeyframe={vi.fn()}
        onUpdateKeyframe={vi.fn()}
        onRemoveKeyframe={vi.fn()}
        onBeginKeyframeDrag={vi.fn()}
        onEndKeyframeDrag={vi.fn()}
      />,
    );

    const channelRegion = document.querySelector(".animation-dope-sheet__left-body") as HTMLElement | null;
    const dopeSheetRegion = document.querySelector(".animation-dope-sheet__right-body") as HTMLElement | null;

    expect(channelRegion).toBeTruthy();
    expect(dopeSheetRegion).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Animation clip" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Channel to add" })).toBeTruthy();
    expect(within(channelRegion as HTMLElement).getByText("Hero Panel")).toBeTruthy();
    expect(within(channelRegion as HTMLElement).queryByText("Accent Plate")).toBeNull();
    expect(within(dopeSheetRegion as HTMLElement).getByText("Hero Panel")).toBeTruthy();
    expect(within(dopeSheetRegion as HTMLElement).queryByText("Accent Plate")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All keyframes" }));

    expect(within(channelRegion as HTMLElement).getByText("Hero Panel")).toBeTruthy();
    expect(within(channelRegion as HTMLElement).getByText("Accent Plate")).toBeTruthy();
    expect(within(dopeSheetRegion as HTMLElement).getByText("Hero Panel")).toBeTruthy();
    expect(within(dopeSheetRegion as HTMLElement).getByText("Accent Plate")).toBeTruthy();
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
      isPlaying: false,
      selectedTrackId: firstTrack.id,
      selectedKeyframeId: null,
      onPlayToggle: vi.fn(),
      onStop: vi.fn(),
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
      onBeginKeyframeDrag: vi.fn(),
      onEndKeyframeDrag: vi.fn(),
    };

    const { rerender } = render(
      <AnimationTimeline
        {...props}
        selectedNode={firstNode}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "All keyframes" }));

    const channelRegion = document.querySelector(".animation-dope-sheet__left-body") as HTMLElement;
    const dopeSheetRegion = document.querySelector(".animation-dope-sheet__right-body") as HTMLElement;

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
});
