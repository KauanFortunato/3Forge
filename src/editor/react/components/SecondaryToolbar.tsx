import type { ReactNode } from "react";
import type { ToolMode } from "../ui-types";
import type { EditorNodeType } from "../../types";
import {
  BoxIcon,
  FastForwardIcon,
  GroupIcon,
  HelpIcon,
  ImageIcon,
  PauseIcon,
  PlayIcon,
  PlaneIcon,
  RedoIcon,
  RewindIcon,
  SaveIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SphereIcon,
  StopIcon,
  TextPropertyIcon,
  TimelineIcon,
  UndoIcon,
  CylinderIcon,
  ShortcutIcon,
} from "./icons";
import { BufferedInput } from "./BufferedInput";

export interface PlaybackToolbarProps {
  isPlaying: boolean;
  currentFrame: number;
  durationFrames: number;
  onPlayToggle: () => void;
  onStop: () => void;
  onRewind: () => void;
  onFastForward: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
}

interface SecondaryToolbarProps {
  componentName: string;
  selectedLabel: string;
  nodeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  currentTool: ToolMode;
  isTimelineVisible: boolean;
  playback?: PlaybackToolbarProps | null;
  onComponentNameChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddNode?: (type: Exclude<EditorNodeType, "image">) => void;
  onAddImage?: () => void;
  onGroupSelection?: () => void;
  canGroupSelection?: boolean;
  onToggleTimeline: () => void;
  onSave?: () => void;
  onShortcuts?: () => void;
}

export function SecondaryToolbar(props: SecondaryToolbarProps) {
  const {
    componentName,
    selectedLabel,
    nodeCount,
    canUndo,
    canRedo,
    currentTool,
    isTimelineVisible,
    playback,
    onComponentNameChange,
    onUndo,
    onRedo,
    onAddNode,
    onAddImage,
    onGroupSelection,
    canGroupSelection = false,
    onToggleTimeline,
    onSave,
    onShortcuts,
  } = props;

  return (
    <div className="toolbar">
      <div className="toolbar__left">
        <div className="proj-chip">
          <div className="proj-chip__icon" aria-hidden="true">
            <BoxIcon width={11} height={11} />
          </div>
          <div className="proj-chip__meta">
            <BufferedInput
              className="proj-chip__name"
              type="text"
              value={componentName}
              onCommit={onComponentNameChange}
            />
            <span className="proj-chip__sub">{`blueprint / ${nodeCount} nodes`}</span>
          </div>
        </div>

        <div className="tgroup tgroup--create" aria-label="Create nodes">
          <ToolbarIconButton label="Add Box" onClick={() => onAddNode?.("box")} disabled={!onAddNode}>
            <BoxIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Add Sphere" onClick={() => onAddNode?.("sphere")} disabled={!onAddNode}>
            <SphereIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Add Cylinder" onClick={() => onAddNode?.("cylinder")} disabled={!onAddNode}>
            <CylinderIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Add Plane" onClick={() => onAddNode?.("plane")} disabled={!onAddNode}>
            <PlaneIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Add Text" onClick={() => onAddNode?.("text")} disabled={!onAddNode}>
            <TextPropertyIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Add Image" onClick={() => onAddImage?.()} disabled={!onAddImage}>
            <ImageIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Group" onClick={() => onGroupSelection?.()} disabled={!onGroupSelection || !canGroupSelection}>
            <GroupIcon />
          </ToolbarIconButton>
        </div>
      </div>

      <div className="toolbar__center">
        {playback ? (
          <PlaybarGroup {...playback} />
        ) : (
          <>
            <span className="toolbar__context">
              <span className="toolbar__context-label">Selection</span>
              <span className="toolbar__context-value">{selectedLabel}</span>
            </span>
            <span className="toolbar__context">
              <span className="toolbar__context-label">Scene</span>
              <span className="toolbar__context-value">{nodeCount} nodes</span>
            </span>
            {currentTool === "translate" ? <span className="toolbar__chip">Hold Shift to snap</span> : null}
          </>
        )}
      </div>

      <div className="toolbar__right">
        <div className="tgroup tgroup--history">
          <ToolbarIconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
            <UndoIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
            <RedoIcon />
          </ToolbarIconButton>
        </div>

        {onShortcuts ? (
          <button
            type="button"
            className="tbtn is-ghost"
            onClick={onShortcuts}
            aria-label="Shortcuts (F1)"
            title="Shortcuts (F1)"
          >
            <ShortcutIcon />
            <span>Shortcuts</span>
          </button>
        ) : null}

        <button
          type="button"
          className={`tbtn is-ghost${isTimelineVisible ? " is-active" : ""}`}
          onClick={onToggleTimeline}
          aria-pressed={isTimelineVisible}
          aria-label={`Timeline ${isTimelineVisible ? "On" : "Off"}`}
          title={`Timeline ${isTimelineVisible ? "On" : "Off"}`}
        >
          <TimelineIcon />
          <span>Timeline</span>
        </button>

        {onSave ? (
          <button
            type="button"
            className="tbtn is-primary"
            onClick={onSave}
            aria-label="Save (Ctrl+S)"
            title="Save (Ctrl+S)"
          >
            <SaveIcon />
            <span>Save</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PlaybarGroup(props: PlaybackToolbarProps) {
  const {
    isPlaying,
    currentFrame,
    durationFrames,
    onPlayToggle,
    onStop,
    onRewind,
    onFastForward,
    onSkipBack,
    onSkipForward,
  } = props;

  return (
    <div className="playbar" role="group" aria-label="Playback controls">
      <button
        type="button"
        className="ibtn"
        onClick={onSkipBack}
        aria-label="Skip to start"
        title="Skip to start"
      >
        <SkipBackIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className="ibtn"
        onClick={onRewind}
        aria-label="Rewind"
        title="Rewind"
      >
        <RewindIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className={`ibtn${isPlaying ? " is-active" : ""}`}
        onClick={onPlayToggle}
        aria-label={isPlaying ? "Pause" : "Play"}
        aria-pressed={isPlaying}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <PauseIcon width={12} height={12} /> : <PlayIcon width={12} height={12} />}
      </button>
      <button
        type="button"
        className="ibtn playbar__btn--danger"
        onClick={onStop}
        aria-label="Stop"
        title="Stop"
      >
        <StopIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className="ibtn"
        onClick={onFastForward}
        aria-label="Fast forward"
        title="Fast forward"
      >
        <FastForwardIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className="ibtn"
        onClick={onSkipForward}
        aria-label="Skip to end"
        title="Skip to end"
      >
        <SkipForwardIcon width={12} height={12} />
      </button>
      <span className="playbar__sep" aria-hidden="true" />
      <span className="playbar__frame" aria-label="Current frame">
        <strong>{String(currentFrame).padStart(3, "0")}</strong>
        <span className="playbar__counter-sep">/</span>
        <span>{String(durationFrames).padStart(3, "0")}</span>
      </span>
    </div>
  );
}

interface ToolbarIconButtonProps {
  label: string;
  disabled?: boolean;
  isActive?: boolean;
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarIconButton({ label, disabled, isActive, shortcut, onClick, children }: ToolbarIconButtonProps) {
  return (
    <button
      type="button"
      className={`ibtn${isActive ? " is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      data-kbd={shortcut}
    >
      {children}
    </button>
  );
}
