export type EditorNodeType = "group" | "box" | "circle" | "sphere" | "cylinder" | "plane" | "text" | "image";
export type EditableFieldType = "number" | "color" | "boolean" | "string";
export type PropertyGroup = "Object" | "Transform" | "Geometry" | "Material" | "Text";
export type PropertyInputKind = "number" | "degrees" | "color" | "checkbox" | "text" | "select";
export type NodePropertyPath = string;
export type MaterialType = "basic" | "standard";
export type NodeOriginHorizontal = "left" | "center" | "right";
export type NodeOriginVertical = "top" | "center" | "bottom";
export type NodeOriginDepth = "front" | "center" | "back";
export type GroupPivotPreset =
  | "center"
  | "bottom-center"
  | "top-center"
  | "left-center"
  | "right-center"
  | "front-center"
  | "back-center";
export type AnimationPropertyPath =
  | "visible"
  | "transform.position.x"
  | "transform.position.y"
  | "transform.position.z"
  | "transform.rotation.x"
  | "transform.rotation.y"
  | "transform.rotation.z"
  | "transform.scale.x"
  | "transform.scale.y"
  | "transform.scale.z";
export type AnimationEasePreset = "linear" | "easeIn" | "easeOut" | "easeInOut" | "backOut" | "bounceOut";

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

export interface NodeOriginSpec {
  x: NodeOriginHorizontal;
  y: NodeOriginVertical;
  z: NodeOriginDepth;
}

export interface MaterialSpec {
  type: MaterialType;
  color: string;
  emissive: string;
  roughness: number;
  metalness: number;
  opacity: number;
  transparent: boolean;
  visible: boolean;
  alphaTest: number;
  depthTest: boolean;
  depthWrite: boolean;
  wireframe: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
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

export interface AnimationKeyframe {
  id: string;
  frame: number;
  value: number;
  ease: AnimationEasePreset;
}

export interface AnimationTrack {
  id: string;
  nodeId: string;
  property: AnimationPropertyPath;
  muted?: boolean;
  keyframes: AnimationKeyframe[];
}

export interface AnimationClip {
  id: string;
  name: string;
  fps: number;
  durationFrames: number;
  tracks: AnimationTrack[];
}

export interface ComponentAnimation {
  activeClipId: string;
  clips: AnimationClip[];
}

export interface BaseEditorNode {
  id: string;
  name: string;
  type: EditorNodeType;
  parentId: string | null;
  visible: boolean;
  transform: TransformSpec;
  origin: NodeOriginSpec;
  editable: Record<NodePropertyPath, EditableBinding>;
}

export interface GroupNode extends BaseEditorNode {
  type: "group";
  pivotOffset: Vec3Like;
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

export interface CircleNode extends BaseEditorNode {
  type: "circle";
  geometry: {
    radius: number;
    segments: number;
    thetaStarts: number;
    thetaLenght: number;
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

export type EditorNode = GroupNode | BoxNode | CircleNode | SphereNode | CylinderNode | PlaneNode | TextNode | ImageNode;

export interface ComponentBlueprint {
  version: 1;
  componentName: string;
  fonts: FontAsset[];
  nodes: EditorNode[];
  animation: ComponentAnimation;
}

export interface NodePropertyDefinition {
  path: NodePropertyPath;
  label: string;
  group: PropertyGroup;
  type: EditableFieldType;
  input: PropertyInputKind;
  options?: Array<{ label: string; value: string }>;
  step?: number;
  min?: number;
  max?: number;
}

export interface EditableFieldEntry {
  node: EditorNode;
  binding: EditableBinding;
}

export type EditorStoreChangeReason =
  | "structure"
  | "node"
  | "selection"
  | "editable"
  | "meta"
  | "import"
  | "history"
  | "font"
  | "view"
  | "animation"
  | "propertyClipboard";

export type EditorStoreChange = {
  reason: EditorStoreChangeReason;
  source: "ui" | "scene" | "system" | "import" | "history";
  nodeId?: string;
};

export type ViewMode = "rendered" | "solid";
