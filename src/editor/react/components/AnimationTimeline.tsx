import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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

const FRAME_WIDTH = 13;
const ACTIONS_WIDTH = 104;
const ACTIONS_GAP = 8;
const TIMELINE_INSET = 1;

interface AnimationTimelineProps {
  animation: ComponentAnimation;
  nodes: EditorNode[];
  selectedNode: EditorNode | undefined;
  currentFrame: number;
  isPlaying: boolean;
  selectedTrackId: string | null;
  selectedKeyframeId: string | null;
  onPlayToggle: () => void;
  onStop: () => void;
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
  originFrame: number;
  batchKeyframeIds: string[];
  batchOriginFrames: Map<string, number>;
  lastDelta: number;
}

interface ScrubState {
  laneLeft: number;
}

type TimelineViewMode = "selected" | "all";

export function AnimationTimeline(props: AnimationTimelineProps) {
  const {
    animation,
    nodes,
    selectedNode,
    currentFrame,
    isPlaying,
    selectedTrackId,
    selectedKeyframeId,
    onPlayToggle,
    onStop,
    onFrameChange,
    onAnimationConfigChange,
    onCreateClip,
    onSelectClip,
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
  const leftBodyRef = useRef<HTMLDivElement | null>(null);
  const rulerScrollRef = useRef<HTMLDivElement | null>(null);
  const rightBodyRef = useRef<HTMLDivElement | null>(null);

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
  const timelineWidth = Math.max(activeClip?.durationFrames ?? 1, 1) * FRAME_WIDTH + (TIMELINE_INSET * 2);
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
  const visibleTrackSummary = viewMode === "all"
    ? `${visibleTrackCount} channels`
    : (selectedNode ? `${visibleTrackCount} channels` : "Select an object");
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
      const frame = positionToFrame(event.clientX, dragState.laneLeft, activeClip?.durationFrames ?? 1);
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
      onFrameChange(positionToFrame(event.clientX, scrubState.laneLeft, activeClip?.durationFrames ?? 1));
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
    const leftBody = leftBodyRef.current;
    const rulerScroll = rulerScrollRef.current;
    const rightBody = rightBodyRef.current;
    if (!leftBody || !rulerScroll || !rightBody) {
      return;
    }

    let syncingLeftTop = false;
    let syncingRightTop = false;
    let syncingRulerLeft = false;
    let syncingRightLeft = false;

    const handleLeftScroll = () => {
      if (syncingLeftTop) {
        syncingLeftTop = false;
        return;
      }

      syncingRightTop = true;
      rightBody.scrollTop = leftBody.scrollTop;
    };

    const handleRulerScroll = () => {
      if (syncingRulerLeft) {
        syncingRulerLeft = false;
        return;
      }

      syncingRightLeft = true;
      rightBody.scrollLeft = rulerScroll.scrollLeft;
    };

    const handleRightScroll = () => {
      if (syncingRightTop) {
        syncingRightTop = false;
      } else {
        syncingLeftTop = true;
        leftBody.scrollTop = rightBody.scrollTop;
      }

      if (syncingRightLeft) {
        syncingRightLeft = false;
      } else {
        syncingRulerLeft = true;
        rulerScroll.scrollLeft = rightBody.scrollLeft;
      }
    };

    leftBody.addEventListener("scroll", handleLeftScroll);
    rulerScroll.addEventListener("scroll", handleRulerScroll);
    rightBody.addEventListener("scroll", handleRightScroll);

    leftBody.scrollTop = rightBody.scrollTop;
    rulerScroll.scrollLeft = rightBody.scrollLeft;

    return () => {
      leftBody.removeEventListener("scroll", handleLeftScroll);
      rulerScroll.removeEventListener("scroll", handleRulerScroll);
      rightBody.removeEventListener("scroll", handleRightScroll);
    };
  }, [viewMode, visibleGroupedTracks.length]);

  useEffect(() => {
    const leftBody = leftBodyRef.current;
    const rightBody = rightBodyRef.current;
    if (!leftBody || !rightBody) {
      return;
    }

    leftBody.scrollTop = 0;
    rightBody.scrollTop = 0;
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

  return (
    <section className="animation-panel">
      <div className="animation-panel__header">
        <div className="animation-panel__toolbar">
          <div className="animation-toolbar animation-toolbar--left">
            <div className="animation-toolbar__group animation-toolbar__group--clip">
              <select
                className="editor-select animation-toolbar__select"
                value={activeClip?.id ?? ""}
                onChange={(event) => onSelectClip(event.target.value)}
                aria-label="Animation clip"
              >
                {animation.clips.map((clip) => (
                  <option key={clip.id} value={clip.id}>{clip.name}</option>
                ))}
              </select>
              <button type="button" className="tool-button tool-button--icon" onClick={onCreateClip}>
                <span>New Clip</span>
              </button>
              {activeClip ? (
                <button
                  type="button"
                  className="tool-button tool-button--icon"
                  onClick={() => onDuplicateClip(activeClip.id)}
                >
                  <span>Duplicate</span>
                </button>
              ) : null}
              {activeClip && animation.clips.length > 1 ? (
                <button type="button" className="tool-button tool-button--icon" onClick={() => onRemoveClip(activeClip.id)}>
                  <span>Delete Clip</span>
                </button>
              ) : null}
            </div>

            {activeClip ? (
              <div className="animation-toolbar__group animation-toolbar__group--name">
                <label className="field-inline animation-toolbar__field animation-toolbar__field--name">
                  <span>Name</span>
                  <BufferedInput
                    className="editor-input editor-input--compact animation-toolbar__name-input"
                    type="text"
                    value={activeClip.name}
                    onCommit={(value) => onRenameClip(activeClip.id, value)}
                  />
                </label>
              </div>
            ) : null}

            <div className="animation-toolbar__group animation-toolbar__group--transport">
              <div className="button-row">
                <button type="button" className={`tool-button tool-button--icon${isPlaying ? " is-active" : ""}`} onClick={onPlayToggle}>
                  <span>{isPlaying ? "Pause" : "Play"}</span>
                </button>
                <button type="button" className="tool-button tool-button--icon" onClick={onStop}>
                  <span>Stop</span>
                </button>
              </div>

              <div className="animation-toolbar__stats">
                <label className="field-inline animation-toolbar__field">
                  <span>Frame</span>
                  <BufferedInput
                    className="editor-input editor-input--compact"
                    type="text"
                    inputMode="numeric"
                    value={String(currentFrame)}
                    onCommit={(value) => onFrameChange(Number(value))}
                  />
                </label>
                <label className="field-inline animation-toolbar__field">
                  <span>FPS</span>
                  <BufferedInput
                    className="editor-input editor-input--compact"
                    type="text"
                    inputMode="numeric"
                    value={String(activeClip?.fps ?? 24)}
                    onCommit={(value) => onAnimationConfigChange({ fps: Number(value) })}
                  />
                </label>
                <label className="field-inline animation-toolbar__field">
                  <span>End</span>
                  <BufferedInput
                    className="editor-input editor-input--compact"
                    type="text"
                    inputMode="numeric"
                    value={String(activeClip?.durationFrames ?? 1)}
                    onCommit={(value) => onAnimationConfigChange({ durationFrames: Number(value) })}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="animation-toolbar animation-toolbar--right">
            <div className="animation-toolbar__group animation-toolbar__group--scope">
              <div className="segmented-control animation-toolbar__view-toggle" aria-label="Timeline view">
                <button
                  type="button"
                  className={`segmented-control__button${viewMode === "selected" ? " is-active" : ""}`}
                  aria-pressed={viewMode === "selected"}
                  onClick={() => setViewMode("selected")}
                >
                  Selected object
                </button>
                <button
                  type="button"
                  className={`segmented-control__button${viewMode === "all" ? " is-active" : ""}`}
                  aria-pressed={viewMode === "all"}
                  onClick={() => setViewMode("all")}
                >
                  All keyframes
                </button>
              </div>
            </div>

            <div className="animation-toolbar__group animation-toolbar__group--channel">
              <select
                className="editor-select animation-toolbar__select"
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
              <button
                type="button"
                className="tool-button tool-button--icon animation-toolbar__add"
                disabled={!selectedNode || availableProperties.length === 0}
                onClick={() => onAddTrack(propertyToAdd)}
              >
                <span>Add Channel</span>
              </button>
              <div className="toolbar-chip animation-toolbar__count is-muted">
                {visibleTrackSummary}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="animation-dope-sheet">
        <div className="animation-dope-sheet__left">
          <div className="animation-dope-sheet__left-header">
            <div className="animation-pane-heading">
              <span className="animation-pane-heading__title">Channels</span>
            </div>
            <div className="toolbar-chip animation-pane-heading__chip">{visibleTrackCount}</div>
          </div>
          <div ref={leftBodyRef} className="animation-dope-sheet__left-body">
            <div className="animation-dope-sheet__left-inner">
              {visibleGroupedTracks.length > 0 ? visibleGroupedTracks.map(({ node, tracks }) => (
                <div key={node.id} className={`animation-node${selectedNode?.id === node.id ? " is-selected" : ""}`}>
                  <div className="animation-node__header">
                    <div className="animation-node__header-main">
                      <div className="animation-node__title">{node.name}</div>
                      <div className="animation-node__meta">{node.type}</div>
                    </div>
                    <div className="animation-node__badge">{tracks.length} ch</div>
                  </div>

                  <div className="animation-node__channels">
                    {tracks.map((track) => {
                      const muted = isTrackMuted(track);
                      return (
                        <div
                          key={track.id}
                          role="button"
                          tabIndex={0}
                          className={`animation-channel${selectedTrackId === track.id ? " is-selected" : ""}${muted ? " is-muted" : ""}`}
                          onClick={() => onSelectTrack(track.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectTrack(track.id);
                            }
                          }}
                        >
                          <span className="animation-channel__content">
                            <span className="animation-channel__label">{getAnimationPropertyLabel(track.property)}</span>
                            <span className="animation-channel__meta">{getTrackCategoryLabel(track.property)}</span>
                            {activeClip ? (
                              <button
                                type="button"
                                className={`animation-channel__mute${muted ? " is-muted" : ""}`}
                                aria-pressed={muted}
                                aria-label={muted ? "Unmute channel" : "Mute channel"}
                                title={muted ? "Unmute channel" : "Mute channel"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onSetTrackMuted(activeClip.id, track.id, !muted);
                                }}
                              >
                                <span>M</span>
                              </button>
                            ) : null}
                          </span>
                          <span className="animation-channel__count">{track.keyframes.length} keys</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )) : (
                <div className="panel-empty panel-empty--card">
                  <strong className="panel-empty__title">No channels visible</strong>
                  <span className="panel-empty__body">
                    {viewMode === "all"
                      ? "No animated channels in this clip yet."
                      : selectedNode
                        ? "Add channels to the selected object."
                        : "Select an object to inspect its channels."}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="animation-dope-sheet__right">
          <div ref={rulerScrollRef} className="animation-dope-sheet__ruler-scroll">
            <div className="animation-ruler-row" style={{ width: timelineWidth + ACTIONS_GAP + ACTIONS_WIDTH }}>
              <div
                className="animation-ruler"
                style={{ width: timelineWidth }}
                onPointerDown={(event) => {
                  const laneLeft = event.currentTarget.getBoundingClientRect().left;
                  onFrameChange(positionToFrame(event.clientX, laneLeft, activeClip?.durationFrames ?? 1));
                  setScrubState({ laneLeft });
                }}
              >
                {Array.from({ length: (activeClip?.durationFrames ?? 1) + 1 }, (_, frame) => (
                  <div
                    key={frame}
                    className={`animation-ruler__tick${frame % 10 === 0 ? " is-major" : ""}`}
                    style={{ left: TIMELINE_INSET + (frame * FRAME_WIDTH) }}
                  >
                    {frame % 10 === 0 ? <span>{frame}</span> : null}
                  </div>
                ))}
                <div className="animation-playhead" style={{ left: TIMELINE_INSET + (currentFrame * FRAME_WIDTH) }} />
              </div>
              <div className="animation-ruler-row__actions-spacer" aria-hidden="true" />
            </div>
          </div>

          <div ref={rightBodyRef} className="animation-dope-sheet__right-body">
            <div className="animation-dope-sheet__rows">
              {visibleGroupedTracks.length > 0 ? visibleGroupedTracks.map(({ node, tracks }) => (
              <div key={node.id} className={`animation-row-group${selectedNode?.id === node.id ? " is-selected" : ""}`}>
                <div className="animation-row-group__spacer" style={{ width: timelineWidth + ACTIONS_GAP + ACTIONS_WIDTH }}>
                  <div
                    className="animation-row-group__spacer-track"
                    style={{ width: timelineWidth }}
                    onPointerDown={(event) => {
                      const laneLeft = event.currentTarget.getBoundingClientRect().left;
                      onFrameChange(positionToFrame(event.clientX, laneLeft, activeClip?.durationFrames ?? 1));
                      setScrubState({ laneLeft });
                    }}
                  >
                    <div className="animation-row-group__spacer-content">
                      <span className="animation-row-group__spacer-title">{node.name}</span>
                    </div>
                  </div>
                  <div className="animation-row-group__spacer-actions" aria-hidden="true" />
                </div>
                {tracks.map((track) => {
                  const trackIsSelected = selectedTrackId === track.id;
                  const selectedKeyframeIdsForTrack = trackIsSelected ? selectedKeyframeIds : null;
                  return (
                    <TrackLane
                      key={track.id}
                      track={track}
                      durationFrames={activeClip?.durationFrames ?? 1}
                      currentFrame={currentFrame}
                      timelineWidth={timelineWidth}
                      isSelected={trackIsSelected}
                      isMuted={isTrackMuted(track)}
                      selectedKeyframeIds={selectedKeyframeIdsForTrack}
                      onAddKeyframe={() => onAddKeyframe(track.id)}
                      onRemoveTrack={() => onRemoveTrack(track.id)}
                      isReadOnly={false}
                      onSelectTrack={() => onSelectTrack(track.id)}
                      onPickKeyframe={(keyframeId, additive) => handleKeyframePick(track.id, keyframeId, additive)}
                      onFrameChange={onFrameChange}
                      onScrubStart={(laneLeft) => setScrubState({ laneLeft })}
                      onStartKeyframeDrag={(event, keyframeId) => {
                        onBeginKeyframeDrag();
                        const laneLeft = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
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
            )) : (
                <div className="panel-empty panel-empty--card animation-panel-empty-wide">
                  <strong className="panel-empty__title">Timeline is empty</strong>
                  <span className="panel-empty__body">
                    {viewMode === "all"
                      ? "Add channels to this clip to see every object and keyframe across the full timeline."
                      : selectedNode
                        ? "Add channels, then click Add key on a lane to start animating."
                        : "Select an object to focus its channels and keyframe them here."}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="animation-dope-sheet__sidebar">
          <div className="animation-dope-sheet__sidebar-header">
            <div className="animation-pane-heading">
              <span className="animation-pane-heading__title">Keyframe</span>
            </div>
          </div>
          <div className="animation-dope-sheet__sidebar-body">
            {visibleSelectedTrack && visibleSelectedKeyframe ? (
              <div className="animation-keyframe-editor animation-keyframe-editor--panel">
                <div className="animation-keyframe-editor__summary">
                  <strong className="animation-keyframe-editor__title">{getAnimationPropertyLabel(visibleSelectedTrack.property)}</strong>
                  <span className="animation-keyframe-editor__meta">
                    {findNodeLabel(nodes, visibleSelectedTrack.nodeId)} · Frame {visibleSelectedKeyframe.frame}
                  </span>
                </div>
                <div className="animation-keyframe-editor__fields">
                  <label className="field-inline">
                    <span>Frame</span>
                    <BufferedInput
                      className="editor-input editor-input--compact"
                      type="text"
                      inputMode="numeric"
                      value={String(visibleSelectedKeyframe.frame)}
                      onCommit={(value) => {
                        const parsed = Number(value);
                        if (!Number.isFinite(parsed)) {
                          return;
                        }
                        const max = activeClip?.durationFrames ?? 0;
                        const clamped = Math.max(0, Math.min(max, Math.round(parsed)));
                        onUpdateKeyframe(visibleSelectedTrack.id, visibleSelectedKeyframe.id, { frame: clamped });
                      }}
                    />
                  </label>
                  <label className="field-inline">
                    <span>Value</span>
                    {isDiscreteAnimationProperty(visibleSelectedTrack.property) ? (
                      <select
                        className="editor-select"
                        value={String(displayValueForInput(visibleSelectedTrack.property, visibleSelectedKeyframe.value))}
                        onChange={(event) =>
                          onUpdateKeyframe(visibleSelectedTrack.id, visibleSelectedKeyframe.id, {
                            value: parseValueFromInput(visibleSelectedTrack.property, Number(event.target.value)),
                          })}
                      >
                        <option value="1">Visible</option>
                        <option value="0">Hidden</option>
                      </select>
                    ) : (
                      <BufferedInput
                        className="editor-input editor-input--compact"
                        type="text"
                        inputMode="decimal"
                        value={String(displayValueForInput(visibleSelectedTrack.property, visibleSelectedKeyframe.value))}
                        onCommit={(value) =>
                          onUpdateKeyframe(visibleSelectedTrack.id, visibleSelectedKeyframe.id, {
                            value: parseValueFromInput(visibleSelectedTrack.property, Number(value)),
                          })}
                      />
                    )}
                  </label>
                </div>
                <label className="field-inline">
                  <span>Ease</span>
                  <select
                    className="editor-select"
                    value={visibleSelectedKeyframe.ease}
                    onChange={(event) => onUpdateKeyframe(visibleSelectedTrack.id, visibleSelectedKeyframe.id, { ease: event.target.value as AnimationEasePreset })}
                  >
                    {ANIMATION_EASE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="tool-button tool-button--icon"
                  onClick={() => onRemoveKeyframe(visibleSelectedTrack.id, visibleSelectedKeyframe.id)}
                >
                  <span>Delete Key</span>
                </button>
              </div>
            ) : (
              <div className="panel-empty panel-empty--card animation-panel-empty-side">
                <strong className="panel-empty__title">Keyframe inspector</strong>
                <span className="panel-empty__body">Select a key diamond in the dope sheet to edit its timing, value and easing.</span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

interface TrackLaneProps {
  track: AnimationTrack;
  durationFrames: number;
  currentFrame: number;
  timelineWidth: number;
  isSelected: boolean;
  isMuted: boolean;
  isReadOnly: boolean;
  selectedKeyframeIds: Set<string> | null;
  onAddKeyframe: () => void;
  onRemoveTrack: () => void;
  onSelectTrack: () => void;
  onPickKeyframe: (keyframeId: string, additive: boolean) => void;
  onFrameChange: (frame: number) => void;
  onScrubStart: (laneLeft: number) => void;
  onStartKeyframeDrag: (event: ReactPointerEvent<HTMLButtonElement>, keyframeId: string) => void;
}

function TrackLane(props: TrackLaneProps) {
  const {
    track,
    durationFrames,
    currentFrame,
    timelineWidth,
    isSelected,
    isMuted,
    isReadOnly,
    selectedKeyframeIds,
    onAddKeyframe,
    onRemoveTrack,
    onSelectTrack,
    onPickKeyframe,
    onFrameChange,
    onScrubStart,
    onStartKeyframeDrag,
  } = props;

  return (
    <div
      className={`animation-lane${isSelected ? " is-selected" : ""}${isMuted ? " is-muted" : ""}`}
      style={{ width: timelineWidth + ACTIONS_GAP + ACTIONS_WIDTH }}
    >
      <div
        className="animation-lane__track"
        style={{ width: timelineWidth }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          const laneLeft = event.currentTarget.getBoundingClientRect().left;
          onSelectTrack();
          onFrameChange(positionToFrame(event.clientX, laneLeft, durationFrames));
          onScrubStart(laneLeft);
        }}
      >
        <div className="animation-lane__current-frame" style={{ left: TIMELINE_INSET + (currentFrame * FRAME_WIDTH) }} />
        {track.keyframes.map((keyframe) => {
          const isKeyframeSelected = selectedKeyframeIds?.has(keyframe.id) ?? false;
          return (
            <button
              key={keyframe.id}
              type="button"
              className={`animation-keyframe${isKeyframeSelected ? " is-selected" : ""}${currentFrame === keyframe.frame ? " is-current" : ""}`}
              style={{ left: TIMELINE_INSET + (keyframe.frame * FRAME_WIDTH) }}
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
                if (isReadOnly) {
                  return;
                }
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
            />
          );
        })}
      </div>

      <div className="animation-lane__actions">
        <button
          type="button"
          className="tool-button tool-button--icon animation-lane__action-button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => onAddKeyframe()}
          disabled={isReadOnly}
        >
          <span>Add key</span>
        </button>
        <button
          type="button"
          className="tool-button tool-button--icon animation-lane__action-button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => onRemoveTrack()}
          disabled={isReadOnly}
        >
          <span>Remove</span>
        </button>
      </div>
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

function positionToFrame(clientX: number, laneLeft: number, durationFrames: number): number {
  const relative = clientX - laneLeft - TIMELINE_INSET;
  return Math.max(0, Math.min(durationFrames, Math.round(relative / FRAME_WIDTH)));
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
