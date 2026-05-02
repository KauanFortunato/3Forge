import type { ReactNode } from "react";
import type { ToolMode } from "../ui-types";
import type { EditorNodeType, ViewMode } from "../../types";
import {
  BoxIcon,
  CursorIcon,
  CylinderIcon,
  FastForwardIcon,
  FrameIcon,
  GeometryIcon,
  GroupIcon,
  HelpIcon,
  ImageIcon,
  MoveIcon,
  PauseIcon,
  PlayIcon,
  PlaneIcon,
  RedoIcon,
  RewindIcon,
  RotateIcon,
  SaveIcon,
  ScaleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SphereIcon,
  StopIcon,
  TextPropertyIcon,
  TimelineIcon,
  UndoIcon,
  ViewRenderedIcon,
  ViewSolidIcon,
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
  viewMode?: ViewMode;
  isTimelineVisible: boolean;
  playback?: PlaybackToolbarProps | null;
  onComponentNameChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddNode?: (type: Exclude<EditorNodeType, "image">) => void;
  onAddImage?: () => void;
  onGroupSelection?: () => void;
  canGroupSelection?: boolean;
  onToolChange?: (mode: ToolMode) => void;
  onFrameSelection?: () => void;
  onViewModeChange?: (mode: ViewMode) => void;
  onToggleTimeline: () => void;
  onSave?: () => void;
  onShortcuts?: () => void;
  onGenerateWithAI?: () => void;
}

export function SecondaryToolbar(props: SecondaryToolbarProps) {
  const {
    componentName,
    selectedLabel,
    nodeCount,
    canUndo,
    canRedo,
    currentTool,
    viewMode,
    isTimelineVisible,
    playback,
    onComponentNameChange,
    onUndo,
    onRedo,
    onAddNode,
    onAddImage,
    onGroupSelection,
    canGroupSelection = false,
    onToolChange,
    onFrameSelection,
    onViewModeChange,
    onToggleTimeline,
    onSave,
    onShortcuts,
    onGenerateWithAI,
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

        {onToolChange ? (
          <div className="tgroup tgroup--tools" aria-label="Transform tools">
            <ToolbarIconButton
              label="Select (1)"
              isActive={currentTool === "select"}
              onClick={() => onToolChange("select")}
            >
              <CursorIcon />
            </ToolbarIconButton>
            <ToolbarIconButton
              label="Move (2)"
              isActive={currentTool === "translate"}
              onClick={() => onToolChange("translate")}
            >
              <MoveIcon />
            </ToolbarIconButton>
            <ToolbarIconButton
              label="Rotate (3)"
              isActive={currentTool === "rotate"}
              onClick={() => onToolChange("rotate")}
            >
              <RotateIcon />
            </ToolbarIconButton>
            <ToolbarIconButton
              label="Scale (4)"
              isActive={currentTool === "scale"}
              onClick={() => onToolChange("scale")}
            >
              <ScaleIcon />
            </ToolbarIconButton>
            {onFrameSelection ? (
              <ToolbarIconButton label="Frame (F)" onClick={onFrameSelection}>
                <FrameIcon />
              </ToolbarIconButton>
            ) : null}
          </div>
        ) : null}
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
        {onViewModeChange && viewMode ? (
          <div className="tgroup tgroup--shading" aria-label="Viewport shading">
            <ToolbarIconButton
              label="Solid"
              isActive={viewMode === "solid"}
              onClick={() => onViewModeChange("solid")}
            >
              <ViewSolidIcon />
            </ToolbarIconButton>
            <ToolbarIconButton
              label="Rendered"
              isActive={viewMode === "rendered"}
              onClick={() => onViewModeChange("rendered")}
            >
              <ViewRenderedIcon />
            </ToolbarIconButton>
            <ToolbarIconButton
              label="Wireframe (Z)"
              isActive={viewMode === "wireframe"}
              onClick={() => onViewModeChange("wireframe")}
            >
              <GeometryIcon />
            </ToolbarIconButton>
          </div>
        ) : null}

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

        {onGenerateWithAI ? (
          <button
            type="button"
            className="tbtn is-ghost"
            onClick={onGenerateWithAI}
            aria-label="Generate with AI"
            title="Generate with AI"
          >
            <GeometryIcon />
            <span>AI</span>
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
