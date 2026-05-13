import {
  AmbientLight,
  AxesHelper,
  Box3,
  BoxGeometry,
  Box3Helper,
  ClampToEdgeWrapping,
  Clock,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LinearFilter,
  LinearMipMapLinearFilter,
  Matrix4,
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
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipMapNearestFilter,
  PCFSoftShadowMap,
  RepeatWrapping,
  ShadowMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Texture,
  TextureLoader,
  VideoTexture,
  Vector2,
  Vector3,
  WebGLRenderer,
  CircleGeometry,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { createAlignmentShape, findAlignmentSnaps } from "./alignment";
import { computeRenderOrderByWorldZ } from "./paintOrder";
import { buildSkewMatrix, isIdentitySkew } from "./skew";
import {
  animationValueToBoolean,
  getAnimationValue,
  isDiscreteAnimationProperty,
  isTrackMuted,
  isW3DPlaybackGuarded,
  getPlaybackDiagnostics,
  maxPreviewFrameFromClips,
  W3D_PLAYBACK_GUARD_WARNING,
} from "./animation";
import { DEFAULT_FONT_ID, parseFontAsset } from "./fonts";
import { EditorStore } from "./state";
import type {
  AnimationEasePreset,
  AnimationKeyframe,
  AnimationPropertyPath,
  ComponentBlueprint,
  EditorNode,
  EditorStoreChange,
  ImageNode,
  ImageSequenceMetadata,
  MaterialSpec,
  NodeOriginSpec,
  TextNode,
  TextureSamplingOptions,
  Vec3Like,
} from "./types";

type GizmoMode = "translate" | "rotate" | "scale";

type MaterialBaseOptions = ConstructorParameters<typeof MeshBasicMaterial>[0];

function buildMaterialFromSpec(baseOptions: MaterialBaseOptions, spec: MaterialSpec): Material {
  switch (spec.type) {
    case "basic":
      return new MeshBasicMaterial(baseOptions);
    case "lambert":
      return new MeshLambertMaterial({
        ...baseOptions,
        emissive: spec.emissive,
      });
    case "phong":
      return new MeshPhongMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        specular: spec.specular,
        shininess: spec.shininess,
      });
    case "toon":
      return new MeshToonMaterial({
        ...baseOptions,
        emissive: spec.emissive,
      });
    case "physical":
      return new MeshPhysicalMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        roughness: spec.roughness,
        metalness: spec.metalness,
        ior: spec.ior,
        transmission: spec.transmission,
        thickness: spec.thickness,
        clearcoat: spec.clearcoat,
        clearcoatRoughness: spec.clearcoatRoughness,
      });
    case "normal":
      return new MeshNormalMaterial(baseOptions);
    case "depth":
      return new MeshDepthMaterial(baseOptions);
    default:
      return new MeshStandardMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        roughness: spec.roughness,
        metalness: spec.metalness,
      });
  }
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
  /** Optional post-write hook. Used by `transform.skew.*` tracks so the
   * shared skewLayer matrix gets rebuilt after any axis is updated. */
  postUpdate?: () => void;
}

export class SceneEditor {
  private readonly textureLoader = new TextureLoader();
  private readonly container: HTMLElement;
  private readonly store: EditorStore;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private camera: PerspectiveCamera | OrthographicCamera;
  private currentSceneMode: "2d" | "3d";
  private readonly orientationRenderer: WebGLRenderer;
  private readonly orientationScene: Scene;
  private readonly orientationCamera: PerspectiveCamera;
  private readonly orientationRoot = new Group();
  private readonly orientationInteractive: Object3D[] = [];
  private readonly orientationRaycaster = new Raycaster();
  private readonly orientationPointer = new Vector2();
  private readonly orbitControls: OrbitControls;
  private readonly transformControls: TransformControls;
  private readonly transformHelper: Object3D;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly viewportRoot = new Group();
  private readonly objectMap = new Map<string, Object3D>();
  private readonly childContainerMap = new Map<string, Object3D>();
  private readonly selectionBounds = new Box3();
  private readonly selectionSize = new Vector3();
  private readonly selectionCenter = new Vector3();
  private readonly tmpVec3 = new Vector3();
  private readonly selectedObjects: Object3D[] = [];
  private readonly infiniteGrid: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: () => void;
  private readonly textureCache = new Map<string, Texture>();
  private readonly videoTextureCache = new Map<string, VideoTexture>();
  private readonly sequencePlayers = new Map<string, ImageSequencePlayer>();
  private readonly playerClock = new Clock();
  private debugFallbackImage: HTMLCanvasElement | null = null;
  private imageMeshLogCount = 0;
  private readonly animationFrameListeners = new Set<(frame: number) => void>();

  private animationFrame = 0;
  private animationTracks: CompiledAnimationTrack[] = [];
  private animationRuntimeReady = false;
  private currentAnimationFrame = 0;
  private isAnimationPlaying = false;
  private animationPlaybackStartedAt = 0;
  private animationPlaybackStartFrame = 0;
  private lastEmittedAnimationFrame: number | null = null;
  /** Phase 4: timestamp of the last render-loop tick (performance.now()).
   * Read by __r3Dump to compute renderLoopActive. */
  private lastPlaybackTickTime: number | null = null;
  private lastAnimationFrameEmitAt = 0;
  private lastSelectionHelperUpdateAt = 0;
  private selectionHelperDirty = true;
  private isSnapModifierPressed = false;
  private pointerDownX = 0;
  private pointerDownY = 0;
  /** Stringified blueprint.engine that we last applied — guards against
   * re-applying author defaults during routine rebuilds (which would
   * otherwise snap the user's camera back on every edit). */
  private lastAppliedEngineKey: string | null = null;
  private mainLight: DirectionalLight | null = null;
  private selectionHelper: Box3Helper | null = null;
  private selectionVisualsSuppressed = false;
  private currentMode: ToolMode = "select";
  private currentGizmoMode: GizmoMode = "translate";
  private isTransformDragging = false;
  private skipNextSelectionPick = false;
  private readonly ORIENTATION_SIZE = 86;

  constructor(container: HTMLElement, store: EditorStore) {
    this.container = container;
    this.store = store;

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // Per-material clippingPlanes (used by W3D-style masks) need this enabled
    // so each masked node's planes apply only to that node's draw call.
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor("#23252a", 1);
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.style.display = "block";
    this.container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.scene.background = new Color("#25272c");

    this.currentSceneMode = (store.blueprint.sceneMode ?? "3d") === "2d" ? "2d" : "3d";
    this.camera = this.buildCameraForMode(this.currentSceneMode);

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

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.applyOrbitControlsForMode(this.currentSceneMode);

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformHelper = this.transformControls.getHelper();
    this.transformControls.setMode(this.currentGizmoMode);
    this.transformControls.setSize(0.9);
    this.transformControls.showX = true;
    this.transformControls.showY = true;
    this.transformControls.showZ = true;
    this.transformControls.addEventListener("dragging-changed", (event) => {
      this.isTransformDragging = Boolean((event as { value?: boolean }).value);
      this.orbitControls.enabled = !this.isTransformDragging;
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
      this.store.setNodeTransformFromObject(nodeId, object);
      this.updateSelectionHelper(
        this.store.selectedNodeIds
          .map((selectedNodeId) => this.objectMap.get(selectedNodeId))
          .filter((selectedObject): selectedObject is Object3D => Boolean(selectedObject)),
      );
    });

    this.infiniteGrid = this.createInfiniteGrid();
    this.scene.add(this.infiniteGrid);
    this.scene.add(this.viewportRoot);
    this.scene.add(this.transformHelper);
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

    // Dev-only console hook: surfaces a structured dump of the live scene so
    // a user reporting "this looks wrong" can paste back evidence (which node
    // is the giant bar, did its skewLayer actually mount, did the texture
    // bind?) instead of guessing at screenshots. Vite's import.meta.env.DEV
    // is true in `npm run dev`, false in production builds.
    if (typeof window !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      (window as unknown as { __r3Dump?: () => unknown }).__r3Dump = () => this.dumpRuntimeScene();
    }
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
      this.orbitControls.target.set(0, 0, 0);
      return;
    }

    this.selectionBounds.getCenter(this.selectionCenter);
    this.selectionBounds.getSize(this.selectionSize);

    const radius = Math.max(this.selectionSize.length() * 0.5, 1);
    const direction = new Vector3(1, 0.75, 1).normalize();
    const distance = radius * 2.2;

    this.camera.position.copy(this.selectionCenter).addScaledVector(direction, distance);
    this.orbitControls.target.copy(this.selectionCenter);
    this.orbitControls.update();
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
    this.transformControls.detach();
    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.clearViewportRoot();
    this.selectionHelper?.removeFromParent();
    this.infiniteGrid.geometry.dispose();
    this.infiniteGrid.material.dispose();
    this.renderer.dispose();
    this.orientationRenderer.dispose();
    this.orientationRenderer.domElement.removeEventListener("pointerdown", this.handleOrientationPointerDown);
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
    if (change.reason === "selection") {
      this.refreshSelection();
      return;
    }

    if (change.reason === "view") {
      this.updateViewMode();
      return;
    }

    if (change.reason === "editable" || change.reason === "meta") {
      // The only "meta" change that affects rendering is sceneMode flips.
      const desired = (this.store.blueprint.sceneMode ?? "3d") === "2d" ? "2d" : "3d";
      if (desired !== this.currentSceneMode) {
        this.applySceneMode(desired);
      }
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

    this.rebuildScene();
  }

  private updateViewMode(): void {
    const viewMode = this.store.viewMode;
    const isRendered = viewMode === "rendered";
    const isWireframe = viewMode === "wireframe";

    if (this.mainLight) {
      this.mainLight.castShadow = isRendered;
    }

    this.viewportRoot.traverse((object) => {
      if (object instanceof Mesh) {
        const nodeId = this.findNodeId(object);
        const node = nodeId ? this.store.getNode(nodeId) : undefined;
        const material = node && node.type !== "group" ? node.material : undefined;
        object.castShadow = isRendered && (material?.castShadow ?? true);
        object.receiveShadow = isRendered && (material?.receiveShadow ?? true);
        const meshMaterial = object.material;
        if (meshMaterial && !Array.isArray(meshMaterial) && "wireframe" in meshMaterial) {
          (meshMaterial as { wireframe: boolean }).wireframe = isWireframe || Boolean(material?.wireframe);
        }
      }
    });
  }

  private addHelpers(): void {
    const hemi = new HemisphereLight(0xe4e0ea, 0x1f2024, 1.1);
    this.scene.add(hemi);

    const ambient = new AmbientLight(0xffffff, 0.3);
    this.scene.add(ambient);

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
    const focus = this.orbitControls.target.clone();
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
        // OrbitControls expects a stable up-vector, so avoid a perfect pole snap.
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

    this.camera.position.copy(focus).addScaledVector(direction, distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(focus);
    this.camera.updateMatrixWorld();
    this.orbitControls.target.copy(focus);
    this.orbitControls.update();
  }

  private bindPointerSelection(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener("pointerdown", (event) => {
      this.pointerDownX = event.clientX;
      this.pointerDownY = event.clientY;
    });

    canvas.addEventListener("pointerup", (event) => {
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
    });
  }

  private pick(clientX: number, clientY: number, additive = false): void {
    const hits = this.getHitsAtClientPoint(clientX, clientY);
    for (const hit of hits) {
      const nodeId = this.findNodeId(hit.object);
      if (nodeId) {
        this.store.selectNode(nodeId, "scene", additive);
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

  private rebuildScene(): void {
    // A new blueprint may carry a different sceneMode (e.g. opening a W3D
    // import sets it to "2d"); align the camera before mounting nodes.
    const desired = (this.store.blueprint.sceneMode ?? "3d") === "2d" ? "2d" : "3d";
    if (desired !== this.currentSceneMode) {
      this.applySceneMode(desired);
    } else {
      // Same mode as before, but re-apply the OrbitControls policy in case
      // it changed shape between rebuilds (e.g. policy tuning shipped in a
      // new build). Cheap; no observable effect when policy is unchanged.
      this.applyOrbitControlsForMode(desired);
    }
    // For 2D scenes, clear any leftover orbit-rotation from a prior session:
    // the camera object is reused across rebuilds, so a user who tilted the
    // ortho camera before we shipped the rotate-lock would otherwise still
    // see a tilted view. Preserve the current zoom-distance so user-zoom
    // doesn't reset on every rebuild.
    if (desired === "2d" && this.camera instanceof OrthographicCamera) {
      const distance = this.camera.position.length() || 10;
      this.camera.position.set(0, 0, distance);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
      this.orbitControls.target.set(0, 0, 0);
      this.orbitControls.update();
    }
    // Detect first apply BEFORE applying so we can frame after mount when no
    // explicit camera pose was authored.
    const engineKey = this.store.blueprint.engine ? JSON.stringify(this.store.blueprint.engine) : "";
    const isFirstEngineApply = engineKey !== this.lastAppliedEngineKey;
    const hasAuthoredCameraPose = Boolean(this.store.blueprint.engine?.camera?.position);
    this.maybeApplyEngineSettings();
    this.clearViewportRoot();
    for (const player of this.sequencePlayers.values()) player.dispose();
    this.sequencePlayers.clear();
    this.objectMap.clear();
    this.childContainerMap.clear();

    for (const node of this.store.blueprint.nodes) {
      const object = this.createObject(node);
      this.objectMap.set(node.id, object);
      // Wire the sequence player's bound Object3D so tick() can gate on
      // visibility. The player was created (or reused) inside createObject →
      // createImageMesh → getOrCreateSequencePlayer, so it is already in the
      // map by the time we reach here.
      const player = this.sequencePlayers.get(node.id);
      if (player) player.setBoundObject3D(object);
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

    try {
      this.applyMasks();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[scene] applyMasks failed (skipping masks):", error);
    }
    this.applyPainterOrderForW3D();
    this.updateViewMode();
    this.refreshSelection();
    this.rebuildAnimationTimeline();

    // Frame the imported content when this is the first time we see this
    // blueprint and the asset didn't pin a camera pose. Skipping when the
    // pose IS authored avoids overriding e.g. a tracked broadcast camera.
    if (isFirstEngineApply && !hasAuthoredCameraPose) {
      this.frameAllForCurrentMode();
    }
    // Drain any accumulated playerClock delta so the FIRST tick after a
    // rebuild starts at ~0. Otherwise getDelta() returns elapsed-since-
    // SceneEditor-construction (often several seconds — the user's
    // import flow), which advances the player by `seconds * fps` frames
    // on tick #1. With a 25-fps loop and a 5-second-old clock, the
    // player jumps to a random frame mid-sweep, then loops from there —
    // visually indistinguishable from "playback is broken".
    if (this.sequencePlayers.size > 0) {
      this.playerClock.getDelta();
    }
    // Confirms end-to-end registration in devtools without requiring the
    // operator to call __r3Dump(). Truncated to 200 chars so a folder
    // with 50 sequences doesn't paint a wall of text.
    // eslint-disable-next-line no-console
    console.info(
      `[scene rebuild] sequence players registered=${this.sequencePlayers.size}` +
      (this.sequencePlayers.size > 0 ? ` keys=${[...this.sequencePlayers.keys()].join(", ").slice(0, 200)}` : ""),
    );
  }

  /**
   * Frame everything currently mounted on `viewportRoot`. The framing strategy
   * differs by camera kind:
   * - **Perspective**: pull back along an angled vector so depth reads cleanly.
   * - **Orthographic**: centre on the content and size the half-extents to
   *   the bounding box (with a small margin) so the layout fills the canvas.
   */
  private frameAllForCurrentMode(): void {
    if (!this.computeSelectionBounds([this.viewportRoot])) return;
    this.selectionBounds.getCenter(this.selectionCenter);
    this.selectionBounds.getSize(this.selectionSize);

    if (this.camera instanceof OrthographicCamera) {
      const halfHeight = Math.max(this.selectionSize.y * 0.55, 1);
      const aspect = (this.container.clientWidth || 1) / (this.container.clientHeight || 1);
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.position.set(this.selectionCenter.x, this.selectionCenter.y, 10);
      this.camera.lookAt(this.selectionCenter);
      this.camera.updateProjectionMatrix();
      this.orbitControls.target.copy(this.selectionCenter);
    } else {
      const radius = Math.max(this.selectionSize.length() * 0.5, 1);
      const direction = new Vector3(0, 0.25, 1).normalize();
      const distance = radius * 2.5;
      this.camera.position.copy(this.selectionCenter).addScaledVector(direction, distance);
      this.orbitControls.target.copy(this.selectionCenter);
    }
    this.orbitControls.update();
  }

  /**
   * Dev-only diagnostic. Returns a structured snapshot of every node currently
   * mounted on the viewport: blueprint values + actual Three.js state
   * (whether a skewLayer was inserted, whether the texture image has loaded,
   * world-space bounding box, render order, etc.).
   *
   * Intended use: a user reports a visual regression, opens devtools, calls
   * `__r3Dump()` and pastes the output back. We can pinpoint which node is
   * the giant white bar / black square / yellow plate without guessing.
   */
  private dumpRuntimeScene(): {
    sceneMode: string | undefined;
    cameraKind: "perspective" | "orthographic";
    nodeCount: number;
    nodes: Array<Record<string, unknown>>;
    mediaLibrary: Array<Record<string, unknown>>;
    w3dTextures: {
      resources: Record<string, string>;
      layers: Array<{ id: string; originalRef: string | null; resolvedFilename: string | null; missing: boolean }>;
      missingTextureRefs: string[];
    } | null;
    previewFlatten: {
      clipName: string | null;
      frame: number;
      appliedControllers: number;
      appliedExportProperties: number;
      unsupportedProperties: string[];
      changedNodeCount: number;
    } | null;
    w3dFlowLayouts: Array<{
      parentXmlId: string;
      parentName: string;
      leadingSpace: number;
      direction: "XPlus" | "XMinus" | "YPlus" | "YMinus";
      appliedAxis: "X" | "Y";
      alignment: string | null;
      childOrder: string[];
      childWidths: number[];
      childExtents: number[];
      computedOffsets: number[];
      approximationWarnings: string[];
    }>;
    timelineRuntime: {
      isPlaying: boolean;
      activeTimelineName: string | null;
      activeTimelineId: string | null;
      currentFrame: number;
      durationFrames: number;
      runtimeReady: boolean;
      compiledTrackCount: number;
      previewFrame: number;
      snapshotMode: boolean;
      playbackSupported: boolean;
      playbackGuarded: boolean;
      scrubGuarded: boolean;
      playbackAdvisoryMessage: string | null;
      lastGuardWarning: string | null;
      // Phase 4 diagnostics
      clipCount: number;
      trackCount: number;
      invalidTrackCount: number;
      missingTargetNodeIds: string[];
      unsupportedAnimatedProperties: string[];
      playbackBlockedReason: import("./animation").PlaybackBlockedReason;
      playbackBlockedMessage: string;
      lastPlaybackTickTime: number | null;
      renderLoopActive: boolean;
      warning: string | null;
    };
    w3dTextDebug: Array<{
      nodeId: string;
      nodeName: string;
      text: string;
      hasTextBox: boolean;
      textBoxSize: { x: number | null; y: number | null };
      alignmentX: string | null;
      alignmentY: string | null;
      constrainMethod: string | null;
      fontStyleId: string | null;
      fontStyleName: string | null;
      fontName: string | null;
      fontType: string | null;
      parentChain: string[];
      localScale: { x: number; y: number; z: number };
      preFitGlyphSize: number;
      postFitLocalSize: { w: number; h: number } | null;
      worldBoxSize: { x: number; y: number; z: number } | null;
      projectedNdcSize: { w: number; h: number } | null;
      maskId: string | null;
      visible: boolean;
      finalVisible: boolean;
    }>;
    w3dMasks: Array<{
      nodeId: string;
      nodeName: string;
      size: { x: number; y: number };
      worldBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
      skew: { x: number; y: number; z: number } | null;
      hasSkewLayer: boolean;
      inverted: boolean;
      colored: boolean;
      disableBinaryAlpha: boolean;
      maskedNodes: Array<{ id: string; name: string }>;
      clippingApplied: boolean;
      approximationWarnings: string[];
    }>;
    shadow: {
      missingTextureNodeCount: number;
      meshPlaceholderNodeCount: number;
      helperNodeCount: number;
      initialDisabledCount: number;
      unresolvedMaterialIds?: string[];
    };
  } {
    this.viewportRoot.updateMatrixWorld(true);
    const bp = this.store.blueprint;
    const w3d = (bp.metadata?.w3d ?? {}) as {
      missingTextureNodeIds?: string[];
      meshPlaceholderNodeIds?: string[];
      helperNodeIds?: string[];
      initialDisabledNodeIds?: string[];
      unresolvedMaterialIds?: string[];
      textureDiagnostics?: {
        textureResources: Record<string, string>;
        textureLayers: Array<{ id: string; originalRef: string | null; resolvedFilename: string | null }>;
        missingTextureRefs: string[];
      };
      textureLayerByNodeId?: Record<string, string>;
      previewFlatten?: {
        clipName: string | null;
        frame: number;
        appliedControllers: number;
        appliedExportProperties: number;
        unsupportedProperties: string[];
        changedNodeCount: number;
      };
      flowLayouts?: Array<{
        parentXmlId: string;
        parentName: string;
        leadingSpace: number;
        direction: "XPlus" | "XMinus" | "YPlus" | "YMinus";
        appliedAxis: "X" | "Y";
        alignment: string | null;
        childOrder: string[];
        childWidths: number[];
        childExtents: number[];
        computedOffsets: number[];
        approximationWarnings: string[];
      }>;
      flowByNodeId?: Record<string, { parentName: string; index: number; offset: number; axis: "X" | "Y" }>;
      textFontStyles?: Record<string, {
        name: string | null;
        fontName: string | null;
        type: string | null;
        kerning: string | null;
        wordWrap: string | null;
        horizontalDirection: string | null;
        verticalDirection: string | null;
      }>;
    };

    const out: Array<Record<string, unknown>> = [];
    for (const node of bp.nodes) {
      const wrapper = this.objectMap.get(node.id);
      if (!wrapper) continue;
      // Look one level deep for a skewLayer Group (matrixAutoUpdate=false)
      // and the underlying Mesh.
      let skewLayer: Group | null = null;
      let mesh: Mesh | null = null;
      for (const child of wrapper.children) {
        if (child instanceof Group && child.matrixAutoUpdate === false) {
          skewLayer = child;
        }
      }
      wrapper.traverse((c) => {
        if (!mesh && c instanceof Mesh) mesh = c;
      });
      // TS narrows `mesh` to `null` because the callback's reassignment
      // happens inside a closure it can't statically track. Re-cast to the
      // intended union before consumer reads.
      const meshObj = mesh as Mesh | null;
      // Capture meshObj.visible into a plain `boolean | null` BEFORE any
      // closure reads it. Inside the per-IIFE scopes below, TypeScript
      // narrows the local `mesh` to `never` after the `if (!mesh && …)`
      // traversal-callback re-write, which makes `meshObj?.visible` resolve
      // to `never.visible` and fail typecheck. The explicit copy here side-
      // steps the narrowing without touching the runtime behaviour.
      const meshObjVisible: boolean | null = meshObj ? meshObj.visible : null;
      const worldPos = wrapper.getWorldPosition(this.tmpVec3).clone();
      let worldBoxSize: { x: number; y: number; z: number } | null = null;
      let textureState: string | null = null;
      let videoState: VideoTextureState | null = null;
      let materialColor: string | null = null;
      let materialOpacity: number | null = null;
      let materialTransparent: boolean | null = null;
      let renderOrder: number | null = null;
      let clippingPlaneCount = 0;
      // Mesh-side material/map snapshot for follow-up diagnostics
      // (FASE D / Pass 4). hasMap distinguishes "blueprint says image but
      // the runtime never bound a texture" (hasMap=false) from
      // "texture bound but the underlying HTMLImageElement/HTMLVideoElement
      // hasn't loaded yet" (hasMap=true, mapHasImage=false).
      let hasMap = false;
      let mapHasImage = false;
      let materialMap: Texture | null = null;
      if (meshObj) {
        if (!meshObj.geometry.boundingBox) meshObj.geometry.computeBoundingBox();
        const bbox = meshObj.geometry.boundingBox;
        if (bbox) {
          const wb = bbox.clone().applyMatrix4(meshObj.matrixWorld);
          const size = new Vector3();
          wb.getSize(size);
          worldBoxSize = { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) };
        }
        renderOrder = meshObj.renderOrder;
        const mat = Array.isArray(meshObj.material) ? meshObj.material[0] : meshObj.material;
        if (mat) {
          materialOpacity = mat.opacity;
          materialTransparent = mat.transparent;
          clippingPlaneCount = mat.clippingPlanes?.length ?? 0;
          const mWithMap = mat as Material & { color?: { getHexString(): string }; map?: Texture };
          if (mWithMap.color) materialColor = "#" + mWithMap.color.getHexString();
          const map = mWithMap.map;
          hasMap = !!map;
          materialMap = map ?? null;
          if (map) {
            const img = (map as Texture & { image?: HTMLImageElement | HTMLVideoElement }).image;
            mapHasImage = !!img;
            if (!img) textureState = "no-image";
            else if ("complete" in img) textureState = (img as HTMLImageElement).complete ? "loaded" : "loading";
            else if ("readyState" in img) textureState = `video-readyState=${(img as HTMLVideoElement).readyState}`;
            // Pull the full video diagnostic bag for video-backed textures so
            // the operator can see paused/muted/loop/errorCode/duration in
            // one place. summariseVideoTextureState returns null for non-video.
            videoState = summariseVideoTextureState(img);
          } else {
            textureState = "no-map";
          }
        }
      }
      // Parent chain (root → node) — forensic field for "why is this node
      // positioned wrong?" reports. The user can paste back the chain and
      // we see which ancestor group has the surprising transform without
      // grepping the W3D XML.
      const parentChain: string[] = [];
      {
        let cursor: EditorNode | null = node;
        const seen = new Set<string>();
        while (cursor) {
          if (seen.has(cursor.id)) break;
          seen.add(cursor.id);
          parentChain.unshift(cursor.name);
          const parentId: string | null = cursor.parentId;
          cursor = parentId ? this.store.blueprint.nodes.find((n) => n.id === parentId) ?? null : null;
        }
      }
      // Projected screen position — feeds the active camera with the node's
      // world position and reads NDC X/Y back ([-1, +1] each axis). Critical
      // for the LINEUP_LEFT class of "side-by-side cards stacked behind each
      // other" reports: if PLAYER_01..05 all share the same NDC X but the
      // thumbnail says distinct, the W3D→3Forge transform basis is wrong.
      const ndc = worldPos.clone().project(this.camera);
      const screenPos = {
        ndcX: +ndc.x.toFixed(4),
        ndcY: +ndc.y.toFixed(4),
        ndcZ: +ndc.z.toFixed(4),
      };
      const flowInfo = w3d.flowByNodeId?.[node.id] ?? null;
      // Geometry size — for plane/image/box nodes. Phase 7 diagnostic: lets
      // the operator see the raw post-flatten W3D <Size> directly alongside
      // the scale track values that animate against it. Group nodes have no
      // geometry field so this stays null.
      const geometrySize: { width: number | null; height: number | null; depth: number | null } | null = (() => {
        if (node.type === "group") return null;
        const g = (node as unknown as { geometry?: Record<string, unknown> }).geometry;
        if (!g) return null;
        const pick = (k: string): number | null => (typeof g[k] === "number" ? +(g[k] as number).toFixed(4) : null);
        return { width: pick("width"), height: pick("height"), depth: pick("depth") };
      })();
      // Texture layer wiring for this node — resolved name/filename pulled
      // from blueprint.metadata so "LOGO disappeared" reports can confirm
      // the LOGO Quad is still wired to TextureLayer "LOGO" → IronHawks.png.
      // (The layer GUID itself is emitted later in this object as
      // `textureLayerId`.)
      const dumpTextureLayerId = w3d.textureLayerByNodeId?.[node.id] ?? null;
      const textureLayerInfo = dumpTextureLayerId
        ? w3d.textureDiagnostics?.textureLayers.find((tl) => tl.id === dumpTextureLayerId) ?? null
        : null;
      out.push({
        id: node.id.slice(0, 8),
        name: node.name,
        type: node.type,
        parentChain,
        screenPos,
        // W3D FlowChildren info — present when the node is a direct child of
        // a `<GeometryOptions FlowChildren="True">` parent. Lets the operator
        // see exactly which flow slot the node was placed into and the
        // additive offset applied during flatten.
        flowParent: flowInfo?.parentName ?? null,
        flowIndex: flowInfo?.index ?? null,
        flowOffset: flowInfo?.offset ?? null,
        flowAxis: flowInfo?.axis ?? null,
        visible: node.visible,
        meshVisible: meshObjVisible,
        hasSkewLayer: !!skewLayer,
        skewLayerMatrix: skewLayer ? Array.from(skewLayer.matrix.elements).map((v) => +v.toFixed(4)) : null,
        blueprintSkew: node.transform.skew ?? null,
        localPos: {
          x: +node.transform.position.x.toFixed(3),
          y: +node.transform.position.y.toFixed(3),
          z: +node.transform.position.z.toFixed(4),
        },
        worldPos: { x: +worldPos.x.toFixed(3), y: +worldPos.y.toFixed(3), z: +worldPos.z.toFixed(4) },
        scale: {
          x: +node.transform.scale.x.toFixed(3),
          y: +node.transform.scale.y.toFixed(3),
          z: +node.transform.scale.z.toFixed(3),
        },
        worldBoxSize,
        // Raw post-flatten geometry (width/height/depth) so the operator can
        // spot Size.*Prop normalization mismatches at a glance — rendered
        // size = geometry × scale, and either factor being unexpected points
        // at a specific import bug.
        geometry: geometrySize,
        // Mask inversion flag (W3D <MaskProperties IsInvertedMask="…">).
        // `isMask` + `maskIds` are emitted later in this object alongside
        // clippingPlaneCount; this is the missing inversion bit.
        maskInverted: node.maskInverted ?? false,
        renderOrder,
        materialColor,
        materialOpacity,
        materialTransparent,
        textureState,
        textureSrc: node.type === "image" ? (node.image?.src ?? "").slice(0, 64) : null,
        textureMime: node.type === "image" ? node.image?.mimeType : null,
        // Resolved layer filename / authored ref (textureLayerId is emitted
        // separately later in this object). Pulled from
        // metadata.w3d.textureDiagnostics so "LOGO" Quad → IronHawks.png is
        // visible alongside the node it belongs to.
        textureLayerFilename: textureLayerInfo?.resolvedFilename ?? null,
        textureLayerOriginalRef: textureLayerInfo?.originalRef ?? null,
        hasMap,
        mapHasImage,
        // Only present when the texture is backed by a <video>. Lets the
        // operator distinguish "video never started" (readyState=0) from
        // "video paused after error" (errorCode != null) from "playing".
        video: videoState,
        imageSequence: (() => {
          const player = this.sequencePlayers.get(node.id);
          const seq = node.type === "image" ? (node.image.sequence ?? null) : null;
          // Common Phase 3 diagnostic fields: surfaced regardless of
          // whether a live player exists, so the operator can see the
          // sequence's storage shape even on a reopen-without-folder.
          const commonFields = seq
            ? {
                storageType: seq.storageType ?? null,
                manifestPath: seq.manifestPath ?? null,
                sourceHash: seq.sourceHash ?? null,
                hasRuntimeFrameUrls: (seq.frameUrls?.length ?? 0) > 0,
                runtimeFrameUrlCount: seq.frameUrls?.length ?? 0,
              }
            : null;
          if (!player) {
            // Phase 3 reopen: a sequence may exist on the blueprint but
            // have no live player because frameUrls couldn't be minted
            // (e.g. workspace autosave restore without folder access).
            // Surface that as `missing-folder-access` so the diagnostic
            // dump shows WHY the node isn't animating.
            if (seq) {
              const resolverStatus = computeSequenceResolverStatus({
                hasFrameUrls: (seq.frameUrls?.length ?? 0) > 0,
                playerError: null,
                storageType: seq.storageType,
                hasManifestPath: !!seq.manifestPath,
              });
              return {
                ...commonFields,
                resolverStatus,
                resolverWarning: describeSequenceResolverStatus(resolverStatus, seq.manifestPath),
                playerRegistered: false,
              };
            }
            return null;
          }
          const s = player.state();
          const resolverStatus = computeSequenceResolverStatus({
            hasFrameUrls: (seq?.frameUrls?.length ?? 0) > 0,
            playerError: s.error ?? null,
            storageType: seq?.storageType,
            hasManifestPath: !!seq?.manifestPath,
          });
          return {
            ...commonFields,
            resolverStatus,
            resolverWarning: describeSequenceResolverStatus(resolverStatus, seq?.manifestPath),
            frameCount: s.totalFrames,
            currentFrame: s.currentFrame,
            loadedFrames: s.loadedFrames,
            fps: node.type === "image" ? (node.image.sequence?.fps ?? 0) : 0,
            loop: node.type === "image" ? (node.image.sequence?.loop ?? true) : true,
            paused: s.paused,
            firstFrameSrc: node.type === "image" ? (node.image.sequence?.frameUrls?.[0] ?? "").slice(0, 64) : "",
            error: s.error,
            // Pass-J diagnostics: lets the operator answer "is this player
            // actually being driven and bound to the right texture?" without
            // having to attach a debugger. currentFrameSrc surfaces what
            // URL the GPU is reading right now; tickCount==0 with a
            // registered player means the render loop wiring is broken;
            // materialMapIsPlayerTexture catches the rare case where the
            // mesh ended up with a different map (e.g. a stale texture
            // from a prior rebuild).
            currentFrameSrc: s.currentFrameSrc,
            tickCount: s.tickCount,
            lastTickDelta: s.lastTickDelta,
            playerRegistered: true,
            materialMapIsPlayerTexture: materialMap === player.texture,
            meshVisible: meshObjVisible,
          };
        })(),
        isMask: !!node.isMask,
        maskIds: node.maskIds ?? (node.maskId ? [node.maskId] : []),
        clippingPlaneCount,
        isHelper: w3d.helperNodeIds?.includes(node.id) ?? false,
        isMissingTexture: w3d.missingTextureNodeIds?.includes(node.id) ?? false,
        wasInitialDisabled: w3d.initialDisabledNodeIds?.includes(node.id) ?? false,
        // W3D TextureLayer GUID that drove this node's binding, when known.
        // Lets the operator cross-reference "this quad" against the
        // textureLayers table below without grepping the XML.
        textureLayerId: w3d.textureLayerByNodeId?.[node.id] ?? null,
        // Animated visibility ("Enabled" controller in W3D, "visible"
        // animation property in 3Forge). Three layers shown so the operator
        // can pinpoint where a "node still rendering when keyframe says
        // off" report breaks down:
        //   - hasTrack: did the parser create a `visible` animation track?
        //   - blueprintVisible: post-flatten static state (i.e. what the
        //     `<Enable>` attribute resolved to after PreviewMarker keyframes
        //     were baked in)
        //   - trackValueAtCurrentFrame: what the track evaluates to RIGHT
        //     NOW (after seekAnimation)
        //   - objectVisible: what Three.js actually has on the wrapper
        //   - finalVisible: same as objectVisible — the rendered truth
        //   - source: which mechanism determined the rendered value
        animatedVisibility: (() => {
          const compiled = this.animationTracks.find(
            (t) => t.propertyPath === "visible" && t.target?.userData?.nodeId === node.id,
          );
          const trackValue = compiled
            ? evaluateCompiledTrack(compiled, this.currentAnimationFrame)
            : null;
          const trackFinalVisible = trackValue !== null ? trackValue >= 0.5 : null;
          return {
            hasTrack: !!compiled,
            keyframes: compiled?.keyframes.length ?? 0,
            firstFrame: compiled?.keyframes[0]?.frame ?? null,
            lastFrame: compiled?.keyframes[compiled.keyframes.length - 1]?.frame ?? null,
            blueprintVisible: node.visible,
            trackValueAtCurrentFrame: trackValue,
            trackFinalVisible,
            objectVisible: meshObjVisible,
            finalVisible: meshObjVisible ?? node.visible,
            source: compiled ? "animation-track" : "blueprint",
          };
        })(),
      });
    }

    // Media library snapshot — shows every asset (especially SEQUENCE
    // assets) with the node(s) that bind to it. Orphan flag = no node
    // references the asset, which is the case for .movs converted from a
    // folder where the W3D XML doesn't statically point to them. Lets the
    // operator paste back "sequence is in Media but nothing renders it" as
    // hard evidence instead of a screenshot.
    const mediaLibrary: Array<Record<string, unknown>> = [];
    for (const image of bp.images) {
      const refNodes: Array<{ id: string; name: string }> = [];
      for (const node of bp.nodes) {
        if (node.type !== "image") continue;
        if (image.id && node.imageId === image.id) {
          refNodes.push({ id: node.id.slice(0, 8), name: node.name });
        }
      }
      const seq = image.sequence;
      const isSequence = image.mimeType === "application/x-image-sequence";
      mediaLibrary.push({
        id: image.id ?? null,
        name: image.name,
        mimeType: image.mimeType,
        kind: isSequence ? "SEQUENCE" : image.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE",
        sequence: seq ? {
          source: seq.source,
          frameCount: seq.frameCount,
          fps: seq.fps,
          format: seq.format,
          fallbackReason: seq.fallbackReason ?? null,
          alpha: seq.alpha,
          width: seq.width,
          height: seq.height,
          frameUrlsLength: seq.frameUrls.length,
          firstFrame: seq.frameUrls[0]?.slice(0, 80) ?? null,
        } : null,
        referencedByNodes: refNodes,
        orphan: refNodes.length === 0,
      });
    }

    // W3D texture-resolution diagnostics. Pasting these alongside
    // mediaLibrary makes it possible to answer "this asset is in Media but
    // doesn't render — why?" by checking three things in order:
    //   1. Is there a Layer with originalRef pointing at this file?
    //   2. Did it resolve to a basename (or land in missingTextureRefs)?
    //   3. Which node's textureLayerId matches that Layer.id?
    // Null when the project wasn't imported from a W3D scene.
    const diag = w3d.textureDiagnostics;
    const w3dTextures = diag ? {
      resources: diag.textureResources,
      layers: diag.textureLayers.map((l) => ({
        ...l,
        missing: !l.resolvedFilename || diag.missingTextureRefs.includes(l.originalRef ?? ""),
      })),
      missingTextureRefs: diag.missingTextureRefs,
    } : null;

    // W3D text-node forensic table — for "why is this label huge / off-axis"
    // reports. One entry per imported `<TextureText>` with everything the
    // parser/renderer knows about the node's box, alignment, font style,
    // and final on-screen extent. Built lazily by re-walking `bp.nodes`;
    // skipped entirely for non-text scenes.
    type W3DTextDebugEntry = {
      nodeId: string;
      nodeName: string;
      text: string;
      hasTextBox: boolean;
      textBoxSize: { x: number | null; y: number | null };
      alignmentX: string | null;
      alignmentY: string | null;
      constrainMethod: string | null;
      fontStyleId: string | null;
      fontStyleName: string | null;
      fontName: string | null;
      fontType: string | null;
      parentChain: string[];
      localScale: { x: number; y: number; z: number };
      preFitGlyphSize: number;
      postFitLocalSize: { w: number; h: number } | null;
      worldBoxSize: { x: number; y: number; z: number } | null;
      projectedNdcSize: { w: number; h: number } | null;
      maskId: string | null;
      visible: boolean;
      finalVisible: boolean;
    };
    const w3dTextDebug: W3DTextDebugEntry[] = [];
    const fontStylesById = w3d.textFontStyles ?? {};
    for (const tn of bp.nodes) {
      if (tn.type !== "text") continue;
      const wrapper = this.objectMap.get(tn.id);
      let textMesh: Mesh | null = null;
      if (wrapper) {
        wrapper.traverse((c) => {
          if (!textMesh && c instanceof Mesh) textMesh = c;
        });
      }
      // Pre-capture into a plain Mesh|null binding so the subsequent
      // accesses don't trip TypeScript's "never" narrowing inside the
      // traversal-callback closure scope (same trick as `meshObjVisible`
      // in the main loop above).
      const textMeshObj: Mesh | null = textMesh;
      let postFitLocalSize: { w: number; h: number } | null = null;
      let worldBoxSize: { x: number; y: number; z: number } | null = null;
      let projectedNdcSize: { w: number; h: number } | null = null;
      if (textMeshObj !== null) {
        const m: Mesh = textMeshObj;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox;
        if (b) {
          postFitLocalSize = {
            w: +(b.max.x - b.min.x).toFixed(4),
            h: +(b.max.y - b.min.y).toFixed(4),
          };
          const wb = b.clone().applyMatrix4(m.matrixWorld);
          const sz = new Vector3();
          wb.getSize(sz);
          worldBoxSize = { x: +sz.x.toFixed(4), y: +sz.y.toFixed(4), z: +sz.z.toFixed(4) };
          const minNdc = wb.min.clone().project(this.camera);
          const maxNdc = wb.max.clone().project(this.camera);
          projectedNdcSize = {
            w: +Math.abs(maxNdc.x - minNdc.x).toFixed(4),
            h: +Math.abs(maxNdc.y - minNdc.y).toFixed(4),
          };
        }
      }
      // Parent chain — same walk as the per-node section, kept local to
      // avoid coupling the two loops.
      const chain: string[] = [];
      {
        let cursor: EditorNode | null = tn;
        const seen = new Set<string>();
        while (cursor) {
          if (seen.has(cursor.id)) break;
          seen.add(cursor.id);
          chain.unshift(cursor.name);
          const parentId: string | null = cursor.parentId;
          cursor = parentId ? this.store.blueprint.nodes.find((n) => n.id === parentId) ?? null : null;
        }
      }
      const fsId = tn.geometry.fontStyleId ?? null;
      const fs = fsId ? fontStylesById[fsId] ?? null : null;
      w3dTextDebug.push({
        nodeId: tn.id.slice(0, 8),
        nodeName: tn.name,
        text: tn.geometry.text,
        hasTextBox: !!tn.geometry.hasTextBox,
        textBoxSize: {
          x: tn.geometry.maxWidth ?? null,
          y: tn.geometry.maxHeight ?? null,
        },
        alignmentX: tn.geometry.alignmentX ?? null,
        alignmentY: tn.geometry.alignmentY ?? null,
        constrainMethod: tn.geometry.constrainMethod ?? null,
        fontStyleId: fsId,
        fontStyleName: fs?.name ?? null,
        fontName: fs?.fontName ?? null,
        fontType: fs?.type ?? null,
        parentChain: chain,
        localScale: {
          x: +tn.transform.scale.x.toFixed(4),
          y: +tn.transform.scale.y.toFixed(4),
          z: +tn.transform.scale.z.toFixed(4),
        },
        preFitGlyphSize: +tn.geometry.size.toFixed(4),
        postFitLocalSize,
        worldBoxSize,
        projectedNdcSize,
        maskId: tn.maskIds?.[0] ?? tn.maskId ?? null,
        visible: tn.visible,
        finalVisible: wrapper?.visible ?? tn.visible,
      });
    }

    // W3D mask forensic table. One entry per `IsMask="True"` quad in the
    // blueprint, with the post-flatten (PreviewMarker) world bounds + skew
    // + which downstream nodes reference it via MaskId. Lets the operator
    // diagnose "X is bleeding past its card / clipping shows the wrong
    // shape" by inspecting whether the right mask geometry got computed.
    // Note on approximation: 3Forge clips with axis-aligned planes derived
    // from the mask's worldMatrix-applied bbox. For a SKEWED mask the
    // mathematical shape is a parallelogram but the clipping envelope is
    // the rectangle that bounds it — content can still show inside the
    // envelope but outside the parallelogram's diagonal edges. Recorded
    // in `approximationWarnings` per-mask so future fidelity work can
    // target exactly the masks where this matters visually.
    type W3DMaskEntry = {
      nodeId: string;
      nodeName: string;
      size: { x: number; y: number };
      worldBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
      skew: { x: number; y: number; z: number } | null;
      hasSkewLayer: boolean;
      inverted: boolean;
      colored: boolean;
      disableBinaryAlpha: boolean;
      maskedNodes: Array<{ id: string; name: string }>;
      clippingApplied: boolean;
      approximationWarnings: string[];
    };
    const maskProps = (bp.metadata?.w3d as { maskProperties?: Record<string, Record<string, string>> } | undefined)?.maskProperties ?? {};
    const w3dMasks: W3DMaskEntry[] = [];
    for (const mn of bp.nodes) {
      if (!mn.isMask) continue;
      const wrapper = this.objectMap.get(mn.id);
      let maskMesh: Mesh | null = null;
      let maskSkewLayer: Group | null = null;
      if (wrapper) {
        for (const c of wrapper.children) {
          if (c instanceof Group && c.matrixAutoUpdate === false) maskSkewLayer = c;
        }
        wrapper.traverse((c) => {
          if (!maskMesh && c instanceof Mesh) maskMesh = c;
        });
      }
      // Capture into a plain Mesh|null and then narrow with an explicit
      // typed local — same workaround as `meshObjVisible` higher up in
      // this file; TypeScript's "never" narrowing inside the traversal
      // closure scope otherwise rejects mesh.geometry/.matrixWorld below.
      const mesh: Mesh | null = maskMesh;
      let worldBounds: W3DMaskEntry["worldBounds"] = null;
      if (mesh !== null) {
        const m: Mesh = mesh;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox;
        if (b) {
          const wb = b.clone().applyMatrix4(m.matrixWorld);
          worldBounds = {
            min: { x: +wb.min.x.toFixed(4), y: +wb.min.y.toFixed(4), z: +wb.min.z.toFixed(4) },
            max: { x: +wb.max.x.toFixed(4), y: +wb.max.y.toFixed(4), z: +wb.max.z.toFixed(4) },
          };
        }
      }
      const maskedNodes: Array<{ id: string; name: string }> = [];
      for (const consumer of bp.nodes) {
        const refs = consumer.maskIds ?? (consumer.maskId ? [consumer.maskId] : []);
        if (refs.includes(mn.id)) {
          maskedNodes.push({ id: consumer.id.slice(0, 8), name: consumer.name });
        }
      }
      // Per-mask shadow props (only present for masks that authored a
      // <MaskProperties> element during parse — covers IsInvertedMask,
      // IsColoredMask, DisableBinaryAlpha).
      const props = maskProps[mn.id] ?? {};
      const inverted = props.IsInvertedMask === "True";
      const colored = props.IsColoredMask === "True";
      const disableBinaryAlpha = props.DisableBinaryAlpha === "True";
      const warnings: string[] = [];
      if (mn.transform.skew && (mn.transform.skew.x !== 0 || mn.transform.skew.y !== 0 || mn.transform.skew.z !== 0)) {
        warnings.push(
          "Skewed mask: clipping uses the axis-aligned envelope of the parallelogram, " +
          "so content inside the envelope but outside the diagonal edges still shows.",
        );
      }
      if (colored) {
        warnings.push("IsColoredMask='True' parsed but not used by the renderer (clipping is binary).");
      }
      // Read clippingPlanes count from the first target wrapper as a
      // proxy for "is clipping live?". 0 → mask referenced but no planes
      // applied; > 0 → working.
      let clippingApplied = false;
      for (const consumer of maskedNodes) {
        const w = bp.nodes.find((n) => n.id.startsWith(consumer.id));
        if (!w) continue;
        const wrap = this.objectMap.get(w.id);
        if (!wrap) continue;
        let consumerMesh: Mesh | null = null;
        wrap.traverse((c) => { if (!consumerMesh && c instanceof Mesh) consumerMesh = c; });
        const cm: Mesh | null = consumerMesh;
        if (cm !== null) {
          const cmTyped: Mesh = cm;
          const mat = Array.isArray(cmTyped.material) ? cmTyped.material[0] : cmTyped.material;
          if (mat && mat.clippingPlanes && mat.clippingPlanes.length > 0) {
            clippingApplied = true;
            break;
          }
        }
      }
      // The mask's own geometry width/height pulled from the node spec —
      // works for both planes (the parser's mask-fallback path) and real
      // Quads imported via createQuadNode (kept on geometry.width/height
      // for image nodes; not present for groups, hence the typeof guard).
      const gw = (mn as unknown as { geometry?: { width?: number; height?: number } }).geometry;
      w3dMasks.push({
        nodeId: mn.id.slice(0, 8),
        nodeName: mn.name,
        size: {
          x: typeof gw?.width === "number" ? +gw.width.toFixed(4) : 0,
          y: typeof gw?.height === "number" ? +gw.height.toFixed(4) : 0,
        },
        worldBounds,
        skew: mn.transform.skew ?? null,
        hasSkewLayer: !!maskSkewLayer,
        inverted,
        colored,
        disableBinaryAlpha,
        maskedNodes,
        clippingApplied,
        approximationWarnings: warnings,
      });
    }

    return {
      sceneMode: bp.sceneMode,
      cameraKind: this.camera instanceof OrthographicCamera ? "orthographic" : "perspective",
      nodeCount: bp.nodes.length,
      nodes: out,
      mediaLibrary,
      w3dTextures,
      // Preview-state flatten summary — see W3DShadowData.previewFlatten in
      // src/editor/import/w3d.ts. Lets the operator confirm at a glance
      // which timeline frame was baked into the blueprint.
      previewFlatten: w3d.previewFlatten ?? null,
      // W3D FlowChildren layouts surfaced for "why are these cards stacked"
      // debugging. One entry per `<GeometryOptions FlowChildren="True">`
      // parent group, with child order + widths + computed offsets.
      w3dFlowLayouts: w3d.flowLayouts ?? [],
      // Per-TextureText forensic table — see `w3dTextDebug` construction
      // above. Empty array for scenes without text nodes.
      w3dTextDebug,
      // Per-mask forensic table — see `w3dMasks` construction above.
      // Includes the post-flatten world bounds (which already incorporate
      // the skew written by D.4.1 because skewLayer feeds into matrixWorld).
      w3dMasks,
      // Animation runtime snapshot — answers "is the import secretly
      // autoplaying / drifting off the preview frame?" without opening a
      // debugger. After a clean W3D import, `isPlaying` should be false and
      // `currentFrame` should be the PreviewMarker.
      timelineRuntime: (() => {
        // Max W3D PreviewMarker across all clips; -1 when none of them
        // declared one (legacy blueprints, ad-hoc imports). Lets the
        // operator see at a glance whether the scene is in "frozen
        // snapshot" mode or showing animated state.
        const previewFrame = maxPreviewFrameFromClips(bp.animation.clips);
        const rounded = Math.round(this.currentAnimationFrame);
        const snapshotMode = previewFrame >= 0 && rounded === previewFrame;
        // W3D imports rely on a flatten pre-pass (see applyW3DPreviewFlatten
        // in src/editor/import/w3d.ts) that bakes ExportProperty + In-timeline
        // PreviewMarker values into the parsed blueprint. Once the user scrubs
        // or plays, the animation tracks override Position/Scale/Alpha/Enabled
        // values — but other W3D-specific systems (FlowChildren layout, mask
        // clipping planes, TextureText fit-to-box) only refreshed at flatten
        // time. Playing/scrubbing therefore yields an *approximate* preview
        // until that refresh pipeline is wired (Phase D.3.1 / D.4). Flag it
        // here so the surface that decides whether to allow Play can read a
        // single source of truth.
        // Use the shared helper so App.tsx (which intercepts the actual
        // Play/scrub events) and this dump can never disagree about
        // whether guards are active.
        const nodeIds = new Set(bp.nodes.map((n) => n.id));
        const diag = getPlaybackDiagnostics({
          blueprintMetadata: bp.metadata,
          clips: bp.animation.clips,
          nodeIds,
        });
        const guarded = diag.playbackGuarded;
        // The render loop is "active" when the editor's RAF tick has fired
        // recently. lastPlaybackTickTime is updated inside startLoop().
        // A null value means the loop never ticked since this SceneEditor
        // instance was created (constructor failed, scene unmounted, etc).
        const lastTick = this.lastPlaybackTickTime ?? null;
        const renderLoopActive = lastTick !== null && (performance.now() - lastTick) < 1000;
        return {
          isPlaying: this.isAnimationPlaying,
          activeTimelineName: this.store.getActiveAnimationClip()?.name ?? null,
          activeTimelineId: this.store.getActiveAnimationClip()?.id ?? null,
          currentFrame: this.currentAnimationFrame,
          durationFrames: this.store.getActiveAnimationClip()?.durationFrames ?? 0,
          runtimeReady: this.animationRuntimeReady,
          compiledTrackCount: this.animationTracks.length,
          previewFrame,
          snapshotMode,
          playbackSupported: diag.playbackSupported && renderLoopActive,
          playbackGuarded: guarded,
          // Scrub is no longer hard-blocked for W3D imports. The advisory is
          // shown in the toolbar but Play/Scrub run normally.
          scrubGuarded: false,
          playbackAdvisoryMessage: diag.playbackAdvisoryMessage || null,
          lastGuardWarning: guarded ? W3D_PLAYBACK_GUARD_WARNING : null,
          warning: guarded ? W3D_PLAYBACK_GUARD_WARNING : null,
          // Phase 4 diagnostics
          clipCount: diag.clipCount,
          trackCount: diag.trackCount,
          invalidTrackCount: diag.invalidTrackCount,
          missingTargetNodeIds: diag.missingTargetNodeIds,
          unsupportedAnimatedProperties: diag.unsupportedAnimatedProperties,
          playbackBlockedReason: !renderLoopActive && diag.playbackBlockedReason === null
            ? "render-loop-inactive"
            : diag.playbackBlockedReason,
          playbackBlockedMessage: !renderLoopActive && diag.playbackBlockedReason === null
            ? "Playback failed: render loop is not active."
            : diag.playbackBlockedMessage,
          lastPlaybackTickTime: lastTick,
          renderLoopActive,
        };
      })(),
      shadow: {
        missingTextureNodeCount: w3d.missingTextureNodeIds?.length ?? 0,
        meshPlaceholderNodeCount: w3d.meshPlaceholderNodeIds?.length ?? 0,
        helperNodeCount: w3d.helperNodeIds?.length ?? 0,
        initialDisabledCount: w3d.initialDisabledNodeIds?.length ?? 0,
        unresolvedMaterialIds: w3d.unresolvedMaterialIds,
      },
    };
  }

  private isMissingTextureNode(nodeId: string): boolean {
    // Also covers placeholder boxes for <Mesh>/<Model> primitives we couldn't
    // load — both groups are kept in the tree for editing and round-trip but
    // hidden from the viewport so they don't render as opaque white blocks.
    // Also covers authoring-helper nodes (HELPERS / Pitch_Reference) that R3
    // hides via Enable="False"; design-view promotion would otherwise put a
    // full-frame solid plate in front of the actual layout.
    const w3d = this.store.blueprint.metadata?.w3d as
      | {
          missingTextureNodeIds?: string[];
          meshPlaceholderNodeIds?: string[];
          helperNodeIds?: string[];
        }
      | undefined;
    if (Array.isArray(w3d?.missingTextureNodeIds) && w3d.missingTextureNodeIds.includes(nodeId)) {
      return true;
    }
    if (Array.isArray(w3d?.meshPlaceholderNodeIds) && w3d.meshPlaceholderNodeIds.includes(nodeId)) {
      return true;
    }
    if (Array.isArray(w3d?.helperNodeIds) && w3d.helperNodeIds.includes(nodeId)) {
      return true;
    }
    return false;
  }

  private applyPainterOrderForW3D(): void {
    // Broadcast scenes (R3 / W3D) stack many quads at near-identical Z (e.g.
    // -0.001 / -0.01 / -1). The right fix depends on the camera:
    //
    // - **2D / orthographic** layouts have no real depth — painter's algorithm
    //   matches what R3 does internally, so we render strictly in node-tree
    //   order with depth writes off.
    // - **3D / perspective** AR scenes legitimately need occlusion between
    //   meshes that overlap in space; turning depth off would render the back
    //   of a model in front of its face. We instead nudge transparent
    //   materials with polygonOffset so coplanar UI overlays stop fighting
    //   each other while opaque geometry keeps real depth testing.
    if (!this.store.blueprint.metadata?.w3d) return;
    if (this.currentSceneMode === "2d") {
      this.applyPainterOrderingForLegacyLayout();
    } else {
      this.applyCoplanarPolygonOffsetForLegacyLayout();
    }
  }

  private applyPainterOrderingForLegacyLayout(): void {
    // Refresh world transforms so getWorldPosition() reflects the just-mounted
    // hierarchy. Without this the wrappers added in the current rebuild still
    // report their previous world Z (or zero on first mount).
    this.viewportRoot.updateMatrixWorld(true);
    const orderMap = computeRenderOrderByWorldZ(
      this.store.blueprint.nodes,
      (id) => {
        const wrapper = this.objectMap.get(id);
        if (!wrapper) return undefined;
        wrapper.getWorldPosition(this.tmpVec3);
        return this.tmpVec3.z;
      },
    );
    this.store.blueprint.nodes.forEach((node) => {
      const wrapper = this.objectMap.get(node.id);
      if (!wrapper) return;
      const order = orderMap.get(node.id) ?? 0;
      wrapper.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.renderOrder = order;
        forEachMaterial(child, (m) => {
          m.depthWrite = false;
          m.polygonOffset = false;
        });
      });
    });
  }

  private applyCoplanarPolygonOffsetForLegacyLayout(): void {
    this.store.blueprint.nodes.forEach((node, index) => {
      const wrapper = this.objectMap.get(node.id);
      if (!wrapper) return;
      wrapper.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        // Stable secondary sort key for transparent materials — Three already
        // sorts them back-to-front but ties (coplanar quads) collapse to
        // insertion order, which can flicker. Tagging each mesh with a unique
        // renderOrder per declaration removes the ambiguity.
        child.renderOrder = index;
        forEachMaterial(child, (m) => {
          if (m.transparent) {
            m.polygonOffset = true;
            // Nudge transparent UI overlays a hair toward the camera so they
            // don't fight with the opaque geometry sitting at the same Z.
            m.polygonOffsetFactor = -1;
            m.polygonOffsetUnits = -1;
          } else {
            m.polygonOffset = false;
          }
        });
      });
    });
  }

  private applyMasks(): void {
    // World-space rectangular clipping for nodes that reference an `isMask`
    // sibling (R3 MaskId convention). Mask geometry is treated as an axis-
    // aligned rectangle in the XY plane after world transform — sufficient
    // for broadcast text-clip cases. Multi-mask is intersected (AND); a
    // node clipped by mask A AND mask B is only visible inside both. The
    // `maskInverted` flag flips a mask's planes so the node is visible
    // INSIDE the mask volume rather than outside the outer-clip default.
    this.viewportRoot.updateMatrixWorld(true);
    for (const node of this.store.blueprint.nodes) {
      // Prefer the multi-id list when present; fall back to the legacy
      // single-id field. Either way, deduplicate so older blueprints whose
      // exporter wrote both end up with one set of planes per mask.
      const ids = node.maskIds && node.maskIds.length > 0
        ? node.maskIds
        : node.maskId
          ? [node.maskId]
          : null;
      if (!ids) continue;
      const targetWrapper = this.objectMap.get(node.id);
      if (!targetWrapper) continue;
      const allPlanes: Plane[] = [];
      for (const maskId of ids) {
        const maskWrapper = this.objectMap.get(maskId);
        if (!maskWrapper) continue;
        // Inversion is a property of the mask itself (W3D
        // <MaskProperties IsInvertedMask="…"/> sits on the mask quad).
        // Each mask in a multi-mask list contributes its own orientation.
        const inverted = resolveMaskInversion(this.store.blueprint, maskId, node);
        const planes = this.computeMaskPlanes(maskWrapper, inverted);
        if (planes) allPlanes.push(...planes);
      }
      if (allPlanes.length > 0) {
        this.applyClippingToMaterials(targetWrapper, allPlanes);
      }
    }
  }

  private computeMaskPlanes(maskWrapper: Object3D, inverted: boolean): Plane[] | null {
    let mesh: Mesh | null = null;
    maskWrapper.traverse((child) => {
      if (!mesh && child instanceof Mesh) {
        mesh = child;
      }
    });
    if (!mesh) return null;
    const meshObj: Mesh = mesh;
    if (!meshObj.geometry.boundingBox) {
      meshObj.geometry.computeBoundingBox();
    }
    const bbox = meshObj.geometry.boundingBox;
    if (!bbox) return null;
    const worldBox = bbox.clone().applyMatrix4(meshObj.matrixWorld);
    // Default (outer-clip): keep what's inside the four planes.
    // Inverted: flip every normal so the half-spaces select the OUTSIDE of
    // the mask volume — drawing is hidden inside the bbox, shown elsewhere.
    const sign = inverted ? -1 : 1;
    return [
      new Plane(new Vector3(1 * sign, 0, 0), -worldBox.min.x * sign),
      new Plane(new Vector3(-1 * sign, 0, 0), worldBox.max.x * sign),
      new Plane(new Vector3(0, 1 * sign, 0), -worldBox.min.y * sign),
      new Plane(new Vector3(0, -1 * sign, 0), worldBox.max.y * sign),
    ];
  }

  private applyClippingToMaterials(target: Object3D, planes: Plane[]): void {
    target.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const material = child.material;
      const apply = (m: Material) => {
        m.clippingPlanes = planes;
        m.clipShadows = true;
      };
      if (Array.isArray(material)) {
        for (const m of material) apply(m);
      } else if (material) {
        apply(material);
      }
    });
  }

  private createObject(node: EditorNode): Object3D {
    const object = node.type === "group"
      ? this.buildGroupObject(node)
      : this.buildWrappedNodeObject(node);
    object.name = node.name;
    // Mask nodes contribute their bounds for clipping but are themselves never
    // rendered (R3 treats them as invisible stencil shapes).
    // Quads whose texture wasn't in the imported folder are also hidden so
    // they don't render as solid-white placeholders — see W3DShadowData.
    object.visible = node.visible && !node.isMask && !this.isMissingTextureNode(node.id);
    object.userData.nodeId = node.id;
    object.userData.nodeType = node.type;
    object.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z);
    // Blueprint stores rotation in degrees (round-trips via export/w3d.ts and
    // is named `rotationDeg` in the dump tests). Three.js Euler expects
    // radians, so convert at the apply boundary.
    object.rotation.set(
      (node.transform.rotation.x * Math.PI) / 180,
      (node.transform.rotation.y * Math.PI) / 180,
      (node.transform.rotation.z * Math.PI) / 180,
    );
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

  private buildWrappedNodeObject(node: Exclude<EditorNode, { type: "group" }>): Object3D {
    const wrapper = new Group();
    const mesh = this.buildMeshObject(node);
    this.applyNodeOrigin(mesh, node.origin);
    // Static <Skew> shears the mesh via an inserted skewLayer Group so that
    // animations on position/rotation/scale (which always target the wrapper)
    // stay clean — the skew matrix lives one level down with
    // matrixAutoUpdate off and is composed once at build time. Identity skew
    // (undefined or all-zero) skips the extra group entirely so non-skewed
    // nodes keep their original wrapper→mesh shape.
    if (!isIdentitySkew(node.transform.skew)) {
      const skewLayer = new Group();
      skewLayer.userData.isSkewLayer = true;
      skewLayer.matrix.copy(buildSkewMatrix(node.transform.skew!));
      skewLayer.matrixAutoUpdate = false;
      skewLayer.add(mesh);
      wrapper.add(skewLayer);
    } else {
      wrapper.add(mesh);
    }
    return wrapper;
  }

  /**
   * Find or insert the per-wrapper skewLayer Group used by `transform.skew.*`
   * animation tracks. When the node was imported with no static skew the
   * layer doesn't exist yet — re-parent the wrapper's existing children
   * under a fresh layer so the runtime can shear them via matrix updates.
   * Initial matrix mirrors `initialSkew` (or identity), so wrappers with a
   * static-baked skew keep that exact value before the first keyframe writes.
   */
  private ensureSkewLayer(wrapper: Object3D, initialSkew: Vec3Like | undefined): Group {
    for (const child of wrapper.children) {
      if (child instanceof Group && child.userData.isSkewLayer) {
        return child;
      }
    }
    const skewLayer = new Group();
    skewLayer.userData.isSkewLayer = true;
    skewLayer.matrixAutoUpdate = false;
    skewLayer.matrix.copy(
      initialSkew ? buildSkewMatrix(initialSkew) : new Matrix4(),
    );
    const existingChildren = [...wrapper.children];
    for (const child of existingChildren) {
      wrapper.remove(child);
      skewLayer.add(child);
    }
    wrapper.add(skewLayer);
    return skewLayer;
  }

  private buildMeshObject(node: Exclude<EditorNode, { type: "group" }>): Mesh {
    let mesh: Mesh;
    switch (node.type) {
      case "box":
        mesh = new Mesh(new BoxGeometry(node.geometry.width, node.geometry.height, node.geometry.depth), this.createNodeMaterial(node));
        break;
      case "circle":
        mesh = new Mesh(new CircleGeometry(node.geometry.radius, node.geometry.segments, node.geometry.thetaLenght, node.geometry.thetaStarts), this.createNodeMaterial(node));
        break;
      case "sphere":
        mesh = new Mesh(new SphereGeometry(node.geometry.radius, 32, 24), this.createNodeMaterial(node));
        break;
      case "cylinder":
        mesh = new Mesh(new CylinderGeometry(node.geometry.radiusTop, node.geometry.radiusBottom, node.geometry.height, 32), this.createNodeMaterial(node));
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
    // W3D TextureText: when `<TextBoxSize>` is authored, the text MUST fit
    // inside that box — broadcast templates author short labels like
    // "COACH"/"BENCH" with portrait boxes that reserve vertical space but
    // expect the glyph height to be constrained by the box. Without this
    // step the TextGeometry renders at its natural cap-height (set by
    // `node.geometry.size`) and short strings spill outside their card.
    // Strategy: uniform-scale the generated geometry down so its bbox fits;
    // never up-scale (a wide box around a short string is the author's
    // intent — extra padding, not larger text).
    const { maxWidth, maxHeight, alignmentX, alignmentY } = node.geometry;
    if ((maxWidth && maxWidth > 0) || (maxHeight && maxHeight > 0)) {
      const bbox = geometry.boundingBox;
      if (bbox) {
        const w = bbox.max.x - bbox.min.x;
        const h = bbox.max.y - bbox.min.y;
        let s = 1;
        if (maxWidth && maxWidth > 0 && w > maxWidth) s = Math.min(s, maxWidth / w);
        if (maxHeight && maxHeight > 0 && h > maxHeight) s = Math.min(s, maxHeight / h);
        if (s < 1 && Number.isFinite(s) && s > 0) {
          geometry.scale(s, s, 1);
          geometry.computeBoundingBox();
        }
      }
    }
    // W3D AlignmentX/AlignmentY: place the (already fitted) text inside a
    // virtual TextBoxSize-defined rectangle centred at the node's local
    // origin. Three.js TextGeometry starts at baseline-left, which lands
    // every label on the wrong side of the node's anchor; the translation
    // below recentres / left-aligns / right-aligns / top/bottom-aligns
    // according to the W3D author's intent. Only fires when at least one
    // alignment axis is explicit — legacy 3Forge imports (no W3D
    // alignment) keep their baseline-left origin so old behaviour is
    // preserved. Skipped when no bbox or the geometry has zero extent
    // (empty/whitespace text — translation would be ill-defined).
    if (alignmentX || alignmentY) {
      const bbox = geometry.boundingBox;
      if (bbox) {
        const w = bbox.max.x - bbox.min.x;
        const h = bbox.max.y - bbox.min.y;
        const boxW = maxWidth && maxWidth > 0 ? maxWidth : w;
        const boxH = maxHeight && maxHeight > 0 ? maxHeight : h;
        const { dx, dy } = computeTextAlignOffset(
          { minX: bbox.min.x, maxX: bbox.max.x, minY: bbox.min.y, maxY: bbox.max.y },
          boxW,
          boxH,
          alignmentX,
          alignmentY,
        );
        if (dx !== 0 || dy !== 0) {
          geometry.translate(dx, dy, 0);
          geometry.computeBoundingBox();
        }
      }
    }
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

  private createNodeMaterial(node: Exclude<EditorNode, { type: "group" }>): Material {
    return buildMaterialFromSpec(this.createBaseMaterialOptions(node), node.material);
  }

  private createBaseMaterialOptions(node: Exclude<EditorNode, { type: "group" }>): ConstructorParameters<typeof MeshBasicMaterial>[0] {
    return {
      color: node.material.color,
      opacity: node.material.opacity,
      transparent: node.material.transparent,
      alphaTest: node.material.alphaTest,
      depthTest: node.material.depthTest,
      depthWrite: node.material.depthWrite,
      wireframe: node.material.wireframe,
      ...((node.type === "plane" || node.type === "circle" || node.type === "image") ? { side: DoubleSide } : {}),
    };
  }

  private createImageMesh(node: ImageNode): Mesh {
    const geometry = new PlaneGeometry(node.geometry.width, node.geometry.height);
    const mime = node.image.mimeType;
    const kind = decideImageMeshKind(node.image);
    // Forensic log: lets the operator see exactly what mime + sequence shape
    // the renderer is observing per node. Throttled to first 12 calls per
    // SceneEditor instance so it doesn't spam in big scenes.
    if (this.imageMeshLogCount < 12) {
      this.imageMeshLogCount += 1;
      // eslint-disable-next-line no-console
      console.info(
        `[scene createImageMesh] node=${node.name ?? node.id} mime=${mime} ` +
        `hasSequenceField=${!!node.image.sequence} ` +
        `seqFrames=${node.image.sequence?.frameUrls?.length ?? 0} ` +
        `→ ${kind}`,
      );
    }
    let texture: Texture;
    if (kind === "image-sequence" && node.image.sequence) {
      const player = this.getOrCreateSequencePlayer(node.id, node.image.sequence);
      texture = player.texture;
    } else if (kind === "sequence-payload-missing") {
      // The mime survived but the sequence payload didn't. This happens
      // when an autosave round-trip strips frameUrls from localStorage to
      // dodge the quota limit. The src field still holds the first frame's
      // blob URL but it may be revoked from a prior session → blank
      // texture + "needsUpdate but no image" warnings. By default we bind a
      // 1×1 fully-transparent texture so the mesh stays in the scene tree
      // (layout unchanged) but writes no visible pixels. Operators who want
      // the explicit magenta/black "broken layer" indicator can opt in by
      // setting `window.__r3DebugBrokenTextures = true` in devtools — see
      // createSequenceMissingPlaceholderTexture.
      // eslint-disable-next-line no-console
      console.warn(
        `[scene] image-sequence node "${node.name ?? node.id}" lost its sequence payload — ` +
        `re-import the W3D folder to restore frame URLs. Falling back to placeholder.`,
      );
      texture = this.createSequenceMissingPlaceholderTexture();
    } else if (kind === "video") {
      texture = this.getVideoTexture(node.image.src);
    } else {
      texture = this.getTexture(node.image.src, node.material.textureOptions);
    }
    const baseOptions = {
      ...this.createBaseMaterialOptions(node),
      map: texture,
    };
    const material = buildMaterialFromSpec(baseOptions, node.material);
    return new Mesh(geometry, material);
  }

  /**
   * Returns a Texture for the sequence-payload-missing fallback. By
   * default it is a 1×1 fully-transparent DataTexture — the mesh exists
   * in the scene tree (so layout stays stable) but renders nothing. The
   * console warning fired from createImageMesh tells the operator to
   * re-import the W3D folder to refresh the frame URLs.
   *
   * The magenta/black checker (`createSequenceMissingDebugTexture`) is
   * gated behind a debug flag — set `window.__r3DebugBrokenTextures =
   * true` in devtools to see the explicit "broken layer" indicator. In
   * normal viewport mode, missing sequences are silently transparent so
   * a localStorage round-trip that strips frameUrls (Pass K/C) doesn't
   * blast the viewport with a debug pattern.
   */
  private createSequenceMissingPlaceholderTexture(): Texture {
    if (
      typeof window !== "undefined" &&
      (window as unknown as { __r3DebugBrokenTextures?: boolean }).__r3DebugBrokenTextures
    ) {
      return this.createSequenceMissingDebugTexture();
    }
    return buildSequencePlaceholderTexture({ debug: false });
  }

  /**
   * Magenta/black checker — kept for explicit debugging. Operators opt
   * in via `window.__r3DebugBrokenTextures = true`. NOT used in normal
   * viewport rendering. Reuses `getDebugFallbackImage()` when canvas is
   * available; falls back to 1×1 transparent in jsdom-without-canvas so
   * the mesh renders nothing rather than garbage.
   */
  private createSequenceMissingDebugTexture(): Texture {
    const fallback = this.getDebugFallbackImage();
    if (fallback) {
      const t = new Texture(fallback);
      t.colorSpace = SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }
    const transparent = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    transparent.needsUpdate = true;
    return transparent;
  }

  private getOrCreateSequencePlayer(
    nodeId: string,
    spec: import("./types").ImageSequenceMetadata,
  ): ImageSequencePlayer {
    const existing = this.sequencePlayers.get(nodeId);
    if (existing) return existing;
    const player = new ImageSequencePlayer({
      frameUrls: spec.frameUrls,
      fps: spec.fps,
      loop: spec.loop,
      width: spec.width || 1,
      height: spec.height || 1,
    });
    this.sequencePlayers.set(nodeId, player);
    return player;
  }

  /**
   * Lazily builds a tiny 8×8 magenta/black checker that we slot in whenever a
   * texture load fails. Magenta is the long-running graphics-pipeline
   * convention for "missing texture" — it makes the broken quad pop visually
   * instead of vanishing into the material's flat colour. Returns null in
   * environments where canvas isn't usable (jsdom without canvas), in which
   * case the caller just leaves the texture as-is.
   */
  private getDebugFallbackImage(): HTMLCanvasElement | null {
    if (this.debugFallbackImage) return this.debugFallbackImage;
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ff00ff";
      ctx.fillRect(0, 0, 8, 8);
      ctx.fillStyle = "#000000";
      for (let y = 0; y < 8; y += 2) {
        for (let x = (y / 2) % 2; x < 8; x += 2) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    } catch {
      return null;
    }
    this.debugFallbackImage = canvas;
    return canvas;
  }

  private getVideoTexture(src: string): VideoTexture {
    const cached = this.videoTextureCache.get(src);
    if (cached) return cached;
    const video = document.createElement("video");
    video.src = src;
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    // One-line confirmation that a VideoTexture was actually requested,
    // so the operator can tell the difference between "video binding
    // never tried" and "video tried but stayed paused".
    // eslint-disable-next-line no-console
    console.info(`[scene] video texture requested src=${src}`);
    // Surface load failures (404, codec mismatch, CORS) — they would
    // otherwise leave the VideoTexture stuck on a blank frame with no
    // console signal at all. The formatted message names the most likely
    // remediation (transcode to H.264 MP4) when the failure looks like a
    // codec problem.
    video.addEventListener("error", () => {
      // eslint-disable-next-line no-console
      console.warn(formatVideoLoadFailureMessage(src, video.error?.code));
    });
    // Autoplay may be blocked until a user gesture. We swallow the
    // rejection silently *and* log a single info line so the operator
    // sees a clear "click anywhere to start" hint when nothing is
    // moving on screen.
    video.play().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.info(
        `[scene] video.play() rejected for src=${src} (${err instanceof Error ? err.name : "unknown"}). ` +
        `Autoplay is likely blocked — click anywhere on the page to start.`,
      );
    });
    const texture = new VideoTexture(video);
    texture.colorSpace = SRGBColorSpace;
    this.videoTextureCache.set(src, texture);
    return texture;
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

  private getTexture(src: string, options?: TextureSamplingOptions): Texture {
    // Without options the cache is keyed purely by src. Multiple meshes can
    // share the same Texture instance, which is the cheapest path.
    if (!options) {
      const cached = this.textureCache.get(src);
      if (cached) return cached;
      // Variants registered against a still-loading base get their image
      // populated from the base's onLoad callback. Three's `Texture.clone()`
      // captures `image` by reference at clone time, so a clone made before
      // the image arrives stays empty even after the base finishes loading
      // — we must propagate explicitly. The base is created below and the
      // closure references it via `texture`.
      const variants: Texture[] = [];
      const onLoad = (loaded: Texture) => {
        // Three sets `loaded.needsUpdate = true` itself on the internal
        // ImageLoader onLoad. Propagate the image to every variant that
        // cloned from this base before the network round-trip completed.
        for (const v of variants) {
          v.image = loaded.image;
          v.needsUpdate = true;
        }
      };
      // Three's TextureLoader signature is (url, onLoad, onProgress, onError).
      // Without onError a 404 / CORS / mime mismatch leaves the texture
      // permanently blank and the user just sees the material's flat colour
      // with no console signal. Swap to a debug magenta image and warn so
      // the broken layer is obvious in-editor.
      // Three's loader contract is `(err: unknown) => void`; widen the param
      // type so it satisfies the call site below while still narrowing to
      // ErrorEvent for the diagnostic message.
      const onError = (err: unknown) => {
        const reason = err instanceof ErrorEvent ? err.message : "load error";
        // eslint-disable-next-line no-console
        console.warn(`[scene] texture failed to load src=${src} reason=${reason}`);
        const fallback = this.getDebugFallbackImage();
        if (fallback) {
          // Three.Texture.image is typed as HTMLImageElement, but it accepts
          // any TexImageSource at runtime — including the HTMLCanvasElement
          // we synthesise as a debug fallback. Cast to keep typecheck happy
          // without changing the runtime swap.
          texture.image = fallback as unknown as HTMLImageElement;
          texture.needsUpdate = true;
          // Variants registered against a never-loaded base would otherwise
          // stay blank — paint the same fallback into them so the warning
          // is visible everywhere the broken texture is referenced.
          for (const v of variants) {
            v.image = fallback as unknown as HTMLImageElement;
            v.needsUpdate = true;
          }
        }
      };
      const texture = this.textureLoader.load(src, onLoad, undefined, onError);
      texture.colorSpace = SRGBColorSpace;
      // Stash the variants list on the texture so the variant-clone branch
      // below can register itself for image propagation. Typed via a
      // structural cast — the field is purely internal to this method.
      (texture as Texture & { __r3Variants?: Texture[] }).__r3Variants = variants;
      // NOTE: do NOT set `texture.needsUpdate = true` here. The image is
      // still loading; marking the texture dirty before image data exists
      // produces the "Texture marked for update but no image data found"
      // WebGL warning. Three's internal onLoad bumps needsUpdate itself
      // once the image arrives.
      this.textureCache.set(src, texture);
      return texture;
    }

    // With options the cache key composes src + a deterministic options
    // signature — Three's Texture wrap/filter/offset are per-instance, so
    // two quads using the same PNG with different sampling settings need
    // distinct Texture objects.
    const key = `${src}::${textureOptionsCacheKey(options)}`;
    const cached = this.textureCache.get(key);
    if (cached) return cached;
    // Clone the canonical (no-options) texture so the underlying ImageBitmap
    // is reused. clone() copies wrap/filter/offset slots which we then
    // overwrite per W3D TextureMappingOption.
    const base = this.getTexture(src);
    const variant = base.clone();
    variant.colorSpace = SRGBColorSpace;
    applyTextureSamplingOptions(variant, options, this.renderer.capabilities.getMaxAnisotropy());
    // If the base already has its image (synchronous cache hit or load
    // finished between calls), mark the variant ready immediately. Otherwise
    // register it on the base's variants list so the eventual onLoad
    // callback pushes the image into this clone.
    if (variant.image) {
      setTextureUpdateIfReady(variant);
    } else {
      const variants = (base as Texture & { __r3Variants?: Texture[] }).__r3Variants;
      if (variants) variants.push(variant);
    }
    this.textureCache.set(key, variant);
    return variant;
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
      this.selectionHelper?.removeFromParent();
      this.selectionHelper = null;
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

    this.updateSelectionHelper(selectedObjects);
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

  private updateSelectionHelper(objects: Object3D[]): void {
    if (!this.computeSelectionBounds(objects)) {
      this.selectionHelper?.removeFromParent();
      this.selectionHelper = null;
      this.lastSelectionHelperUpdateAt = performance.now();
      return;
    }

    if (!this.selectionHelper) {
      this.selectionHelper = new Box3Helper(this.selectionBounds.clone(), 0x6b2ecf);
      this.scene.add(this.selectionHelper);
      return;
    }

    this.selectionHelper.box.copy(this.selectionBounds);
    this.lastSelectionHelperUpdateAt = performance.now();
  }

  private updateSelectionHelperFromCache(): void {
    if (this.selectedObjects.length === 0) {
      if (this.selectionHelper) {
        this.updateSelectionHelper([]);
      }
      this.selectionHelperDirty = false;
      return;
    }

    if (!this.selectionHelperDirty) {
      return;
    }

    const now = performance.now();
    if (
      this.isAnimationPlaying &&
      now - this.lastSelectionHelperUpdateAt < SELECTION_HELPER_PLAYBACK_UPDATE_INTERVAL_MS
    ) {
      return;
    }

    this.updateSelectionHelper(this.selectedObjects);
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
    this.viewportRoot.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          for (const material of object.material) {
            material.dispose();
          }
        } else {
          object.material.dispose();
        }
      }
    });

    this.viewportRoot.clear();
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = width / height;
    } else {
      // Orthographic: keep half-extent of 5 world units; scale horizontally
      // by aspect so a 2D layout fits in either window orientation.
      const halfHeight = 5;
      const aspect = width / height;
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.orientationCamera.aspect = 1;
    this.orientationCamera.updateProjectionMatrix();
    this.orientationRenderer.setSize(this.ORIENTATION_SIZE, this.ORIENTATION_SIZE, false);
  }

  private buildCameraForMode(mode: "2d" | "3d"): PerspectiveCamera | OrthographicCamera {
    if (mode === "2d") {
      // Half-extent 5: covers most broadcast layouts (~10 units wide). The
      // resize() pass updates the aspect-driven left/right immediately.
      const camera = new OrthographicCamera(-5, 5, 5, -5, 0.01, 2000);
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      camera.up.set(0, 1, 0);
      return camera;
    }
    const camera = new PerspectiveCamera(45, 1, 0.01, 2000);
    camera.position.set(6, 5, 8);
    return camera;
  }

  private applyOrbitControlsForMode(mode: "2d" | "3d"): void {
    // Rotate/pan/zoom enablement is policy-driven so the rules live in one
    // pure function (see `orbitPolicyForSceneMode`). The other settings
    // (panning style, target, distance limits) are mode-specific tuning
    // that doesn't need to be unit-tested separately.
    const policy = orbitPolicyForSceneMode(mode);
    this.orbitControls.enableRotate = policy.enableRotate;
    this.orbitControls.enablePan = policy.enablePan;
    this.orbitControls.enableZoom = policy.enableZoom;
    if (mode === "2d") {
      // Broadcast-style canvas: pan keeps the axes parallel to the screen,
      // and zoom drives camera.zoom on the OrthographicCamera (OrbitControls
      // handles that automatically). Rotate is locked off via the policy
      // above — _FS layouts are flat 2D and tilt looks broken.
      this.orbitControls.screenSpacePanning = true;
      this.orbitControls.target.set(0, 0, 0);
      this.orbitControls.maxDistance = 200;
      this.orbitControls.minDistance = 0.1;
    } else {
      this.orbitControls.screenSpacePanning = false;
      this.orbitControls.target.set(0, 1, 0);
      this.orbitControls.maxDistance = 80;
      this.orbitControls.minDistance = 1;
    }
    this.orbitControls.update();
  }

  /**
   * Hot-swap the camera/orbit-controls when the blueprint's sceneMode changes.
   * TransformControls is bound to a camera too — recreated lazily by callers
   * via a full scene rebuild.
   */
  applySceneMode(mode: "2d" | "3d"): void {
    if (mode === this.currentSceneMode) return;
    this.currentSceneMode = mode;
    const next = this.buildCameraForMode(mode);
    // Preserve the renderer size on the new camera.
    this.camera = next;
    this.orbitControls.object = this.camera;
    this.transformControls.camera = this.camera;
    this.applyOrbitControlsForMode(mode);
    this.resize();
    // Forget the last applied engine snapshot so the next rebuildScene with a
    // matching blueprint re-frames against the new camera.
    this.lastAppliedEngineKey = null;
  }

  /**
   * Apply blueprint.engine (background colour + camera framing) once per
   * blueprint identity. Comparing the JSON serialisation is cheap (these
   * objects are tiny) and it avoids stomping on the user's navigation when
   * the same blueprint is rebuilt because of e.g. a node edit.
   */
  private maybeApplyEngineSettings(): void {
    const engine = this.store.blueprint.engine;
    const key = engine ? JSON.stringify(engine) : "";
    if (key === this.lastAppliedEngineKey) {
      return;
    }
    this.lastAppliedEngineKey = key;

    if (engine?.background) {
      if (engine.background.type === "color") {
        const color = new Color(engine.background.color);
        this.scene.background = color;
        const alpha = engine.background.alpha ?? 1;
        this.renderer.setClearColor(color, alpha);
      } else {
        this.scene.background = null;
        this.renderer.setClearColor(0x000000, 0);
      }
    }

    const cam = engine?.camera;
    if (cam?.position) {
      this.camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    }
    if (cam?.target) {
      this.orbitControls.target.set(cam.target.x, cam.target.y, cam.target.z);
    } else if (cam?.rotation && cam?.position) {
      // Authored camera has explicit rotation but no explicit target. Set the
      // rotation (degrees → radians) so we can derive a forward axis, then
      // place the orbit target along that forward direction. OrbitControls'
      // subsequent .update() will re-derive the camera basis from
      // position + target — matching the authored pose without snapping the
      // camera to look at world origin.
      this.camera.rotation.set(
        (cam.rotation.x * Math.PI) / 180,
        (cam.rotation.y * Math.PI) / 180,
        (cam.rotation.z * Math.PI) / 180,
      );
      const forward = new Vector3(0, 0, -1).applyEuler(this.camera.rotation);
      // Distance is arbitrary; OrbitControls only uses target as a pivot
      // direction. 5 units works for typical broadcast scene scales.
      this.orbitControls.target.copy(this.camera.position).addScaledVector(forward, 5);
    } else if (cam?.position) {
      // No explicit target or rotation — point at the world origin, which is
      // where R3 tracked broadcast cameras conventionally aim.
      this.orbitControls.target.set(0, 0, 0);
    }
    if (cam?.fovY !== undefined && this.camera instanceof PerspectiveCamera) {
      // Apply unconditionally — many R3 cameras only ship a FoV without an
      // explicit position, and we still want the projection to match the
      // authored field-of-view (the rest of the framing then comes from
      // frameAllForCurrentMode).
      this.camera.fov = cam.fovY;
      this.camera.updateProjectionMatrix();
    }
    if (cam?.position || cam?.target || cam?.fovY !== undefined) {
      this.orbitControls.update();
    }
    // Mirror broadcast metadata (IsTracked, TrackingCamera, RenderTarget,
    // AspectRatio, FieldofViewX, sourceId/Name) onto the camera object so
    // future broadcast plug-ins / runtime exports can read it back without
    // having to traverse the blueprint.
    if (cam?.metadata) {
      this.camera.userData.w3d = { ...this.camera.userData.w3d, ...cam.metadata };
    }
  }

  private startLoop(): void {
    const tick = () => {
      this.animationFrame = requestAnimationFrame(tick);
      this.lastPlaybackTickTime = performance.now();
      const dt = this.playerClock.getDelta();
      for (const player of this.sequencePlayers.values()) player.tick(dt);
      this.updateAnimationPlayback();
      this.orbitControls.update();
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

      // `transform.skew.*` lives on a runtime skewLayer Group rather than the
      // wrapper itself — set up (or reuse) the layer + a mutable runtimeSkew
      // record before resolving owner/property. The post-write hook below
      // rebuilds the shear matrix once any axis has been written.
      let owner: Record<string, unknown> | null = null;
      let property: string | null = null;
      let postUpdate: (() => void) | undefined;
      if (track.property.startsWith("transform.skew.")) {
        const axis = track.property.slice("transform.skew.".length);
        if (axis !== "x" && axis !== "y" && axis !== "z") {
          continue;
        }
        const skewLayer = this.ensureSkewLayer(target, node.transform.skew);
        const runtimeSkew = (target.userData.runtimeSkew ??= {
          x: node.transform.skew?.x ?? 0,
          y: node.transform.skew?.y ?? 0,
          z: node.transform.skew?.z ?? 0,
        }) as { x: number; y: number; z: number };
        owner = runtimeSkew as unknown as Record<string, unknown>;
        property = axis;
        postUpdate = () => {
          skewLayer.matrix.copy(buildSkewMatrix(runtimeSkew));
        };
      } else {
        const objectPath = toObjectAnimationPath(track.property);
        [owner, property] = resolveAnimationTarget(target, objectPath);
      }
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
        postUpdate,
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
      // Skew tracks need the shared 4×4 shear matrix rebuilt after every
      // axis write — no-op for everything else.
      track.postUpdate?.();
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
  }

  private resetAnimatedObjectsToBlueprintState(): void {
    for (const node of this.store.blueprint.nodes) {
      const object = this.objectMap.get(node.id);
      if (!object) {
        continue;
      }

      const renderable = node.visible && !node.isMask && !this.isMissingTextureNode(node.id);
      object.visible = renderable;
      object.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z);
      // Blueprint rotation is in degrees — Three.js Euler is radians. See create path.
      object.rotation.set(
        (node.transform.rotation.x * Math.PI) / 180,
        (node.transform.rotation.y * Math.PI) / 180,
        (node.transform.rotation.z * Math.PI) / 180,
      );
      object.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z);

      const mesh = this.getAnimatedVisibilityMeshTarget(object);
      if (mesh) {
        mesh.visible = renderable;
      }
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
  // material.* paths target the first Mesh's material under the wrapper —
  // wrappers are Groups so a generic property walk would fail to find
  // `.material`. We pick the first Mesh and force material.transparent so
  // opacity changes actually composite (Three skips the alpha sort path
  // when transparent=false).
  if (path.startsWith("material.")) {
    let mesh: Mesh | null = null;
    target.traverse((child) => {
      if (!mesh && child instanceof Mesh) mesh = child;
    });
    if (!mesh) return [null, null];
    const meshObj: Mesh = mesh;
    const material = meshObj.material;
    const owner = Array.isArray(material) ? material[0] : material;
    if (!owner) return [null, null];
    // Animated UV offset/repeat: route to the underlying Three Texture's
    // `offset`/`repeat` Vector2. R3 broadcast templates animate these for
    // sliding logos and ticker bands; the static counterpart already lives
    // in MaterialSpec.textureOptions and is applied at texture creation.
    const textureOpsMatch = /^material\.textureOptions\.(offset|repeat)([UV])$/.exec(path);
    if (textureOpsMatch) {
      const map = (owner as { map?: unknown }).map;
      if (!map || typeof map !== "object") return [null, null];
      const vecKey = textureOpsMatch[1];
      const axis = textureOpsMatch[2] === "U" ? "x" : "y";
      const vec = (map as Record<string, unknown>)[vecKey];
      if (!vec || typeof vec !== "object") return [null, null];
      return [vec as Record<string, unknown>, axis];
    }
    if (path === "material.opacity") {
      forEachMaterial(meshObj, (m) => {
        m.transparent = true;
      });
    }
    const property = path.slice("material.".length);
    return [owner as unknown as Record<string, unknown>, property];
  }

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

function forEachMaterial(mesh: Mesh, fn: (material: Material) => void): void {
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const m of material) fn(m);
  } else if (material) {
    fn(material);
  }
}

/**
 * Stable signature for cache lookups. Order matters: the same six fields
 * always go into the key in the same order so two equivalent options
 * objects produce identical strings.
 */
function textureOptionsCacheKey(options: TextureSamplingOptions): string {
  return [
    options.wrapU ?? "_",
    options.wrapV ?? "_",
    options.magFilter ?? "_",
    options.minFilter ?? "_",
    options.anisotropy ?? "_",
    options.offsetU ?? "_",
    options.offsetV ?? "_",
    options.repeatU ?? "_",
    options.repeatV ?? "_",
  ].join("|");
}

function applyTextureSamplingOptions(
  texture: Texture,
  options: TextureSamplingOptions,
  maxAnisotropy: number,
): void {
  if (options.wrapU) texture.wrapS = wrapToThree(options.wrapU);
  if (options.wrapV) texture.wrapT = wrapToThree(options.wrapV);
  if (options.magFilter) texture.magFilter = magFilterToThree(options.magFilter);
  if (options.minFilter) texture.minFilter = minFilterToThree(options.minFilter);
  if (options.anisotropy !== undefined) {
    // Cap to GPU max so we don't request unsupported levels.
    texture.anisotropy = Math.min(options.anisotropy, Math.max(1, maxAnisotropy));
  }
  if (options.offsetU !== undefined) texture.offset.x = options.offsetU;
  if (options.offsetV !== undefined) texture.offset.y = options.offsetV;
  if (options.repeatU !== undefined) texture.repeat.x = options.repeatU;
  if (options.repeatV !== undefined) texture.repeat.y = options.repeatV;
  // Only flag dirty when the texture already has image data — guards against
  // "Texture marked for update but no image data found" warnings when this
  // helper runs on a freshly-cloned variant whose image hasn't arrived yet.
  // The variant will be re-marked dirty by the base's onLoad propagation.
  setTextureUpdateIfReady(texture);
}

function wrapToThree(value: NonNullable<TextureSamplingOptions["wrapU"]>): Texture["wrapS"] {
  switch (value) {
    case "repeat": return RepeatWrapping;
    case "mirror": return MirroredRepeatWrapping;
    case "clamp":
    default: return ClampToEdgeWrapping;
  }
}

function magFilterToThree(value: NonNullable<TextureSamplingOptions["magFilter"]>): Texture["magFilter"] {
  // MagFilter only has Nearest or Linear in WebGL — anisotropic falls back
  // to Linear and the dedicated `anisotropy` field handles the upgrade.
  return value === "nearest" ? NearestFilter : LinearFilter;
}

function minFilterToThree(value: NonNullable<TextureSamplingOptions["minFilter"]>): Texture["minFilter"] {
  switch (value) {
    case "nearest": return NearestMipMapNearestFilter;
    case "anisotropic":
    case "linear":
    default: return LinearMipMapLinearFilter;
  }
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
 * Returns the OrbitControls policy that should apply for a given scene mode.
 * Pure — easy to test. The renderer applies the result to the live controls
 * (see `applyOrbitControlsForMode`).
 *
 * Why this exists: a `_FS` (full-screen broadcast) W3D scene is authored as a
 * flat 2D composition viewed straight-on. With OrbitControls' default
 * `enableRotate: true`, the user can mouse-drag the OrthographicCamera into a
 * tilted angle and the layout (e.g. GameName_FS court) starts to look like a
 * tilted 3D plane — which is wrong, the geometry was never designed for any
 * other angle. Pan + zoom stay enabled so canvas navigation still works.
 */
/**
 * Discriminator for the four texture-binding paths inside `createImageMesh`.
 * Extracted as a pure exported helper so the branching can be unit-tested
 * without instantiating SceneEditor (which needs WebGL + a DOM).
 */
export type ImageMeshKind = "image-sequence" | "video" | "image" | "sequence-payload-missing";

/**
 * Decides which texture-binding branch `createImageMesh` should take for a
 * given image asset. The new `"sequence-payload-missing"` value surfaces the
 * regression where mime survives autosave round-tripping but the
 * `sequence.frameUrls` payload doesn't — we don't want to silently fall to
 * the video branch with a revoked blob URL.
 */
/**
 * Phase 3 reopen diagnostic: classifies a sequence node into a resolver
 * state for `__r3Dump.imageSequence.resolverStatus`. Pure so it can be
 * unit-tested without instantiating SceneEditor.
 *
 *   - `resolved`              — frameUrls present and the player is healthy
 *   - `missing-folder-access` — sequence has manifestPath + storageType
 *                               "project-folder" but no frameUrls
 *                               (e.g. workspace autosave rehydrated the
 *                                blueprint without an FSA folder handle)
 *   - `dev-cache-expired`     — storageType "dev-cache" + no frameUrls
 *                               (transient frames vanished — re-import to
 *                                save permanently)
 *   - `unsupported-storage`   — storageType is something the renderer
 *                               doesn't recognise (forward-compat guard)
 *   - `player-error`          — frameUrls present but the live player has
 *                               an error in its state (e.g. a frame fetch
 *                                failed after init)
 *   - `unresolved`            — generic catch-all (no metadata to act on)
 *
 * Parse-time statuses (`missing-manifest`, `invalid-manifest`,
 * `missing-frame`) fire as warnings during `parseW3DFromFolder` and
 * surface via `result.warnings`; the renderer never observes them
 * because the parser drops the sequence and falls back to video mime.
 */
export type SequenceResolverStatus =
  | "resolved"
  | "missing-folder-access"
  | "dev-cache-expired"
  | "unsupported-storage"
  | "player-error"
  | "unresolved";

export interface SequenceResolverStatusInput {
  hasFrameUrls: boolean;
  playerError: string | null;
  /** Sequence storage type from the blueprint, may be undefined for legacy. */
  storageType?: string;
  /** True when the sequence has manifestPath set (Phase 1 layout). */
  hasManifestPath?: boolean;
}

export function computeSequenceResolverStatus(input: SequenceResolverStatusInput): SequenceResolverStatus {
  if (input.hasFrameUrls) {
    if (input.playerError) return "player-error";
    return "resolved";
  }
  // No frameUrls — diagnose WHY based on storage shape.
  if (input.storageType === "dev-cache") return "dev-cache-expired";
  if (input.storageType !== undefined && input.storageType !== "project-folder") {
    return "unsupported-storage";
  }
  // project-folder, or the legacy back-compat case where storageType is
  // unknown — both point at "we expected to find frames in the project
  // folder but they aren't here".
  return "missing-folder-access";
}

export interface SequenceResolverWarning {
  /** The resolver status that produced this warning. */
  status: SequenceResolverStatus;
  /** Number of distinct assets in the blueprint affected by this status. */
  count: number;
  /** Operator-facing message ready for a toast. Already pluralised /
   * grouped — there is at most ONE warning per status, regardless of
   * how many assets share it. */
  message: string;
  /** The names of the affected assets, for log/devtools follow-up. */
  assetNames: string[];
}

/**
 * Walks the blueprint and groups image-sequence assets that failed to
 * resolve into one warning per resolver-status. Used by App.tsx after
 * `loadBlueprint` to fire a single toast per failure mode (e.g. "3
 * sequences could not be loaded — reconnect the project folder")
 * instead of one toast per asset.
 *
 * Asset-library entries (`blueprint.images`) are the canonical source
 * — image nodes pointing into the library inherit its sequence shape.
 * Sequences in `resolved` or `player-error` state are NOT reported
 * here (resolved is success; player-error is a runtime symptom that
 * surfaces via `__r3Dump.imageSequence.error`, not at load time).
 */
export function summariseSequenceResolverWarnings(
  blueprint: ComponentBlueprint,
): SequenceResolverWarning[] {
  // Collect unique sequence assets by id (or by name when id is missing,
  // which is the legacy case). Asset library is canonical; image nodes
  // that carry their own `image.sequence` (no library entry) are also
  // considered so we don't miss inline assets.
  const seen = new Map<string, { name: string; status: SequenceResolverStatus }>();
  const consider = (asset: { id?: string; name: string; sequence?: ImageSequenceMetadata } | undefined): void => {
    if (!asset?.sequence) return;
    const key = asset.id ?? asset.name;
    if (seen.has(key)) return;
    const seq = asset.sequence;
    const status = computeSequenceResolverStatus({
      hasFrameUrls: (seq.frameUrls?.length ?? 0) > 0,
      playerError: null,
      storageType: seq.storageType,
      hasManifestPath: !!seq.manifestPath,
    });
    seen.set(key, { name: asset.name, status });
  };
  for (const asset of blueprint.images ?? []) consider(asset);
  for (const node of blueprint.nodes) {
    if (node.type !== "image") continue;
    consider(node.image);
  }

  // Group by status — but skip the success and runtime-only ones.
  const groups = new Map<SequenceResolverStatus, string[]>();
  for (const { name, status } of seen.values()) {
    if (status === "resolved") continue;
    if (status === "player-error") continue;  // surfaces via runtime player state, not load
    const list = groups.get(status) ?? [];
    list.push(name);
    groups.set(status, list);
  }

  const out: SequenceResolverWarning[] = [];
  for (const [status, names] of groups) {
    out.push({
      status,
      count: names.length,
      message: groupedMessageFor(status, names.length),
      assetNames: names,
    });
  }
  return out;
}

function groupedMessageFor(status: SequenceResolverStatus, count: number): string {
  const plural = count === 1 ? "image sequence" : `${count} image sequences`;
  switch (status) {
    case "missing-folder-access":
      return `${count === 1 ? "An" : count} ${plural === "image sequence" ? "image sequence" : plural} could not be loaded. Reconnect or re-import the project folder to load ${count === 1 ? "it" : "them"}.`;
    case "dev-cache-expired":
      return `${count === 1 ? "A temporary MOV sequence" : `${count} temporary MOV sequences`} expired. Re-import with project folder access to save ${count === 1 ? "it" : "them"} permanently.`;
    case "unsupported-storage":
      return `${count === 1 ? "An image sequence has" : `${count} image sequences have`} an unsupported storage type and could not be loaded.`;
    case "unresolved":
    default:
      return `${count === 1 ? "An image sequence" : `${count} image sequences`} could not be resolved.`;
  }
}

/** Operator-facing one-liner explaining the resolver status. */
export function describeSequenceResolverStatus(status: SequenceResolverStatus, manifestPath?: string | null): string {
  switch (status) {
    case "resolved":
      return "Sequence resolved.";
    case "missing-folder-access":
      return `Sequence frames are stored in the project folder${manifestPath ? ` (${manifestPath})` : ""}. Reconnect or re-import the project folder to load them.`;
    case "dev-cache-expired":
      return "Temporary MOV sequence expired. Re-import with project folder access to save it permanently.";
    case "unsupported-storage":
      return "Sequence storage type is not recognised by this build of the editor.";
    case "player-error":
      return "Sequence player reported a frame load error.";
    case "unresolved":
    default:
      return "Sequence is not resolved.";
  }
}

export function decideImageMeshKind(image: {
  mimeType: string;
  sequence?: { frameUrls?: string[] };
}): ImageMeshKind {
  const mime = image.mimeType;
  if (mime === "application/x-image-sequence") {
    if (image.sequence && image.sequence.frameUrls && image.sequence.frameUrls.length > 0) {
      return "image-sequence";
    }
    return "sequence-payload-missing";
  }
  if (typeof mime === "string" && mime.startsWith("video/")) return "video";
  return "image";
}

/**
 * Pure builder for the sequence-payload-missing placeholder Texture. Pulled
 * out of `SceneEditor.createSequenceMissingPlaceholderTexture` so the
 * branching can be unit-tested without instantiating SceneEditor (which
 * needs WebGL + a DOM). The default branch returns a 1×1 fully-transparent
 * `DataTexture` — the host mesh stays in the scene tree but writes no
 * visible pixels. When `debug` is true and a `buildDebugTexture` factory is
 * provided, that factory is called to produce the magenta/black "broken
 * layer" checker (Pass K/B's behaviour, now opt-in via
 * `window.__r3DebugBrokenTextures = true`).
 */
export function buildSequencePlaceholderTexture(opts: {
  debug: boolean;
  buildDebugTexture?: () => Texture;
}): Texture {
  if (opts.debug && opts.buildDebugTexture) {
    return opts.buildDebugTexture();
  }
  const data = new Uint8Array([0, 0, 0, 0]);
  const tex = new DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  return tex;
}

export interface OrbitPolicy {
  enableRotate: boolean;
  enablePan: boolean;
  enableZoom: boolean;
}

/**
 * W3D TextureText alignment: compute the (dx, dy) translation that moves a
 * baseline-left TextGeometry so its content sits inside a virtual
 * `(boxW × boxH)` rectangle centred at the node's local origin, honouring
 * AlignmentX/Y. Pure math — no Three.js dependency — so unit tests don't
 * need a renderer + font.
 *
 * Conventions:
 *   - The bbox is the post-fit geometry bounding box in node-local space.
 *   - Output dx/dy is a translation applied to that geometry.
 *   - When an alignment axis is undefined, the corresponding offset stays 0
 *     (preserves the existing baseline-left X / baseline Y behaviour).
 *
 * Reference points after the translation has been applied:
 *   alignmentX = "Left"   → bbox.minX  =  -boxW / 2
 *   alignmentX = "Center" → centre of bbox along X  =  0
 *   alignmentX = "Right"  → bbox.maxX  =  +boxW / 2
 *   alignmentY = "Top"    → bbox.maxY  =  +boxH / 2
 *   alignmentY = "Center" → centre of bbox along Y  =  0
 *   alignmentY = "Bottom" → bbox.minY  =  -boxH / 2
 */
export interface TextAlignBbox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function computeTextAlignOffset(
  bbox: TextAlignBbox,
  boxW: number,
  boxH: number,
  alignX: "Left" | "Center" | "Right" | undefined,
  alignY: "Top" | "Center" | "Bottom" | undefined,
): { dx: number; dy: number } {
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  let dx = 0;
  if (alignX === "Left") dx = -boxW / 2 - bbox.minX;
  else if (alignX === "Center") dx = -(bbox.minX + w / 2);
  else if (alignX === "Right") dx = boxW / 2 - bbox.maxX;
  let dy = 0;
  if (alignY === "Top") dy = boxH / 2 - bbox.maxY;
  else if (alignY === "Center") dy = -(bbox.minY + h / 2);
  else if (alignY === "Bottom") dy = -boxH / 2 - bbox.minY;
  return { dx, dy };
}
export function orbitPolicyForSceneMode(sceneMode: string | undefined): OrbitPolicy {
  if (sceneMode === "2d") {
    return { enableRotate: false, enablePan: true, enableZoom: true };
  }
  // 3D scenes — and any unknown mode — keep full free orbit so we never
  // accidentally lock the camera on a scene that didn't declare its mode.
  return { enableRotate: true, enablePan: true, enableZoom: true };
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

/**
 * Returns true when clipping for `targetNode` against the mask identified by
 * `maskNodeId` should keep the inside of the mask volume rather than the
 * outside. Inversion is a property of the mask itself (W3D
 * `<MaskProperties IsInvertedMask="…"/>` lives on the mask quad) — every
 * node referencing the same mask sees the same orientation. A leftover
 * `maskInverted` flag on the target is treated as stale and ignored.
 */
export function resolveMaskInversion(
  blueprint: ComponentBlueprint,
  maskNodeId: string,
  _targetNode: EditorNode,
): boolean {
  void _targetNode;
  const mask = blueprint.nodes.find((n) => n.id === maskNodeId);
  return mask?.maskInverted === true;
}

export interface VideoTextureState {
  src: string;
  readyState: number;
  networkState: number;
  errorCode: number | null;
  paused: boolean;
  muted: boolean;
  loop: boolean;
  playsInline: boolean;
  currentTime: number;
  duration: number;
}

/**
 * Pulls every diagnostically-useful field off a `<video>` element backing a
 * VideoTexture. Returns null when `image` is not a video (e.g. an
 * `HTMLImageElement` or undefined). The shape matches what
 * `__r3Dump()` surfaces per node so the operator can paste back the state
 * after a failed video bind: `readyState`, `networkState`, `errorCode`,
 * `paused`, `currentTime`, `duration`, plus the `muted`/`loop`/`playsInline`
 * flags so we can verify the autoplay contract.
 */
export function summariseVideoTextureState(image: unknown): VideoTextureState | null {
  if (image == null) return null;
  if (typeof HTMLVideoElement === "undefined") return null;
  if (!(image instanceof HTMLVideoElement)) return null;
  return {
    src: image.src,
    readyState: image.readyState,
    networkState: image.networkState,
    errorCode: image.error?.code ?? null,
    paused: image.paused,
    muted: image.muted,
    loop: image.loop,
    playsInline: image.playsInline,
    currentTime: image.currentTime,
    duration: image.duration,
  };
}

/**
 * Builds an operator-facing warning for a VideoTexture load failure. Code 4
 * (`MEDIA_ERR_SRC_NOT_SUPPORTED`) names the codec problem and points at the
 * cheapest fix — transcoding the asset to H.264 MP4 — because Chrome ships
 * H.264 universally but does not decode ProRes/DNxHR `.mov` containers.
 */
export function formatVideoLoadFailureMessage(src: string, code: number | undefined): string {
  if (code === 4) {
    return (
      `[scene] video texture failed to load src=${src} code=4 ` +
      `(MEDIA_ERR_SRC_NOT_SUPPORTED). The browser cannot decode this file — ` +
      `most often a .mov carrying ProRes/DNxHR or another non-web codec. ` +
      `Try transcoding to H.264 MP4 (ffmpeg -i in.mov -c:v libx264 -pix_fmt yuv420p out.mp4) ` +
      `or open the source file directly in Chrome to confirm.`
    );
  }
  return `[scene] video texture failed to load src=${src} code=${code ?? "unknown"}`;
}

/**
 * Marks `t.needsUpdate = true` only when the underlying image actually
 * has decoded data. Setting needsUpdate prematurely produces black /
 * transparent frames in WebGL; this guard has caught the bug before.
 */
export function setTextureUpdateIfReady(t: Texture): void {
  const img = t.image as unknown;
  if (!img) return;
  if (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement && !img.complete) return;
  if (typeof HTMLVideoElement !== "undefined" && img instanceof HTMLVideoElement && img.readyState < 2) return;
  t.needsUpdate = true;
}

const DEFAULT_PLAYER_FPS = 25;
const FRAME_WINDOW = 60;
const MEMORY_WARN_BYTES = 200 * 1024 * 1024;

/**
 * Returns a 4x4 canvas that the player uses whenever a frame fails to load.
 * By default it is fully transparent so no visible pixel escapes to the viewport.
 * When `window.__r3DebugBrokenTextures === true` it returns a magenta+grid
 * canvas for debugging — this is an explicit opt-in by the operator; it is
 * NEVER active in normal rendering.
 *
 * The canvas is tagged with a `data-r3-fallback` attribute:
 *   "transparent" — normal path (invisible to the user)
 *   "magenta"     — debug path (only when __r3DebugBrokenTextures is set)
 * This lets tests inspect the intent without needing pixel reads (which are
 * not available in jsdom without the `canvas` npm package).
 */
function makeSequenceFallbackImage(): HTMLCanvasElement {
  const dbg =
    typeof window !== "undefined" &&
    (window as { __r3DebugBrokenTextures?: boolean }).__r3DebugBrokenTextures === true;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  canvas.dataset["r3Fallback"] = dbg ? "magenta" : "transparent";
  const ctx = canvas.getContext("2d");
  if (ctx) {
    if (dbg) {
      // Magenta + grid: only when the debug flag is explicitly enabled in the
      // browser console. Off by default. NEVER painted in normal viewports.
      ctx.fillStyle = "#ff00ff";
      ctx.fillRect(0, 0, 4, 4);
      ctx.fillStyle = "#000000";
      ctx.fillRect(1, 1, 1, 1);
      ctx.fillRect(3, 3, 1, 1);
    } else {
      ctx.clearRect(0, 0, 4, 4);
    }
  }
  return canvas;
}

export interface ImageSequencePlayerSpec {
  frameUrls: string[];
  fps: number;
  loop: boolean;
  width: number;
  height: number;
}

export class ImageSequencePlayer {
  readonly texture: Texture;
  private readonly frameUrls: string[];
  private readonly fps: number;
  private readonly loop: boolean;
  private readonly width: number;
  private readonly height: number;
  /** The Object3D in the scene that this player drives. Ticking is gated on its visibility. */
  private _boundObject3D: import("three").Object3D | null = null;

  get boundObject3D(): import("three").Object3D | null {
    return this._boundObject3D;
  }

  private currentFrame = 0;
  private acc = 0;
  private paused = false;
  private error: string | null = null;
  private frameCache = new Map<number, HTMLImageElement>();
  private inFlight = new Set<number>();
  private disposed = false;
  private warned = false;
  private firstBindLogged = false;
  // Per-player log throttling. Each diagnostic stream (constructor, loads,
  // ticks, binds) caps at the first ~3 events so the operator can see the
  // playback chain coming up without flooding the console at 25–60 fps.
  private tickLogCount = 0;
  private bindLogCount = 0;
  private loadLogCount = 0;
  // Lifetime tick counter — surfaced via state() so __r3Dump shows whether
  // the render loop is actually driving this player. A registered player
  // with tickCount === 0 is the smoking gun for a broken loop wiring.
  private tickCount = 0;
  private lastTickDelta = 0;

  constructor(spec: ImageSequencePlayerSpec) {
    this.frameUrls = spec.frameUrls;
    this.fps = spec.fps && spec.fps > 0 ? spec.fps : DEFAULT_PLAYER_FPS;
    this.loop = spec.loop;
    this.width = spec.width;
    this.height = spec.height;
    this.texture = new Texture();
    this.texture.colorSpace = SRGBColorSpace;
    // eslint-disable-next-line no-console
    console.info(
      `[seq player] created — frameUrls=${this.frameUrls.length} fps=${this.fps} loop=${this.loop} width=${this.width} height=${this.height}`,
    );
    this.maybeWarn();
    this.loadFrame(0);
  }

  private maybeWarn(): void {
    if (this.warned) return;
    const bytes = FRAME_WINDOW * this.width * this.height * 4;
    if (this.frameUrls.length > FRAME_WINDOW || bytes > MEMORY_WARN_BYTES) {
      const mb = (bytes / 1024 / 1024).toFixed(0);
      // eslint-disable-next-line no-console
      console.warn(
        `[scene] large image sequence — ${this.frameUrls.length} frames at ${this.width}x${this.height} ` +
        `(estimated ${mb} MB at peak window). Consider downsampling for smoother playback.`,
      );
      this.warned = true;
    }
  }

  private loadFrame(idx: number): void {
    if (this.disposed) return;
    if (idx < 0 || idx >= this.frameUrls.length) return;
    if (this.frameCache.has(idx) || this.inFlight.has(idx)) return;
    if (this.inFlight.size >= 4) return;
    this.inFlight.add(idx);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.inFlight.delete(idx);
      if (this.disposed) return;
      this.frameCache.set(idx, img);
      if (this.loadLogCount < 3) {
        this.loadLogCount += 1;
        // eslint-disable-next-line no-console
        console.info(
          `[seq player] loaded frame ${idx + 1}/${this.frameUrls.length} src=${this.frameUrls[idx]}`,
        );
      }
      // Bind immediately if this is the current frame OR if no frame is
      // currently bound (cold-start race: the player has already ticked
      // past frame 0 by the time the first onload fires — without this
      // fallback the texture stays blank until a future load happens to
      // land exactly on currentFrame). The next tick overwrites with
      // whatever frame we SHOULD be displaying, but the user sees content
      // immediately instead of an empty quad.
      if (idx === this.currentFrame) {
        this.bind(img);
      } else if (this.texture.image == null) {
        this.bind(img);
      }
      this.evictIfBeyondWindow();
    };
    img.onerror = () => {
      this.inFlight.delete(idx);
      if (this.disposed) return;
      this.error = `frame ${idx + 1} failed to load`;
      // eslint-disable-next-line no-console
      console.warn(
        `[seq player] FAILED frame ${idx + 1} src=${this.frameUrls[idx]} reason=image element onerror`,
      );
      // Ensure texture.image is never left null — use a transparent fallback
      // so no visible pixel is painted. Operators can opt into the magenta
      // debug canvas by setting window.__r3DebugBrokenTextures = true.
      if (this.texture.image == null) {
        this.texture.image = makeSequenceFallbackImage();
        this.texture.needsUpdate = true;
      }
    };
    img.src = this.frameUrls[idx];
  }

  private evictIfBeyondWindow(): void {
    if (this.frameCache.size <= FRAME_WINDOW) return;
    const half = Math.floor(FRAME_WINDOW / 2);
    for (const k of [...this.frameCache.keys()]) {
      if (Math.abs(k - this.currentFrame) > half) this.frameCache.delete(k);
    }
  }

  private bind(img: HTMLImageElement): void {
    this.texture.image = img;
    // The image just fired its `onload` callback (the only entry point that
    // calls bind), so the decoded data is, by contract, already in memory.
    // `setTextureUpdateIfReady` would otherwise refuse the upload whenever
    // `img.complete` is still false — which happens in jsdom under tests
    // and, intermittently, with blob: URLs in production browsers (the
    // `complete` flag races the onload event in some Chromium builds).
    // The guard is correct for callers that don't own the image lifecycle;
    // we do, so we set the version counter directly.
    this.texture.needsUpdate = true;
    if (!this.firstBindLogged) {
      this.firstBindLogged = true;
      // eslint-disable-next-line no-console
      console.info(`[seq] first frame bound for sequence (${this.frameUrls.length} frames)`);
    }
    if (this.bindLogCount < 3) {
      this.bindLogCount += 1;
      // eslint-disable-next-line no-console
      console.info(
        `[seq player] bind frame=${this.currentFrame} texture.image set version=${this.texture.version}`,
      );
    }
  }

  setBoundObject3D(obj: import("three").Object3D | null): void {
    this._boundObject3D = obj;
  }

  /** @internal test-only — simulates a frame load error and applies the fallback image. */
  _simulateFrameError(idx: number): void {
    this.error = `frame ${idx + 1} failed (test)`;
    if (this.texture.image == null) {
      this.texture.image = makeSequenceFallbackImage();
      this.texture.needsUpdate = true;
    }
  }

  tick(deltaSec: number): void {
    if (this.disposed) {
      if (this.tickLogCount < 1) {
        this.tickLogCount = 1;
        // eslint-disable-next-line no-console
        console.warn(`[seq player] tick called on disposed player — bug`);
      }
      return;
    }
    // Visibility gate: when the bound Object3D exists and is invisible,
    // freeze the player. State (currentFrame, acc, frameCache, texture.image)
    // is preserved so the user gets immediate playback resumption when
    // visibility flips back to true. This deliberately does NOT consult
    // frustum / occlusion.
    if (this.boundObject3D && this.boundObject3D.visible === false) {
      return;
    }
    if (this.paused) return;
    this.tickCount += 1;
    this.lastTickDelta = deltaSec;
    if (this.tickLogCount < 3) {
      this.tickLogCount += 1;
      // eslint-disable-next-line no-console
      console.info(
        `[seq player] tick #${this.tickCount} dt=${deltaSec}s currentFrame=${this.currentFrame}`,
      );
    }
    this.acc += deltaSec;
    const advance = Math.floor(this.acc * this.fps);
    if (advance <= 0) return;
    this.acc -= advance / this.fps;
    let next = this.currentFrame + advance;
    if (this.loop) {
      next = ((next % this.frameUrls.length) + this.frameUrls.length) % this.frameUrls.length;
    } else {
      next = Math.min(next, this.frameUrls.length - 1);
    }
    this.currentFrame = next;
    const cached = this.frameCache.get(next);
    if (cached) this.bind(cached);
    for (let i = 1; i <= 4; i += 1) {
      const idx = this.loop
        ? (next + i) % this.frameUrls.length
        : Math.min(next + i, this.frameUrls.length - 1);
      this.loadFrame(idx);
    }
  }

  state(): {
    currentFrame: number;
    loadedFrames: number;
    totalFrames: number;
    paused: boolean;
    error: string | null;
    tickCount: number;
    lastTickDelta: number;
    currentFrameSrc: string | null;
  } {
    const img = this.texture.image as HTMLImageElement | null;
    const src = img && typeof img.src === "string" ? img.src.slice(0, 64) : null;
    return {
      currentFrame: this.currentFrame,
      loadedFrames: this.frameCache.size,
      totalFrames: this.frameUrls.length,
      paused: this.paused,
      error: this.error,
      tickCount: this.tickCount,
      lastTickDelta: this.lastTickDelta,
      currentFrameSrc: src,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.frameCache.clear();
    this.inFlight.clear();
    this.texture.dispose();
  }
}
