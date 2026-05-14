import type { ReactNode } from "react";
import type { PropertyClipboard } from "../propertyClipboard";
import type {
  AnimationTrack,
  ComponentAnimation,
  EditableFieldEntry,
  EditorNode,
  FontAsset,
  HdrAsset,
  ImageAsset,
  MaterialAsset,
  ModelAsset,
  NodePropertyDefinition,
  SceneSettings,
  ViewMode,
} from "../types";

export type ExportMode = "json" | "typescript";
export type RightPanelTab = "properties" | "material";
export type ToolMode = "select" | "translate" | "rotate" | "scale";

export interface EditorStoreView {
  blueprintComponentName: string;
  blueprintNodes: EditorNode[];
  selectedNodeId: string;
  selectedNodeIds: string[];
  selectedNode: EditorNode | undefined;
  selectedNodes: EditorNode[];
  selectedPartId: string | null;
  fonts: FontAsset[];
  materials: MaterialAsset[];
  models: ModelAsset[];
  images: ImageAsset[];
  hdrs: HdrAsset[];
  sceneSettings: SceneSettings;
  editableFields: EditableFieldEntry[];
  animation: ComponentAnimation;
  selectedNodeAnimationTracks: AnimationTrack[];
  canUndo: boolean;
  canRedo: boolean;
  viewMode: ViewMode;
  propertyClipboard: PropertyClipboard | null;
}

export interface TreeBranch {
  node: EditorNode;
  children: TreeBranch[];
}

export interface TreeDropTarget {
  parentId: string | null;
  index: number;
  position: "before" | "inside" | "after" | "end";
  rowNodeId?: string;
}

export interface MenuAction {
  id: string;
  label?: string;
  shortcut?: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  onSelect?: () => void;
  children?: MenuAction[];
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuAction[];
}

export interface PropertyFieldProps {
  node: EditorNode;
  definition: NodePropertyDefinition;
}
