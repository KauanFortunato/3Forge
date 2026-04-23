import type { ReactNode } from "react";
import type { ToolMode } from "../ui-types";
import type { ViewMode } from "../../types";
import {
  BoxIcon,
  CursorIcon,
  ExportIcon,
  FastForwardIcon,
  FrameIcon,
  HelpIcon,
  MoveIcon,
  PauseIcon,
  PlayIcon,
  RedoIcon,
  RewindIcon,
  RotateIcon,
  SaveIcon,
  ScaleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  StopIcon,
  TimelineIcon,
  UndoIcon,
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
  /**
   * Retained for API stability. View-mode buttons render on the viewport HUD, not in the toolbar.
   */
  viewMode?: ViewMode;
  isTimelineVisible: boolean;
  playback?: PlaybackToolbarProps | null;
  onComponentNameChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToolChange: (mode: ToolMode) => void;
  /** Retained for API stability; toolbar no longer renders view-mode buttons. */
  onViewModeChange?: (mode: ViewMode) => void;
  onFrame: () => void;
  onToggleTimeline: () => void;
  onSave?: () => void;
  onExport?: () => void;
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
    onToolChange,
    onFrame,
    onToggleTimeline,
    onSave,
    onExport,
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
            <span className="proj-chip__label">Component</span>
            <BufferedInput
              className="proj-chip__name"
              type="text"
              value={componentName}
              onCommit={onComponentNameChange}
            />
          </div>
        </div>

        <div className="tgroup tgroup--tools">
          <ToolbarIconButton label="Select" shortcut="Q" isActive={currentTool === "select"} onClick={() => onToolChange("select")}>
            <CursorIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Move" shortcut="W" isActive={currentTool === "translate"} onClick={() => onToolChange("translate")}>
            <MoveIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Rotate" shortcut="E" isActive={currentTool === "rotate"} onClick={() => onToolChange("rotate")}>
            <RotateIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Scale" shortcut="R" isActive={currentTool === "scale"} onClick={() => onToolChange("scale")}>
            <ScaleIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Frame" shortcut="F" onClick={onFrame}>
            <FrameIcon />
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
        <button
          type="button"
          className={`ibtn${isTimelineVisible ? " is-active" : ""}`}
          onClick={onToggleTimeline}
          aria-pressed={isTimelineVisible}
          aria-label={`Timeline ${isTimelineVisible ? "On" : "Off"}`}
          title={`Timeline ${isTimelineVisible ? "On" : "Off"}`}
        >
          <TimelineIcon />
        </button>

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
            className="ibtn"
            onClick={onShortcuts}
            aria-label="Shortcuts (F1)"
            title="Shortcuts (F1)"
          >
            <HelpIcon />
          </button>
        ) : null}

        {onExport ? (
          <button
            type="button"
            className="tbtn is-ghost"
            onClick={onExport}
            aria-label="Export"
            title="Export"
          >
            <ExportIcon />
            <span>Export</span>
          </button>
        ) : null}

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
        className="playbar__btn"
        onClick={onSkipBack}
        aria-label="Skip to start"
        title="Skip to start"
      >
        <SkipBackIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className="playbar__btn"
        onClick={onRewind}
        aria-label="Rewind"
        title="Rewind"
      >
        <RewindIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className={`playbar__btn playbar__btn--primary${isPlaying ? " is-active" : ""}`}
        onClick={onPlayToggle}
        aria-label={isPlaying ? "Pause" : "Play"}
        aria-pressed={isPlaying}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <PauseIcon width={12} height={12} /> : <PlayIcon width={12} height={12} />}
      </button>
      <button
        type="button"
        className="playbar__btn"
        onClick={onStop}
        aria-label="Stop"
        title="Stop"
      >
        <StopIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className="playbar__btn"
        onClick={onFastForward}
        aria-label="Fast forward"
        title="Fast forward"
      >
        <FastForwardIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className="playbar__btn"
        onClick={onSkipForward}
        aria-label="Skip to end"
        title="Skip to end"
      >
        <SkipForwardIcon width={12} height={12} />
      </button>
      <span className="playbar__sep" aria-hidden="true" />
      <span className="playbar__counter" aria-label="Current frame">
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
