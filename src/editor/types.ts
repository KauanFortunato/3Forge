export type EditorNodeType = "group" | "box" | "circle" | "sphere" | "cylinder" | "plane" | "text" | "image";
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
  | "transform.scale.z"
  | "material.opacity"
  | "material.textureOptions.offsetU"
  | "material.textureOptions.offsetV"
  | "material.textureOptions.repeatU"
  | "material.textureOptions.repeatV";
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
  /**
   * Optional shear, in degrees, sourced from W3D `<NodeTransform><Skew/>`.
   * `x` shears the X coordinate by `tan(x) * Y`; `y` shears Y by `tan(y) * X`;
   * `z` is accepted for round-trip but doesn't apply in the 2D-flat shaders
   * the editor uses today. Undefined or all-zero is treated as identity by
   * the renderer and the extra skewLayer Group is not inserted.
   */
  skew?: Vec3Like;
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
  ior: number;
  transmission: number;
  clearcoat: number;
  clearcoatRoughness: number;
  thickness: number;
  specular: string;
  shininess: number;
  /**
   * Optional texture sampling overrides — sourced from W3D
   * TextureMappingOption (wrap mode, filtering, offset/repeat). Renderer
   * applies them when the material has a `map`. Absent fields fall back to
   * Three's defaults.
   */
  textureOptions?: TextureSamplingOptions;
}

export type TextureWrap = "clamp" | "repeat" | "mirror";
export type TextureFilter = "nearest" | "linear" | "anisotropic";

export interface TextureSamplingOptions {
  wrapU?: TextureWrap;
  wrapV?: TextureWrap;
  magFilter?: TextureFilter;
  minFilter?: TextureFilter;
  /** Anisotropy level (1..16). Default 1; capped by GPU at runtime. */
  anisotropy?: number;
  offsetU?: number;
  offsetV?: number;
  repeatU?: number;
  repeatV?: number;
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

export interface ImageSequenceMetadata {
  /** Discriminator. Always "image-sequence" for v1. */
  type: "image-sequence";
  /** sequence.json schema version. */
  version: 1;
  /** Source .mov filename the sequence was generated from. */
  source: string;
  /** ffmpeg %d-style pattern, e.g. "frame_%06d.png". */
  framePattern: string;
  /** Count of PNG files actually written by the conversion. */
  frameCount: number;
  /** Frames per second, 0 when ffprobe is unavailable. */
  fps: number;
  /** Pixel width / height (0 when unknown). */
  width: number;
  height: number;
  /** Duration in seconds (0 when unknown). */
  durationSec: number;
  /** Loop on the last frame. */
  loop: boolean;
  /** Always true for PNG sequences (alpha is the reason we exist). */
  alpha: boolean;
  /** Always "rgba" for v1. */
  pixelFormat: "rgba";
  /** Resolved blob: URLs for each frame, in order. Browser-only. */
  frameUrls: string[];
}

export interface ImageAsset {
  id?: string;
  name: string;
  mimeType: string;
  src: string;
  width: number;
  height: number;
  /** Present only for application/x-image-sequence assets. */
  sequence?: ImageSequenceMetadata;
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
  /** When set, the node's children/contents are clipped to this node's plane bounds. */
  isMask?: boolean;
  /**
   * When set, this node's rendering is clipped to the mask node referenced
   * by id. Kept as the primary single-mask case for back-compat with
   * blueprints written before multi-mask support landed.
   */
  maskId?: string;
  /**
   * When set (length > 0), all listed masks are intersected (logical AND)
   * before clipping. The first entry usually mirrors `maskId` — both stay
   * in sync at write time.
   */
  maskIds?: string[];
  /**
   * Invert clipping — keep the inside of the mask volume rather than the
   * outside. Maps W3D's `IsInvertedMask="True"`.
   */
  maskInverted?: boolean;
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

export type EditorNode = GroupNode | BoxNode | CircleNode | SphereNode | CylinderNode | PlaneNode | TextNode | ImageNode;

export interface ComponentBlueprint {
  version: 1;
  componentName: string;
  /** Engine rendering mode. Absent = "3d" for backwards compatibility. */
  sceneMode?: SceneMode;
  /**
   * Engine/viewport defaults harvested at import time (background colour,
   * authored camera pose, FOV). Consumed once when the blueprint is mounted —
   * subsequent navigation belongs to the user, not the asset.
   */
  engine?: EngineViewportSettings;
  /**
   * Author-exposed parameters (R3 ExportList / ExportProperty) that an
   * end-user is meant to tweak per playout — names, scores, photos, colours.
   * Persisted on the blueprint for the inspector UI to render and for
   * runtime exports to bind to. Empty/absent for blueprints that didn't
   * come from W3D.
   */
  exposedProperties?: ExposedProperty[];
  /**
   * Lossy import side-channel: anything we recognised but don't fully render
   * yet (lights, custom shaders, exotic primitives). Stored so a future
   * version of the renderer can pick it up and so round-trip tools can
   * surface it to the user.
   */
  importMetadata?: ImportMetadata;
  fonts: FontAsset[];
  materials: MaterialAsset[];
  images: ImageAsset[];
  nodes: EditorNode[];
  animation: ComponentAnimation;
  /**
   * Free-form, non-typed side-channel for importer/exporter scaffolding (e.g.
   * W3D shadow XML and id maps). Always optional; serializers should ignore
   * unknown keys but preserve them on round-trip.
   */
  metadata?: Record<string, unknown>;
}

export type ExposedPropertyType = "string" | "number" | "boolean" | "color" | "texture" | "unknown";

export interface ExposedProperty {
  /** Stable id used by exporters and runtime bindings — the W3D PropertyName. */
  id: string;
  /** Human-readable label shown in the inspector — the W3D Name attribute. */
  label: string;
  type: ExposedPropertyType;
  defaultValue: string | number | boolean | null;
  /** GUID (lower-cased) of the W3D object this property writes to. */
  controllableId?: string;
  /** Update strategy from R3 (e.g. "OnTake", "OnChange"). Stored verbatim. */
  updateMode?: string;
  /** All XML attributes preserved for forward-compat / round-trip. */
  raw?: Record<string, string>;
}

export interface ImportMetadata {
  source: "w3d" | string;
  /** Lights captured from the W3D scene that we don't yet instantiate. */
  lights?: ImportedLight[];
  /** HLSL/CSO shader filenames discovered next to the scene. Not yet used. */
  shaderFiles?: string[];
  /** Anything else worth surfacing later — left open for forward-compat. */
  notes?: string[];
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

/**
 * Asset-authored viewport defaults. The renderer consumes these once on import
 * to set the initial framing/background; the user's subsequent orbit/pan/zoom
 * is not written back here.
 */
export interface EngineViewportSettings {
  background?: EngineBackgroundSettings;
  camera?: EngineCameraSettings;
}

export type EngineBackgroundSettings =
  | { type: "color"; color: string; alpha?: number }
  | { type: "transparent" };

export interface EngineCameraSettings {
  /** Mirrors `sceneMode` for convenience; importers should keep the two in sync. */
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

export interface EngineCameraMetadata {
  isTracked?: boolean;
  trackingCamera?: string;
  renderTarget?: string;
  aspectRatio?: number;
  fovX?: number;
  /** Original W3D Camera Id GUID, lower-cased. */
  sourceId?: string;
  /** Camera name, preserved verbatim. */
  sourceName?: string;
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
  | "view"
  | "animation"
  | "propertyClipboard";

export type EditorStoreChange = {
  reason: EditorStoreChangeReason;
  source: "ui" | "scene" | "system" | "import" | "history";
  nodeId?: string;
};

export type ViewMode = "rendered" | "solid" | "wireframe";

/**
 * Engine-level rendering mode.
 * - `3d` (default): PerspectiveCamera, free orbit. For spatial scenes.
 * - `2d`: OrthographicCamera, locked rotation, pan/zoom only. For broadcast
 *   layouts, UI cards, anything authored in the XY plane.
 */
export type SceneMode = "2d" | "3d";
