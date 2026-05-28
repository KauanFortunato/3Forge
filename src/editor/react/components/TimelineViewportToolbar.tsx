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
  showCheckerboardBg: boolean;
  isRecordingViewport: boolean;
  backgroundColor: string;
  onTakeSnapshot: () => void;
  onToggleRecording: () => void;
  onToolChange: (mode: ToolMode) => void;
  onToggleGridOverlay: () => void;
  onToggleSafeArea: () => void;
  onToggleCheckerboardBg: () => void;
  onBackgroundColorChange: (value: string) => void;
}

export function TimelineViewportToolbar({
  currentTool,
  sceneMode,
  showGridOverlay,
  showSafeArea,
  showCheckerboardBg,
  isRecordingViewport,
  backgroundColor,
  onTakeSnapshot,
  onToggleRecording,
  onToolChange,
  onToggleGridOverlay,
  onToggleSafeArea,
  onToggleCheckerboardBg,
  onBackgroundColorChange,
}: TimelineViewportToolbarProps) {
  const is2dMode = sceneMode === "2d";

  return (
    <div className="timeline-toolbar" aria-label="Timeline viewport toolbar">
      <div className="timeline-toolbar__left">
        <div className="timeline-toolbar__group" aria-label="Viewport capture">
          <ToolbarButton
            label="Take viewport snapshot"
            onClick={onTakeSnapshot}
          >
            <CameraIcon />
          </ToolbarButton>
          <ToolbarButton
            label={isRecordingViewport ? "Stop viewport recording" : "Record viewport"}
            isActive={isRecordingViewport}
            onClick={onToggleRecording}
          >
            {isRecordingViewport ? <StopRecordingIcon /> : <RecordIcon />}
          </ToolbarButton>
        </div>
      </div>

      <div className="timeline-toolbar__center">
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
      </div>

      <div className="timeline-toolbar__right">
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

            <ToolbarButton
              label="Show checkerboard background"
              isActive={showCheckerboardBg}
              onClick={onToggleCheckerboardBg}
            >
              <CheckerboardBackgroundIcon />
            </ToolbarButton>
          </div>
        ) : null}

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

function CameraIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M4.2 3.2 5.1 2h3.8l.9 1.2h1.4c.72 0 1.3.58 1.3 1.3v5.2c0 .72-.58 1.3-1.3 1.3H2.8c-.72 0-1.3-.58-1.3-1.3V4.5c0-.72.58-1.3 1.3-1.3h1.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="7" cy="7.1" r="2.05" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function RecordIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7" r="2.35" fill="currentColor" />
    </svg>
  );
}

function StopRecordingIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5" y="5" width="4" height="4" rx="0.7" fill="currentColor" />
    </svg>
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

function CheckerboardBackgroundIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="9" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 2.5h3.67v3H1.5v-3ZM8.83 2.5h3.67v3H8.83v-3ZM5.17 5.5h3.66v3H5.17v-3ZM1.5 8.5h3.67v3H1.5v-3ZM8.83 8.5h3.67v3H8.83v-3Z" fill="currentColor" opacity="0.72" />
    </svg>
  );
}
