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
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LinearFilter,
  LinearMipMapLinearFilter,
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
  MaterialSpec,
  NodeOriginSpec,
  TextNode,
  TextureSamplingOptions,
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
  private readonly animationFrameListeners = new Set<(frame: number) => void>();

  private animationFrame = 0;
  private animationTracks: CompiledAnimationTrack[] = [];
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
      const meshObj: Mesh | null = mesh;
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
      out.push({
        id: node.id.slice(0, 8),
        name: node.name,
        type: node.type,
        visible: node.visible,
        meshVisible: meshObj?.visible ?? null,
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
        renderOrder,
        materialColor,
        materialOpacity,
        materialTransparent,
        textureState,
        textureSrc: node.type === "image" ? (node.image?.src ?? "").slice(0, 64) : null,
        textureMime: node.type === "image" ? node.image?.mimeType : null,
        hasMap,
        mapHasImage,
        // Only present when the texture is backed by a <video>. Lets the
        // operator distinguish "video never started" (readyState=0) from
        // "video paused after error" (errorCode != null) from "playing".
        video: videoState,
        imageSequence: (() => {
          const player = this.sequencePlayers.get(node.id);
          if (!player) return null;
          const s = player.state();
          return {
            frameCount: s.totalFrames,
            currentFrame: s.currentFrame,
            loadedFrames: s.loadedFrames,
            fps: node.type === "image" ? (node.image.sequence?.fps ?? 0) : 0,
            loop: node.type === "image" ? (node.image.sequence?.loop ?? true) : true,
            paused: s.paused,
            firstFrameSrc: node.type === "image" ? (node.image.sequence?.frameUrls?.[0] ?? "").slice(0, 64) : "",
            error: s.error,
          };
        })(),
        isMask: !!node.isMask,
        maskIds: node.maskIds ?? (node.maskId ? [node.maskId] : []),
        clippingPlaneCount,
        isHelper: w3d.helperNodeIds?.includes(node.id) ?? false,
        isMissingTexture: w3d.missingTextureNodeIds?.includes(node.id) ?? false,
        wasInitialDisabled: w3d.initialDisabledNodeIds?.includes(node.id) ?? false,
      });
    }

    return {
      sceneMode: bp.sceneMode,
      cameraKind: this.camera instanceof OrthographicCamera ? "orthographic" : "perspective",
      nodeCount: bp.nodes.length,
      nodes: out,
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
      skewLayer.matrix.copy(buildSkewMatrix(node.transform.skew!));
      skewLayer.matrixAutoUpdate = false;
      skewLayer.add(mesh);
      wrapper.add(skewLayer);
    } else {
      wrapper.add(mesh);
    }
    return wrapper;
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
    const isSequence = mime === "application/x-image-sequence" && !!node.image.sequence;
    const isVideo = typeof mime === "string" && mime.startsWith("video/");
    let texture: Texture;
    if (isSequence && node.image.sequence) {
      const player = this.getOrCreateSequencePlayer(node.id, node.image.sequence);
      texture = player.texture;
    } else if (isVideo) {
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
      // Three's TextureLoader signature is (url, onLoad, onProgress, onError).
      // Without onError a 404 / CORS / mime mismatch leaves the texture
      // permanently blank and the user just sees the material's flat colour
      // with no console signal. Swap to a debug magenta image and warn so
      // the broken layer is obvious in-editor.
      const onError = (event: ErrorEvent | Event) => {
        const reason = event instanceof ErrorEvent ? event.message : "load error";
        // eslint-disable-next-line no-console
        console.warn(`[scene] texture failed to load src=${src} reason=${reason}`);
        const fallback = this.getDebugFallbackImage();
        if (fallback) {
          texture.image = fallback;
          texture.needsUpdate = true;
        }
      };
      const texture = this.textureLoader.load(src, undefined, undefined, onError);
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
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
    variant.needsUpdate = true;
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
    } else if (cam?.position) {
      // No explicit target — point at the world origin, which is where R3
      // tracked broadcast cameras conventionally aim.
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
      object.rotation.set(node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z);
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
  // Switching to a wrap mode other than ClampToEdge requires repeat>0,
  // which Three already enforces, but make sure offset/repeat changes are
  // visible immediately.
  texture.needsUpdate = true;
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
export interface OrbitPolicy {
  enableRotate: boolean;
  enablePan: boolean;
  enableZoom: boolean;
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
  private currentFrame = 0;
  private acc = 0;
  private paused = false;
  private error: string | null = null;
  private frameCache = new Map<number, HTMLImageElement>();
  private inFlight = new Set<number>();
  private disposed = false;
  private warned = false;
  private firstBindLogged = false;

  constructor(spec: ImageSequencePlayerSpec) {
    this.frameUrls = spec.frameUrls;
    this.fps = spec.fps && spec.fps > 0 ? spec.fps : DEFAULT_PLAYER_FPS;
    this.loop = spec.loop;
    this.width = spec.width;
    this.height = spec.height;
    this.texture = new Texture();
    this.texture.colorSpace = SRGBColorSpace;
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
      if (idx === this.currentFrame) this.bind(img);
      this.evictIfBeyondWindow();
    };
    img.onerror = () => {
      this.inFlight.delete(idx);
      if (this.disposed) return;
      this.error = `frame ${idx + 1} failed to load`;
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
  }

  tick(deltaSec: number): void {
    if (this.disposed || this.paused) return;
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

  state(): { currentFrame: number; loadedFrames: number; totalFrames: number; paused: boolean; error: string | null } {
    return {
      currentFrame: this.currentFrame,
      loadedFrames: this.frameCache.size,
      totalFrames: this.frameUrls.length,
      paused: this.paused,
      error: this.error,
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
