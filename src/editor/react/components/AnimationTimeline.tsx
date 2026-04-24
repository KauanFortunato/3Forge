import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import {
  ANIMATION_EASE_OPTIONS,
  ANIMATION_PROPERTIES,
  animationValueToBoolean,
  getAnimationPropertyLabel,
  isDiscreteAnimationProperty,
  isTrackMuted,
  normalizeAnimationValueForProperty,
} from "../../animation";
import type {
  AnimationClip,
  AnimationEasePreset,
  AnimationKeyframe,
  AnimationPropertyPath,
  AnimationTrack,
  ComponentAnimation,
  EditorNode,
} from "../../types";
import { BufferedInput } from "./BufferedInput";
import { ChevronDownIcon, CopyIcon, PlusIcon, TimelineIcon, TrashIcon } from "./icons";

function framePercent(frame: number, durationFrames: number): string {
  const safeDuration = Math.max(durationFrames, 1);
  const clamped = Math.max(0, Math.min(frame, safeDuration));
  return `${(clamped / safeDuration) * 100}%`;
}

interface AnimationTimelineProps {
  animation: ComponentAnimation;
  nodes: EditorNode[];
  selectedNode: EditorNode | undefined;
  currentFrame: number;
  selectedTrackId: string | null;
  selectedKeyframeId: string | null;
  onFrameChange: (frame: number) => void;
  onAnimationConfigChange: (patch: Partial<Pick<AnimationClip, "fps" | "durationFrames">>) => void;
  onCreateClip: () => void;
  onSelectClip: (clipId: string) => void;
  onRenameClip: (clipId: string, name: string) => void;
  onRemoveClip: (clipId: string) => void;
  onAddTrack: (property: AnimationPropertyPath) => void;
  onRemoveTrack: (trackId: string) => void;
  onAddKeyframe: (trackId: string) => void;
  onSelectTrack: (trackId: string | null) => void;
  onSelectKeyframe: (trackId: string, keyframeId: string | null) => void;
  onUpdateKeyframe: (trackId: string, keyframeId: string, patch: Partial<Pick<AnimationKeyframe, "frame" | "value" | "ease">>) => void;
  onRemoveKeyframe: (trackId: string, keyframeId: string) => void;
  onBeginKeyframeDrag: () => void;
  onEndKeyframeDrag: () => void;
  onDuplicateClip: (clipId: string) => void;
  onSetTrackMuted: (clipId: string, trackId: string, muted: boolean) => void;
  onRemoveKeyframes: (trackId: string, keyframeIds: string[]) => void;
  onShiftKeyframes: (trackId: string, keyframeIds: string[], frameDelta: number) => void;
}

interface DragState {
  trackId: string;
  keyframeId: string;
  laneLeft: number;
  laneWidth: number;
  originFrame: number;
  batchKeyframeIds: string[];
  batchOriginFrames: Map<string, number>;
  lastDelta: number;
}

interface ScrubState {
  laneLeft: number;
  laneWidth: number;
}

type TimelineViewMode = "selected" | "all";
const MIN_TIMELINE_PIXELS_PER_FRAME = 4;
const MAX_TIMELINE_PIXELS_PER_FRAME = 80;
const TARGET_RULER_TICK_SPACING = 72;
const RULER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500];

export function AnimationTimeline(props: AnimationTimelineProps) {
  const {
    animation,
    nodes,
    selectedNode,
    currentFrame,
    selectedTrackId,
    selectedKeyframeId,
    onFrameChange,
    onAnimationConfigChange,
    onRenameClip,
    onRemoveClip,
    onAddTrack,
    onRemoveTrack,
    onAddKeyframe,
    onSelectTrack,
    onSelectKeyframe,
    onUpdateKeyframe,
    onRemoveKeyframe,
    onBeginKeyframeDrag,
    onEndKeyframeDrag,
    onDuplicateClip,
    onSetTrackMuted,
    onRemoveKeyframes,
    onShiftKeyframes,
  } = props;

  const [propertyToAdd, setPropertyToAdd] = useState<AnimationPropertyPath>("transform.position.x");
  const [viewMode, setViewMode] = useState<TimelineViewMode>("selected");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [scrubState, setScrubState] = useState<ScrubState | null>(null);
  const [selectedKeyframeIds, setSelectedKeyframeIds] = useState<Set<string>>(() => new Set());
  const [timelinePixelsPerFrame, setTimelinePixelsPerFrame] = useState(12);
  const rulerScrollRef = useRef<HTMLDivElement | null>(null);
  const tracksScrollRef = useRef<HTMLDivElement | null>(null);
  const lanesScrollRef = useRef<HTMLDivElement | null>(null);

  const activeClip = useMemo(
    () => animation.clips.find((clip) => clip.id === animation.activeClipId) ?? animation.clips[0],
    [animation.activeClipId, animation.clips],
  );
  const resolvedTracks = useMemo(
    () => getResolvedClipTracks(animation, activeClip?.id ?? ""),
    [activeClip?.id, animation],
  );
  const takenProperties = new Set(
    selectedNode ? resolvedTracks.filter((track) => track.nodeId === selectedNode.id).map((track) => track.property) : [],
  );
  const availableProperties = ANIMATION_PROPERTIES.filter((entry) => !takenProperties.has(entry.path));
  const visibleTracks = useMemo(() => {
    if (viewMode === "all") {
      return resolvedTracks;
    }

    return selectedNode ? resolvedTracks.filter((track) => track.nodeId === selectedNode.id) : [];
  }, [resolvedTracks, selectedNode, viewMode]);
  const visibleGroupedTracks = useMemo(() => groupTracksByNode(visibleTracks, nodes), [nodes, visibleTracks]);
  const visibleTrackCount = visibleTracks.length;
  const visibleSelectedTrack = visibleTracks.find((track) => track.id === selectedTrackId) ?? null;
  const visibleSelectedKeyframe = visibleSelectedTrack?.keyframes.find((keyframe) => keyframe.id === selectedKeyframeId) ?? null;
  useEffect(() => {
    if (availableProperties.length > 0 && !availableProperties.some((entry) => entry.path === propertyToAdd)) {
      setPropertyToAdd(availableProperties[0].path);
    }
  }, [availableProperties, propertyToAdd]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const frame = positionToFrame(event.clientX, dragState.laneLeft, dragState.laneWidth, activeClip?.durationFrames ?? 1);
      if (dragState.batchKeyframeIds.length > 1) {
        const delta = frame - dragState.originFrame;
        if (delta !== dragState.lastDelta) {
          onShiftKeyframes(dragState.trackId, dragState.batchKeyframeIds, delta - dragState.lastDelta);
          dragState.lastDelta = delta;
        }
        const primaryOrigin = dragState.batchOriginFrames.get(dragState.keyframeId) ?? dragState.originFrame;
        onFrameChange(Math.max(0, Math.min(activeClip?.durationFrames ?? 1, primaryOrigin + delta)));
      } else {
        onUpdateKeyframe(dragState.trackId, dragState.keyframeId, { frame });
        onFrameChange(frame);
      }
    };

    const handlePointerUp = () => {
      setDragState(null);
      onEndKeyframeDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeClip?.durationFrames, dragState, onEndKeyframeDrag, onFrameChange, onShiftKeyframes, onUpdateKeyframe]);

  useEffect(() => {
    if (!scrubState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      onFrameChange(positionToFrame(event.clientX, scrubState.laneLeft, scrubState.laneWidth, activeClip?.durationFrames ?? 1));
    };

    const handlePointerUp = () => {
      setScrubState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeClip?.durationFrames, onFrameChange, scrubState]);

  useEffect(() => {
    const leftBody = tracksScrollRef.current;
    const rightBody = lanesScrollRef.current;
    const rulerBody = rulerScrollRef.current;
    if (!leftBody || !rightBody || !rulerBody) {
      return;
    }

    let syncingLeftTop = false;
    let syncingRightTop = false;
    let syncingRulerLeft = false;
    let syncingLanesLeft = false;

    const handleLeftScroll = () => {
      if (syncingLeftTop) {
        syncingLeftTop = false;
        return;
      }

      syncingRightTop = true;
      rightBody.scrollTop = leftBody.scrollTop;
    };

    const handleRightScroll = () => {
      if (syncingRightTop) {
        syncingRightTop = false;
      } else {
        syncingLeftTop = true;
        leftBody.scrollTop = rightBody.scrollTop;
      }

      if (syncingLanesLeft) {
        syncingLanesLeft = false;
        return;
      }

      syncingRulerLeft = true;
      rulerBody.scrollLeft = rightBody.scrollLeft;
    };

    const handleRulerScroll = () => {
      if (syncingRulerLeft) {
        syncingRulerLeft = false;
        return;
      }

      syncingLanesLeft = true;
      rightBody.scrollLeft = rulerBody.scrollLeft;
    };

    leftBody.addEventListener("scroll", handleLeftScroll);
    rightBody.addEventListener("scroll", handleRightScroll);
    rulerBody.addEventListener("scroll", handleRulerScroll);

    leftBody.scrollTop = rightBody.scrollTop;
    rulerBody.scrollLeft = rightBody.scrollLeft;

    return () => {
      leftBody.removeEventListener("scroll", handleLeftScroll);
      rightBody.removeEventListener("scroll", handleRightScroll);
      rulerBody.removeEventListener("scroll", handleRulerScroll);
    };
  }, [viewMode, visibleGroupedTracks.length]);

  useEffect(() => {
    const leftBody = tracksScrollRef.current;
    const rightBody = lanesScrollRef.current;
    const rulerBody = rulerScrollRef.current;
    if (!leftBody || !rightBody) {
      return;
    }

    leftBody.scrollTop = 0;
    rightBody.scrollTop = 0;
    rightBody.scrollLeft = 0;
    if (rulerBody) {
      rulerBody.scrollLeft = 0;
    }
  }, [activeClip?.id, viewMode]);

  useEffect(() => {
    setSelectedKeyframeIds((previous) => {
      if (!selectedKeyframeId) {
        if (previous.size === 0) {
          return previous;
        }
        return new Set();
      }

      if (previous.has(selectedKeyframeId)) {
        return previous;
      }

      return new Set([selectedKeyframeId]);
    });
  }, [selectedKeyframeId]);

  const handleKeyframePick = useCallback((trackId: string, keyframeId: string, additive: boolean) => {
    if (!additive) {
      setSelectedKeyframeIds(new Set([keyframeId]));
      onSelectKeyframe(trackId, keyframeId);
      return;
    }

    setSelectedKeyframeIds((previous) => {
      const next = new Set(previous);
      if (next.has(keyframeId)) {
        next.delete(keyframeId);
      } else {
        next.add(keyframeId);
      }
      const primary = next.has(keyframeId) ? keyframeId : (next.values().next().value ?? null);
      onSelectKeyframe(trackId, primary);
      return next;
    });
  }, [onSelectKeyframe]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }

      if ((event.key !== "Delete" && event.key !== "Backspace") || !selectedTrackId) {
        return;
      }

      if (selectedKeyframeIds.size < 2) {
        return;
      }

      event.preventDefault();
      onRemoveKeyframes(selectedTrackId, Array.from(selectedKeyframeIds));
      setSelectedKeyframeIds(new Set());
      onSelectKeyframe(selectedTrackId, null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onRemoveKeyframes, onSelectKeyframe, selectedKeyframeIds, selectedTrackId]);

  const durationFrames = activeClip?.durationFrames ?? 1;

  const rulerTicks: Array<{ frame: number; isMajor: boolean }> = [];
  const rulerStep = getRulerStep(timelinePixelsPerFrame);
  for (let frame = 0; frame <= durationFrames; frame += rulerStep) {
    rulerTicks.push({ frame, isMajor: frame % (rulerStep * 2) === 0 || frame === 0 });
  }
  if (rulerTicks.at(-1)?.frame !== durationFrames) {
    rulerTicks.push({ frame: durationFrames, isMajor: true });
  }
  const timelineContentWidth = Math.max(480, durationFrames * timelinePixelsPerFrame);
  const timelineContentStyle = { minWidth: "100%", width: `${timelineContentWidth}px` };
  const handleTimelineWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const lanes = lanesScrollRef.current;
    const ruler = rulerScrollRef.current;
    const scrollHost = event.currentTarget;
    if (event.shiftKey) {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const nextScrollLeft = Math.max(0, scrollHost.scrollLeft + delta);
      if (lanes) {
        lanes.scrollLeft = nextScrollLeft;
      }
      if (ruler) {
        ruler.scrollLeft = nextScrollLeft;
      }
      return;
    }

    const rect = scrollHost.getBoundingClientRect();
    const pointerX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const currentScrollLeft = scrollHost.scrollLeft;

    setTimelinePixelsPerFrame((previous) => {
      const zoomIntensity = 1.22;
      const factor = event.deltaY < 0 ? zoomIntensity : 1 / zoomIntensity;
      const next = Math.max(
        MIN_TIMELINE_PIXELS_PER_FRAME,
        Math.min(MAX_TIMELINE_PIXELS_PER_FRAME, Number((previous * factor).toFixed(3))),
      );
      if (next === previous) {
        return previous;
      }

      const frameUnderPointer = (currentScrollLeft + pointerX) / Math.max(previous, 0.001);
      const nextScrollLeft = Math.max(0, frameUnderPointer * next - pointerX);
      window.requestAnimationFrame(() => {
        if (lanes) {
          lanes.scrollLeft = nextScrollLeft;
        }
        if (ruler) {
          ruler.scrollLeft = nextScrollLeft;
        }
      });

      return next;
    });
  }, []);

  return (
    <section className="tl">
      <div className="panel__hd">
        <span className="panel__hd-icon"><TimelineIcon width={12} height={12} /></span>
        <span className="panel__hd-title">Timeline</span>
        <span className="tl__panel-hd-clock">
          <strong>{String(currentFrame).padStart(3, "0")}</strong>
          <span className="tl__panel-hd-clock-dim">/</span>
          <span>{String(durationFrames).padStart(3, "0")}</span>
        </span>
        <span className="tl__range">
          <strong>0</strong>
          <span>-</span>
          <strong>{durationFrames}</strong>
          <span>frames</span>
        </span>

        <span className="panel__hd-meta" aria-hidden="true">
          {visibleTrackCount} channels
        </span>

        <div className="panel__hd-spacer" />

        <div className="panel__hd-actions">
          <div className="seg" role="tablist" aria-label="Timeline view">
            <button
              type="button"
              className={`seg__btn${viewMode === "selected" ? " is-active" : ""}`}
              aria-pressed={viewMode === "selected"}
              onClick={() => setViewMode("selected")}
            >
              Selected object
            </button>
            <button
              type="button"
              className={`seg__btn${viewMode === "all" ? " is-active" : ""}`}
              aria-pressed={viewMode === "all"}
              onClick={() => setViewMode("all")}
            >
              All keyframes
            </button>
          </div>

          <span className="num" style={{ width: 60 }} title="Frame">
            <BufferedInput
              type="text"
              inputMode="numeric"
              value={String(currentFrame)}
              onCommit={(value) => onFrameChange(Number(value))}
              aria-label="Frame"
            />
          </span>

          <span className="num" style={{ width: 50 }} title="FPS">
            <BufferedInput
              type="text"
              inputMode="numeric"
              value={String(activeClip?.fps ?? 24)}
              onCommit={(value) => onAnimationConfigChange({ fps: Number(value) })}
              aria-label="FPS"
            />
          </span>

          <span className="num" style={{ width: 60 }} title="End frame">
            <BufferedInput
              type="text"
              inputMode="numeric"
              value={String(activeClip?.durationFrames ?? 1)}
              onCommit={(value) => onAnimationConfigChange({ durationFrames: Number(value) })}
              aria-label="End"
            />
          </span>

          {activeClip ? (
            <button
              type="button"
              className="ibtn"
              onClick={() => onDuplicateClip(activeClip.id)}
              aria-label="Duplicate clip"
              title="Duplicate clip"
            >
              <CopyIcon width={12} height={12} />
            </button>
          ) : null}

          {activeClip && animation.clips.length > 1 ? (
            <button
              type="button"
              className="ibtn"
              onClick={() => onRemoveClip(activeClip.id)}
              aria-label="Delete clip"
              title="Delete clip"
            >
              <TrashIcon width={12} height={12} />
            </button>
          ) : null}

          {activeClip ? (
            <span className="text" style={{ width: 120 }} title="Clip name">
              <BufferedInput
                type="text"
                value={activeClip.name}
                onCommit={(value) => onRenameClip(activeClip.id, value)}
                aria-label="Clip name"
              />
            </span>
          ) : null}
        </div>
      </div>

      <div className="tl__ruler-row">
        <div className="tl__ruler-spacer">
          <span>Channels</span>
        </div>
        <div className="tl__ruler" ref={rulerScrollRef} onWheel={handleTimelineWheel}>
          <div
            className="tl__ruler-inner"
            style={timelineContentStyle}
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const laneLeft = rect.left;
              const laneWidth = rect.width;
              onFrameChange(positionToFrame(event.clientX, laneLeft, laneWidth, durationFrames));
              setScrubState({ laneLeft, laneWidth });
            }}
          >
            {rulerTicks.map(({ frame, isMajor }) => (
              <div
                key={frame}
                className={`tl__ruler-tick${isMajor ? " is-major" : " is-minor"}`}
                style={{ left: framePercent(frame, durationFrames) }}
              />
            ))}
            {rulerTicks.filter((tick) => tick.isMajor).map(({ frame }) => (
              <div
                key={`lbl-${frame}`}
                className="tl__ruler-line"
                style={{ left: framePercent(frame, durationFrames) }}
              >
                {frame}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="tl__body">
        <div className="tl__tracks" ref={tracksScrollRef}>
          <div className="tl__tracks-inner">
            <div className="tl-track tl-track--add">
              <span className="sel" style={{ width: "100%" }} title="Channel to add">
                <select
                  value={propertyToAdd}
                  onChange={(event) => setPropertyToAdd(event.target.value as AnimationPropertyPath)}
                  disabled={!selectedNode || availableProperties.length === 0}
                  aria-label="Channel to add"
                >
                  {availableProperties.length > 0 ? (
                    availableProperties.map((entry) => (
                      <option key={entry.path} value={entry.path}>
                        {entry.label}
                      </option>
                    ))
                  ) : (
                    <option value={propertyToAdd}>No transform channels left</option>
                  )}
                </select>
                <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
              </span>
              <button
                type="button"
                className="tl-track__ibtn"
                disabled={!selectedNode || availableProperties.length === 0}
                onClick={() => onAddTrack(propertyToAdd)}
                aria-label="Add channel"
                title="Add channel"
              >
                <PlusIcon width={11} height={11} />
              </button>
            </div>

            {visibleGroupedTracks.length > 0 ? visibleGroupedTracks.map(({ node, tracks }) => (
              <div key={node.id}>
                <div className="tl-track tl-track--group">
                  <span className="tl-track__ico"><TimelineIcon width={11} height={11} /></span>
                  <span className="tl-track__name">{node.name}</span>
                  <span className="tl-track__prop">{node.type}</span>
                  <span className="tl-track__kf-count">{tracks.length}ch</span>
                </div>
                {tracks.map((track) => {
                  const muted = isTrackMuted(track);
                  const trackSelected = selectedTrackId === track.id;
                  return (
                    <div
                      key={track.id}
                      className={`tl-track is-child${trackSelected ? " is-selected" : ""}${muted ? " is-muted" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectTrack(track.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectTrack(track.id);
                        }
                      }}
                    >
                      <span className="tl-track__ico"><TimelineIcon width={10} height={10} /></span>
                      <span className="tl-track__name">{getAnimationPropertyLabel(track.property)}</span>
                      <span className="tl-track__prop">{getTrackCategoryLabel(track.property)}</span>
                      <span className="tl-track__kf-count">{track.keyframes.length}</span>
                      <span className="tl-track__actions">
                        {activeClip ? (
                          <button
                            type="button"
                            className={`tl-track__ibtn${muted ? " is-off" : ""}`}
                            aria-pressed={muted}
                            aria-label={muted ? "Unmute channel" : "Mute channel"}
                            title={muted ? "Unmute channel" : "Mute channel"}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSetTrackMuted(activeClip.id, track.id, !muted);
                            }}
                          >
                            M
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="tl-track__ibtn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onAddKeyframe(track.id);
                          }}
                          aria-label="Add key"
                          title="Add key"
                        >
                          <PlusIcon width={10} height={10} />
                        </button>
                        <button
                          type="button"
                          className="tl-track__ibtn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveTrack(track.id);
                          }}
                          aria-label="Remove track"
                          title="Remove track"
                        >
                          <TrashIcon width={10} height={10} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )) : (
              <div className="tl__empty">
                {viewMode === "all"
                  ? "No animated channels in this clip yet."
                  : selectedNode
                    ? "Add channels to the selected object."
                    : "Select an object to inspect its channels."}
              </div>
            )}
          </div>
        </div>

        <div className="tl__lanes" ref={lanesScrollRef} onWheel={handleTimelineWheel}>
          <div className="tl__lanes-inner" style={timelineContentStyle}>
            {/* Spacer lane matching the property-selector track */}
            <div className="tl-lane" />

            {visibleGroupedTracks.length > 0 ? visibleGroupedTracks.map(({ node, tracks }) => (
              <div key={node.id}>
                <div className="tl-lane" />
                {tracks.map((track) => {
                  const trackIsSelected = selectedTrackId === track.id;
                  const selectedKeyframeIdsForTrack = trackIsSelected ? selectedKeyframeIds : null;
                  return (
                    <TrackLane
                      key={track.id}
                      track={track}
                      durationFrames={durationFrames}
                      currentFrame={currentFrame}
                      isSelected={trackIsSelected}
                      isMuted={isTrackMuted(track)}
                      selectedKeyframeIds={selectedKeyframeIdsForTrack}
                      onSelectTrack={() => onSelectTrack(track.id)}
                      onPickKeyframe={(keyframeId, additive) => handleKeyframePick(track.id, keyframeId, additive)}
                      onFrameChange={onFrameChange}
                      onScrubStart={(laneLeft, laneWidth) => setScrubState({ laneLeft, laneWidth })}
                      onStartKeyframeDrag={(event, keyframeId) => {
                        onBeginKeyframeDrag();
                        const laneElement = event.currentTarget.parentElement;
                        const rect = laneElement?.getBoundingClientRect();
                        const laneLeft = rect?.left ?? 0;
                        const laneWidth = rect?.width ?? 0;
                        const batchIds = trackIsSelected && selectedKeyframeIds.has(keyframeId) && selectedKeyframeIds.size > 1
                          ? Array.from(selectedKeyframeIds)
                          : [keyframeId];
                        const originMap = new Map<string, number>();
                        for (const id of batchIds) {
                          const match = track.keyframes.find((entry) => entry.id === id);
                          if (match) {
                            originMap.set(id, match.frame);
                          }
                        }
                        const primaryOrigin = originMap.get(keyframeId) ?? track.keyframes.find((entry) => entry.id === keyframeId)?.frame ?? 0;
                        setDragState({
                          trackId: track.id,
                          keyframeId,
                          laneLeft,
                          laneWidth,
                          originFrame: primaryOrigin,
                          batchKeyframeIds: batchIds,
                          batchOriginFrames: originMap,
                          lastDelta: 0,
                        });
                      }}
                    />
                  );
                })}
              </div>
            )) : null}

            <div
              className="tl__playhead"
              style={{ left: framePercent(currentFrame, durationFrames) }}
            />
          </div>
        </div>
      </div>

      {visibleSelectedTrack && visibleSelectedKeyframe ? (
        <KeyframeEditorStrip
          track={visibleSelectedTrack}
          keyframe={visibleSelectedKeyframe}
          nodes={nodes}
          durationFrames={durationFrames}
          onUpdateKeyframe={onUpdateKeyframe}
          onRemoveKeyframe={onRemoveKeyframe}
        />
      ) : null}
    </section>
  );
}

interface KeyframeEditorStripProps {
  track: AnimationTrack;
  keyframe: AnimationKeyframe;
  nodes: EditorNode[];
  durationFrames: number;
  onUpdateKeyframe: (trackId: string, keyframeId: string, patch: Partial<Pick<AnimationKeyframe, "frame" | "value" | "ease">>) => void;
  onRemoveKeyframe: (trackId: string, keyframeId: string) => void;
}

function KeyframeEditorStrip({ track, keyframe, nodes, durationFrames, onUpdateKeyframe, onRemoveKeyframe }: KeyframeEditorStripProps) {
  const nodeName = findNodeLabel(nodes, track.nodeId);
  return (
    <div className="exp-hd" style={{ gap: "var(--sp-3)", flexWrap: "wrap" }}>
      <strong style={{ color: "var(--c-text)", fontSize: "var(--fs-sm)" }}>{getAnimationPropertyLabel(track.property)}</strong>
      <span className="panel__hd-meta">{nodeName} · Frame {keyframe.frame}</span>

      <div className="exp-hd__spacer" />

      <span className="num" style={{ width: 60 }} title="Frame">
        <BufferedInput
          type="text"
          inputMode="numeric"
          value={String(keyframe.frame)}
          aria-label="Keyframe frame"
          onCommit={(value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) {
              return;
            }
            const clamped = Math.max(0, Math.min(durationFrames, Math.round(parsed)));
            onUpdateKeyframe(track.id, keyframe.id, { frame: clamped });
          }}
        />
      </span>

      {isDiscreteAnimationProperty(track.property) ? (
        <span className="sel" style={{ width: 100 }}>
          <select
            value={String(displayValueForInput(track.property, keyframe.value))}
            aria-label="Keyframe value"
            onChange={(event) =>
              onUpdateKeyframe(track.id, keyframe.id, {
                value: parseValueFromInput(track.property, Number(event.target.value)),
              })}
          >
            <option value="1">Visible</option>
            <option value="0">Hidden</option>
          </select>
          <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
        </span>
      ) : (
        <span className="num" style={{ width: 80 }} title="Value">
          <BufferedInput
            type="text"
            inputMode="decimal"
            aria-label="Keyframe value"
            value={String(displayValueForInput(track.property, keyframe.value))}
            onCommit={(value) =>
              onUpdateKeyframe(track.id, keyframe.id, {
                value: parseValueFromInput(track.property, Number(value)),
              })}
          />
        </span>
      )}

      <span className="sel" style={{ width: 120 }} title="Ease">
        <select
          value={keyframe.ease}
          aria-label="Keyframe ease"
          onChange={(event) => onUpdateKeyframe(track.id, keyframe.id, { ease: event.target.value as AnimationEasePreset })}
        >
          {ANIMATION_EASE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="sel__caret"><ChevronDownIcon width={10} height={10} /></span>
      </span>

      <button
        type="button"
        className="ibtn"
        onClick={() => onRemoveKeyframe(track.id, keyframe.id)}
        aria-label="Delete keyframe"
        title="Delete keyframe"
      >
        <TrashIcon width={12} height={12} />
      </button>
    </div>
  );
}

interface TrackLaneProps {
  track: AnimationTrack;
  durationFrames: number;
  currentFrame: number;
  isSelected: boolean;
  isMuted: boolean;
  selectedKeyframeIds: Set<string> | null;
  onSelectTrack: () => void;
  onPickKeyframe: (keyframeId: string, additive: boolean) => void;
  onFrameChange: (frame: number) => void;
  onScrubStart: (laneLeft: number, laneWidth: number) => void;
  onStartKeyframeDrag: (event: ReactPointerEvent<HTMLButtonElement>, keyframeId: string) => void;
}

function TrackLane(props: TrackLaneProps) {
  const {
    track,
    durationFrames,
    currentFrame,
    isSelected,
    isMuted,
    selectedKeyframeIds,
    onSelectTrack,
    onPickKeyframe,
    onFrameChange,
    onScrubStart,
    onStartKeyframeDrag,
  } = props;

  return (
    <div
      className={`tl-lane${isSelected ? " is-selected" : ""}${isMuted ? " is-muted" : ""}`}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const laneLeft = rect.left;
        const laneWidth = rect.width;
        onSelectTrack();
        onFrameChange(positionToFrame(event.clientX, laneLeft, laneWidth, durationFrames));
        onScrubStart(laneLeft, laneWidth);
      }}
    >
      {track.keyframes.map((keyframe) => {
        const isKeyframeSelected = selectedKeyframeIds?.has(keyframe.id) ?? false;
        return (
          <button
            key={keyframe.id}
            type="button"
            className={`tl-kf${isKeyframeSelected ? " is-selected" : ""}${currentFrame === keyframe.frame ? " is-current" : ""}`}
            style={{ left: framePercent(keyframe.frame, durationFrames) }}
            onClick={(event) => {
              event.stopPropagation();
              const additive = event.shiftKey || event.ctrlKey || event.metaKey;
              onSelectTrack();
              onPickKeyframe(keyframe.id, additive);
              if (!additive) {
                onFrameChange(keyframe.frame);
              }
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              const additive = event.shiftKey || event.ctrlKey || event.metaKey;
              onSelectTrack();
              if (additive) {
                onPickKeyframe(keyframe.id, true);
                return;
              }
              if (!(selectedKeyframeIds?.has(keyframe.id) ?? false)) {
                onPickKeyframe(keyframe.id, false);
              }
              onStartKeyframeDrag(event, keyframe.id);
            }}
            title={`${keyframe.frame}f`}
            aria-label={`Keyframe at ${keyframe.frame}`}
          />
        );
      })}
    </div>
  );
}

function groupTracksByNode(tracks: AnimationTrack[], nodes: EditorNode[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, AnimationTrack[]>();

  for (const track of tracks) {
    const bucket = groups.get(track.nodeId) ?? [];
    bucket.push(track);
    groups.set(track.nodeId, bucket);
  }

  return Array.from(groups.entries())
    .map(([nodeId, groupedTracks]) => ({
      node: nodesById.get(nodeId),
      tracks: [...groupedTracks].sort((a, b) => a.property.localeCompare(b.property)),
    }))
    .filter((entry): entry is { node: EditorNode; tracks: AnimationTrack[] } => Boolean(entry.node));
}

function getResolvedClipTracks(animation: ComponentAnimation, clipId: string): AnimationTrack[] {
  const clip = animation.clips.find((entry) => entry.id === clipId);
  return clip?.tracks ?? [];
}

function positionToFrame(
  clientX: number,
  laneLeft: number,
  laneWidth: number,
  durationFrames: number,
): number {
  const safeWidth = Math.max(laneWidth, 1);
  const safeDuration = Math.max(durationFrames, 1);
  const ratio = (clientX - laneLeft) / safeWidth;
  return Math.max(0, Math.min(safeDuration, Math.round(ratio * safeDuration)));
}

function displayValueForInput(property: AnimationPropertyPath, value: number): number {
  if (isDiscreteAnimationProperty(property)) {
    return animationValueToBoolean(property, value) ? 1 : 0;
  }

  if (property.includes("rotation")) {
    return Number(((value * 180) / Math.PI).toFixed(2));
  }

  return Number(value.toFixed(3));
}

function parseValueFromInput(property: AnimationPropertyPath, value: number): number {
  if (isDiscreteAnimationProperty(property)) {
    return normalizeAnimationValueForProperty(property, value);
  }

  if (!Number.isFinite(value)) {
    return property.includes("scale") ? 1 : 0;
  }

  if (property.includes("rotation")) {
    return Number(((value * Math.PI) / 180).toFixed(6));
  }

  return value;
}

function getTrackCategoryLabel(property: AnimationPropertyPath): string {
  if (property.includes("position")) {
    return "Position";
  }

  if (property.includes("rotation")) {
    return "Rotation";
  }

  if (property.includes("scale")) {
    return "Scale";
  }

  return "Transform";
}

function findNodeLabel(nodes: EditorNode[], nodeId: string): string {
  const node = nodes.find((entry) => entry.id === nodeId);
  return node ? node.name : "Object";
}

function getRulerStep(pixelsPerFrame: number): number {
  const desired = TARGET_RULER_TICK_SPACING / Math.max(pixelsPerFrame, 1);
  return RULER_STEPS.find((step) => step >= desired) ?? RULER_STEPS.at(-1) ?? 100;
}
