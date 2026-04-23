import type { ReactNode } from "react";
import type { ToolMode } from "../ui-types";
import type { ViewMode } from "../../types";
import {
  BoxIcon,
  CursorIcon,
  FrameIcon,
  HelpIcon,
  MoveIcon,
  RedoIcon,
  RotateIcon,
  SaveIcon,
  ScaleIcon,
  TimelineIcon,
  UndoIcon,
  ViewRenderedIcon,
  ViewSolidIcon,
} from "./icons";
import { BufferedInput } from "./BufferedInput";

interface SecondaryToolbarProps {
  componentName: string;
  selectedLabel: string;
  nodeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  currentTool: ToolMode;
  viewMode: ViewMode;
  isTimelineVisible: boolean;
  onComponentNameChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToolChange: (mode: ToolMode) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onFrame: () => void;
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
    viewMode,
    isTimelineVisible,
    onComponentNameChange,
    onUndo,
    onRedo,
    onToolChange,
    onViewModeChange,
    onFrame,
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
        <span className="toolbar__context">
          <span className="toolbar__context-label">Selection</span>
          <span className="toolbar__context-value">{selectedLabel}</span>
        </span>
        <span className="toolbar__context">
          <span className="toolbar__context-label">Scene</span>
          <span className="toolbar__context-value">{nodeCount} nodes</span>
        </span>
        {currentTool === "translate" ? <span className="toolbar__chip">Hold Shift to snap</span> : null}
      </div>

      <div className="toolbar__right">
        <div className="tgroup tgroup--view">
          <ToolbarIconButton
            label="Solid View"
            isActive={viewMode === "solid"}
            onClick={() => onViewModeChange("solid")}
          >
            <ViewSolidIcon />
          </ToolbarIconButton>
          <ToolbarIconButton
            label="Rendered View"
            isActive={viewMode === "rendered"}
            onClick={() => onViewModeChange("rendered")}
          >
            <ViewRenderedIcon />
          </ToolbarIconButton>
        </div>

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
