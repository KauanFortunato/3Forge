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
  mimeType: "model/gltf-binary" | "model/gltf+json" | "model/vnd.usdz+zip" | string;
  src: string;
  format: "glb" | "gltf" | "usdz";
  originalFileName?: string;
  source?: "imported" | "external";
  structure?: ModelAssetStructure;
}

export interface ModelAssetStructureNode {
  id: string;
  name: string;
  type: string;
  childCount: number;
  meshCount: number;
  materialCount: number;
  children: ModelAssetStructureNode[];
}

export interface ModelAssetStructure {
  format: ModelAsset["format"];
  source: "three" | "openusd" | "archive" | "unknown";
  nodeCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  roots: ModelAssetStructureNode[];
}

/**
 * Hierarchical plan handed to {@link EditorStore.insertModelImportPlan} to
 * "explode" an imported model (typically a USDZ) into a tree of editable
 * blueprint nodes. Each plan entry becomes either a `group` node (for
 * `xform` kind — pure transform container) or a `model` node (for `mesh`
 * kind — references the parent ModelAsset and renders only the prim at
 * `primPath`). Transforms are local (relative to the plan parent).
 *
 * `materialId` (mesh-kind only) is the id of a MaterialAsset already
 * registered on the blueprint (typically by the same import pass); the
 * resulting ModelNode is linked to that asset so edits in the Materials
 * panel propagate to every part sharing it.
 */
export interface ModelImportPlanNode {
  name: string;
  kind: "xform" | "mesh";
  position: Vec3Like;
  rotation: Vec3Like;
  scale: Vec3Like;
  primPath?: string;
  /**
   * When the plan node represents a single GeomSubset of a multi-material
   * mesh prim, this is the subset's name (matches `userData.usdSubsetName`
   * set by the parser on the corresponding child Mesh). Renderer filters
   * the prim's mesh children by this to clone just that subset.
   */
  subsetName?: string;
  materialId?: string;
  children: ModelImportPlanNode[];
}

export interface HdrAsset {
  id: string;
  name: string;
  mimeType: "image/vnd.radiance" | string;
  src: string;
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

export interface SceneSettings {
  backgroundColor: string;
  environment: {
    type: "none" | "default" | "hdr";
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
  /**
   * Per-part visibility overrides keyed by structure part ID (child-index
   * path — see {@link buildStructureFromGroup}). Only entries with value
   * `false` are meaningful; missing entries mean the part is visible.
   */
  partVisibility?: Record<string, boolean>;
  /**
   * When set, this node renders only the subtree of the referenced model
   * located at the given USD prim path (tagged via `userData.usdPath` by
   * the OpenUSD parser). The rest of the model is rendered by sibling
   * ModelNodes that share the same `modelId`. Used to expose each prim of
   * an imported USDZ as an independently editable blueprint node.
   *
   * Only meaningful for ModelNodes whose ModelAsset is a USDZ parsed by
   * the OpenUSD pipeline; ignored otherwise.
   */
  primPath?: string;
  /**
   * When set together with {@link primPath}, restricts rendering to the
   * specific GeomSubset child mesh whose `userData.usdSubsetName` matches.
   * Used to split a multi-material USD mesh prim into one editable node
   * per subset so each subset can be selected, moved, and bound to its
   * own MaterialAsset without bleeding into siblings.
   */
  subsetName?: string;
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
  hdrs?: HdrAsset[];
  sceneSettings?: SceneSettings;
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
  | "material"
  | "image"
  | "model"
  | "hdr"
  | "sceneSettings"
  | "view"
  | "animation"
  | "propertyClipboard";

export type EditorStoreChange = {
  reason: EditorStoreChangeReason;
  source: "ui" | "scene" | "system" | "import" | "history";
  nodeId?: string;
  /**
   * Set on "history" notifications. "lightweight" means the change is fully
   * representable as transform/visibility updates on existing nodes, so the
   * scene can patch Object3Ds in place instead of doing a full rebuild.
   * `affectedNodeIds` lists the nodes whose Object3D needs to be re-synced.
   */
  historyKind?: "lightweight" | "heavy";
  affectedNodeIds?: ReadonlySet<string>;
};

export type ViewMode = "rendered" | "solid" | "wireframe";
