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
  UndoIcon,
  ViewRenderedIcon,
  ViewSolidIcon,
} from "./icons";

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
          <span className="component-name-field__label">Component</span>
          <input
            className="editor-input editor-input--compact component-name-field__input"
            type="text"
            value={componentName}
            onChange={(event) => onComponentNameChange(event.target.value)}
          />
        </label>
      </div>

      <div className="secondary-toolbar__center">
        <div className="toolbar-chip">{selectedLabel}</div>
        <div className="toolbar-chip is-muted">{nodeCount} nodes</div>
      </div>

      <div className="secondary-toolbar__right">
        <div className="toolbar-icon-group">
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

        <div className="toolbar-icon-group">
          <ToolbarIconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
            <UndoIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
            <RedoIcon />
          </ToolbarIconButton>
        </div>

        <div className="toolbar-icon-group">
          <button
            type="button"
            className={`tool-button tool-button--label${isTimelineVisible ? " is-active" : ""}`}
            onClick={onToggleTimeline}
          >
            Timeline
          </button>
        </div>

        <div className="toolbar-icon-group">
          <ToolbarIconButton label="Select (1)" isActive={currentTool === "select"} onClick={() => onToolChange("select")}>
            <CursorIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Move (2)" isActive={currentTool === "translate"} onClick={() => onToolChange("translate")}>
            <MoveIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Rotate (3)" isActive={currentTool === "rotate"} onClick={() => onToolChange("rotate")}>
            <RotateIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Scale (4)" isActive={currentTool === "scale"} onClick={() => onToolChange("scale")}>
            <ScaleIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Frame (F)" onClick={onFrame}>
            <FrameIcon />
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
  onClick: () => void;
  children: ReactNode;
}

function ToolbarIconButton({ label, disabled, isActive, onClick, children }: ToolbarIconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button${isActive ? " is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
