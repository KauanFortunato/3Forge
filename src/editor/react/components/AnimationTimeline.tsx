import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ANIMATION_EASE_OPTIONS,
  ANIMATION_PROPERTIES,
  getAnimationPropertyLabel,
} from "../../animation";
import type {
  AnimationEasePreset,
  AnimationKeyframe,
  AnimationPropertyPath,
  AnimationTrack,
  ComponentAnimation,
  EditorNode,
} from "../../types";

const FRAME_WIDTH = 14;
const ACTIONS_WIDTH = 126;
const ACTIONS_GAP = 12;

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
  onAnimationConfigChange: (patch: Partial<Pick<ComponentAnimation, "fps" | "durationFrames">>) => void;
  onAddTrack: (property: AnimationPropertyPath) => void;
  onRemoveTrack: (trackId: string) => void;
  onAddKeyframe: (trackId: string) => void;
  onSelectTrack: (trackId: string | null) => void;
  onSelectKeyframe: (trackId: string, keyframeId: string | null) => void;
  onUpdateKeyframe: (trackId: string, keyframeId: string, patch: Partial<Pick<AnimationKeyframe, "frame" | "value" | "ease">>) => void;
  onRemoveKeyframe: (trackId: string, keyframeId: string) => void;
  onBeginKeyframeDrag: () => void;
  onEndKeyframeDrag: () => void;
}

interface DragState {
  trackId: string;
  keyframeId: string;
  laneLeft: number;
}

interface ScrubState {
  laneLeft: number;
}

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
    onAddTrack,
    onRemoveTrack,
    onAddKeyframe,
    onSelectTrack,
    onSelectKeyframe,
    onUpdateKeyframe,
    onRemoveKeyframe,
    onBeginKeyframeDrag,
    onEndKeyframeDrag,
  } = props;

  const [propertyToAdd, setPropertyToAdd] = useState<AnimationPropertyPath>("transform.position.x");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [scrubState, setScrubState] = useState<ScrubState | null>(null);
  const leftBodyRef = useRef<HTMLDivElement | null>(null);
  const rulerScrollRef = useRef<HTMLDivElement | null>(null);
  const rightBodyRef = useRef<HTMLDivElement | null>(null);

  const groupedTracks = useMemo(() => groupTracksByNode(animation.tracks, nodes), [animation.tracks, nodes]);
  const selectedTrack = animation.tracks.find((track) => track.id === selectedTrackId) ?? null;
  const selectedKeyframe = selectedTrack?.keyframes.find((keyframe) => keyframe.id === selectedKeyframeId) ?? null;
  const selectedNodeLabel = selectedNode ? `${selectedNode.name} · ${selectedNode.type}` : "No node selected";
  const takenProperties = new Set(
    selectedNode ? animation.tracks.filter((track) => track.nodeId === selectedNode.id).map((track) => track.property) : [],
  );
  const availableProperties = ANIMATION_PROPERTIES.filter((entry) => !takenProperties.has(entry.path));
  const timelineWidth = Math.max(animation.durationFrames, 1) * FRAME_WIDTH;
  const visibleTracks = useMemo(
    () => (selectedNode ? animation.tracks.filter((track) => track.nodeId === selectedNode.id) : []),
    [animation.tracks, selectedNode],
  );
  const visibleGroupedTracks = useMemo(() => groupTracksByNode(visibleTracks, nodes), [nodes, visibleTracks]);
  const visibleTrackCount = visibleTracks.length;
  const visibleSelectedTrack = visibleTracks.find((track) => track.id === selectedTrackId) ?? null;
  const visibleSelectedKeyframe = visibleSelectedTrack?.keyframes.find((keyframe) => keyframe.id === selectedKeyframeId) ?? null;
  const selectedObjectLabel = selectedNode ? `${selectedNode.name} | ${selectedNode.type}` : "No object selected";

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
      const frame = positionToFrame(event.clientX, dragState.laneLeft, animation.durationFrames);
      onUpdateKeyframe(dragState.trackId, dragState.keyframeId, { frame });
      onFrameChange(frame);
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
  }, [animation.durationFrames, dragState, onEndKeyframeDrag, onFrameChange, onUpdateKeyframe]);

  useEffect(() => {
    if (!scrubState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      onFrameChange(positionToFrame(event.clientX, scrubState.laneLeft, animation.durationFrames));
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
  }, [animation.durationFrames, onFrameChange, scrubState]);

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
  }, [visibleGroupedTracks.length]);

  useEffect(() => {
    const leftBody = leftBodyRef.current;
    const rightBody = rightBodyRef.current;
    if (!leftBody || !rightBody) {
      return;
    }

    leftBody.scrollTop = 0;
    rightBody.scrollTop = 0;
  }, [selectedNode?.id]);

  return (
    <section className="animation-panel">
      <div className="animation-panel__header">
        <div className="animation-toolbar animation-toolbar--left">
          <div className="button-row">
            <button type="button" className={`tool-button tool-button--icon${isPlaying ? " is-active" : ""}`} onClick={onPlayToggle}>
              <span>{isPlaying ? "Pause" : "Play"}</span>
            </button>
            <button type="button" className="tool-button tool-button--icon" onClick={onStop}>
              <span>Stop</span>
            </button>
          </div>

          <div className="animation-toolbar__stats">
            <label className="field-inline">
              <span>Frame</span>
              <input
                className="editor-input editor-input--compact"
                type="number"
                min={0}
                max={animation.durationFrames}
                value={currentFrame}
                onChange={(event) => onFrameChange(Number(event.target.value))}
              />
            </label>
            <label className="field-inline">
              <span>FPS</span>
              <input
                className="editor-input editor-input--compact"
                type="number"
                min={1}
                value={animation.fps}
                onChange={(event) => onAnimationConfigChange({ fps: Number(event.target.value) })}
              />
            </label>
            <label className="field-inline">
              <span>End</span>
              <input
                className="editor-input editor-input--compact"
                type="number"
                min={1}
                value={animation.durationFrames}
                onChange={(event) => onAnimationConfigChange({ durationFrames: Number(event.target.value) })}
              />
            </label>
          </div>
        </div>

        <div className="animation-toolbar animation-toolbar--right">
          <div className="toolbar-chip animation-toolbar__selection">{selectedObjectLabel}</div>
          <select
            className="editor-select animation-toolbar__select"
            value={propertyToAdd}
            onChange={(event) => setPropertyToAdd(event.target.value as AnimationPropertyPath)}
            disabled={!selectedNode || availableProperties.length === 0}
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
          {visibleSelectedTrack && visibleSelectedKeyframe ? (
            <div className="animation-keyframe-editor">
              <div className="toolbar-chip">{getAnimationPropertyLabel(visibleSelectedTrack.property)}</div>
              <label className="field-inline">
                <span>F</span>
                <input
                  className="editor-input editor-input--compact"
                  type="number"
                  min={0}
                  max={animation.durationFrames}
                  value={visibleSelectedKeyframe.frame}
                  onChange={(event) => onUpdateKeyframe(visibleSelectedTrack.id, visibleSelectedKeyframe.id, { frame: Number(event.target.value) })}
                />
              </label>
              <label className="field-inline">
                <span>Val</span>
                <input
                  className="editor-input editor-input--compact"
                  type="number"
                  step={visibleSelectedTrack.property.includes("rotation") ? 1 : 0.1}
                  value={displayValueForInput(visibleSelectedTrack.property, visibleSelectedKeyframe.value)}
                  onChange={(event) => onUpdateKeyframe(visibleSelectedTrack.id, visibleSelectedKeyframe.id, { value: parseValueFromInput(visibleSelectedTrack.property, Number(event.target.value)) })}
                />
              </label>
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
            </div>
          ) : (
            <div className="toolbar-chip animation-toolbar__count is-muted">
              {selectedNode ? `${visibleTrackCount} channels` : "Select an object"}
            </div>
          )}
        </div>
      </div>

      <div className="animation-dope-sheet">
        <div className="animation-dope-sheet__left">
          <div className="animation-dope-sheet__left-header">Channels</div>
          <div ref={leftBodyRef} className="animation-dope-sheet__left-body">
            {visibleGroupedTracks.length > 0 ? visibleGroupedTracks.map(({ node, tracks }) => (
              <div key={node.id} className={`animation-node${selectedNode?.id === node.id ? " is-selected" : ""}`}>
                <div className="animation-node__header">
                  <div className="animation-node__title">{node.name}</div>
                  <div className="animation-node__meta">{node.type}</div>
                </div>

                <div className="animation-node__channels">
                  {tracks.map((track) => (
                    <div
                      key={track.id}
                      className={`animation-channel${selectedTrackId === track.id ? " is-selected" : ""}`}
                      onClick={() => onSelectTrack(track.id)}
                    >
                      <span className="animation-channel__label">{getAnimationPropertyLabel(track.property)}</span>
                      <span className="animation-channel__count">{track.keyframes.length}</span>
                    </div>
                  ))}
                </div>
              </div>
            )) : (
              <div className="panel-empty">
                {selectedNode ? "Add channels for the selected object to start animating." : "Select an object to inspect its channels."}
              </div>
            )}
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
                  onFrameChange(positionToFrame(event.clientX, laneLeft, animation.durationFrames));
                  setScrubState({ laneLeft });
                }}
              >
                {Array.from({ length: animation.durationFrames + 1 }, (_, frame) => (
                  <div
                    key={frame}
                    className={`animation-ruler__tick${frame % 10 === 0 ? " is-major" : ""}`}
                    style={{ left: frame * FRAME_WIDTH }}
                  >
                    {frame % 10 === 0 ? <span>{frame}</span> : null}
                  </div>
                ))}
                <div className="animation-playhead" style={{ left: currentFrame * FRAME_WIDTH }} />
              </div>
              <div className="animation-ruler-row__actions-spacer" aria-hidden="true" />
            </div>
          </div>

          <div ref={rightBodyRef} className="animation-dope-sheet__right-body">
            <div className="animation-dope-sheet__rows">
              {visibleGroupedTracks.length > 0 ? visibleGroupedTracks.map(({ node, tracks }) => (
              <div key={node.id} className="animation-row-group">
                <div className="animation-row-group__spacer" style={{ width: timelineWidth + ACTIONS_GAP + ACTIONS_WIDTH }}>
                  <div
                    className="animation-row-group__spacer-track"
                    style={{ width: timelineWidth }}
                    onPointerDown={(event) => {
                      const laneLeft = event.currentTarget.getBoundingClientRect().left;
                      onFrameChange(positionToFrame(event.clientX, laneLeft, animation.durationFrames));
                      setScrubState({ laneLeft });
                    }}
                  />
                  <div className="animation-row-group__spacer-actions" aria-hidden="true" />
                </div>
                {tracks.map((track) => (
                  <TrackLane
                    key={track.id}
                    track={track}
                    durationFrames={animation.durationFrames}
                    currentFrame={currentFrame}
                    timelineWidth={timelineWidth}
                    isSelected={selectedTrackId === track.id}
                    selectedKeyframeId={selectedTrackId === track.id ? selectedKeyframeId : null}
                    onAddKeyframe={() => onAddKeyframe(track.id)}
                    onRemoveTrack={() => onRemoveTrack(track.id)}
                    onSelectTrack={() => onSelectTrack(track.id)}
                    onSelectKeyframe={(keyframeId) => onSelectKeyframe(track.id, keyframeId)}
                    onFrameChange={onFrameChange}
                    onScrubStart={(laneLeft) => setScrubState({ laneLeft })}
                    onStartKeyframeDrag={(event, keyframeId) => {
                      onBeginKeyframeDrag();
                      setDragState({
                        trackId: track.id,
                        keyframeId,
                        laneLeft: event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0,
                      });
                    }}
                  />
                ))}
              </div>
            )) : (
                <div className="panel-empty animation-panel-empty-wide">
                  {selectedNode
                    ? "Add transform channels for the selected object and keyframe directly in the dope sheet."
                    : "Select an object to view and edit its animation channels."}
                </div>
              )}
            </div>
          </div>
        </div>
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
  selectedKeyframeId: string | null;
  onAddKeyframe: () => void;
  onRemoveTrack: () => void;
  onSelectTrack: () => void;
  onSelectKeyframe: (keyframeId: string) => void;
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
    selectedKeyframeId,
    onAddKeyframe,
    onRemoveTrack,
    onSelectTrack,
    onSelectKeyframe,
    onFrameChange,
    onScrubStart,
    onStartKeyframeDrag,
  } = props;

  return (
    <div className={`animation-lane${isSelected ? " is-selected" : ""}`} style={{ width: timelineWidth + ACTIONS_GAP + ACTIONS_WIDTH }}>
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
        <div className="animation-lane__current-frame" style={{ left: currentFrame * FRAME_WIDTH }} />
        {track.keyframes.map((keyframe) => (
          <button
            key={keyframe.id}
            type="button"
            className={`animation-keyframe${selectedKeyframeId === keyframe.id ? " is-selected" : ""}${currentFrame === keyframe.frame ? " is-current" : ""}`}
            style={{ left: keyframe.frame * FRAME_WIDTH }}
            onClick={(event) => {
              event.stopPropagation();
              onSelectTrack();
              onSelectKeyframe(keyframe.id);
              onFrameChange(keyframe.frame);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelectTrack();
              onSelectKeyframe(keyframe.id);
              onStartKeyframeDrag(event, keyframe.id);
            }}
            title={`${keyframe.frame}f`}
          />
        ))}
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
        >
          <span>+ Key</span>
        </button>
        <button
          type="button"
          className="tool-button tool-button--icon animation-lane__action-button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => onRemoveTrack()}
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

function positionToFrame(clientX: number, laneLeft: number, durationFrames: number): number {
  const relative = clientX - laneLeft;
  return Math.max(0, Math.min(durationFrames, Math.round(relative / FRAME_WIDTH)));
}

function displayValueForInput(property: AnimationPropertyPath, value: number): number {
  if (property.includes("rotation")) {
    return Number(((value * 180) / Math.PI).toFixed(2));
  }

  return Number(value.toFixed(3));
}

function parseValueFromInput(property: AnimationPropertyPath, value: number): number {
  if (!Number.isFinite(value)) {
    return property.includes("scale") ? 1 : 0;
  }

  if (property.includes("rotation")) {
    return Number(((value * Math.PI) / 180).toFixed(6));
  }

  return value;
}
