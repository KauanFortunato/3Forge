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
    onPasteKeyframes: vi.fn((_keyframes: unknown[], _frame: number): Array<{ trackId: string; keyframeId: string }> => []),
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

  it("uses empty lane drag for marquee selection instead of scrubbing the playhead", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.name = "Hero Panel";

    const track = createAnimationTrack(node.id, "transform.position.x");
    const firstKeyframe = createAnimationKeyframe(10, 0);
    const secondKeyframe = createAnimationKeyframe(30, 1);
    track.keyframes.push(firstKeyframe, secondKeyframe);

    const clip = createAnimationClip("main", {
      durationFrames: 100,
      tracks: [track],
    });
    const props = makeBaseProps();

    render(
      <AnimationTimeline
        animation={{ activeClipId: clip.id, clips: [clip] }}
        nodes={[root, node]}
        selectedNode={node}
        currentFrame={0}
        selectedTrackId={track.id}
        selectedKeyframeId={null}
        {...props}
      />,
    );

    const lane = document.querySelector<HTMLElement>(`[data-track-lane-id="${track.id}"]`);
    expect(lane).toBeTruthy();
    vi.spyOn(lane as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 1100,
      top: 100,
      bottom: 126,
      width: 1000,
      height: 26,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(lane as HTMLElement, { button: 0, clientX: 150, clientY: 110 });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 120 });
    fireEvent.pointerUp(window);

    const keyframes = Array.from(document.querySelectorAll<HTMLElement>(".tl-kf"));
    expect(keyframes[0].classList.contains("is-selected")).toBe(true);
    expect(keyframes[1].classList.contains("is-selected")).toBe(false);
    expect(props.onFrameChange).not.toHaveBeenCalled();
  });

  it("drags marquee-selected keyframes together while preserving their spacing", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    firstNode.name = "Hero Panel";
    const secondNode = createNode("plane", ROOT_NODE_ID, "plane-1");
    secondNode.name = "Accent Plate";

    const firstTrack = createAnimationTrack(firstNode.id, "transform.position.x");
    const firstKeyframe = createAnimationKeyframe(10, 0);
    firstTrack.keyframes.push(firstKeyframe);

    const secondTrack = createAnimationTrack(secondNode.id, "transform.position.y");
    const secondKeyframe = createAnimationKeyframe(30, 1);
    secondTrack.keyframes.push(secondKeyframe);

    const clip = createAnimationClip("main", {
      durationFrames: 100,
      tracks: [firstTrack, secondTrack],
    });
    const props = makeBaseProps();

    render(
      <AnimationTimeline
        animation={{ activeClipId: clip.id, clips: [clip] }}
        nodes={[root, firstNode, secondNode]}
        selectedNode={firstNode}
        currentFrame={0}
        selectedTrackId={firstTrack.id}
        selectedKeyframeId={null}
        {...props}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "All keyframes" }));

    const firstLane = document.querySelector<HTMLElement>(`[data-track-lane-id="${firstTrack.id}"]`);
    const secondLane = document.querySelector<HTMLElement>(`[data-track-lane-id="${secondTrack.id}"]`);
    expect(firstLane).toBeTruthy();
    expect(secondLane).toBeTruthy();

    vi.spyOn(firstLane as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 1100,
      top: 100,
      bottom: 126,
      width: 1000,
      height: 26,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(secondLane as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 1100,
      top: 126,
      bottom: 152,
      width: 1000,
      height: 26,
      x: 100,
      y: 126,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(firstLane as HTMLElement, { button: 0, clientX: 150, clientY: 105 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 145 });
    fireEvent.pointerUp(window);

    const firstButton = screen.getByRole("button", { name: `Keyframe at ${firstKeyframe.frame}` });
    fireEvent.pointerDown(firstButton, { button: 0, clientX: 200, clientY: 113 });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 113 });
    fireEvent.pointerUp(window);

    expect(props.onBeginKeyframeDrag).toHaveBeenCalledTimes(1);
    expect(props.onShiftKeyframes).toHaveBeenCalledWith(firstTrack.id, [firstKeyframe.id], 5);
    expect(props.onShiftKeyframes).toHaveBeenCalledWith(secondTrack.id, [secondKeyframe.id], 5);
  });

  it("deletes every marquee-selected keyframe across tracks", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    firstNode.name = "Hero Panel";
    const secondNode = createNode("plane", ROOT_NODE_ID, "plane-1");
    secondNode.name = "Accent Plate";

    const firstTrack = createAnimationTrack(firstNode.id, "transform.position.x");
    const firstKeyframe = createAnimationKeyframe(10, 0);
    firstTrack.keyframes.push(firstKeyframe);

    const secondTrack = createAnimationTrack(secondNode.id, "transform.position.y");
    const secondKeyframe = createAnimationKeyframe(30, 1);
    secondTrack.keyframes.push(secondKeyframe);

    const clip = createAnimationClip("main", {
      durationFrames: 100,
      tracks: [firstTrack, secondTrack],
    });
    const props = makeBaseProps();

    render(
      <AnimationTimeline
        animation={{ activeClipId: clip.id, clips: [clip] }}
        nodes={[root, firstNode, secondNode]}
        selectedNode={firstNode}
        currentFrame={0}
        selectedTrackId={null}
        selectedKeyframeId={null}
        {...props}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "All keyframes" }));

    const firstLane = document.querySelector<HTMLElement>(`[data-track-lane-id="${firstTrack.id}"]`);
    const secondLane = document.querySelector<HTMLElement>(`[data-track-lane-id="${secondTrack.id}"]`);
    vi.spyOn(firstLane as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 1100,
      top: 100,
      bottom: 126,
      width: 1000,
      height: 26,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(secondLane as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 1100,
      top: 126,
      bottom: 152,
      width: 1000,
      height: 26,
      x: 100,
      y: 126,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(firstLane as HTMLElement, { button: 0, clientX: 150, clientY: 105 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 145 });
    fireEvent.pointerUp(window);
    fireEvent.keyDown(window, { key: "Delete" });

    expect(props.onRemoveKeyframes).toHaveBeenCalledWith(firstTrack.id, [firstKeyframe.id]);
    expect(props.onRemoveKeyframes).toHaveBeenCalledWith(secondTrack.id, [secondKeyframe.id]);
  });

  it("copies and pastes multiple selected keyframes through a timeline-local clipboard", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    const firstNode = createNode("box", ROOT_NODE_ID, "box-1");
    firstNode.name = "Hero Panel";
    const secondNode = createNode("plane", ROOT_NODE_ID, "plane-1");
    secondNode.name = "Accent Plate";

    const firstTrack = createAnimationTrack(firstNode.id, "transform.position.x");
    const firstKeyframe = createAnimationKeyframe(10, 2);
    firstTrack.keyframes.push(firstKeyframe);

    const secondTrack = createAnimationTrack(secondNode.id, "transform.position.y");
    const secondKeyframe = createAnimationKeyframe(30, 4);
    secondTrack.keyframes.push(secondKeyframe);

    const clip = createAnimationClip("main", {
      durationFrames: 100,
      tracks: [firstTrack, secondTrack],
    });
    const props = makeBaseProps();
    props.onPasteKeyframes.mockReturnValue([
      { trackId: firstTrack.id, keyframeId: "pasted-a" },
      { trackId: secondTrack.id, keyframeId: "pasted-b" },
    ]);

    render(
      <AnimationTimeline
        animation={{ activeClipId: clip.id, clips: [clip] }}
        nodes={[root, firstNode, secondNode]}
        selectedNode={firstNode}
        currentFrame={40}
        selectedTrackId={firstTrack.id}
        selectedKeyframeId={null}
        {...props}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "All keyframes" }));

    const firstLane = document.querySelector<HTMLElement>(`[data-track-lane-id="${firstTrack.id}"]`);
    const secondLane = document.querySelector<HTMLElement>(`[data-track-lane-id="${secondTrack.id}"]`);
    vi.spyOn(firstLane as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 1100,
      top: 100,
      bottom: 126,
      width: 1000,
      height: 26,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(secondLane as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 1100,
      top: 126,
      bottom: 152,
      width: 1000,
      height: 26,
      x: 100,
      y: 126,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(firstLane as HTMLElement, { button: 0, clientX: 150, clientY: 105 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 145 });
    fireEvent.pointerUp(window);
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });

    expect(props.onPasteKeyframes).toHaveBeenCalledTimes(1);
    expect(props.onPasteKeyframes).toHaveBeenCalledWith(
      [
        expect.objectContaining({ trackId: firstTrack.id, frame: 10, value: 2 }),
        expect.objectContaining({ trackId: secondTrack.id, frame: 30, value: 4 }),
      ],
      40,
    );
    expect(props.onSelectKeyframe).toHaveBeenLastCalledWith(secondTrack.id, "pasted-b");
  });

  it("keeps marquee selection stable when the timeline scrolls under the pointer", () => {
    const root = createNode("group", null, ROOT_NODE_ID);
    const node = createNode("box", ROOT_NODE_ID, "box-1");
    node.name = "Hero Panel";

    const track = createAnimationTrack(node.id, "transform.position.x");
    const firstKeyframe = createAnimationKeyframe(10, 0);
    track.keyframes.push(firstKeyframe);

    const clip = createAnimationClip("main", {
      durationFrames: 100,
      tracks: [track],
    });
    const props = makeBaseProps();

    render(
      <AnimationTimeline
        animation={{ activeClipId: clip.id, clips: [clip] }}
        nodes={[root, node]}
        selectedNode={node}
        currentFrame={0}
        selectedTrackId={track.id}
        selectedKeyframeId={null}
        {...props}
      />,
    );

    const lanesRoot = document.querySelector<HTMLElement>(".tl__lanes");
    const lane = document.querySelector<HTMLElement>(`[data-track-lane-id="${track.id}"]`);
    expect(lanesRoot).toBeTruthy();
    expect(lane).toBeTruthy();
    vi.spyOn(lanesRoot as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 1000,
      top: 0,
      bottom: 180,
      width: 1000,
      height: 180,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const laneRect = vi.spyOn(lane as HTMLElement, "getBoundingClientRect");
    laneRect.mockReturnValue({
      left: 100,
      right: 1100,
      top: 100,
      bottom: 126,
      width: 1000,
      height: 26,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(lane as HTMLElement, { button: 0, clientX: 150, clientY: 105 });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 115 });

    laneRect.mockReturnValue({
      left: 100,
      right: 1100,
      top: 40,
      bottom: 66,
      width: 1000,
      height: 26,
      x: 100,
      y: 40,
      toJSON: () => ({}),
    });
    (lanesRoot as HTMLElement).scrollTop = 60;
    fireEvent.scroll(lanesRoot as HTMLElement);
    fireEvent.pointerUp(window);

    const keyframe = screen.getByRole("button", { name: `Keyframe at ${firstKeyframe.frame}` });
    expect(keyframe.classList.contains("is-selected")).toBe(true);
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
