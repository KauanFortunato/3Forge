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
  // Animated skew (degrees per axis). Routes to a runtime skewLayer Group
  // that the scene inserts on demand — see SceneEditor.rebuildAnimationTimeline.
  | "transform.skew.x"
  | "transform.skew.y"
  | "transform.skew.z"
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
  /**
   * W3D `<TextureMappingOption><Rotation Z="…"/></TextureMappingOption>` — UV
   * rotation in **degrees**. LINEUP_LEFT's TEXTURE_FULLFRAME_MAIN authors
   * `Rotation Z=-1` so the PATTERN.png tile slants slightly. The renderer
   * translates this to `texture.rotation` (radians, centred at 0.5,0.5).
   */
  textureRotation?: number;
  /**
   * W3D AlphaKey reference — `<TextureMappingOption Key="<guid>" KeyType="AlphaKey">`.
   * The GUID points at another `<Texture>` resource (e.g. VERTICAL_RAMP.png)
   * that W3D composites as the layer's alpha mask. The Block 5 renderer
   * composites the key into fragment alpha via `MeshBasicMaterial.onBeforeCompile`
   * when `alphaKeyTextureName` resolves to a loaded image asset. The GUID
   * stays robust to texture-folder renames.
   */
  alphaKeyTextureId?: string;
  /** Resolved filename basename for the alphaKey texture (e.g. "ramp.png"),
   * derived at import time from the W3D `<Texture Id=… Filename=…>` resource
   * matching `alphaKeyTextureId`. The renderer uses this to look up the
   * image asset on the blueprint. Absent when the GUID didn't resolve. */
  alphaKeyTextureName?: string;
  alphaKeyType?: string;
  /** W3D `ColorShaping="Shaped"` etc. — purely diagnostic for now. */
  colorShaping?: string;
  /** W3D `PremultiplyColor` — non-default values surface a diagnostic. */
  premultiplyColor?: string;
  /** W3D `IsEmissive="True"`. The renderer treats all textured Quads as
   * basic-material today; preserving this lets a future PBR pass honour
   * emissive textures. */
  isEmissive?: boolean;
  /** W3D `TextureStretchOption="Fill" | "Keep" | …` — preserved for round-trip
   * and future renderer use. */
  textureStretchOption?: string;
  /**
   * W3D `<TextureLayer TextureBlending="Multiply|Add|Screen|…">`. The Block 5
   * renderer maps `"Multiply"` → `MultiplyBlending` and `"Add"` →
   * `AdditiveBlending` on the material; unknown / `"Screen"` values are
   * preserved verbatim with a warning in the dump (`Screen` would need
   * CustomBlending equations that risk breaking transparency sorting).
   */
  textureBlending?: string;
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

export type {
  SequenceFormat,
  SequenceFallbackReason,
} from "./import/sequenceSchema";
import type { SequenceFormat, SequenceFallbackReason } from "./import/sequenceSchema";

/**
 * Where the canonical frame files for this sequence live.
 *
 * - `project-folder`: written into the project's
 *   `Resources/Textures/<slug>_sequence_<hash8>/` folder via the File
 *   System Access API. `manifestPath` is set; `frameUrls` is hydrated
 *   on demand (browser-session-scoped blob URLs) and never persisted.
 *   This is the only durable storage type — survives reload + export.
 *   Exported zips mirror this same folder layout under
 *   `Resources/Textures/<...>/` so the storage type stays the same
 *   whether you ship the project folder or the zip.
 * - `dev-cache`: temp dir on the dev server (legacy fallback used
 *   when the user refuses folder access or FSA is unsupported).
 *   Non-persistent: do NOT rely on these frames after a reload.
 *   On export, dev-cache sequences are promoted to `project-folder`
 *   if their frames are still in memory.
 */
export type SequenceStorageType = "project-folder" | "dev-cache";

export interface ImageSequenceMetadata {
  /** Discriminator. Always "image-sequence". */
  type: "image-sequence";
  /** sequence.json schema version. v1/v2 are read-only legacy; v3 writers
   * also emit `sourceHash` / `createdBy` / `converterVersion`. */
  version: 1 | 2 | 3;
  /** Image format used for every frame. Implicit "png" on legacy v1. */
  format: SequenceFormat;
  /** Source .mov filename the sequence was generated from. */
  source: string;
  /** ffmpeg %d-style pattern. Extension must match `format`. */
  framePattern: string;
  /** Count of frame files actually written by the conversion. */
  frameCount: number;
  /** Frames per second. v2 writers must emit > 0 (defaulting to 25). */
  fps: number;
  /** Pixel width / height (0 when ffprobe is unavailable). */
  width: number;
  height: number;
  /** Duration in seconds (0 when unknown). */
  durationSec: number;
  /** Loop on the last frame. */
  loop: boolean;
  /** True when the encoder produced an alpha channel. */
  alpha: boolean;
  /** Always "rgba" for both webp and png paths. */
  pixelFormat: "rgba";
  /** Resolved blob: URLs for each frame, in order. Browser-only, never persisted. */
  frameUrls: string[];
  /** Set when the conversion fell back from webp to png. */
  fallbackReason?: SequenceFallbackReason;
  /** Set in-memory only: resolver auto-generated this metadata because sequence.json was missing. Never persisted. */
  autoRepaired?: boolean;
  /** Set in-memory only: resolved via the legacy `<basename>_frames/` layer (priority 3). */
  legacy?: boolean;
  /** Where the canonical frame files live. Persisted. Defaults to
   * `"dev-cache"` for legacy blueprints that pre-date the project-folder
   * pipeline. */
  storageType?: SequenceStorageType;
  /** Project-root-relative path to `sequence.json`, e.g.
   * `Resources/Textures/<slug>_sequence_<hash8>/sequence.json`. Present
   * when `storageType === "project-folder"`. Persisted. */
  manifestPath?: string;
  /** Full sha256 of the source .mov, formatted `sha256:<full-hex>`.
   * Used to detect "same video already converted" so re-imports skip
   * ffmpeg. Persisted. The folder name encodes only the first 8 chars. */
  sourceHash?: string;
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
  /**
   * Frame the W3D author wanted shown as the static thumbnail/rest state
   * (`<Timeline PreviewMarker="…">`). For broadcast graphics this is
   * typically the last frame of the "In" timeline — the moment after the
   * intro animation settles. -1 / undefined when the author didn't pick one.
   */
  previewFrame?: number;
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
    /**
     * W3D `<TextBoxSize X>` — when set, the renderer scales the generated
     * TextGeometry down so its bounding-box width stays ≤ maxWidth. Lets
     * R3-authored short labels (player names, bench rows, COACH) stay
     * inside the card they belong to instead of overflowing.
     */
    maxWidth?: number;
    /** W3D `<TextBoxSize Y>` — same role as `maxWidth`, for height. */
    maxHeight?: number;
    /**
     * True when the W3D source had `HasTextBox="True"`. We still write
     * `maxWidth`/`maxHeight` separately so the renderer's contract is
     * uniform: missing dims => no fit; this flag is for diagnostics.
     */
    hasTextBox?: boolean;
    /**
     * W3D `<GeometryOptions AlignmentX>` — where the text sits inside the
     * virtual TextBoxSize-defined rectangle centred at the node's local
     * origin. Default is "Center" when omitted. Renderer translates the
     * generated TextGeometry after fit-to-box to honour this.
     */
    alignmentX?: "Left" | "Center" | "Right";
    /** W3D `<GeometryOptions AlignmentY>`, see `alignmentX`. */
    alignmentY?: "Top" | "Center" | "Bottom";
    /**
     * W3D `<GeometryOptions ConstrainMethod>` ("Width" / "Height" /
     * "WidthOnly" / "HeightOnly" …). Kept as a string for diagnostics —
     * the renderer's current fit-to-box behaviour is uniform downscale
     * regardless of method, but recording the value lets future work
     * specialise without re-touching the parser.
     */
    constrainMethod?: string;
    /**
     * W3D `<GeometryOptions FontStyle>` — lower-cased GUID pointing into
     * `metadata.w3d.textFontStyles`. Today used purely for diagnostics;
     * the renderer still uses the editor's default font.
     */
    fontStyleId?: string;
    /**
     * Block 6: the resolved W3D font name (e.g. "Obviously", "Obviously Cond"),
     * looked up from `metadata.w3d.textFontStyles[fontStyleId].fontName` at
     * import time. Used by the renderer's W3D font resolver to match against
     * the bundled font catalog by name. Stored on the node so dumps can show
     * the requested font without re-walking metadata.
     */
    fontFamily?: string;
    /** Block 6: W3D font weight/type (e.g. "Light", "Bold", "Light Italic")
     * from `<TextureTextFontStyle Type>`. Diagnostic. */
    fontWeight?: string;
    /**
     * Block 6: actual 3Forge font asset id the renderer ended up using.
     * Equal to `fontStyleId`'s resolved match when present; falls back to
     * `DEFAULT_FONT_ID` when the W3D font is not bundled. Records the
     * fallback path for the dump so the operator sees substitution.
     */
    resolvedFontId?: string;
    /** Block 6: human-readable reason for substitution (e.g. "Obviously not
     * bundled — falling back to Helvetiker"). Absent when the requested
     * font matched exactly. */
    fontFallbackReason?: string;
    /**
     * Block 1/6: W3D `<GeometryOptions TextQuality>` — rasterization density
     * hint (e.g. "0.8", "3", "5"). Currently preserved for diagnostics only;
     * future work may map this to TextGeometry `curveSegments`.
     */
    textQuality?: string;
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
