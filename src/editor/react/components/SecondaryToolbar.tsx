import type { ReactNode } from "react";
import type { ToolMode } from "../ui-types";
import type { ViewMode } from "../../types";
import {
  CursorIcon,
  FrameIcon,
  MoveIcon,
  RedoIcon,
  RotateIcon,
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
  } = props;

  return (
    <div className="secondary-toolbar">
      <div className="secondary-toolbar__left">
        <label className="component-name-field">
          <span className="component-name-field__label toolbar-context__label">Component</span>
          <BufferedInput
            className="editor-input editor-input--compact component-name-field__input"
            type="text"
            value={componentName}
            onCommit={onComponentNameChange}
          />
        </label>
      </div>

      <div className="secondary-toolbar__center">
        <div className="toolbar-context">
          <span className="toolbar-context__label">Selection</span>
          <span className="toolbar-context__value">{selectedLabel}</span>
        </div>
        <div className="toolbar-context toolbar-context--compact">
          <span className="toolbar-context__label">Scene</span>
          <span className="toolbar-context__value">{nodeCount} nodes</span>
        </div>
        {currentTool === "translate" ? <div className="toolbar-chip toolbar-chip--hint">Hold Shift to snap</div> : null}
      </div>

      <div className="secondary-toolbar__right">
        <div className="toolbar-icon-group toolbar-icon-group--tools">
          <ToolbarIconButton label="Select (1)" shortcut="1" isActive={currentTool === "select"} onClick={() => onToolChange("select")}>
            <CursorIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Move (2)" shortcut="2" isActive={currentTool === "translate"} onClick={() => onToolChange("translate")}>
            <MoveIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Rotate (3)" shortcut="3" isActive={currentTool === "rotate"} onClick={() => onToolChange("rotate")}>
            <RotateIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Scale (4)" shortcut="4" isActive={currentTool === "scale"} onClick={() => onToolChange("scale")}>
            <ScaleIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Frame Selection (F)" shortcut="F" onClick={onFrame}>
            <FrameIcon />
          </ToolbarIconButton>
        </div>

        <span className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-icon-group toolbar-icon-group--modes">
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

        <span className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-icon-group toolbar-icon-group--toggle">
          <button
            type="button"
            className={`icon-button${isTimelineVisible ? " is-active" : ""}`}
            onClick={onToggleTimeline}
            aria-pressed={isTimelineVisible}
            aria-label={`Timeline ${isTimelineVisible ? "On" : "Off"}`}
            title={`Timeline ${isTimelineVisible ? "On" : "Off"}`}
          >
            <TimelineIcon />
          </button>
        </div>

        <span className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-icon-group toolbar-icon-group--history">
          <ToolbarIconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
            <UndoIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
            <RedoIcon />
          </ToolbarIconButton>
        </div>
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
      className={`icon-button${isActive ? " is-active" : ""}${shortcut ? " icon-button--with-kbd" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
      {shortcut ? <kbd className="icon-button__kbd" aria-hidden="true">{shortcut}</kbd> : null}
    </button>
  );
}
