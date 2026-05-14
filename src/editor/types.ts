export type EditorNodeType =
  | "group"
  | "box"
  | "circle"
  | "sphere"
  | "cylinder"
  | "cone"
  | "capsule"
  | "ring"
  | "torus"
  | "torusKnot"
  | "dodecahedron"
  | "icosahedron"
  | "octahedron"
  | "tetrahedron"
  | "plane"
  | "text"
  | "image"
  | "model";
export type EditableFieldType = "number" | "color" | "boolean" | "string";
export type PropertyGroup = "Object" | "Transform" | "Geometry" | "Material" | "Text";
export type PropertyInputKind = "number" | "degrees" | "color" | "checkbox" | "text" | "select";
export type NodePropertyPath = string;
export type MaterialType =
  | "basic"
  | "standard"
  | "physical"
  | "toon"
  | "lambert"
  | "phong"
  | "normal"
  | "depth";
export type MaterialSide = "front" | "back" | "double";
export type MaterialDepthPacking = "basic" | "rgba";
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
  mapImageId?: string;
  side: MaterialSide;
  emissive: string;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  opacity: number;
  transparent: boolean;
  visible: boolean;
  alphaTest: number;
  depthTest: boolean;
  depthWrite: boolean;
  colorWrite: boolean;
  dithering: boolean;
  flatShading: boolean;
  fog: boolean;
  toneMapped: boolean;
  premultipliedAlpha: boolean;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
  wireframe: boolean;
  wireframeLinewidth: number;
  castShadow: boolean;
  receiveShadow: boolean;
  envMapIntensity: number;
  ior: number;
  transmission: number;
  clearcoat: number;
  clearcoatRoughness: number;
  thickness: number;
  reflectivity: number;
  iridescence: number;
  iridescenceIOR: number;
  iridescenceThicknessRangeStart: number;
  iridescenceThicknessRangeEnd: number;
  sheen: number;
  sheenRoughness: number;
  sheenColor: string;
  specularIntensity: number;
  specularColor: string;
  attenuationDistance: number;
  attenuationColor: string;
  dispersion: number;
  anisotropy: number;
  specular: string;
  shininess: number;
  depthPacking: MaterialDepthPacking;
}

export interface MaterialAsset {
  id: string;
  name: string;
  spec: MaterialSpec;
}

export interface FontAsset {
  id: string;
  name: string;
  source: "builtin" | "imported";
  data?: string;
}

export interface ImageAsset {
  id?: string;
  name: string;
  mimeType: string;
  src: string;
  width: number;
  height: number;
}

export interface ModelAsset {
  id: string;
  name: string;
  mimeType: "model/gltf-binary" | "model/gltf+json" | string;
  src: string;
  format: "glb" | "gltf";
  originalFileName?: string;
  source?: "imported" | "external";
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

export type SceneToneMapping = "none" | "linear" | "acesFilmic";
export type SceneShadowType = "basic" | "pcf" | "pcfSoft";
export type SceneMode = "2d" | "3d";

export interface SceneCanvasSize {
  width: number;
  height: number;
}

export interface SceneSettings {
  backgroundColor: string;
  mode: SceneMode;
  canvas: SceneCanvasSize;
  environment: {
    type: "none";
    hdrAssetId: string | null;
    intensity: number;
  };
  lighting: {
    ambientColor: string;
    ambientIntensity: number;
    directionalColor: string;
    directionalIntensity: number;
  };
  toneMapping: {
    type: SceneToneMapping;
    exposure: number;
  };
  shadows: {
    enabled: boolean;
    type: SceneShadowType;
  };
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
  materialId?: string;
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
  materialId?: string;
}

export interface SphereNode extends BaseEditorNode {
  type: "sphere";
  geometry: {
    radius: number;
    widthSegments: number;
    heightSegments: number;
    phiStart: number;
    phiLength: number;
    thetaStart: number;
    thetaLength: number;
  };
  material: MaterialSpec;
  materialId?: string;
}

export interface CylinderNode extends BaseEditorNode {
  type: "cylinder";
  geometry: {
    radiusTop: number;
    radiusBottom: number;
    height: number;
    radialSegments: number;
    heightSegments: number;
    thetaStart: number;
    thetaLength: number;
  };
  material: MaterialSpec;
  materialId?: string;
}

export interface ConeNode extends BaseEditorNode {
  type: "cone";
  geometry: {
    radius: number;
    height: number;
    radialSegments: number;
    heightSegments: number;
    thetaStart: number;
    thetaLength: number;
  };
  material: MaterialSpec;
  materialId?: string;
}

export interface CapsuleNode extends BaseEditorNode {
  type: "capsule";
  geometry: {
    radius: number;
    length: number;
    capSegments: number;
    radialSegments: number;
  };
  material: MaterialSpec;
  materialId?: string;
}

export interface RingNode extends BaseEditorNode {
  type: "ring";
  geometry: {
    innerRadius: number;
    outerRadius: number;
    thetaSegments: number;
    phiSegments: number;
    thetaStart: number;
    thetaLength: number;
  };
  material: MaterialSpec;
  materialId?: string;
}

export interface TorusNode extends BaseEditorNode {
  type: "torus";
  geometry: {
    radius: number;
    tube: number;
    radialSegments: number;
    tubularSegments: number;
    arc: number;
  };
  material: MaterialSpec;
  materialId?: string;
}

export interface TorusKnotNode extends BaseEditorNode {
  type: "torusKnot";
  geometry: {
    radius: number;
    tube: number;
    tubularSegments: number;
    radialSegments: number;
    p: number;
    q: number;
  };
  material: MaterialSpec;
  materialId?: string;
}

export interface PolyhedronNode extends BaseEditorNode {
  type: "dodecahedron" | "icosahedron" | "octahedron" | "tetrahedron";
  geometry: {
    radius: number;
    detail: number;
  };
  material: MaterialSpec;
  materialId?: string;
}

export interface PlaneNode extends BaseEditorNode {
  type: "plane";
  geometry: {
    width: number;
    height: number;
  };
  material: MaterialSpec;
  materialId?: string;
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
  materialId?: string;
}

export interface ImageNode extends BaseEditorNode {
  type: "image";
  geometry: {
    width: number;
    height: number;
  };
  imageId?: string;
  image: ImageAsset;
  material: MaterialSpec;
  materialId?: string;
}

export interface ModelNode extends BaseEditorNode {
  type: "model";
  modelId: string;
  material: MaterialSpec;
  materialId?: string;
}

export type EditorNode =
  | GroupNode
  | BoxNode
  | CircleNode
  | SphereNode
  | CylinderNode
  | ConeNode
  | CapsuleNode
  | RingNode
  | TorusNode
  | TorusKnotNode
  | PolyhedronNode
  | PlaneNode
  | TextNode
  | ImageNode
  | ModelNode;

export interface ComponentBlueprint {
  version: 1;
  componentName: string;
  fonts: FontAsset[];
  materials: MaterialAsset[];
  images: ImageAsset[];
  models?: ModelAsset[];
  sceneSettings?: SceneSettings;
  /**
   * Engine/viewport defaults harvested at import time (background colour,
   * authored camera pose, FOV). Consumed once when the blueprint is mounted —
   * subsequent navigation belongs to the user, not the asset.
   */
  engine?: EngineViewportSettings;
  /**
   * Lossy import side-channel: anything we recognised but don't fully render
   * yet (lights, custom shaders, exotic primitives). Stored so a future
   * version of the renderer can pick it up and so round-trip tools can
   * surface it to the user.
   */
  importMetadata?: ImportMetadata;
  nodes: EditorNode[];
  animation: ComponentAnimation;
}

export interface ImportedLight {
  id: string;
  name: string;
  kind: "directional" | "point" | "spot" | "ambient";
  intensity?: number;
  color?: string;
  position?: Vec3Like;
  rotation?: Vec3Like;
}

export interface ImportMetadata {
  source: "w3d" | string;
  /** Lights captured from the source scene that we don't yet instantiate. */
  lights?: ImportedLight[];
  /** HLSL/CSO shader filenames discovered next to the scene. Not yet used. */
  shaderFiles?: string[];
  /** Anything else worth surfacing later — left open for forward-compat. */
  notes?: string[];
}

export type EngineBackgroundSettings =
  | { type: "color"; color: string; alpha?: number }
  | { type: "transparent" };

export interface EngineCameraMetadata {
  isTracked?: boolean;
  trackingCamera?: string;
  renderTarget?: string;
  aspectRatio?: number;
  fovX?: number;
  /** Original source-engine camera Id GUID, lower-cased. */
  sourceId?: string;
  /** Camera name, preserved verbatim. */
  sourceName?: string;
}

export interface EngineCameraSettings {
  /** Mirrors `sceneSettings.mode` for convenience; importers should keep the two in sync. */
  mode: "perspective" | "orthographic";
  /** Vertical field-of-view in degrees. Perspective only. */
  fovY?: number;
  /** Authored camera position in editor (Three.js) space. */
  position?: Vec3Like;
  /** Authored camera Euler rotation in degrees, X/Y/Z. */
  rotation?: Vec3Like;
  /** Optional explicit look-at target. When absent, derived from rotation+position. */
  target?: Vec3Like;
  near?: number;
  far?: number;
  /**
   * Source-engine camera flags worth keeping for broadcast integrations:
   * tracked / tracking-channel / render-target / aspect / horizontal FOV.
   * Renderer copies into camera.userData; not consumed for projection yet.
   */
  metadata?: EngineCameraMetadata;
}

/**
 * Asset-authored viewport defaults. The renderer consumes these once on import
 * to set the initial framing/background; the user's subsequent orbit/pan/zoom
 * is not written back here.
 */
export interface EngineViewportSettings {
  background?: EngineBackgroundSettings;
  camera?: EngineCameraSettings;
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
  | "material"
  | "image"
  | "model"
  | "sceneSettings"
  | "view"
  | "animation"
  | "propertyClipboard";

export type EditorStoreChange = {
  reason: EditorStoreChangeReason;
  source: "ui" | "scene" | "system" | "import" | "history";
  nodeId?: string;
};

export type ViewMode = "rendered" | "solid" | "wireframe";
