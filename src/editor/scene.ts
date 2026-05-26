import {
  AmbientLight,
  ACESFilmicToneMapping,
  AxesHelper,
  BackSide,
  BasicShadowMap,
  BasicDepthPacking,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DodecahedronGeometry,
  EdgesGeometry,
  FrontSide,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  LinearToneMapping,
  Mesh,
  Material,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  MeshNormalMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  PCFSoftShadowMap,
  Quaternion,
  RGBADepthPacking,
  ShadowMaterial,
  Object3D,
  OctahedronGeometry,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PCFShadowMap,
  PMREMGenerator,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Skeleton,
  SkinnedMesh,
  SRGBColorSpace,
  SphereGeometry,
  TetrahedronGeometry,
  Texture,
  TextureLoader,
  TorusGeometry,
  TorusKnotGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  CircleGeometry,
  Clock,
} from "three";
import { clone as cloneSkeletalGroup } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";
import CameraControls from "camera-controls";

CameraControls.install({ THREE });
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { createAlignmentShape, findAlignmentSnaps } from "./alignment";
import {
  animationValueToBoolean,
  getAnimationValue,
  isDiscreteAnimationProperty,
  isTrackMuted,
} from "./animation";
import { DEFAULT_FONT_ID, parseFontAsset } from "./fonts";
import { tryDecodeDataUrl } from "./modelBuffer";
import { buildStructureFromGroup, findObjectByIndexPath, findObjectByUsdPath } from "./modelStructure";
import { runTask } from "./react/hooks/useAsyncTask";
import { EditorStore } from "./state";
import type {
  AnimationEasePreset,
  AnimationKeyframe,
  AnimationPropertyPath,
  EditorNode,
  EditorStoreChange,
  ImageNode,
  MaterialSpec,
  ModelAsset,
  ModelNode,
  NodeOriginSpec,
  TextNode,
} from "./types";

type GizmoMode = "translate" | "rotate" | "scale";

type MaterialBaseOptions = Record<string, unknown>;

interface SceneEditorOptions {
  onTransformObjectChange?: (nodeId: string, object: Object3D) => boolean;
}

interface AnimationPreviewOverride {
  nodeId: string;
  property: AnimationPropertyPath;
  frame: number;
  value: number;
}

interface ModelCacheEntry {
  src: string;
  format: ModelAsset["format"];
  promise: Promise<Group>;
}

const MATERIAL_TEXTURE_PROPERTIES = [
  "map",
  "alphaMap",
  "aoMap",
  "bumpMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "iridescenceMap",
  "iridescenceThicknessMap",
  "lightMap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "transmissionMap",
] as const;

function disposeMaterialTextures(material: Material, disposedTextures: Set<Texture>): void {
  const record = material as unknown as Record<string, unknown>;
  for (const property of MATERIAL_TEXTURE_PROPERTIES) {
    const texture = record[property];
    if (texture instanceof Texture && !disposedTextures.has(texture)) {
      texture.dispose();
      disposedTextures.add(texture);
    }
  }
}

function disposeObjectResources(
  root: Object3D,
  options: { disposeTextures?: boolean; skipModelResources?: boolean } = {},
): void {
  const disposedGeometries = new Set<{ dispose: () => void }>();
  const disposedMaterials = new Set<Material>();
  const disposedTextures = new Set<Texture>();

  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    // For model-node meshes the geometry + shared materials live in the
    // modelGroupCache and must not be disposed here. Per-node material
    // *clones* are tagged with `userData.isClonedForNode` so we still dispose
    // them — otherwise the cloned MeshPhysicalMaterial leaks GPU memory once
    // the wrapper is removed from the scene.
    const isSharedModelMesh = !!options.skipModelResources && object.userData.nodeType === "model";

    if (!isSharedModelMesh && object.geometry && !disposedGeometries.has(object.geometry)) {
      object.geometry.dispose();
      disposedGeometries.add(object.geometry);
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || disposedMaterials.has(material)) {
        continue;
      }
      if (isSharedModelMesh && material.userData?.isClonedForNode !== true) {
        continue;
      }
      if (options.disposeTextures) {
        disposeMaterialTextures(material, disposedTextures);
      }
      material.dispose();
      disposedMaterials.add(material);
    }
  });
}

/**
 * Apply the *scalar/color* fields of a MaterialSpec onto an already-built
 * Material instance (typically a clone of a USD-parsed `MeshPhysicalMaterial`).
 * Used by primPath ModelNodes so the user can edit color/roughness/metalness/
 * etc. via Inspector while keeping the textures the OpenUSD parser baked onto
 * the source material. Properties not exposed in the spec are left untouched.
 */
function applyMaterialSpecOverrides(material: Material, spec: MaterialSpec): void {
  const mat = material as unknown as Record<string, unknown> & {
    color?: Color;
    emissive?: Color;
  };
  if (mat.color && typeof mat.color.set === "function") {
    mat.color.set(spec.color);
  }
  if (mat.emissive && typeof mat.emissive.set === "function") {
    mat.emissive.set(spec.emissive);
  }
  if ("emissiveIntensity" in mat) mat.emissiveIntensity = spec.emissiveIntensity;
  if ("roughness" in mat) mat.roughness = spec.roughness;
  if ("metalness" in mat) mat.metalness = spec.metalness;
  mat.opacity = spec.opacity;
  mat.transparent = spec.transparent;
  mat.alphaTest = spec.alphaTest;
  mat.visible = spec.visible;
  mat.depthTest = spec.depthTest;
  mat.depthWrite = spec.depthWrite;
  mat.colorWrite = spec.colorWrite;
  mat.dithering = spec.dithering;
  mat.toneMapped = spec.toneMapped;
  if ("wireframe" in mat) mat.wireframe = spec.wireframe;
  material.side = resolveMaterialSide(spec.side);
  material.needsUpdate = true;
}

/**
 * Texture slots stripped while the editor is in "solid" view. Covers
 * MeshStandardMaterial + every extension on MeshPhysicalMaterial. Listed
 * explicitly rather than enumerated via `for…in` so we never accidentally
 * walk past Material.userData / Material.uuid and so the round-trip is
 * deterministic.
 */
const SOLID_STRIPPED_TEXTURE_KEYS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "lightMap",
  "envMap",
  "specularColorMap",
  "specularIntensityMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "transmissionMap",
  "thicknessMap",
  "iridescenceMap",
  "iridescenceThicknessMap",
  "anisotropyMap",
] as const;

const SOLID_STASH_KEY = "__solidStash";

interface SolidStash {
  textures: Partial<Record<typeof SOLID_STRIPPED_TEXTURE_KEYS[number], Texture | null>>;
}

function isLiveTexture(value: unknown): value is Texture {
  return !!value && typeof value === "object" && (value as { isTexture?: boolean }).isTexture === true;
}

/**
 * Blender-like solid mode: while in solid view, every Material instance has
 * its texture map slots nulled (so the GPU never uploads them) and the live
 * Texture refs stashed on userData. Switching back to rendered/wireframe
 * restores them.
 *
 * Important: do NOT rely on the presence of `userData[SOLID_STASH_KEY]` as
 * a "this material is already in solid" flag. When Three.js's `Material.copy`
 * clones a material (via `.clone()`), it deep-clones userData with
 * `JSON.parse(JSON.stringify(source.userData))` — which calls each Texture's
 * `.toJSON()` and replaces the live Texture refs in our stash with serialised
 * metadata. The cloned material then carries a `__solidStash` key whose
 * contents are useless plain objects, yet the live map slots are also copied
 * over (Material.copy copies them by reference). So a "stash present" clone
 * may still have live textures we need to strip. Always inspect the actual
 * map slots and only treat values with `.isTexture === true` as restorable.
 */
function applySolidShading(materialOrList: Material | Material[] | null | undefined, solid: boolean): void {
  if (!materialOrList) return;
  if (Array.isArray(materialOrList)) {
    for (const m of materialOrList) applySolidShading(m, solid);
    return;
  }
  const material = materialOrList;
  const indexed = material as unknown as Record<string, Texture | null | undefined>;
  const userData = material.userData as Record<string, unknown>;
  const existing = userData[SOLID_STASH_KEY] as SolidStash | undefined;

  if (solid) {
    const captured: SolidStash["textures"] = {};
    let stripped = false;
    for (const key of SOLID_STRIPPED_TEXTURE_KEYS) {
      const value = indexed[key];
      if (isLiveTexture(value)) {
        captured[key] = value;
        indexed[key] = null;
        stripped = true;
      } else if (value !== null && value !== undefined) {
        // Non-Texture leftover in a map slot (e.g. JSON-cloned metadata
        // from a previous round trip). Null it so it doesn't render.
        indexed[key] = null;
        stripped = true;
      }
    }
    if (stripped) {
      // Merge in any still-valid Texture entries from a prior stash that we
      // didn't re-capture this round, so successive solid passes accumulate
      // instead of overwriting (e.g. when only some slots had been wired up
      // at the previous pass and more textures arrived since).
      if (existing) {
        for (const key of SOLID_STRIPPED_TEXTURE_KEYS) {
          if (key in captured) continue;
          const prior = existing.textures[key];
          if (isLiveTexture(prior)) {
            captured[key] = prior;
          }
        }
      }
      userData[SOLID_STASH_KEY] = { textures: captured } satisfies SolidStash;
      material.needsUpdate = true;
    }
    // If we stripped nothing this round, do NOT touch any existing stash:
    // that's almost always the legitimate "already-stripped" state from a
    // previous pass (maps null + stash carrying the real Texture refs) which
    // we need to keep intact so a later switch to rendered/wireframe can
    // restore the textures. Deleting it here was the regression that left
    // certain meshes stuck in solid mode until the model rebuilt.
    return;
  }

  if (!existing) return;
  for (const key of SOLID_STRIPPED_TEXTURE_KEYS) {
    if (!(key in existing.textures)) continue;
    const stashed = existing.textures[key];
    // Only restore real Texture instances. Anything else is JSON-serialised
    // metadata from a Material.copy round-trip and can't be used as a map.
    indexed[key] = isLiveTexture(stashed) ? stashed : null;
  }
  delete userData[SOLID_STASH_KEY];
  material.needsUpdate = true;
}

function buildMaterialFromSpec(baseOptions: MaterialBaseOptions, spec: MaterialSpec): Material {
  switch (spec.type) {
    case "basic":
      return new MeshBasicMaterial({
        ...baseOptions,
        fog: spec.fog,
      });
    case "lambert":
      return new MeshLambertMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        flatShading: spec.flatShading,
        fog: spec.fog,
      });
    case "phong":
      return new MeshPhongMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        specular: spec.specular,
        shininess: spec.shininess,
        flatShading: spec.flatShading,
        fog: spec.fog,
      });
    case "toon":
      return new MeshToonMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        fog: spec.fog,
      });
    case "physical":
      return new MeshPhysicalMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        roughness: spec.roughness,
        metalness: spec.metalness,
        envMapIntensity: spec.envMapIntensity,
        flatShading: spec.flatShading,
        fog: spec.fog,
        ior: spec.ior,
        transmission: spec.transmission,
        thickness: spec.thickness,
        clearcoat: spec.clearcoat,
        clearcoatRoughness: spec.clearcoatRoughness,
        reflectivity: spec.reflectivity,
        iridescence: spec.iridescence,
        iridescenceIOR: spec.iridescenceIOR,
        iridescenceThicknessRange: [
          spec.iridescenceThicknessRangeStart,
          spec.iridescenceThicknessRangeEnd,
        ],
        sheen: spec.sheen,
        sheenRoughness: spec.sheenRoughness,
        sheenColor: spec.sheenColor,
        specularIntensity: spec.specularIntensity,
        specularColor: spec.specularColor,
        attenuationDistance: spec.attenuationDistance,
        attenuationColor: spec.attenuationColor,
        dispersion: spec.dispersion,
        anisotropy: spec.anisotropy,
      });
    case "normal":
      return new MeshNormalMaterial({
        ...baseOptions,
        flatShading: spec.flatShading,
      });
    case "depth":
      return new MeshDepthMaterial({
        ...baseOptions,
        depthPacking: resolveDepthPacking(spec.depthPacking),
      });
    default:
      return new MeshStandardMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        roughness: spec.roughness,
        metalness: spec.metalness,
        envMapIntensity: spec.envMapIntensity,
        flatShading: spec.flatShading,
        fog: spec.fog,
      });
  }
}

function resolveMaterialSide(side: MaterialSpec["side"]) {
  switch (side) {
    case "back":
      return BackSide;
    case "double":
      return DoubleSide;
    default:
      return FrontSide;
  }
}

function resolveDepthPacking(depthPacking: MaterialSpec["depthPacking"]) {
  return depthPacking === "rgba" ? RGBADepthPacking : BasicDepthPacking;
}
export type ToolMode = "select" | GizmoMode;

const DRAG_SNAP_THRESHOLD = 0.18;
const ANIMATION_UI_EMIT_INTERVAL_MS = 1000 / 20;
const SELECTION_HELPER_PLAYBACK_UPDATE_INTERVAL_MS = 1000 / 12;

interface CompiledAnimationTrack {
  propertyPath: AnimationPropertyPath;
  owner: Record<string, unknown>;
  property: string;
  baseValue: number;
  keyframes: AnimationKeyframe[];
  target?: Object3D;
  visibilityMesh?: Mesh | null;
}

/**
 * One USDZ skeletal animation registered for playback on a ModelNode. The
 * skeleton's bones (cloned via SkeletonUtils together with the SkinnedMesh
 * so the new SkinnedMesh.skeleton references the cloned bones) live inside
 * the model's wrapper Object3D. `joints` is the SkelAnimation's authored
 * joint order remapped to indices into the skeleton's bone array — applying
 * a frame walks this map writing position/quaternion/scale to bone i.
 *
 * `frames` is sorted by ascending frame; lookup is a binary-search to find
 * the bracketing pair, then per-channel lerp/slerp. Out-of-range frames
 * clamp to the nearest sample.
 */
interface SkeletalPlayback {
  skeleton: Skeleton;
  jointToBoneIndex: Int32Array;
  fps: number;
  durationFrames: number;
  frames: Array<{
    frame: number;
    translations: Float32Array;
    rotations: Float32Array;
    scales: Float32Array;
  }>;
}

export class SceneEditor {
  private readonly textureLoader = new TextureLoader();
  private readonly container: HTMLElement;
  private readonly store: EditorStore;
  private readonly onTransformObjectChange?: (nodeId: string, object: Object3D) => boolean;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly orientationRenderer: WebGLRenderer;
  private readonly orientationScene: Scene;
  private readonly orientationCamera: PerspectiveCamera;
  private readonly orientationRoot = new Group();
  private readonly orientationInteractive: Object3D[] = [];
  private readonly orientationRaycaster = new Raycaster();
  private readonly orientationPointer = new Vector2();
  private readonly cameraControls: CameraControls;
  private readonly cameraClock = new Clock();
  private readonly transformControls: TransformControls;
  private readonly transformHelper: Object3D;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly viewportRoot = new Group();
  private readonly objectMap = new Map<string, Object3D>();
  private readonly childContainerMap = new Map<string, Object3D>();
  private readonly gltfLoader = new GLTFLoader();
  private readonly usdLoader = new USDLoader();
  private readonly rgbeLoader = new RGBELoader();
  // Parsed-model cache: maps asset.id → Promise<Group> so each model is parsed
  // once. Subsequent scene rebuilds clone the cached Group instead of re-parsing.
  private readonly modelGroupCache = new Map<string, ModelCacheEntry>();
  private readonly selectionBounds = new Box3();
  private readonly selectionSize = new Vector3();
  private readonly selectionCenter = new Vector3();
  private readonly selectedObjects: Object3D[] = [];
  private readonly infiniteGrid: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: () => void;
  private readonly textureCache = new Map<string, Texture>();
  private readonly pmremGenerator: PMREMGenerator;
  private readonly neutralEnvironmentTarget: WebGLRenderTarget;
  private readonly hdrEnvironmentCache = new Map<string, { target: WebGLRenderTarget; source: Texture }>();
  private readonly animationFrameListeners = new Set<(frame: number) => void>();

  private animationFrame = 0;
  private animationTracks: CompiledAnimationTrack[] = [];
  // Skeletal playbacks keyed by ModelNode id. Each entry binds a SkinnedMesh
  // assembly (cloned via SkeletonUtils so its bones live in the wrapper) to
  // the per-frame joint TRS baked at import time. applyAnimationFrame walks
  // these and writes bone.position/quaternion/scale at the current frame,
  // independently of the keyframe track system.
  private readonly skeletalPlaybacks = new Map<string, SkeletalPlayback>();
  private readonly animationPreviewOverrides = new Map<string, AnimationPreviewOverride>();
  private animationRuntimeReady = false;
  private currentAnimationFrame = 0;
  private isAnimationPlaying = false;
  private animationPlaybackStartedAt = 0;
  private animationPlaybackStartFrame = 0;
  private lastEmittedAnimationFrame: number | null = null;
  private lastAnimationFrameEmitAt = 0;
  private lastSelectionHelperUpdateAt = 0;
  private selectionHelperDirty = true;
  private isSnapModifierPressed = false;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private mainLight: DirectionalLight | null = null;
  private hemisphereLight: HemisphereLight | null = null;
  private ambientLight: AmbientLight | null = null;
  // Light-weight Blender-like selection outline: per-mesh EdgesGeometry drawn
  // as LineSegments in light purple. Lives at the scene root (not inside
  // viewportRoot) so picking and view-mode passes ignore it. Edge geometries
  // are cached per source BufferGeometry — only the LineSegments wrappers are
  // recreated when selection changes; geometry is reused.
  private readonly selectionOutlineRoot = new Group();
  private readonly selectionOutlineMaterial = new LineBasicMaterial({
    color: 0xc4b5fd,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    toneMapped: false,
  });
  private readonly edgesGeometryCache = new WeakMap<BufferGeometry, EdgesGeometry>();
  // Each entry pairs the rendered outline line with the source Mesh it traces
  // so we can sync matrices on every frame after the mesh's world transform
  // changes (animation playback, gizmo drag, parent re-rebuild).
  private selectionOutlines: Array<{ line: LineSegments; source: Mesh }> = [];
  private selectionVisualsSuppressed = false;
  private currentMode: ToolMode = "select";
  private currentGizmoMode: GizmoMode = "translate";
  private isTransformDragging = false;
  private skipNextSelectionPick = false;
  private readonly ORIENTATION_SIZE = 86;
  private environmentLoadToken = 0;

  constructor(container: HTMLElement, store: EditorStore, options: SceneEditorOptions = {}) {
    this.container = container;
    this.store = store;
    this.onTransformObjectChange = options.onTransformObjectChange;

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.style.display = "block";
    this.container.appendChild(this.renderer.domElement);
    this.pmremGenerator = new PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();
    const neutralEnvironment = new RoomEnvironment();
    this.neutralEnvironmentTarget = this.pmremGenerator.fromScene(neutralEnvironment);
    neutralEnvironment.dispose();

    this.scene = new Scene();
    this.scene.background = new Color(this.store.sceneSettings.backgroundColor);

    this.camera = new PerspectiveCamera(45, 1, 0.01, 2000);
    this.camera.position.set(6, 5, 8);

    this.orientationRenderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.orientationRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.orientationRenderer.setClearColor(0x000000, 0);
    this.orientationRenderer.domElement.className = "viewport-orientation-gizmo";
    this.orientationRenderer.domElement.style.position = "absolute";
    this.orientationRenderer.domElement.style.bottom = "10px";
    this.orientationRenderer.domElement.style.left = "10px";
    this.orientationRenderer.domElement.style.pointerEvents = "auto";
    this.orientationRenderer.domElement.style.cursor = "pointer";
    this.orientationRenderer.domElement.style.width = `${this.ORIENTATION_SIZE}px`;
    this.orientationRenderer.domElement.style.height = `${this.ORIENTATION_SIZE}px`;
    this.container.appendChild(this.orientationRenderer.domElement);

    this.orientationScene = new Scene();
    this.orientationCamera = new PerspectiveCamera(50, 1, 0.1, 10);
    this.orientationCamera.position.set(0, 0, 3);
    this.buildOrientationGizmo();
    this.orientationScene.add(this.orientationRoot);
    this.orientationRenderer.domElement.addEventListener("pointerdown", this.handleOrientationPointerDown);

    this.cameraControls = new CameraControls(this.camera, this.renderer.domElement);
    this.cameraControls.setTarget(0, 1, 0, false);
    this.cameraControls.minDistance = 1;
    this.cameraControls.maxDistance = Infinity;
    this.cameraControls.smoothTime = 0.18;
    this.cameraControls.draggingSmoothTime = 0.08;
    this.cameraControls.dollyToCursor = true;
    this.cameraControls.infinityDolly = true;
    this.cameraControls.mouseButtons.left = CameraControls.ACTION.ROTATE;
    this.cameraControls.mouseButtons.middle = CameraControls.ACTION.DOLLY;
    this.cameraControls.mouseButtons.right = CameraControls.ACTION.TRUCK;
    this.cameraControls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformHelper = this.transformControls.getHelper();
    this.transformControls.setMode(this.currentGizmoMode);
    this.transformControls.setSize(0.9);
    this.transformControls.showX = true;
    this.transformControls.showY = true;
    this.transformControls.showZ = true;
    this.transformControls.addEventListener("dragging-changed", (event) => {
      this.isTransformDragging = Boolean((event as { value?: boolean }).value);
      this.cameraControls.enabled = !this.isTransformDragging;
    });
    this.transformControls.addEventListener("mouseDown", () => {
      this.skipNextSelectionPick = true;
      this.store.beginHistoryTransaction();
    });
    this.transformControls.addEventListener("mouseUp", () => {
      this.skipNextSelectionPick = true;
      this.store.commitHistoryTransaction("scene");
    });
    this.transformControls.addEventListener("objectChange", () => {
      const object = this.transformControls.object;
      const nodeId = object?.userData?.nodeId;
      if (!object || typeof nodeId !== "string") {
        return;
      }

      this.applyDragAlignmentSnap(nodeId, object);
      const wasHandled = this.onTransformObjectChange?.(nodeId, object) ?? false;
      if (!wasHandled) {
        this.store.setNodeTransformFromObject(nodeId, object);
      }
      // objectChange fires per pointer move (can exceed 60Hz on high-rate mice).
      // computeSelectionBounds runs updateMatrixWorld(true) on the viewport and
      // Box3.setFromObject across every selected object's descendants — for a
      // complex USDZ this can traverse thousands of meshes per event. Defer to
      // the rAF cache so it runs at most once per frame.
      this.selectionHelperDirty = true;
    });

    this.infiniteGrid = this.createInfiniteGrid();
    this.scene.add(this.infiniteGrid);
    this.scene.add(this.viewportRoot);
    this.scene.add(this.transformHelper);
    // Render selection outlines AFTER everything else so they sit on top
    // of any mesh they trace, regardless of depth ordering quirks.
    this.selectionOutlineRoot.renderOrder = 999;
    this.scene.add(this.selectionOutlineRoot);
    this.addHelpers();
    this.bindPointerSelection();
    window.addEventListener("keydown", this.handleWindowKeyDown);
    window.addEventListener("keyup", this.handleWindowKeyUp);
    window.addEventListener("blur", this.handleWindowBlur);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.unsubscribe = this.store.subscribe((change) => this.handleStoreChange(change));
    this.rebuildScene();
    this.resize();
    this.startLoop();
  }

  setTransformMode(mode: ToolMode): void {
    this.currentMode = mode;
    if (mode !== "select") {
      this.currentGizmoMode = mode;
      this.transformControls.setMode(mode);
    }
    this.refreshSelection();
  }

  getTransformMode(): ToolMode {
    return this.currentMode;
  }

  getNodeIdAtClientPoint(clientX: number, clientY: number): string | null {
    const hits = this.getHitsAtClientPoint(clientX, clientY);
    for (const hit of hits) {
      const nodeId = this.findNodeId(hit.object);
      if (nodeId) {
        return nodeId;
      }
    }

    return null;
  }

  frameSelection(): void {
    const selectedObjects = this.store.selectedNodeIds
      .map((nodeId) => this.objectMap.get(nodeId))
      .filter((object): object is Object3D => Boolean(object));

    if (!this.computeSelectionBounds(selectedObjects.length > 0 ? selectedObjects : [this.viewportRoot])) {
      this.cameraControls.setTarget(0, 0, 0, true);
      return;
    }

    this.selectionBounds.getCenter(this.selectionCenter);
    this.selectionBounds.getSize(this.selectionSize);

    const radius = Math.max(this.selectionSize.length() * 0.5, 1);
    const direction = new Vector3(1, 0.75, 1).normalize();
    const distance = radius * 2.2;

    const eye = this.selectionCenter.clone().addScaledVector(direction, distance);
    this.cameraControls.setLookAt(
      eye.x,
      eye.y,
      eye.z,
      this.selectionCenter.x,
      this.selectionCenter.y,
      this.selectionCenter.z,
      true,
    );
  }

  onAnimationFrameChange(listener: (frame: number) => void): () => void {
    this.animationFrameListeners.add(listener);
    listener(this.getCurrentAnimationFrame());
    return () => {
      this.animationFrameListeners.delete(listener);
    };
  }

  getCurrentAnimationFrame(): number {
    const clip = this.store.getActiveAnimationClip();
    if (!clip) {
      return 0;
    }
    return Math.max(0, Math.min(Math.round(this.currentAnimationFrame), clip.durationFrames));
  }

  getNodeAnimationValue(nodeId: string, property: AnimationPropertyPath): number | null {
    const object = this.objectMap.get(nodeId);
    if (!object) {
      return null;
    }

    if (property === "visible") {
      return this.getAnimatedVisibilityValue(object);
    }

    const [owner, key] = resolveAnimationTarget(object, toObjectAnimationPath(property));
    if (!owner || !key) {
      return null;
    }

    const value = owner[key];
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  previewAnimationValue(nodeId: string, property: AnimationPropertyPath, value: number): void {
    this.applyAnimationValueToObject(nodeId, property, value);
  }

  setAnimationPreviewOverrides(overrides: AnimationPreviewOverride[]): void {
    this.animationPreviewOverrides.clear();
    for (const override of overrides) {
      if (!Number.isFinite(override.value)) {
        continue;
      }
      this.animationPreviewOverrides.set(
        `${override.nodeId}:${override.property}`,
        {
          ...override,
          frame: Math.max(0, Math.round(override.frame)),
        },
      );
    }
    this.applyAnimationPreviewOverrides(this.getCurrentAnimationFrame());
  }

  playAnimation(): void {
    const clip = this.store.getActiveAnimationClip();
    if (!clip) {
      return;
    }

    if (!this.animationRuntimeReady) {
      this.rebuildAnimationTimeline(false);
    }
    const startFrame = this.currentAnimationFrame >= clip.durationFrames ? 0 : this.currentAnimationFrame;
    if (startFrame !== this.currentAnimationFrame) {
      this.applyAnimationFrame(startFrame);
    }
    this.animationPlaybackStartFrame = startFrame;
    this.animationPlaybackStartedAt = performance.now();
    this.isAnimationPlaying = true;
    this.emitAnimationFrame(undefined, true);
  }

  pauseAnimation(): void {
    this.isAnimationPlaying = false;
    this.emitAnimationFrame(undefined, true);
  }

  stopAnimation(): void {
    this.isAnimationPlaying = false;
    this.seekAnimation(0);
    this.emitAnimationFrame(undefined, true);
  }

  seekAnimation(frame: number): void {
    if (!this.store.getActiveAnimationClip()) {
      this.emitAnimationFrame(0);
      return;
    }
    if (!this.animationRuntimeReady) {
      this.rebuildAnimationTimeline(false);
    }

    const clip = this.store.getActiveAnimationClip();
    if (!clip) {
      this.emitAnimationFrame(0);
      return;
    }
    const normalizedFrame = Math.max(0, Math.min(Math.round(frame), clip.durationFrames));
    this.isAnimationPlaying = false;
    this.applyAnimationFrame(normalizedFrame);
    this.emitAnimationFrame(undefined, true);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.isAnimationPlaying = false;
    window.removeEventListener("keydown", this.handleWindowKeyDown);
    window.removeEventListener("keyup", this.handleWindowKeyUp);
    window.removeEventListener("blur", this.handleWindowBlur);
    this.renderer.domElement.removeEventListener("pointerdown", this.handleCanvasPointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handleCanvasPointerUp);
    this.orientationRenderer.domElement.removeEventListener("pointerdown", this.handleOrientationPointerDown);
    this.transformControls.detach();
    this.transformControls.dispose();
    this.cameraControls.dispose();
    this.clearViewportRoot();
    this.clearModelGroupCache();
    this.clearTextureCache();
    this.clearHdrEnvironmentCache();
    this.clearSelectionOutlines();
    this.selectionOutlineMaterial.dispose();
    this.infiniteGrid.geometry.dispose();
    this.infiniteGrid.material.dispose();
    disposeObjectResources(this.orientationRoot);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.neutralEnvironmentTarget.dispose();
    this.pmremGenerator.dispose();
    this.orientationRenderer.dispose();
    this.orientationRenderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.orientationRenderer.domElement.remove();
  }

  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Shift") {
      this.isSnapModifierPressed = true;
    }
  };

  private readonly handleWindowKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "Shift") {
      this.isSnapModifierPressed = false;
    }
  };

  private readonly handleWindowBlur = (): void => {
    this.isSnapModifierPressed = false;
  };

  private readonly handleCanvasPointerDown = (event: PointerEvent): void => {
    this.pointerDownX = event.clientX;
    this.pointerDownY = event.clientY;
  };

  private readonly handleCanvasPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    if (this.skipNextSelectionPick) {
      this.skipNextSelectionPick = false;
      return;
    }

    if (this.isTransformDragging) {
      return;
    }

    const delta = Math.abs(event.clientX - this.pointerDownX) + Math.abs(event.clientY - this.pointerDownY);
    if (delta > 6) {
      return;
    }

    this.pick(event.clientX, event.clientY, event.shiftKey);
  };

  private readonly handleOrientationPointerDown = (event: PointerEvent): void => {
    const rect = this.orientationRenderer.domElement.getBoundingClientRect();
    this.orientationPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.orientationPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.orientationRaycaster.setFromCamera(this.orientationPointer, this.orientationCamera);
    const hits = this.orientationRaycaster.intersectObjects(this.orientationInteractive, false);
    const axis = hits[0]?.object?.userData?.axis as string | undefined;
    if (!axis) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.snapCameraToAxis(axis);
  };

  private handleStoreChange(change: EditorStoreChange): void {
    if (
      change.reason === "image" ||
      change.reason === "model" ||
      change.reason === "hdr" ||
      change.reason === "sceneSettings" ||
      change.reason === "structure" ||
      change.reason === "import"
    ) {
      this.reconcileAssetCaches();
    }

    if (change.reason === "selection") {
      this.refreshSelection();
      return;
    }

    if (change.reason === "view") {
      this.updateViewMode();
      // Solid mode also suppresses any user-loaded HDR env back to the
      // neutral fallback; rendered/wireframe restore it. Re-apply env here
      // so toggling the view mode re-evaluates which env to bind.
      void this.applyEnvironmentSettings();
      return;
    }

    if (change.reason === "sceneSettings") {
      this.applySceneSettings();
      return;
    }

    if (change.reason === "editable" || change.reason === "meta") {
      return;
    }

    if (change.reason === "animation") {
      this.rebuildAnimationTimeline();
      return;
    }

    if (change.reason === "node" && change.source === "scene") {
      this.refreshSelection();
      return;
    }

    // Fast-path: an undo/redo of a transform-or-visibility-only change can
    // patch the existing Object3Ds in place. This avoids `rebuildScene()` —
    // which re-clones the entire parsed USDZ tree on every cycle and is the
    // single biggest source of JS-heap churn for USDZ-heavy scenes.
    if (
      change.reason === "history" &&
      change.historyKind === "lightweight" &&
      change.affectedNodeIds &&
      change.affectedNodeIds.size > 0
    ) {
      this.applyLightweightHistory(change.affectedNodeIds);
      return;
    }

    this.rebuildScene();
  }

  private applyLightweightHistory(affectedNodeIds: ReadonlySet<string>): void {
    for (const nodeId of affectedNodeIds) {
      const node = this.store.getNode(nodeId);
      const object = this.objectMap.get(nodeId);
      if (!node || !object) continue;
      object.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z);
      object.rotation.set(node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z);
      object.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z);
      object.visible = node.visible;
    }
    // Selection bounds, outlines, and the transform gizmo anchor read live
    // Object3D state, so refresh them after the in-place patch.
    this.selectionHelperDirty = true;
    this.refreshSelection();
  }

  private updateViewMode(): void {
    const viewMode = this.store.viewMode;
    const isRendered = viewMode === "rendered";
    const isWireframe = viewMode === "wireframe";
    const isSolid = viewMode === "solid";

    if (this.mainLight) {
      this.mainLight.castShadow = isRendered && this.store.sceneSettings.shadows.enabled;
    }

    this.viewportRoot.traverse((object) => {
      if (object instanceof Mesh) {
        const nodeId = this.findNodeId(object);
        const node = nodeId ? this.store.getNode(nodeId) : undefined;
        const material = node && node.type !== "group" ? node.material : undefined;
        object.castShadow = isRendered && this.store.sceneSettings.shadows.enabled && (material?.castShadow ?? true);
        object.receiveShadow = isRendered && this.store.sceneSettings.shadows.enabled && (material?.receiveShadow ?? true);
        const meshMaterial = object.material;
        if (meshMaterial && !Array.isArray(meshMaterial) && "wireframe" in meshMaterial) {
          (meshMaterial as { wireframe: boolean }).wireframe = isWireframe || Boolean(material?.wireframe);
        }
        applySolidShading(meshMaterial as Material | Material[] | null | undefined, isSolid);
      }
    });

    if (isSolid) {
      this.warnAboutUnstrippedMaterials();
    }
  }

  /**
   * Diagnostic: after a solid-mode pass, walk viewportRoot once more looking
   * for any Mesh whose material still carries a live Texture in a known map
   * slot. Logs a single console group per offending mesh so we can tell which
   * materials are escaping `applySolidShading`. Kept opt-in via a dev flag on
   * window so the warn doesn't fire in production once we've identified and
   * patched the offending code path.
   */
  private warnAboutUnstrippedMaterials(): void {
    const globalAny = globalThis as { __forgeDebugSolid?: boolean };
    if (!globalAny.__forgeDebugSolid) return;
    const offenders: Array<{ nodeId: string | null; subsetName?: string; primPath?: string; liveSlots: string[]; material: Material }> = [];
    this.viewportRoot.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of materials) {
        if (!mat) continue;
        const indexed = mat as unknown as Record<string, unknown>;
        const live: string[] = [];
        for (const key of SOLID_STRIPPED_TEXTURE_KEYS) {
          if (isLiveTexture(indexed[key])) live.push(key);
        }
        if (live.length === 0) continue;
        const nodeId = this.findNodeId(object);
        const node = nodeId ? this.store.getNode(nodeId) : undefined;
        offenders.push({
          nodeId,
          subsetName: (node && node.type === "model" ? (node as { subsetName?: string }).subsetName : undefined),
          primPath: (node && node.type === "model" ? (node as { primPath?: string }).primPath : undefined),
          liveSlots: live,
          material: mat,
        });
      }
    });
    if (offenders.length === 0) {
      console.info("[forge-debug] solid pass clean — no live textures remaining.");
      return;
    }
    console.group(`[forge-debug] ${offenders.length} mesh(es) still carrying live textures after solid pass:`);
    for (const o of offenders) {
      console.warn(
        `node=${o.nodeId ?? "?"}, prim=${o.primPath ?? "-"}, subset=${o.subsetName ?? "-"}, slots=[${o.liveSlots.join(", ")}], material=`,
        o.material,
      );
    }
    console.groupEnd();
  }

  private addHelpers(): void {
    this.hemisphereLight = new HemisphereLight(0xffffff, 0xffffff, 0.8);
    this.scene.add(this.hemisphereLight);

    this.ambientLight = new AmbientLight(0xffffff, 0.3);
    this.scene.add(this.ambientLight);

    this.mainLight = new DirectionalLight(0xffffff, 1.4);
    this.mainLight.position.set(5, 9, 6);
    this.mainLight.castShadow = true;
    this.mainLight.shadow.mapSize.set(2048, 2048);
    const shadowCamera = this.mainLight.shadow.camera;
    shadowCamera.left = -25;
    shadowCamera.right = 25;
    shadowCamera.top = 25;
    shadowCamera.bottom = -25;
    shadowCamera.near = 0.5;
    shadowCamera.far = 80;
    shadowCamera.updateProjectionMatrix();
    this.mainLight.shadow.bias = -0.0005;
    this.mainLight.shadow.normalBias = 0.02;
    this.scene.add(this.mainLight);
    this.scene.add(this.mainLight.target);

    const shadowPlane = new Mesh(
      new PlaneGeometry(400, 400),
      new ShadowMaterial({ opacity: 0.32, transparent: true, depthWrite: false }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.005;
    shadowPlane.receiveShadow = true;
    shadowPlane.renderOrder = -1;
    shadowPlane.userData.isShadowReceiver = true;
    this.scene.add(shadowPlane);
    this.applySceneSettings();
  }

  private applySceneSettings(): void {
    const settings = this.store.sceneSettings;
    const background = new Color(settings.backgroundColor);
    this.scene.background = background;
    this.renderer.setClearColor(background, 1);
    this.renderer.toneMapping = settings.toneMapping.type === "acesFilmic"
      ? ACESFilmicToneMapping
      : settings.toneMapping.type === "linear"
        ? LinearToneMapping
        : NoToneMapping;
    this.renderer.toneMappingExposure = settings.toneMapping.exposure;
    this.renderer.shadowMap.enabled = settings.shadows.enabled;
    this.renderer.shadowMap.type = settings.shadows.type === "basic"
      ? BasicShadowMap
      : settings.shadows.type === "pcf"
        ? PCFShadowMap
        : PCFSoftShadowMap;

    if (this.ambientLight) {
      this.ambientLight.color.set(settings.lighting.ambientColor);
      this.ambientLight.intensity = settings.lighting.ambientIntensity;
    }
    if (this.hemisphereLight) {
      this.hemisphereLight.color.set(0xffffff);
      this.hemisphereLight.groundColor.set(0xffffff);
      this.hemisphereLight.intensity = Math.max(0.4, settings.lighting.ambientIntensity);
    }
    if (this.mainLight) {
      this.mainLight.color.set(settings.lighting.directionalColor);
      this.mainLight.intensity = settings.lighting.directionalIntensity;
    }
    void this.applyEnvironmentSettings();
    this.updateViewMode();
  }

  private async applyEnvironmentSettings(): Promise<void> {
    const token = ++this.environmentLoadToken;
    const settings = this.store.sceneSettings;
    const environmentScene = this.scene as Scene & { environmentIntensity?: number };
    environmentScene.environmentIntensity = settings.environment.intensity;

    // Honour an explicit "no environment" regardless of view mode — the user
    // turning the env off in settings is a strong signal that they don't want
    // any ambient/IBL on the materials, and solid mode shouldn't silently
    // re-bind a neutral env over that intent.
    if (settings.environment.type === "none") {
      this.scene.environment = null;
      environmentScene.environmentIntensity = 0;
      return;
    }

    if (settings.environment.type === "default") {
      this.scene.environment = this.neutralEnvironmentTarget.texture;
      environmentScene.environmentIntensity = settings.environment.intensity;
      return;
    }

    // From here on, type === "hdr". Solid mode suppresses the HDR back to the
    // neutral env so working flat doesn't pay for an HDR upload + the heavy
    // reflections it would put on every material; the HDR re-binds the moment
    // the user switches to rendered or wireframe.
    if (this.store.viewMode === "solid") {
      this.scene.environment = this.neutralEnvironmentTarget.texture;
      environmentScene.environmentIntensity = 1;
      return;
    }

    if (!settings.environment.hdrAssetId) {
      this.scene.environment = null;
      environmentScene.environmentIntensity = 0;
      return;
    }

    const asset = this.store.getHdrAsset(settings.environment.hdrAssetId);
    if (!asset || !asset.src) {
      this.scene.environment = null;
      environmentScene.environmentIntensity = 0;
      return;
    }

    try {
      const environment = await this.getHdrEnvironment(asset.src);
      if (token !== this.environmentLoadToken) {
        return;
      }

      this.scene.environment = environment.target.texture;
      environmentScene.environmentIntensity = this.store.sceneSettings.environment.intensity;
    } catch {
      if (token === this.environmentLoadToken) {
        this.scene.environment = null;
        environmentScene.environmentIntensity = 0;
      }
    }
  }

  private createInfiniteGrid(): Mesh<PlaneGeometry, ShaderMaterial> {
    const geometry = new PlaneGeometry(1200, 1200, 1, 1);
    const material = new ShaderMaterial({
      uniforms: {
        uCameraPosition: { value: new Vector3() },
      },
      vertexShader: `
        varying vec3 vWorldPosition;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uCameraPosition;
        varying vec3 vWorldPosition;

        float gridLine(float size, float thickness) {
          vec2 coordinate = vWorldPosition.xz / size;
          vec2 derivative = fwidth(coordinate);
          vec2 grid = abs(fract(coordinate - 0.5) - 0.5) / derivative;
          float line = min(grid.x, grid.y);
          return 1.0 - min(line / thickness, 1.0);
        }

        void main() {
          float minorLine = gridLine(1.0, 1.0);
          float majorLine = gridLine(5.0, 1.25);
          float axisX = 1.0 - smoothstep(0.0, fwidth(vWorldPosition.z) * 1.5, abs(vWorldPosition.z));
          float axisZ = 1.0 - smoothstep(0.0, fwidth(vWorldPosition.x) * 1.5, abs(vWorldPosition.x));
          float distanceToCamera = distance(vWorldPosition.xz, uCameraPosition.xz);
          float fade = 1.0 - smoothstep(90.0, 430.0, distanceToCamera);
          float alpha = max(max(minorLine * 0.2, majorLine * 0.42), max(axisX, axisZ) * 0.48) * fade;

          vec3 baseColor = vec3(0.212, 0.224, 0.251);
          vec3 majorColor = vec3(0.29, 0.302, 0.333);
          vec3 axisXColor = vec3(0.55, 0.21, 0.3);
          vec3 axisZColor = vec3(0.24, 0.32, 0.62);
          vec3 gridColor = mix(baseColor, majorColor, majorLine);
          gridColor = mix(gridColor, axisXColor, axisX * 0.7);
          gridColor = mix(gridColor, axisZColor, axisZ * 0.7);

          gl_FragColor = vec4(gridColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
    });
    const grid = new Mesh(geometry, material);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -0.001;
    grid.renderOrder = -10;
    return grid;
  }

  private updateInfiniteGrid(): void {
    const snapSize = 1;
    this.infiniteGrid.position.x = Math.round(this.camera.position.x / snapSize) * snapSize;
    this.infiniteGrid.position.z = Math.round(this.camera.position.z / snapSize) * snapSize;
    this.infiniteGrid.material.uniforms.uCameraPosition.value.copy(this.camera.position);
  }

  private buildOrientationGizmo(): void {
    this.orientationRoot.clear();
    this.orientationInteractive.length = 0;

    const createAxisLine = (color: string, rotation: { x?: number; y?: number; z?: number }, position: Vector3) => {
      const mesh = new Mesh(
        new CylinderGeometry(0.03, 0.03, 0.84, 6),
        new MeshBasicMaterial({ color }),
      );
      mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
      mesh.position.copy(position);
      this.orientationRoot.add(mesh);
    };

    createAxisLine("#ff5570", { z: -Math.PI / 2 }, new Vector3(0.42, 0, 0));
    createAxisLine("#79df53", {}, new Vector3(0, 0.42, 0));
    createAxisLine("#4d84ff", { x: Math.PI / 2 }, new Vector3(0, 0, 0.42));

    const createEndpoint = (axis: string, position: Vector3, color: string, opacity: number, scale = 0.14) => {
      const mesh = new Mesh(
        new SphereGeometry(scale, 18, 18),
        new MeshBasicMaterial({ color, transparent: opacity < 1, opacity }),
      );
      mesh.position.copy(position);
      mesh.userData.axis = axis;
      this.orientationRoot.add(mesh);
      this.orientationInteractive.push(mesh);
    };

    createEndpoint("posX", new Vector3(1, 0, 0), "#ff5570", 1, 0.15);
    createEndpoint("negX", new Vector3(-1, 0, 0), "#111318", 0.9, 0.13);
    createEndpoint("posY", new Vector3(0, 1, 0), "#79df53", 1, 0.15);
    createEndpoint("negY", new Vector3(0, -1, 0), "#111318", 0.9, 0.13);
    createEndpoint("posZ", new Vector3(0, 0, 1), "#4d84ff", 1, 0.15);
    createEndpoint("negZ", new Vector3(0, 0, -1), "#111318", 0.9, 0.13);

    const core = new Mesh(
      new SphereGeometry(0.08, 14, 14),
      new MeshBasicMaterial({ color: "#1d2026" }),
    );
    this.orientationRoot.add(core);
  }

  private snapCameraToAxis(axis: string): void {
    const focus = new Vector3();
    this.cameraControls.getTarget(focus);
    const distance = Math.max(this.camera.position.distanceTo(focus), 2);
    const direction = new Vector3();
    const verticalSnapOffset = 0.0001;

    switch (axis) {
      case "posX":
        direction.set(1, 0, 0);
        break;
      case "negX":
        direction.set(-1, 0, 0);
        break;
      case "posY":
        direction.set(0, 1, verticalSnapOffset).normalize();
        break;
      case "negY":
        direction.set(0, -1, verticalSnapOffset).normalize();
        break;
      case "posZ":
        direction.set(0, 0, 1);
        break;
      case "negZ":
        direction.set(0, 0, -1);
        break;
      default:
        return;
    }

    const eye = focus.clone().addScaledVector(direction, distance);
    this.cameraControls.setLookAt(eye.x, eye.y, eye.z, focus.x, focus.y, focus.z, true);
  }

  private bindPointerSelection(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.handleCanvasPointerDown);
    canvas.addEventListener("pointerup", this.handleCanvasPointerUp);
  }

  private pick(clientX: number, clientY: number, additive = false): void {
    const hits = this.getHitsAtClientPoint(clientX, clientY);
    for (const hit of hits) {
      const nodeId = this.findNodeId(hit.object);
      if (nodeId) {
        // For model nodes, also resolve the nearest part (sub-mesh) and stash
        // it as the selected part so the selection box wraps only that piece.
        const partId = this.findPartId(hit.object);
        this.store.selectNode(nodeId, "scene", additive);
        if (!additive) {
          this.store.setSelectedPartId(partId, "scene");
        }
        return;
      }
    }
  }

  private getHitsAtClientPoint(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.viewportRoot.children, true);
  }

  private findNodeId(object: Object3D | null): string | null {
    let current: Object3D | null = object;
    while (current && current !== this.viewportRoot) {
      const nodeId = current.userData?.nodeId;
      if (typeof nodeId === "string") {
        return nodeId;
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * Walk ancestors looking for `userData.partId`. Stops at the first hit OR
   * when it reaches a node boundary (`userData.nodeId`-bearing ancestor) —
   * partIds beyond that boundary belong to a different model and don't apply.
   */
  private findPartId(object: Object3D | null): string | null {
    let current: Object3D | null = object;
    while (current && current !== this.viewportRoot) {
      const partId = current.userData?.partId;
      if (typeof partId === "string") {
        return partId;
      }
      current = current.parent;
    }
    return null;
  }

  private rebuildScene(): void {
    this.clearViewportRoot();
    this.objectMap.clear();
    this.childContainerMap.clear();
    // Skeletal playbacks reference SkinnedMesh instances that lived in the
    // about-to-be-cleared scene. They re-register as buildModelObject runs
    // again for surviving model nodes.
    this.skeletalPlaybacks.clear();

    for (const node of this.store.blueprint.nodes) {
      const object = this.createObject(node);
      this.objectMap.set(node.id, object);
    }

    for (const node of this.store.blueprint.nodes) {
      const object = this.objectMap.get(node.id);
      if (!object) continue;

      if (node.parentId && this.objectMap.has(node.parentId)) {
        const parentContainer = this.childContainerMap.get(node.parentId) ?? this.objectMap.get(node.parentId);
        parentContainer?.add(object);
      } else {
        this.viewportRoot.add(object);
      }
    }

    this.updateViewMode();
    this.refreshSelection();
    this.rebuildAnimationTimeline();
  }

  private createObject(node: EditorNode): Object3D {
    const object = node.type === "group"
      ? this.buildGroupObject(node)
      : node.type === "model"
        ? this.buildModelObject(node)
      : this.buildWrappedNodeObject(node);
    object.name = node.name;
    object.visible = node.visible;
    object.userData.nodeId = node.id;
    object.userData.nodeType = node.type;
    object.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z);
    object.rotation.set(node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z);
    object.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z);
    return object;
  }

  private buildGroupObject(node: Extract<EditorNode, { type: "group" }>): Object3D {
    const wrapper = new Group();
    const content = new Group();
    content.position.set(node.pivotOffset.x, node.pivotOffset.y, node.pivotOffset.z);
    wrapper.add(content);
    this.childContainerMap.set(node.id, content);
    return wrapper;
  }

  private buildModelObject(node: ModelNode): Object3D {
    const wrapper = new Group();
    const asset = this.store.getModelAsset(node.modelId);
    if (!asset) {
      return wrapper;
    }

    const tagForNode = (root: Group): void => {
      root.traverse((child) => {
        child.userData.nodeId = node.id;
        child.userData.nodeType = node.type;
        if (child instanceof Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      // Tag each part with its index-path partId (matching ModelAssetStructure).
      // The structure treats root.children as roots ("0", "1", "2"…), then nests
      // by `${parentPath}.${index}` — so the root itself stays untagged.
      const tagPart = (object: Object3D, path: string) => {
        object.userData.partId = path;
        object.children.forEach((nested, idx) => tagPart(nested, `${path}.${idx}`));
      };
      root.children.forEach((child, idx) => tagPart(child, String(idx)));
    };

    // Cache the parsed Group per-asset so subsequent scene rebuilds clone the
    // cached result instead of re-parsing. Without this, ANY scene update
    // (move, select, property change) would re-run the WASM parser.
    let cacheEntry = this.modelGroupCache.get(asset.id);
    if (cacheEntry && (cacheEntry.src !== asset.src || cacheEntry.format !== asset.format)) {
      this.modelGroupCache.delete(asset.id);
      this.disposeModelCacheEntry(cacheEntry);
      cacheEntry = undefined;
    }

    if (!cacheEntry) {
      const taskLabel = `Loading ${asset.name ?? asset.format.toUpperCase()}`;
      let parsePromise: Promise<Group>;
      if (asset.format === "usdz") {
        const bytes = tryDecodeDataUrl(asset.src);
        if (bytes) {
          const buffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          // Primary path: OpenUSD WASM. Falls back to three.js USDLoader if
          // OpenUSD throws (covers ASCII USDA where OpenUSD plugin coverage may
          // be incomplete in our build).
          parsePromise = runTask(taskLabel, async (task) => {
            try {
              const { parseUsdz } = await import("../lib/openusd/openusdParser");
              return await parseUsdz(buffer, asset.name ?? "asset.usdz", task.update);
            } catch (openUsdError) {
              console.warn("OpenUSD parse failed, falling back to three.js USDLoader:", openUsdError);
              task.update({
                label: "Loading USDZ with fallback parser",
                detail: "OpenUSD failed; trying Three.js USDLoader",
                progress: null,
              });
              return await new Promise<Group>((resolve, reject) => {
                this.usdLoader.load(asset.src, resolve, undefined, reject);
              });
            }
          }, { blocking: true });
        } else {
          parsePromise = runTask(taskLabel, () => new Promise<Group>((resolve, reject) => {
            this.usdLoader.load(asset.src, resolve, undefined, reject);
          }), { blocking: true });
        }
      } else {
        parsePromise = runTask(taskLabel, () => new Promise<Group>((resolve, reject) => {
          this.gltfLoader.load(asset.src, (gltf) => resolve(gltf.scene), undefined, reject);
        }), { blocking: true });
      }

      cacheEntry = { src: asset.src, format: asset.format, promise: parsePromise };
      this.modelGroupCache.set(asset.id, cacheEntry);
      // Drop the cache entry on failure so the next attempt re-tries the parse
      // instead of replaying the cached rejection.
      parsePromise.catch(() => {
        if (this.modelGroupCache.get(asset.id)?.promise === parsePromise) {
          this.modelGroupCache.delete(asset.id);
        }
      });
      // Once the parse succeeds, derive the structure from the actual rendered
      // tree (with index-path IDs that survive clone()) and publish it on the
      // ModelAsset so the hierarchy panel can render it.
      parsePromise.then((cached) => {
        const currentEntry = this.modelGroupCache.get(asset.id);
        const currentAsset = this.store.getModelAsset(asset.id);
        if (
          currentEntry?.promise !== parsePromise ||
          !currentAsset ||
          currentAsset.src !== asset.src ||
          currentAsset.format !== asset.format
        ) {
          return;
        }
        const structure = buildStructureFromGroup(cached, asset.format);
        this.store.updateModelAssetStructure(asset.id, structure);
      }).catch(() => {/* already logged below */});
    }

    cacheEntry.promise
      .then((cached) => {
        // Bail if a later cache replacement has supplanted this promise
        // (asset re-imported, source bytes changed) — the stale cached Group
        // would render the wrong asset for the same node.
        if (this.modelGroupCache.get(asset.id)?.promise !== cacheEntry.promise) {
          return;
        }
        // Bail if a later rebuild has already detached this wrapper. Without
        // this guard the cloned materials we'd attach below escape the
        // disposeObjectResources sweep and leak GPU memory.
        if (!wrapper.parent) {
          return;
        }
        // primPath path: this ModelNode renders ONLY the meshes attached to
        // the specific USD prim in the cached group (its sibling prims are
        // rendered by other ModelNodes that share the same modelId). The
        // prim's own transform was already baked into the blueprint node's
        // `transform` at import time, so we render the meshes at identity.
        if (node.primPath) {
          const prim = findObjectByUsdPath(cached, node.primPath);
          if (!prim) {
            wrapper.clear();
            return;
          }
          const meshContainer = new Group();
          meshContainer.userData.nodeId = node.id;
          meshContainer.userData.nodeType = node.type;
          const targetSubset = node.subsetName;
          for (const child of prim.children) {
            if (!(child instanceof Mesh)) continue;
            // When this node is pinned to a specific GeomSubset, skip mesh
            // children that aren't part of that subset. Sibling subsets are
            // rendered by their own ModelNodes (one per subset), so each
            // subset is independently selectable, movable, and bindable to
            // its own MaterialAsset.
            if (targetSubset && child.userData?.usdSubsetName !== targetSubset) {
              continue;
            }
            const clonedMesh = child.clone();
            // Clone the material too so Inspector edits applied below don't
            // bleed across other prims that share the same parsed material
            // reference. The MaterialSpec on the node carries the editable
            // overrides; textures parsed from the USDZ are preserved on the
            // cloned material instance.
            const sourceMaterial = clonedMesh.material;
            if (Array.isArray(sourceMaterial)) {
              clonedMesh.material = sourceMaterial.map((m) => {
                const c = m.clone();
                c.userData = { ...c.userData, isClonedForNode: true };
                applyMaterialSpecOverrides(c, node.material);
                return c;
              });
            } else if (sourceMaterial) {
              const c = sourceMaterial.clone();
              c.userData = { ...c.userData, isClonedForNode: true };
              applyMaterialSpecOverrides(c, node.material);
              clonedMesh.material = c;
            }
            clonedMesh.userData.nodeId = node.id;
            clonedMesh.userData.nodeType = node.type;
            clonedMesh.castShadow = true;
            clonedMesh.receiveShadow = true;
            meshContainer.add(clonedMesh);
          }
          wrapper.clear();
          wrapper.add(meshContainer);
          // Async model loads finish AFTER rebuildScene's updateViewMode pass,
          // so the freshly-attached materials still carry textures. Re-run
          // updateViewMode so solid mode strips them immediately.
          this.updateViewMode();
          return;
        }

        // Skinned USDZ assets need SkeletonUtils.clone so the cloned
        // SkinnedMesh's skeleton reference rebinds to the cloned bones.
        // For non-skinned content the standard recursive clone is fine.
        const hasSkinned = cached.userData?.skeletalAnimations
          && Object.keys(cached.userData.skeletalAnimations).length > 0;
        const clone = (hasSkinned ? cloneSkeletalGroup(cached) : cached.clone(true)) as Group;
        tagForNode(clone);

        // Apply per-part visibility overrides. partId is the same index-path
        // used to build asset.structure, so walking clone.children by the
        // same path resolves to the matching Object3D in this instance.
        const overrides = node.partVisibility;
        if (overrides) {
          for (const [partId, visible] of Object.entries(overrides)) {
            if (visible !== false) continue;
            const target = findObjectByIndexPath(clone, partId);
            if (target) target.visible = false;
          }
        }

        wrapper.clear();
        wrapper.add(clone);
        if (hasSkinned) {
          this.registerSkeletalPlayback(node.id, clone, cached);
        }
        this.updateViewMode();
      })
      .catch((error) => {
        console.error("Failed to load model:", error);
      });

    return wrapper;
  }

  /**
   * Scan a freshly-cloned skinned model for {@link SkeletalPlayback}
   * candidates and register them under the owning ModelNode id. The cloned
   * SkinnedMesh carries its own .skeleton (rebound by SkeletonUtils.clone),
   * but the per-frame TRS data lives on the cached source group's userData
   * (it's shared across instances; cloning would waste memory). Joints
   * named on the SkelAnimation are remapped to skeleton bone indices via
   * the bone's `.name` (set to the USD joint path in
   * {@link buildThreeSkeleton}).
   */
  private registerSkeletalPlayback(nodeId: string, clone: Object3D, cached: Object3D): void {
    const animations = cached.userData?.skeletalAnimations as
      | Record<string, { fps: number; durationFrames: number; jointsOrder: string[]; frames: SkeletalPlayback["frames"] }>
      | undefined;
    if (!animations) return;

    // Drop any previous playback for the same node (re-render replaces the
    // wrapper, so the old skeleton ref is now orphaned).
    this.skeletalPlaybacks.delete(nodeId);

    let skinnedMesh: SkinnedMesh | null = null;
    let playbackKey: string | null = null;
    clone.traverse((object) => {
      if (skinnedMesh) return;
      if (!(object instanceof SkinnedMesh)) return;
      skinnedMesh = object;
      // The skeletalPlayback marker sits on the prim Object3D — walk parents
      // looking for it.
      let cursor: Object3D | null = object.parent;
      while (cursor) {
        const playback = cursor.userData?.skeletalPlayback as { animationPath: string } | undefined;
        if (playback?.animationPath) {
          playbackKey = playback.animationPath;
          break;
        }
        cursor = cursor.parent;
      }
    });
    if (!skinnedMesh || !playbackKey) return;
    const animation = animations[playbackKey];
    if (!animation || animation.frames.length === 0) return;

    const skeleton = (skinnedMesh as SkinnedMesh).skeleton;
    const boneIndexByName = new Map<string, number>();
    skeleton.bones.forEach((bone, idx) => boneIndexByName.set(bone.name, idx));

    const jointToBoneIndex = new Int32Array(animation.jointsOrder.length);
    for (let i = 0; i < animation.jointsOrder.length; i += 1) {
      jointToBoneIndex[i] = boneIndexByName.get(animation.jointsOrder[i]) ?? -1;
    }

    this.skeletalPlaybacks.set(nodeId, {
      skeleton,
      jointToBoneIndex,
      fps: animation.fps,
      durationFrames: animation.durationFrames,
      frames: animation.frames,
    });
  }

  private buildWrappedNodeObject(node: Exclude<EditorNode, { type: "group" | "model" }>): Object3D {
    const wrapper = new Group();
    const mesh = this.buildMeshObject(node);
    this.applyNodeOrigin(mesh, node.origin);
    wrapper.add(mesh);
    return wrapper;
  }

  private buildMeshObject(node: Exclude<EditorNode, { type: "group" | "model" }>): Mesh {
    let mesh: Mesh;
    switch (node.type) {
      case "box":
        mesh = new Mesh(new BoxGeometry(node.geometry.width, node.geometry.height, node.geometry.depth), this.createNodeMaterial(node));
        break;
      case "circle":
        mesh = new Mesh(new CircleGeometry(node.geometry.radius, node.geometry.segments, node.geometry.thetaLenght, node.geometry.thetaStarts), this.createNodeMaterial(node));
        break;
      case "sphere":
        mesh = new Mesh(new SphereGeometry(
          node.geometry.radius,
          Math.max(3, Math.round(node.geometry.widthSegments)),
          Math.max(2, Math.round(node.geometry.heightSegments)),
          node.geometry.phiStart,
          node.geometry.phiLength,
          node.geometry.thetaStart,
          node.geometry.thetaLength,
        ), this.createNodeMaterial(node));
        break;
      case "cylinder":
        mesh = new Mesh(new CylinderGeometry(
          node.geometry.radiusTop,
          node.geometry.radiusBottom,
          node.geometry.height,
          Math.max(3, Math.round(node.geometry.radialSegments)),
          Math.max(1, Math.round(node.geometry.heightSegments)),
          false,
          node.geometry.thetaStart,
          node.geometry.thetaLength,
        ), this.createNodeMaterial(node));
        break;
      case "cone":
        mesh = new Mesh(new ConeGeometry(
          node.geometry.radius,
          node.geometry.height,
          Math.max(3, Math.round(node.geometry.radialSegments)),
          Math.max(1, Math.round(node.geometry.heightSegments)),
          false,
          node.geometry.thetaStart,
          node.geometry.thetaLength,
        ), this.createNodeMaterial(node));
        break;
      case "capsule":
        mesh = new Mesh(new CapsuleGeometry(
          node.geometry.radius,
          node.geometry.length,
          Math.max(1, Math.round(node.geometry.capSegments)),
          Math.max(3, Math.round(node.geometry.radialSegments)),
        ), this.createNodeMaterial(node));
        break;
      case "ring":
        mesh = new Mesh(new RingGeometry(
          node.geometry.innerRadius,
          node.geometry.outerRadius,
          Math.max(3, Math.round(node.geometry.thetaSegments)),
          Math.max(1, Math.round(node.geometry.phiSegments)),
          node.geometry.thetaStart,
          node.geometry.thetaLength,
        ), this.createNodeMaterial(node));
        break;
      case "torus":
        mesh = new Mesh(new TorusGeometry(
          node.geometry.radius,
          node.geometry.tube,
          Math.max(3, Math.round(node.geometry.radialSegments)),
          Math.max(3, Math.round(node.geometry.tubularSegments)),
          node.geometry.arc,
        ), this.createNodeMaterial(node));
        break;
      case "torusKnot":
        mesh = new Mesh(new TorusKnotGeometry(
          node.geometry.radius,
          node.geometry.tube,
          Math.max(3, Math.round(node.geometry.tubularSegments)),
          Math.max(3, Math.round(node.geometry.radialSegments)),
          Math.max(1, Math.round(node.geometry.p)),
          Math.max(1, Math.round(node.geometry.q)),
        ), this.createNodeMaterial(node));
        break;
      case "dodecahedron":
        mesh = new Mesh(new DodecahedronGeometry(node.geometry.radius, Math.max(0, Math.round(node.geometry.detail))), this.createNodeMaterial(node));
        break;
      case "icosahedron":
        mesh = new Mesh(new IcosahedronGeometry(node.geometry.radius, Math.max(0, Math.round(node.geometry.detail))), this.createNodeMaterial(node));
        break;
      case "octahedron":
        mesh = new Mesh(new OctahedronGeometry(node.geometry.radius, Math.max(0, Math.round(node.geometry.detail))), this.createNodeMaterial(node));
        break;
      case "tetrahedron":
        mesh = new Mesh(new TetrahedronGeometry(node.geometry.radius, Math.max(0, Math.round(node.geometry.detail))), this.createNodeMaterial(node));
        break;
      case "plane":
        mesh = new Mesh(new PlaneGeometry(node.geometry.width, node.geometry.height), this.createNodeMaterial(node));
        break;
      case "image":
        mesh = this.createImageMesh(node);
        break;
      case "text":
        mesh = this.createTextMesh(node, this.createNodeMaterial(node));
        break;
    }

    mesh.castShadow = node.material.castShadow;
    mesh.receiveShadow = node.material.receiveShadow;
    mesh.visible = node.material.visible;
    return mesh;
  }

  private createTextMesh(node: TextNode, material: Material): Mesh {
    const font = this.resolveFont(node.fontId);
    const geometry = new TextGeometry(node.geometry.text || " ", {
      font,
      size: Math.max(node.geometry.size, 0.01),
      depth: Math.max(node.geometry.depth, 0),
      curveSegments: Math.max(1, Math.round(node.geometry.curveSegments)),
      bevelEnabled: node.geometry.bevelEnabled,
      bevelThickness: Math.max(node.geometry.bevelThickness, 0),
      bevelSize: Math.max(node.geometry.bevelSize, 0),
    });

    geometry.computeBoundingBox();
    return new Mesh(geometry, material);
  }

  private applyNodeOrigin(mesh: Mesh, origin: NodeOriginSpec): void {
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds) {
      return;
    }

    mesh.position.set(
      resolveOriginOffset(bounds.min.x, bounds.max.x, origin.x),
      resolveOriginOffset(bounds.min.y, bounds.max.y, origin.y),
      resolveOriginOffset(bounds.min.z, bounds.max.z, origin.z),
    );
  }

  private createNodeMaterial(node: Exclude<EditorNode, { type: "group" | "model" }>): Material {
    return buildMaterialFromSpec(this.createBaseMaterialOptions(node), node.material);
  }

  private createBaseMaterialOptions(node: Exclude<EditorNode, { type: "group" | "model" }>): MaterialBaseOptions {
    const materialTexture = this.getMaterialTexture(node.material);
    return {
      color: node.material.color,
      side: resolveMaterialSide(node.material.side),
      opacity: node.material.opacity,
      transparent: node.material.transparent,
      alphaTest: node.material.alphaTest,
      depthTest: node.material.depthTest,
      depthWrite: node.material.depthWrite,
      colorWrite: node.material.colorWrite,
      dithering: node.material.dithering,
      toneMapped: node.material.toneMapped,
      premultipliedAlpha: node.material.premultipliedAlpha,
      polygonOffset: node.material.polygonOffset,
      polygonOffsetFactor: node.material.polygonOffsetFactor,
      polygonOffsetUnits: node.material.polygonOffsetUnits,
      wireframe: node.material.wireframe,
      wireframeLinewidth: node.material.wireframeLinewidth,
      ...(materialTexture ? { map: materialTexture } : {}),
    };
  }

  private createImageMesh(node: ImageNode): Mesh {
    const geometry = new PlaneGeometry(node.geometry.width, node.geometry.height);
    const texture = this.getMaterialTexture(node.material) ?? this.getTexture(node.image.src);
    const baseOptions = {
      ...this.createBaseMaterialOptions(node),
      map: texture,
    };
    const material = buildMaterialFromSpec(baseOptions, node.material);
    return new Mesh(geometry, material);
  }

  private getMaterialTexture(material: MaterialSpec): Texture | null {
    if (!material.mapImageId) {
      return null;
    }
    const asset = this.store.getImageAsset(material.mapImageId);
    return asset ? this.getTexture(asset.src) : null;
  }

  private resolveFont(fontId: string): ReturnType<typeof parseFontAsset> {
    const fontAsset =
      this.store.getFont(fontId) ??
      this.store.getFont(DEFAULT_FONT_ID) ??
      this.store.fonts[0];

    if (!fontAsset) {
      throw new Error("No fonts available for text rendering.");
    }

    return parseFontAsset(fontAsset);
  }

  private getTexture(src: string): Texture {
    const cached = this.textureCache.get(src);
    if (cached) {
      return cached;
    }

    const texture = this.textureLoader.load(src);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    this.textureCache.set(src, texture);
    return texture;
  }

  private async getHdrEnvironment(src: string): Promise<{ target: WebGLRenderTarget; source: Texture }> {
    const cached = this.hdrEnvironmentCache.get(src);
    if (cached) {
      return cached;
    }

    const source = await this.rgbeLoader.loadAsync(src);
    const target = this.pmremGenerator.fromEquirectangular(source);
    const environment = { target, source };
    this.hdrEnvironmentCache.set(src, environment);
    return environment;
  }

  private refreshSelection(): void {
    const selectedObjects = this.store.selectedNodeIds
      .map((nodeId) => this.objectMap.get(nodeId))
      .filter((object): object is Object3D => Boolean(object));
    this.selectedObjects.length = 0;
    this.selectedObjects.push(...selectedObjects);
    const primaryObject = this.objectMap.get(this.store.selectedNodeId);

    if (this.selectionVisualsSuppressed) {
      this.transformControls.detach();
      this.transformHelper.visible = false;
      this.clearSelectionOutlines();
      this.selectionHelperDirty = false;
      return;
    }

    if (shouldAttachTransformGizmo(this.currentMode, selectedObjects.length, Boolean(primaryObject)) && primaryObject) {
      this.transformControls.attach(primaryObject);
      this.transformHelper.visible = true;
    } else {
      this.transformControls.detach();
      this.transformHelper.visible = false;
    }

    // If a sub-part of a model is selected, narrow the selection box to that
    // part's Object3D instead of the whole model wrapper. The gizmo stays on
    // the wrapper (we don't support per-part transforms yet).
    const partObjects = this.collectSelectionPartObjects(selectedObjects);
    this.updateSelectionHelper(partObjects ?? selectedObjects);
    this.selectionHelperDirty = false;
  }

  setSelectionVisualsSuppressed(suppressed: boolean): void {
    if (this.selectionVisualsSuppressed === suppressed) {
      return;
    }
    this.selectionVisualsSuppressed = suppressed;
    this.refreshSelection();
  }

  private applyDragAlignmentSnap(nodeId: string, object: Object3D): void {
    if (
      !this.isTransformDragging ||
      !this.isSnapModifierPressed ||
      this.currentGizmoMode !== "translate"
    ) {
      return;
    }

    const node = this.store.getNode(nodeId);
    const parent = object.parent;
    if (!node || !parent) {
      return;
    }

    const movingShape = this.createWorldAlignmentShape(nodeId, object);
    if (!movingShape) {
      return;
    }

    const candidateShapes = this.store.getNodeChildren(node.parentId)
      .filter((entry) => entry.id !== nodeId)
      .map((entry) => this.objectMap.get(entry.id))
      .filter((entry): entry is Object3D => Boolean(entry))
      .map((entry) => {
        const candidateNodeId = String(entry.userData.nodeId ?? "");
        return candidateNodeId ? this.createWorldAlignmentShape(candidateNodeId, entry) : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    if (candidateShapes.length === 0) {
      return;
    }

    const activeAxes = this.getActiveAlignmentAxes();
    if (activeAxes.length === 0) {
      return;
    }

    const snap = findAlignmentSnaps(movingShape, candidateShapes, DRAG_SNAP_THRESHOLD, undefined, activeAxes);
    if (snap.matches.length === 0) {
      return;
    }

    const nextWorldPivot = new Vector3(
      snap.position.x,
      snap.position.y,
      snap.position.z,
    );
    const nextLocalPivot = parent.worldToLocal(nextWorldPivot.clone());
    object.position.copy(nextLocalPivot);
  }

  private getActiveAlignmentAxes(): Array<"x" | "y" | "z"> {
    const axis = this.transformControls.axis ?? "XYZ";
    const activeAxes: Array<"x" | "y" | "z"> = [];

    if (axis.includes("X")) {
      activeAxes.push("x");
    }
    if (axis.includes("Y")) {
      activeAxes.push("y");
    }
    if (axis.includes("Z")) {
      activeAxes.push("z");
    }

    return activeAxes;
  }

  private createWorldAlignmentShape(nodeId: string, object: Object3D) {
    const worldPivot = object.getWorldPosition(new Vector3());
    const worldBounds = new Box3().setFromObject(object);

    if (worldBounds.isEmpty()) {
      return createAlignmentShape(nodeId, worldPivot, worldPivot, worldPivot);
    }

    return createAlignmentShape(nodeId, worldPivot, worldBounds.min, worldBounds.max);
  }

  /**
   * If the store has a selectedPartId AND exactly one node is selected and it
   * is a model node, returns the array of part Object3Ds that the selection
   * box should wrap. Returns null in any other case (caller falls back to the
   * full node wrappers).
   */
  private collectSelectionPartObjects(selectedObjects: Object3D[]): Object3D[] | null {
    const partId = this.store.selectedPartId;
    if (!partId) return null;
    if (selectedObjects.length !== 1) return null;
    const wrapper = selectedObjects[0];
    if (!wrapper) return null;
    // The model's parseUsdz Group lives at wrapper.children[0] (see buildModelObject).
    // Structure index-paths start from clone.children.
    const clone = wrapper.children[0];
    if (!clone) return null;
    const part = findObjectByIndexPath(clone, partId);
    return part ? [part] : null;
  }

  private clearSelectionOutlines(): void {
    if (this.selectionOutlines.length === 0) return;
    for (const entry of this.selectionOutlines) {
      this.selectionOutlineRoot.remove(entry.line);
      // Do NOT dispose the edge geometry — it lives in edgesGeometryCache and
      // may be reused by a future selection of the same mesh. The shared
      // material is also retained for the editor lifetime.
    }
    this.selectionOutlines.length = 0;
  }

  private getEdgesGeometry(geometry: BufferGeometry): EdgesGeometry {
    let cached = this.edgesGeometryCache.get(geometry);
    if (!cached) {
      // 15° threshold matches Blender's default "auto smooth" edge angle
      // closely enough for a wire-style outline that traces silhouettes and
      // hard creases without dragging in coplanar faces.
      cached = new EdgesGeometry(geometry, 15);
      this.edgesGeometryCache.set(geometry, cached);
    }
    return cached;
  }

  private updateSelectionHelper(objects: Object3D[]): void {
    this.clearSelectionOutlines();
    if (objects.length === 0) {
      this.lastSelectionHelperUpdateAt = performance.now();
      return;
    }

    for (const root of objects) {
      root.updateMatrixWorld(true);
      root.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        if (child.userData?.isShadowReceiver) return;
        const geometry = child.geometry as BufferGeometry | undefined;
        if (!geometry) return;
        const line = new LineSegments(this.getEdgesGeometry(geometry), this.selectionOutlineMaterial);
        line.matrixAutoUpdate = false;
        line.matrix.copy(child.matrixWorld);
        line.renderOrder = 999;
        // Selection outlines never participate in picking. They live outside
        // viewportRoot so the raycaster doesn't see them anyway, but make
        // the intent explicit in case future code walks the scene tree.
        line.raycast = () => {};
        this.selectionOutlineRoot.add(line);
        this.selectionOutlines.push({ line, source: child });
      });
    }
    this.lastSelectionHelperUpdateAt = performance.now();
  }

  private syncSelectionOutlines(): void {
    for (const entry of this.selectionOutlines) {
      entry.source.updateMatrixWorld();
      entry.line.matrix.copy(entry.source.matrixWorld);
    }
  }

  private updateSelectionHelperFromCache(): void {
    if (this.selectedObjects.length === 0) {
      if (this.selectionOutlines.length > 0) {
        this.clearSelectionOutlines();
      }
      this.selectionHelperDirty = false;
      return;
    }

    // The selection set itself didn't change; just keep outline transforms in
    // sync with their source meshes (handles gizmo drags, animation playback,
    // parent rebuilds that re-parent the same Mesh instance).
    if (!this.selectionHelperDirty) {
      this.syncSelectionOutlines();
      return;
    }

    const now = performance.now();
    if (
      this.isAnimationPlaying &&
      now - this.lastSelectionHelperUpdateAt < SELECTION_HELPER_PLAYBACK_UPDATE_INTERVAL_MS
    ) {
      this.syncSelectionOutlines();
      return;
    }

    const partObjects = this.collectSelectionPartObjects(this.selectedObjects);
    this.updateSelectionHelper(partObjects ?? this.selectedObjects);
    this.selectionHelperDirty = false;
  }

  private computeSelectionBounds(objects: Object3D[]): boolean {
    if (objects.length === 0) {
      this.selectionBounds.makeEmpty();
      return false;
    }

    // Box3.setFromObject relies on each object's matrixWorld being current;
    // after a rebuildScene the freshly created groups still hold identity
    // world matrices until the next render tick. Propagate the matrices
    // from the viewport root so the resulting bounds match the visible mesh.
    this.viewportRoot.updateMatrixWorld(true);

    const bounds = new Box3();
    let hasBounds = false;

    for (const object of objects) {
      const objectBounds = new Box3().setFromObject(object);
      if (objectBounds.isEmpty()) {
        continue;
      }

      if (!hasBounds) {
        bounds.copy(objectBounds);
        hasBounds = true;
        continue;
      }

      bounds.union(objectBounds);
    }

    if (!hasBounds) {
      this.selectionBounds.makeEmpty();
      return false;
    }

    this.selectionBounds.copy(bounds);
    return true;
  }

  private clearViewportRoot(): void {
    disposeObjectResources(this.viewportRoot, { skipModelResources: true });
    this.viewportRoot.clear();
  }

  private reconcileAssetCaches(): void {
    this.reconcileModelGroupCache();
    this.reconcileTextureCache();
    this.reconcileHdrEnvironmentCache();
  }

  private reconcileModelGroupCache(): void {
    const modelsById = new Map(this.store.models.map((asset) => [asset.id, asset] as const));
    for (const [assetId, entry] of this.modelGroupCache) {
      const asset = modelsById.get(assetId);
      if (asset && asset.src === entry.src && asset.format === entry.format) {
        continue;
      }
      this.modelGroupCache.delete(assetId);
      this.disposeModelCacheEntry(entry);
    }
  }

  private reconcileTextureCache(): void {
    const activeSources = new Set<string>();
    for (const image of this.store.images) {
      activeSources.add(image.src);
    }
    for (const node of this.store.blueprint.nodes) {
      if (node.type === "image") {
        activeSources.add(node.image.src);
      }
    }

    for (const [src, texture] of this.textureCache) {
      if (activeSources.has(src)) {
        continue;
      }
      texture.dispose();
      this.textureCache.delete(src);
    }
  }

  private reconcileHdrEnvironmentCache(): void {
    const settings = this.store.sceneSettings;
    const activeHdr = settings.environment.type === "hdr" && settings.environment.hdrAssetId
      ? this.store.getHdrAsset(settings.environment.hdrAssetId)
      : null;
    const activeSrc = activeHdr?.src ?? null;

    for (const [src, environment] of this.hdrEnvironmentCache) {
      if (src === activeSrc) {
        continue;
      }
      environment.target.dispose();
      environment.source.dispose();
      this.hdrEnvironmentCache.delete(src);
    }
  }

  private clearModelGroupCache(): void {
    for (const entry of this.modelGroupCache.values()) {
      this.disposeModelCacheEntry(entry);
    }
    this.modelGroupCache.clear();
  }

  private disposeModelCacheEntry(entry: ModelCacheEntry): void {
    entry.promise
      .then((group) => disposeObjectResources(group, { disposeTextures: true }))
      .catch(() => undefined);
  }

  private clearTextureCache(): void {
    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();
  }

  private clearHdrEnvironmentCache(): void {
    this.scene.environment = null;
    for (const environment of this.hdrEnvironmentCache.values()) {
      environment.target.dispose();
      environment.source.dispose();
    }
    this.hdrEnvironmentCache.clear();
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.orientationCamera.aspect = 1;
    this.orientationCamera.updateProjectionMatrix();
    this.orientationRenderer.setSize(this.ORIENTATION_SIZE, this.ORIENTATION_SIZE, false);
  }

  private startLoop(): void {
    const tick = () => {
      this.animationFrame = requestAnimationFrame(tick);
      this.updateAnimationPlayback();
      this.cameraControls.update(this.cameraClock.getDelta());
      this.updateInfiniteGrid();
      this.updateSelectionHelperFromCache();
      this.renderer.render(this.scene, this.camera);
      this.orientationRoot.quaternion.copy(this.camera.quaternion).invert();
      this.orientationRenderer.render(this.orientationScene, this.orientationCamera);
    };

    tick();
  }

  private rebuildAnimationTimeline(preserveState = true): void {
    const previousFrame = preserveState ? this.getCurrentAnimationFrame() : 0;
    const wasPlaying = this.isAnimationPlaying;
    this.isAnimationPlaying = false;
    this.animationTracks = [];
    this.animationRuntimeReady = false;
    this.lastEmittedAnimationFrame = null;
    this.resetAnimatedObjectsToBlueprintState();

    const clip = this.store.getActiveAnimationClip();
    if (!clip) {
      this.currentAnimationFrame = 0;
      this.animationRuntimeReady = true;
      this.emitAnimationFrame(0, true);
      return;
    }

    for (const track of clip.tracks) {
      if (isTrackMuted(track)) {
        continue;
      }
      const target = this.objectMap.get(track.nodeId);
      if (!target) {
        continue;
      }
      const node = this.store.getNode(track.nodeId);
      if (!node) {
        continue;
      }

      const objectPath = toObjectAnimationPath(track.property);
      const [owner, property] = resolveAnimationTarget(target, objectPath);
      if (!owner || !property) {
        continue;
      }

      const ordered = [...track.keyframes].sort((a, b) => a.frame - b.frame);
      if (ordered.length === 0) {
        continue;
      }

      this.animationTracks.push({
        propertyPath: track.property,
        owner,
        property,
        baseValue: getAnimationValue(node, track.property),
        keyframes: ordered,
        target,
        visibilityMesh: isDiscreteAnimationProperty(track.property)
          ? this.getAnimatedVisibilityMeshTarget(target)
          : null,
      });
    }

    const clampedFrame = Math.max(0, Math.min(previousFrame, clip.durationFrames));
    this.animationRuntimeReady = true;
    this.applyAnimationFrame(clampedFrame);
    if (wasPlaying) {
      this.animationPlaybackStartFrame = clampedFrame;
      this.animationPlaybackStartedAt = performance.now();
      this.isAnimationPlaying = true;
    }
    this.emitAnimationFrame(undefined, true);
  }

  private emitAnimationFrame(frame = this.getCurrentAnimationFrame(), force = false): void {
    const roundedFrame = Math.max(0, Math.round(frame));
    if (!force && this.lastEmittedAnimationFrame === roundedFrame) {
      return;
    }

    this.lastEmittedAnimationFrame = roundedFrame;
    this.lastAnimationFrameEmitAt = performance.now();
    for (const listener of this.animationFrameListeners) {
      listener(roundedFrame);
    }
  }

  private updateAnimationPlayback(): void {
    if (!this.isAnimationPlaying) {
      return;
    }

    const clip = this.store.getActiveAnimationClip();
    if (!clip) {
      this.isAnimationPlaying = false;
      this.applyAnimationFrame(0);
      this.emitAnimationFrame(0, true);
      return;
    }

    const now = performance.now();
    const fps = Math.max(clip.fps, 1);
    const elapsedFrames = ((now - this.animationPlaybackStartedAt) / 1000) * fps;
    const durationFrames = Math.max(clip.durationFrames, 1);
    const nextFrame = (this.animationPlaybackStartFrame + elapsedFrames) % durationFrames;
    const didLoop = nextFrame < this.currentAnimationFrame;
    this.applyAnimationFrame(nextFrame);
    if (didLoop || now - this.lastAnimationFrameEmitAt >= ANIMATION_UI_EMIT_INTERVAL_MS) {
      this.emitAnimationFrame();
    }
  }

  private applyAnimationFrame(frame: number): void {
    const clip = this.store.getActiveAnimationClip();
    const durationFrames = clip?.durationFrames ?? 0;
    const normalizedFrame = Math.max(0, Math.min(frame, durationFrames));
    this.currentAnimationFrame = normalizedFrame;
    let selectedObjectWasAnimated = false;

    this.resetAnimationTrackTargetsToBlueprintState();

    for (const track of this.animationTracks) {
      const value = evaluateCompiledTrack(track, normalizedFrame);
      if (isDiscreteAnimationProperty(track.propertyPath)) {
        const visible = animationValueToBoolean(track.propertyPath, value);
        if (track.target) {
          track.target.visible = visible;
        }
        if (track.visibilityMesh) {
          track.visibilityMesh.visible = visible;
        }
      } else {
        track.owner[track.property] = value;
      }
      if (
        track.target &&
        this.store.selectedNodeIds.includes(String(track.target.userData.nodeId ?? ""))
      ) {
        selectedObjectWasAnimated = true;
      }
    }

    if (selectedObjectWasAnimated) {
      this.selectionHelperDirty = true;
    }

    this.applySkeletalPlaybacks(normalizedFrame);
    this.applyAnimationPreviewOverrides(normalizedFrame);
  }

  /**
   * Drive every registered SkinnedMesh's bones from the baked per-frame
   * joint TRS at the active clip's current frame. This runs after the
   * keyframe-track pass so manual transform overrides on a model don't
   * leak into the skeleton — the skin always reflects the authored
   * skeletal animation while playback is active.
   *
   * Joints that didn't map to a bone (jointToBoneIndex[i] === -1) are
   * silently skipped — that happens when the SkelAnimation animates more
   * joints than the Skeleton declares (rare but allowed by USD).
   */
  private applySkeletalPlaybacks(frame: number): void {
    if (this.skeletalPlaybacks.size === 0) return;

    const tmpQuat = new Quaternion();
    for (const playback of this.skeletalPlaybacks.values()) {
      const { frames, skeleton, jointToBoneIndex } = playback;
      if (frames.length === 0) continue;

      const target = Math.max(0, Math.min(frame, playback.durationFrames));
      const { lower, upper, alpha } = bracketSkeletalFrame(frames, target);
      const lo = frames[lower];
      const hi = frames[upper];

      for (let j = 0; j < jointToBoneIndex.length; j += 1) {
        const boneIdx = jointToBoneIndex[j];
        if (boneIdx < 0 || boneIdx >= skeleton.bones.length) continue;
        const bone = skeleton.bones[boneIdx];

        const tBase = j * 3;
        const rBase = j * 4;
        // Translation/scale: per-channel linear interpolation. Both shrink
        // to constants when lower === upper (alpha === 0), so the same code
        // path handles "exact sample" too.
        if (tBase + 2 < lo.translations.length && tBase + 2 < hi.translations.length) {
          bone.position.set(
            lerp(lo.translations[tBase], hi.translations[tBase], alpha),
            lerp(lo.translations[tBase + 1], hi.translations[tBase + 1], alpha),
            lerp(lo.translations[tBase + 2], hi.translations[tBase + 2], alpha),
          );
        }
        if (tBase + 2 < lo.scales.length && tBase + 2 < hi.scales.length) {
          bone.scale.set(
            lerp(lo.scales[tBase], hi.scales[tBase], alpha),
            lerp(lo.scales[tBase + 1], hi.scales[tBase + 1], alpha),
            lerp(lo.scales[tBase + 2], hi.scales[tBase + 2], alpha),
          );
        }
        // Rotation: slerp on quaternions; per-component lerp drifts off
        // the unit sphere fast.
        if (rBase + 3 < lo.rotations.length && rBase + 3 < hi.rotations.length) {
          bone.quaternion.set(
            lo.rotations[rBase],
            lo.rotations[rBase + 1],
            lo.rotations[rBase + 2],
            lo.rotations[rBase + 3],
          );
          if (alpha > 0) {
            tmpQuat.set(
              hi.rotations[rBase],
              hi.rotations[rBase + 1],
              hi.rotations[rBase + 2],
              hi.rotations[rBase + 3],
            );
            bone.quaternion.slerp(tmpQuat, alpha);
          }
        }
      }
      skeleton.update();
    }
  }

  private applyAnimationPreviewOverrides(frame: number): void {
    const normalizedFrame = Math.max(0, Math.round(frame));
    for (const override of this.animationPreviewOverrides.values()) {
      if (override.frame !== normalizedFrame) {
        continue;
      }
      this.applyAnimationValueToObject(override.nodeId, override.property, override.value);
    }
  }

  private applyAnimationValueToObject(nodeId: string, property: AnimationPropertyPath, value: number): void {
    const object = this.objectMap.get(nodeId);
    if (!object || !Number.isFinite(value)) {
      return;
    }

    if (property === "visible") {
      const visible = animationValueToBoolean(property, value);
      object.visible = visible;
      const mesh = this.getAnimatedVisibilityMeshTarget(object);
      if (mesh) {
        mesh.visible = visible;
      }
      this.selectionHelperDirty = this.store.selectedNodeIds.includes(nodeId);
      return;
    }

    const [owner, key] = resolveAnimationTarget(object, toObjectAnimationPath(property));
    if (!owner || !key) {
      return;
    }

    owner[key] = value;
    this.selectionHelperDirty = this.store.selectedNodeIds.includes(nodeId);
  }

  private resetAnimatedObjectsToBlueprintState(): void {
    for (const node of this.store.blueprint.nodes) {
      const object = this.objectMap.get(node.id);
      if (!object) {
        continue;
      }

      this.applyNodeBaseStateToObject(node, object);
    }
  }

  private resetAnimationTrackTargetsToBlueprintState(): void {
    const resetNodeIds = new Set<string>();
    for (const track of this.animationTracks) {
      const nodeId = String(track.target?.userData.nodeId ?? "");
      if (!nodeId || resetNodeIds.has(nodeId)) {
        continue;
      }

      const node = this.store.getNode(nodeId);
      if (!node || !track.target) {
        continue;
      }

      this.applyNodeBaseStateToObject(node, track.target);
      resetNodeIds.add(nodeId);
    }
  }

  private applyNodeBaseStateToObject(node: EditorNode, object: Object3D): void {
    object.visible = node.visible;
    object.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z);
    object.rotation.set(node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z);
    object.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z);

    const mesh = this.getAnimatedVisibilityMeshTarget(object);
    if (mesh) {
      mesh.visible = node.visible;
    }
  }

  private getAnimatedVisibilityValue(object: Object3D): number {
    if (!object.visible) {
      return 0;
    }

    if (object.userData?.nodeType !== "group") {
      const mesh = object.children.find((child): child is Mesh => child instanceof Mesh);
      if (mesh && !mesh.visible) {
        return 0;
      }
    }

    return 1;
  }

  private getAnimatedVisibilityMeshTarget(object: Object3D): Mesh | null {
    if (object.userData?.nodeType === "group") {
      return null;
    }

    return object.children.find((child): child is Mesh => child instanceof Mesh) ?? null;
  }
}

function toObjectAnimationPath(path: string): string {
  return path.replace(/^transform\./, "");
}

function resolveAnimationTarget(target: Object3D, path: string): [Record<string, unknown> | null, string | null] {
  const segments = path.split(".");
  const property = segments.pop() ?? null;
  if (!property) {
    return [null, null];
  }

  const owner = segments.reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, target);

  if (!owner || typeof owner !== "object") {
    return [null, null];
  }

  return [owner as Record<string, unknown>, property];
}

function bracketSkeletalFrame(
  frames: SkeletalPlayback["frames"],
  target: number,
): { lower: number; upper: number; alpha: number } {
  if (frames.length <= 1 || target <= frames[0].frame) {
    return { lower: 0, upper: 0, alpha: 0 };
  }
  if (target >= frames[frames.length - 1].frame) {
    return { lower: frames.length - 1, upper: frames.length - 1, alpha: 0 };
  }
  let lo = 0;
  let hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].frame <= target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const span = frames[hi].frame - frames[lo].frame;
  const alpha = span === 0 ? 0 : (target - frames[lo].frame) / span;
  return { lower: lo, upper: hi, alpha };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function evaluateCompiledTrack(track: CompiledAnimationTrack, frame: number): number {
  const keyframes = track.keyframes;
  if (keyframes.length === 0 || frame < keyframes[0].frame) {
    return track.baseValue;
  }

  if (keyframes.length === 1 || frame === keyframes[0].frame) {
    return keyframes[0].value;
  }

  let low = 0;
  let high = keyframes.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const keyframe = keyframes[middle];
    if (frame === keyframe.frame) {
      return keyframe.value;
    }
    if (frame < keyframe.frame) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  const previous = keyframes[Math.max(0, high)];
  const next = keyframes[low];
  if (!next) {
    return previous.value;
  }
  if (isDiscreteAnimationProperty(track.propertyPath)) {
    return previous.value;
  }

  const span = Math.max(next.frame - previous.frame, 1);
  const progress = applyAnimationEase((frame - previous.frame) / span, next.ease);
  return previous.value + (next.value - previous.value) * progress;
}

function applyAnimationEase(progress: number, ease: AnimationEasePreset): number {
  const t = Math.max(0, Math.min(progress, 1));
  switch (ease) {
    case "linear":
      return t;
    case "easeIn":
      return t * t;
    case "easeOut":
      return 1 - ((1 - t) * (1 - t));
    case "easeInOut":
      return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    case "backOut": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * ((t - 1) ** 3) + c1 * ((t - 1) ** 2);
    }
    case "bounceOut":
      return bounceOut(t);
    default:
      return t;
  }
}

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  }
  if (t < 2 / d1) {
    const shifted = t - 1.5 / d1;
    return n1 * shifted * shifted + 0.75;
  }
  if (t < 2.5 / d1) {
    const shifted = t - 2.25 / d1;
    return n1 * shifted * shifted + 0.9375;
  }
  const shifted = t - 2.625 / d1;
  return n1 * shifted * shifted + 0.984375;
}

function resolveOriginOffset(
  min: number,
  max: number,
  origin: NodeOriginSpec["x"] | NodeOriginSpec["y"] | NodeOriginSpec["z"],
): number {
  switch (origin) {
    case "left":
    case "bottom":
    case "back":
      return -min;
    case "right":
    case "top":
    case "front":
      return -max;
    default:
      return -((min + max) * 0.5);
  }
}

/**
 * Returns true when the transform gizmo should attach to the primary selection.
 * The gizmo only appears in non-select tool modes, and requires the primary selected
 * object to be present in the scene. Multi-selection is supported — the gizmo still
 * attaches to the primary (last-selected) object.
 */
export function shouldAttachTransformGizmo(
  currentMode: ToolMode,
  selectionCount: number,
  hasPrimaryObject: boolean,
): boolean {
  if (currentMode === "select") {
    return false;
  }
  if (selectionCount === 0) {
    return false;
  }
  return hasPrimaryObject;
}
