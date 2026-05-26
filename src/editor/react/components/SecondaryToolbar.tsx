import type { ReactNode } from "react";
import type { ToolMode } from "../ui-types";
import type { EditorNodeType, ViewMode } from "../../types";
import {
  BoxIcon,
  CursorIcon,
  CylinderIcon,
  FrameIcon,
  GeometryIcon,
  GroupIcon,
  ImageIcon,
  MoveIcon,
  PlaneIcon,
  RedoIcon,
  RotateIcon,
  SaveIcon,
  ScaleIcon,
  SphereIcon,
  TextPropertyIcon,
  UndoIcon,
  ViewRenderedIcon,
  ViewSolidIcon,
  ShortcutIcon,
} from "./icons";
import { BufferedInput } from "./BufferedInput";

interface SecondaryToolbarProps {
  componentName: string;
  selectedLabel: string;
  nodeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  currentTool: ToolMode;
  viewMode?: ViewMode;
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
