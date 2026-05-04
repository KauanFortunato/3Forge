import {
  AmbientLight,
  AxesHelper,
  BackSide,
  BasicDepthPacking,
  Box3,
  BoxGeometry,
  Box3Helper,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  HemisphereLight,
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
  RGBADepthPacking,
  ShadowMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  CircleGeometry,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { createAlignmentShape, findAlignmentSnaps } from "./alignment";
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
  EditorNode,
  EditorStoreChange,
  ImageNode,
  MaterialSpec,
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
  private readonly selectedObjects: Object3D[] = [];
  private readonly infiniteGrid: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: () => void;
  private readonly textureCache = new Map<string, Texture>();
  private readonly animationFrameListeners = new Set<(frame: number) => void>();

  private animationFrame = 0;
  private animationTracks: CompiledAnimationTrack[] = [];
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
  private selectionHelper: Box3Helper | null = null;
  private selectionVisualsSuppressed = false;
  private currentMode: ToolMode = "select";
  private currentGizmoMode: GizmoMode = "translate";
  private isTransformDragging = false;
  private skipNextSelectionPick = false;
  private readonly ORIENTATION_SIZE = 86;

  constructor(container: HTMLElement, store: EditorStore, options: SceneEditorOptions = {}) {
    this.container = container;
    this.store = store;
    this.onTransformObjectChange = options.onTransformObjectChange;

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor("#23252a", 1);
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.style.display = "block";
    this.container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.scene.background = new Color("#25272c");

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

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.target.set(0, 1, 0);
    this.orbitControls.maxDistance = 80;
    this.orbitControls.minDistance = 1;

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
      const wasHandled = this.onTransformObjectChange?.(nodeId, object) ?? false;
      if (!wasHandled) {
        this.store.setNodeTransformFromObject(nodeId, object);
      }
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
    this.clearViewportRoot();
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

    this.updateViewMode();
    this.refreshSelection();
    this.rebuildAnimationTimeline();
  }

  private createObject(node: EditorNode): Object3D {
    const object = node.type === "group"
      ? this.buildGroupObject(node)
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

  private buildWrappedNodeObject(node: Exclude<EditorNode, { type: "group" }>): Object3D {
    const wrapper = new Group();
    const mesh = this.buildMeshObject(node);
    this.applyNodeOrigin(mesh, node.origin);
    wrapper.add(mesh);
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

  private createBaseMaterialOptions(node: Exclude<EditorNode, { type: "group" }>): MaterialBaseOptions {
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

    this.applyAnimationPreviewOverrides(normalizedFrame);
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
