import {
  AmbientLight,
  AxesHelper,
  Box3,
  BoxGeometry,
  Box3Helper,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  CircleGeometry,
} from "three";
import gsap from "gsap";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { frameToSeconds, getTrackSegments, mapAnimationEaseToGsap, secondsToFrame } from "./animation";
import { DEFAULT_FONT_ID, parseFontAsset } from "./fonts";
import { EditorStore } from "./state";
import type { AnimationPropertyPath, EditorNode, EditorStoreChange, ImageNode, NodeOriginSpec, TextNode } from "./types";

type GizmoMode = "translate" | "rotate" | "scale";
type ToolMode = "select" | GizmoMode;

export class SceneEditor {
  private readonly textureLoader = new TextureLoader();
  private readonly container: HTMLElement;
  private readonly store: EditorStore;
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
  private readonly selectionBounds = new Box3();
  private readonly selectionSize = new Vector3();
  private readonly selectionCenter = new Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: () => void;
  private readonly textureCache = new Map<string, Texture>();
  private readonly animationFrameListeners = new Set<(frame: number) => void>();

  private animationFrame = 0;
  private animationTimeline: gsap.core.Timeline | null = null;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private mainLight: DirectionalLight | null = null;
  private selectionHelper: Box3Helper | null = null;
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
    this.orientationRenderer.domElement.style.top = "10px";
    this.orientationRenderer.domElement.style.right = "10px";
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

      this.store.setNodeTransformFromObject(nodeId, object);
      this.updateSelectionHelper(
        this.store.selectedNodeIds
          .map((selectedNodeId) => this.objectMap.get(selectedNodeId))
          .filter((selectedObject): selectedObject is Object3D => Boolean(selectedObject)),
      );
    });

    this.scene.add(this.viewportRoot);
    this.scene.add(this.transformHelper);
    this.addHelpers();
    this.bindPointerSelection();

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
    if (!this.animationTimeline) {
      return 0;
    }

    const clip = this.store.getActiveAnimationClip();
    if (!clip) {
      return 0;
    }
    return secondsToFrame(this.animationTimeline.time(), clip.fps);
  }

  getNodeAnimationValue(nodeId: string, property: AnimationPropertyPath): number | null {
    const object = this.objectMap.get(nodeId);
    if (!object) {
      return null;
    }

    const [owner, key] = resolveAnimationTarget(object, toObjectAnimationPath(property));
    if (!owner || !key) {
      return null;
    }

    const value = owner[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  playAnimation(): void {
    if (!this.store.getActiveAnimationClip()) {
      return;
    }
    if (!this.animationTimeline) {
      this.rebuildAnimationTimeline(false);
    }

    this.animationTimeline?.play();
    this.emitAnimationFrame();
  }

  pauseAnimation(): void {
    this.animationTimeline?.pause();
    this.emitAnimationFrame();
  }

  stopAnimation(): void {
    if (!this.animationTimeline) {
      return;
    }

    this.animationTimeline.pause();
    this.seekAnimation(0);
    this.emitAnimationFrame();
  }

  seekAnimation(frame: number): void {
    if (!this.store.getActiveAnimationClip()) {
      this.emitAnimationFrame(0);
      return;
    }
    if (!this.animationTimeline) {
      this.rebuildAnimationTimeline(false);
    }

    if (!this.animationTimeline) {
      this.emitAnimationFrame(Math.max(0, Math.round(frame)));
      return;
    }

    const clip = this.store.getActiveAnimationClip();
    if (!clip) {
      this.emitAnimationFrame(0);
      return;
    }
    const normalizedFrame = Math.max(0, Math.min(Math.round(frame), clip.durationFrames));
    const time = frameToSeconds(normalizedFrame, clip.fps);
    this.animationTimeline.pause();
    this.animationTimeline.seek(time, false);
    this.emitAnimationFrame();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.animationTimeline?.kill();
    this.transformControls.detach();
    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.clearViewportRoot();
    this.selectionHelper?.removeFromParent();
    this.renderer.dispose();
    this.orientationRenderer.dispose();
    this.orientationRenderer.domElement.removeEventListener("pointerdown", this.handleOrientationPointerDown);
    this.renderer.domElement.remove();
    this.orientationRenderer.domElement.remove();
  }

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
    const isRendered = this.store.viewMode === "rendered";

    if (this.mainLight) {
      this.mainLight.castShadow = isRendered;
    }

    this.viewportRoot.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = isRendered && object.userData.nodeType !== "image";
        object.receiveShadow = isRendered && object.userData.nodeType !== "image";
      }
    });
  }

  private addHelpers(): void {
    const grid = new GridHelper(50, 50, 0x4a4d55, 0x363940);
    grid.position.y = -0.001;
    this.scene.add(grid);

    const hemi = new HemisphereLight(0xe4e0ea, 0x1f2024, 1.1);
    this.scene.add(hemi);

    const ambient = new AmbientLight(0xffffff, 0.3);
    this.scene.add(ambient);

    this.mainLight = new DirectionalLight(0xffffff, 1.4);
    this.mainLight.position.set(5, 9, 6);
    this.mainLight.castShadow = true;
    this.mainLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.mainLight);
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

    for (const node of this.store.blueprint.nodes) {
      const object = this.createObject(node);
      this.objectMap.set(node.id, object);
    }

    for (const node of this.store.blueprint.nodes) {
      const object = this.objectMap.get(node.id);
      if (!object) continue;

      if (node.parentId && this.objectMap.has(node.parentId)) {
        this.objectMap.get(node.parentId)?.add(object);
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
      ? new Group()
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

    mesh.castShadow = node.type !== "image";
    mesh.receiveShadow = node.type !== "image";
    mesh.visible = node.material.visible;
    return mesh;
  }

  private createTextMesh(node: TextNode, material: MeshBasicMaterial | MeshStandardMaterial): Mesh {
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

  private createNodeMaterial(node: Exclude<EditorNode, { type: "group" }>): MeshBasicMaterial | MeshStandardMaterial {
    const baseOptions = this.createBaseMaterialOptions(node);
    if (node.material.type === "basic") {
      return new MeshBasicMaterial(baseOptions);
    }

    return new MeshStandardMaterial({
      ...baseOptions,
      emissive: node.material.emissive,
      roughness: node.material.roughness,
      metalness: node.material.metalness,
    });
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
    const texture = this.getTexture(node.image.src);
    const baseOptions = {
      ...this.createBaseMaterialOptions(node),
      map: texture,
    };
    const material = node.material.type === "basic"
      ? new MeshBasicMaterial(baseOptions)
      : new MeshStandardMaterial({
        ...baseOptions,
        emissive: node.material.emissive,
        roughness: node.material.roughness,
        metalness: node.material.metalness,
      });

    return new Mesh(geometry, material);
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
    const primaryObject = this.objectMap.get(this.store.selectedNodeId);

    if (selectedObjects.length === 1 && primaryObject && this.currentMode !== "select") {
      this.transformControls.attach(primaryObject);
      this.transformHelper.visible = true;
    } else {
      this.transformControls.detach();
      this.transformHelper.visible = false;
    }

    this.updateSelectionHelper(selectedObjects);
  }

  private updateSelectionHelper(objects: Object3D[]): void {
    if (!this.computeSelectionBounds(objects)) {
      this.selectionHelper?.removeFromParent();
      this.selectionHelper = null;
      return;
    }

    if (!this.selectionHelper) {
      this.selectionHelper = new Box3Helper(this.selectionBounds.clone(), 0x6b2ecf);
      this.scene.add(this.selectionHelper);
      return;
    }

    this.selectionHelper.box.copy(this.selectionBounds);
  }

  private computeSelectionBounds(objects: Object3D[]): boolean {
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
      this.orbitControls.update();
      this.updateSelectionHelper(
        this.store.selectedNodeIds
          .map((nodeId) => this.objectMap.get(nodeId))
          .filter((object): object is Object3D => Boolean(object)),
      );
      this.renderer.render(this.scene, this.camera);
      this.orientationRoot.quaternion.copy(this.camera.quaternion).invert();
      this.orientationRenderer.render(this.orientationScene, this.orientationCamera);
    };

    tick();
  }

  private rebuildAnimationTimeline(preserveState = true): void {
    const previousTimeline = this.animationTimeline;
    const previousFrame = preserveState ? this.getCurrentAnimationFrame() : 0;
    const wasPaused = previousTimeline?.paused() ?? true;
    previousTimeline?.kill();

    const timeline = gsap.timeline({
      paused: true,
      repeat: -1,
      onUpdate: () => this.emitAnimationFrame(),
    });
    const clip = this.store.getActiveAnimationClip();
    if (!clip) {
      this.animationTimeline = timeline;
      this.emitAnimationFrame(0);
      return;
    }
    const tracks = clip.tracks;
    const totalDuration = frameToSeconds(clip.durationFrames, clip.fps);
    const hold = { progress: 0 };
    timeline.to(hold, { progress: 1, duration: Math.max(totalDuration, 0.0001), ease: "none" }, 0);

    for (const track of tracks) {
      const target = this.objectMap.get(track.nodeId);
      if (!target) {
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

      timeline.set(owner, { [property]: ordered[0].value }, frameToSeconds(ordered[0].frame, clip.fps));

      for (const segment of getTrackSegments(track)) {
        timeline.to(
          owner,
          {
            [property]: segment.to.value,
            duration: frameToSeconds(segment.to.frame - segment.from.frame, clip.fps),
            ease: mapAnimationEaseToGsap(segment.to.ease),
          },
          frameToSeconds(segment.from.frame, clip.fps),
        );
      }
    }

    this.animationTimeline = timeline;

    if (timeline.duration() <= 0) {
      this.emitAnimationFrame(0);
      return;
    }

    const clampedFrame = Math.max(0, Math.min(previousFrame, clip.durationFrames));
    timeline.pause();
    timeline.seek(frameToSeconds(clampedFrame, clip.fps), false);
    if (!wasPaused) {
      timeline.play();
    }
    this.emitAnimationFrame();
  }

  private emitAnimationFrame(frame = this.getCurrentAnimationFrame()): void {
    for (const listener of this.animationFrameListeners) {
      listener(frame);
    }
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
