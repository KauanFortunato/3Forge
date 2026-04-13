export type EditorNodeType = "group" | "box" | "sphere" | "cylinder" | "plane" | "text" | "image";
export type EditableFieldType = "number" | "color" | "boolean" | "string";
export type PropertyGroup = "Transform" | "Geometry" | "Material" | "Text";
export type PropertyInputKind = "number" | "degrees" | "color" | "checkbox" | "text";
export type NodePropertyPath = string;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface TransformSpec {
  position: Vec3Like;
  rotation: Vec3Like;
  scale: Vec3Like;
}

export interface MaterialSpec {
  color: string;
  opacity: number;
  wireframe: boolean;
}

export interface FontAsset {
  id: string;
  name: string;
  source: "builtin" | "imported";
  data?: string;
}

export interface ImageAsset {
  name: string;
  mimeType: string;
  src: string;
  width: number;
  height: number;
}

export interface EditableBinding {
  path: NodePropertyPath;
  key: string;
  label: string;
  type: EditableFieldType;
}

export interface BaseEditorNode {
  id: string;
  name: string;
  type: EditorNodeType;
  parentId: string | null;
  transform: TransformSpec;
  editable: Record<NodePropertyPath, EditableBinding>;
}

export interface GroupNode extends BaseEditorNode {
  type: "group";
}

export interface BoxNode extends BaseEditorNode {
  type: "box";
  geometry: {
    width: number;
    height: number;
    depth: number;
  };
  material: MaterialSpec;
}

export interface SphereNode extends BaseEditorNode {
  type: "sphere";
  geometry: {
    radius: number;
  };
  material: MaterialSpec;
}

export interface CylinderNode extends BaseEditorNode {
  type: "cylinder";
  geometry: {
    radiusTop: number;
    radiusBottom: number;
    height: number;
  };
  material: MaterialSpec;
}

export interface PlaneNode extends BaseEditorNode {
  type: "plane";
  geometry: {
    width: number;
    height: number;
  };
  material: MaterialSpec;
}

export interface TextNode extends BaseEditorNode {
  type: "text";
  fontId: string;
  geometry: {
    text: string;
    size: number;
    depth: number;
    curveSegments: number;
    bevelEnabled: boolean;
    bevelThickness: number;
    bevelSize: number;
  };
  material: MaterialSpec;
}

export interface ImageNode extends BaseEditorNode {
  type: "image";
  geometry: {
    width: number;
    height: number;
  };
  image: ImageAsset;
  material: MaterialSpec;
}

export type EditorNode = GroupNode | BoxNode | SphereNode | CylinderNode | PlaneNode | TextNode | ImageNode;

export interface ComponentBlueprint {
  version: 1;
  componentName: string;
  fonts: FontAsset[];
  nodes: EditorNode[];
}

export interface NodePropertyDefinition {
  path: NodePropertyPath;
  label: string;
  group: PropertyGroup;
  type: EditableFieldType;
  input: PropertyInputKind;
  step?: number;
  min?: number;
  max?: number;
}

export interface EditableFieldEntry {
  node: EditorNode;
  binding: EditableBinding;
}

export interface EditorStoreChange {
  reason: "structure" | "node" | "selection" | "editable" | "meta" | "import" | "history" | "font";
  source: "ui" | "scene" | "system" | "import" | "history";
  nodeId?: string;
}
