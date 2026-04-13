import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BoxHelper,
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
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { DEFAULT_FONT_ID, parseFontAsset } from "./fonts";
import { EditorStore } from "./state";
import type { EditorNode, EditorStoreChange, ImageNode, TextNode } from "./types";

type GizmoMode = "translate" | "rotate" | "scale";
type ToolMode = "select" | GizmoMode;

export class SceneEditor {
  private readonly textureLoader = new TextureLoader();
  private readonly container: HTMLElement;
  private readonly store: EditorStore;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
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

  private animationFrame = 0;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private selectionHelper: BoxHelper | null = null;
  private currentMode: ToolMode = "select";
  private currentGizmoMode: GizmoMode = "translate";
  private isTransformDragging = false;
  private skipNextSelectionPick = false;

  constructor(container: HTMLElement, store: EditorStore) {
    this.container = container;
    this.store = store;

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.setClearColor("#23252a", 1);
    this.renderer.domElement.style.touchAction = "none";
    this.container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.scene.background = new Color("#25272c");

    this.camera = new PerspectiveCamera(45, 1, 0.01, 2000);
    this.camera.position.set(6, 5, 8);

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
      this.updateSelectionHelper(object);
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

  frameSelection(): void {
    const target = this.objectMap.get(this.store.selectedNodeId) ?? this.viewportRoot;
    this.selectionBounds.setFromObject(target);
    if (this.selectionBounds.isEmpty()) {
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

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.transformControls.detach();
    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.clearViewportRoot();
    this.selectionHelper?.removeFromParent();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private handleStoreChange(change: EditorStoreChange): void {
    if (change.reason === "selection") {
      this.refreshSelection();
      return;
    }

    if (change.reason === "editable" || change.reason === "meta") {
      return;
    }

    if (change.reason === "node" && change.source === "scene") {
      this.refreshSelection();
      return;
    }

    this.rebuildScene();
  }

  private addHelpers(): void {
    const grid = new GridHelper(50, 50, 0x4a4d55, 0x363940);
    grid.position.y = -0.001;
    this.scene.add(grid);

    const hemi = new HemisphereLight(0xe4e0ea, 0x1f2024, 1.1);
    this.scene.add(hemi);

    const ambient = new AmbientLight(0xffffff, 0.3);
    this.scene.add(ambient);

    const light = new DirectionalLight(0xffffff, 1.4);
    light.position.set(5, 9, 6);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    this.scene.add(light);
  }

  private bindPointerSelection(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener("pointerdown", (event) => {
      this.pointerDownX = event.clientX;
      this.pointerDownY = event.clientY;
    });

    canvas.addEventListener("pointerup", (event) => {
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

      this.pick(event.clientX, event.clientY);
    });
  }

  private pick(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.viewportRoot.children, true);

    for (const hit of hits) {
      const nodeId = this.findNodeId(hit.object);
      if (nodeId) {
        this.store.selectNode(nodeId);
        return;
      }
    }
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

    this.refreshSelection();
  }

  private createObject(node: EditorNode): Object3D {
    const object = this.buildNodeObject(node);
    object.name = node.name;
    object.userData.nodeId = node.id;
    object.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z);
    object.rotation.set(node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z);
    object.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z);
    return object;
  }

  private buildNodeObject(node: EditorNode): Object3D {
    if (node.type === "group") {
      return new Group();
    }

    let mesh: Mesh;
    switch (node.type) {
      case "box":
        mesh = new Mesh(new BoxGeometry(node.geometry.width, node.geometry.height, node.geometry.depth), this.createStandardMaterial(node));
        break;
      case "sphere":
        mesh = new Mesh(new SphereGeometry(node.geometry.radius, 32, 24), this.createStandardMaterial(node));
        break;
      case "cylinder":
        mesh = new Mesh(new CylinderGeometry(node.geometry.radiusTop, node.geometry.radiusBottom, node.geometry.height, 32), this.createStandardMaterial(node));
        break;
      case "plane":
        mesh = new Mesh(new PlaneGeometry(node.geometry.width, node.geometry.height), this.createStandardMaterial(node));
        break;
      case "image":
        mesh = this.createImageMesh(node);
        break;
      case "text":
        mesh = this.createTextMesh(node, this.createStandardMaterial(node));
        break;
    }

    mesh.castShadow = node.type !== "image";
    mesh.receiveShadow = node.type !== "image";
    return mesh;
  }

  private createTextMesh(node: TextNode, material: MeshStandardMaterial): Mesh {
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
    geometry.center();

    return new Mesh(geometry, material);
  }

  private createStandardMaterial(node: Exclude<EditorNode, { type: "group" | "image" }>): MeshStandardMaterial {
    return new MeshStandardMaterial({
      color: node.material.color,
      opacity: node.material.opacity,
      transparent: node.material.opacity < 1,
      wireframe: node.material.wireframe,
      side: node.type === "plane" ? DoubleSide : undefined,
      roughness: 0.4,
      metalness: 0.1,
    });
  }

  private createImageMesh(node: ImageNode): Mesh {
    const geometry = new PlaneGeometry(node.geometry.width, node.geometry.height);
    const texture = this.getTexture(node.image.src);
    const material = new MeshBasicMaterial({
      color: node.material.color,
      map: texture,
      opacity: node.material.opacity,
      transparent: true,
      alphaTest: 0.01,
      side: DoubleSide,
      wireframe: node.material.wireframe,
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
    const selectedObject = this.objectMap.get(this.store.selectedNodeId);
    if (selectedObject) {
      if (this.currentMode === "select") {
        this.transformControls.detach();
        this.transformHelper.visible = false;
      } else {
        this.transformControls.attach(selectedObject);
        this.transformHelper.visible = true;
      }
      this.updateSelectionHelper(selectedObject);
    } else {
      this.transformControls.detach();
      this.transformHelper.visible = false;
      this.selectionHelper?.removeFromParent();
      this.selectionHelper = null;
    }
  }

  private updateSelectionHelper(object: Object3D): void {
    this.selectionHelper?.removeFromParent();
    this.selectionHelper = new BoxHelper(object, 0x6b2ecf);
    this.scene.add(this.selectionHelper);
    this.selectionHelper.update();
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
  }

  private startLoop(): void {
    const tick = () => {
      this.animationFrame = requestAnimationFrame(tick);
      this.orbitControls.update();
      this.selectionHelper?.update();
      this.renderer.render(this.scene, this.camera);
    };

    tick();
  }
}
