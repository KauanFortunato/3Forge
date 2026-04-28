import type { ReactNode } from "react";
import type { PropertyClipboard } from "../propertyClipboard";
import type {
  AnimationTrack,
  ComponentAnimation,
  EditableFieldEntry,
  EditorNode,
  FontAsset,
  ImageAsset,
  MaterialAsset,
  NodePropertyDefinition,
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
  fonts: FontAsset[];
  materials: MaterialAsset[];
  images: ImageAsset[];
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
  parentId: string;
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
