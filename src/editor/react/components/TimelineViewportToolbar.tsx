import type { ReactNode } from "react";
import type { SceneMode } from "../../types";
import type { ToolMode } from "../ui-types";
import {
  CursorIcon,
  MoveIcon,
  RotateIcon,
  ScaleIcon,
} from "./icons";

interface TimelineViewportToolbarProps {
  currentTool: ToolMode;
  sceneMode: SceneMode;
  showGridOverlay: boolean;
  showSafeArea: boolean;
  backgroundColor: string;
  onToolChange: (mode: ToolMode) => void;
  onToggleGridOverlay: () => void;
  onToggleSafeArea: () => void;
  onBackgroundColorChange: (value: string) => void;
}

export function TimelineViewportToolbar({
  currentTool,
  sceneMode,
  showGridOverlay,
  showSafeArea,
  backgroundColor,
  onToolChange,
  onToggleGridOverlay,
  onToggleSafeArea,
  onBackgroundColorChange,
}: TimelineViewportToolbarProps) {
  const is2dMode = sceneMode === "2d";

  return (
    <div className="timeline-toolbar" aria-label="Timeline viewport toolbar">
      <div className="timeline-toolbar__left">
        <div className="timeline-toolbar__group" aria-label="Transform tools">
          <ToolbarButton
            label="Select"
            isActive={currentTool === "select"}
            onClick={() => onToolChange("select")}
          >
            <CursorIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Move"
            isActive={currentTool === "translate"}
            onClick={() => onToolChange("translate")}
          >
            <MoveIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Rotate"
            isActive={currentTool === "rotate"}
            onClick={() => onToolChange("rotate")}
          >
            <RotateIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Scale"
            isActive={currentTool === "scale"}
            onClick={() => onToolChange("scale")}
          >
            <ScaleIcon />
          </ToolbarButton>
        </div>

        {is2dMode ? (
          <div className="timeline-toolbar__group" aria-label="2D overlays">
            <ToolbarButton
              label="Show grid overlay"
              isActive={showGridOverlay}
              onClick={onToggleGridOverlay}
            >
              <GridOverlayIcon />
            </ToolbarButton>
            <ToolbarButton
              label="Show safe area"
              isActive={showSafeArea}
              onClick={onToggleSafeArea}
            >
              <SafeAreaIcon />
            </ToolbarButton>
          </div>
        ) : null}
      </div>

      <div className="timeline-toolbar__right">
        <label className="timeline-toolbar__color" title="Viewport background">
          <span className="timeline-toolbar__color-swatch" style={{ backgroundColor }} aria-hidden="true" />
          <input
            type="color"
            value={backgroundColor}
            onChange={(event) => onBackgroundColorChange(event.currentTarget.value)}
            aria-label="Viewport background"
          />
          <span className="timeline-toolbar__color-value">{backgroundColor.toUpperCase()}</span>
        </label>
      </div>
    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  isActive?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({ label, isActive, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`timeline-toolbar__button${isActive ? " is-active" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={isActive}
      title={label}
    >
      {children}
    </button>
  );
}

function GridOverlayIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="9" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.25 2.5v9M7 2.5v9M9.75 2.5v9M1.5 5.5h11M1.5 8.5h11" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  );
}

function SafeAreaIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="9" stroke="currentColor" strokeWidth="1.2" />
      <rect x="3" y="4" width="8" height="6" stroke="currentColor" strokeWidth="0.9" strokeDasharray="1.4 1.1" />
      <path d="M5 7h4M7 5v4" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  );
}
