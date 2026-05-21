/**
 * Tiny Three.js scene used to visualise the result of `translateBlueprint`.
 * Intentionally simpler than the editor's `SceneEditor` — no gizmos, no
 * orbit controls when locked, no selection. Just "draw whatever the
 * blueprint says".
 */

import {
  AmbientLight,
  BoxGeometry,
  BoxHelper,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ComponentBlueprint, EditorNode } from "../../../src/editor/types";
import { buildNodeTree, type BuildContext } from "./nodes/builder";
import type { W3DNodeData } from "./nodes/data";

/** DEV-Inspector callback payload. */
export type InspectorEvent =
  | { phase: "click"; target: Object3D }
  | { phase: "clear" };

export interface PlaygroundViewport {
  /** Replace what's drawn. Call whenever the blueprint changes. */
  setBlueprint(blueprint: ComponentBlueprint): void;
  setNodes(roots: W3DNodeData[], ctx?: BuildContext): void;
  /** DEV-Inspector — enable click-to-pick + selection box outline. */
  setInspectorEnabled(on: boolean): void;
  /** DEV-Inspector — callback receives click/clear events. */
  setInspectorCallback(cb: ((event: InspectorEvent) => void) | null): void;
  /** DEV-Inspector — clear the current selection outline. */
  clearInspectorSelection(): void;
  dispose(): void;
}

export function createPlaygroundViewport(host: HTMLElement): PlaygroundViewport {
  // stencil:true is required by Phase 1a photo mask clipping.
  const renderer = new WebGLRenderer({ antialias: true, stencil: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.display = "block";
  // Phase DEV-Viewport — render into a 16:9 frame matching the 3Forge project
  // aspect (1920×1080). The canvas size is computed by resize() below to fit
  // inside the host while preserving 16:9; CSS centers it inside the host.
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color("#1e1f25");

  const perspectiveCam = new PerspectiveCamera(45, 1, 0.01, 2000);
  perspectiveCam.position.set(6, 5, 8);

  const orthoCam = new OrthographicCamera(-8.89, 8.89, 5, -5, 0.1, 100);
  orthoCam.position.set(0, 0, 10);
  orthoCam.lookAt(0, 0, 0);

  let activeCam: PerspectiveCamera | OrthographicCamera = perspectiveCam;

  scene.add(new AmbientLight(0xffffff, 0.4));
  const key = new DirectionalLight(0xffffff, 1.2);
  key.position.set(5, 9, 6);
  scene.add(key);

  let mounted: Group | null = null;
  let mountedNodes: Group | null = null;
  let controls: OrbitControls | null = new OrbitControls(perspectiveCam, renderer.domElement);
  controls.enableDamping = true;

  const TARGET_ASPECT = 16 / 9; // 3Forge project default (1920×1080)
  // The canvas size is now enforced by CSS (`aspect-ratio: 16/9` + max-width
  // /max-height in playground.css). The renderer's drawing buffer just
  // matches whatever pixel dimensions CSS chose for the canvas.
  const resize = () => {
    const rect = renderer.domElement.getBoundingClientRect();
    const w = Math.max(Math.round(rect.width), 1);
    const h = Math.max(Math.round(rect.height), 1);
    renderer.setSize(w, h, false); // false: do NOT touch CSS — CSS owns layout
    if (activeCam instanceof PerspectiveCamera) {
      activeCam.aspect = TARGET_ASPECT;
      activeCam.updateProjectionMatrix();
    } else {
      const halfH = 5;
      const halfW = halfH * TARGET_ASPECT;
      activeCam.left = -halfW;
      activeCam.right = halfW;
      activeCam.top = halfH;
      activeCam.bottom = -halfH;
      activeCam.updateProjectionMatrix();
    }
  };
  // Observe both host (parent layout changes) and canvas (its own size).
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  ro.observe(renderer.domElement);
  resize();

  // ---- DEV-Inspector state ----------------------------------------------
  let inspectorEnabled = false;
  let inspectorCallback: ((event: InspectorEvent) => void) | null = null;
  let selectionHelper: BoxHelper | null = null;
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  // Track pointerdown coords to distinguish click vs OrbitControls drag.
  let downX = 0;
  let downY = 0;
  const CLICK_THRESHOLD_PX = 3;

  function clearSelectionHelper(): void {
    if (selectionHelper) {
      scene.remove(selectionHelper);
      selectionHelper.geometry.dispose();
      // BoxHelper carries a LineBasicMaterial — dispose via the generic Material type.
      (selectionHelper.material as { dispose?: () => void }).dispose?.();
      selectionHelper = null;
    }
  }

  function setSelection(target: Object3D | null): void {
    clearSelectionHelper();
    if (!target) return;
    selectionHelper = new BoxHelper(target, 0x7c44de);
    scene.add(selectionHelper);
  }

  function pickAt(clientX: number, clientY: number): Object3D | null {
    if (!mountedNodes) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, activeCam);
    const hits = raycaster.intersectObject(mountedNodes, true);
    for (const hit of hits) {
      const o = hit.object;
      if (!o.visible) continue;
      // Drop any ancestor-invisible chain.
      let anc: Object3D | null = o.parent;
      let ancestorVisible = true;
      while (anc) {
        if (!anc.visible) { ancestorVisible = false; break; }
        anc = anc.parent;
      }
      if (!ancestorVisible) continue;
      const mat = (o as Mesh).material as MeshBasicMaterial | undefined;
      if (mat) {
        // PHOTO_MASK / PHOTO_DUMMY stencil writers paint no pixels — skip them.
        if (mat.colorWrite === false) continue;
        // alpha=0 helpers (PLAYERS_MASK etc.).
        if (typeof mat.opacity === "number" && mat.opacity <= 0.01) continue;
      }
      return o;
    }
    return null;
  }

  const onPointerDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX) return; // drag
    const target = pickAt(e.clientX, e.clientY);
    if (target) {
      setSelection(target);
      inspectorCallback?.({ phase: "click", target });
    } else {
      setSelection(null);
      inspectorCallback?.({ phase: "clear" });
    }
  };

  function attachInspectorListeners(): void {
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
  }
  function detachInspectorListeners(): void {
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
  }
  // ---- End DEV-Inspector state ------------------------------------------

  let frame = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    if (activeCam === perspectiveCam) controls?.update();
    if (selectionHelper) selectionHelper.update();
    renderer.render(scene, activeCam);
  };
  tick();

  return {
    setBlueprint(blueprint) {
      if (mounted) {
        scene.remove(mounted);
        disposeGroup(mounted);
        mounted = null;
      }

      const wantOrtho = blueprint.sceneSettings?.mode === "2d";
      if (wantOrtho && activeCam !== orthoCam) {
        activeCam = orthoCam;
        if (controls) { controls.enabled = false; }
      } else if (!wantOrtho && activeCam !== perspectiveCam) {
        activeCam = perspectiveCam;
        if (controls) { controls.enabled = true; }
      }

      if (blueprint.sceneSettings?.backgroundColor) {
        scene.background = new Color(blueprint.sceneSettings.backgroundColor);
      }

      mounted = new Group();
      const byId = new Map<string, Group>();
      for (const node of blueprint.nodes) {
        const obj = nodeToObject(node);
        if (!obj) continue;
        const parent = node.parentId ? byId.get(node.parentId) ?? mounted : mounted;
        parent.add(obj);
        if (obj instanceof Group) byId.set(node.id, obj);
      }
      scene.add(mounted);
      resize();
    },
    setNodes(roots, ctx) {
      if (mountedNodes) {
        scene.remove(mountedNodes);
        disposeGroup(mountedNodes);
        mountedNodes = null;
      }
      mountedNodes = buildNodeTree(roots, ctx);
      scene.add(mountedNodes);
    },
    setInspectorEnabled(on: boolean) {
      if (on === inspectorEnabled) return;
      inspectorEnabled = on;
      if (on) {
        attachInspectorListeners();
      } else {
        detachInspectorListeners();
        clearSelectionHelper();
        inspectorCallback?.({ phase: "clear" });
      }
    },
    setInspectorCallback(cb) {
      inspectorCallback = cb;
    },
    clearInspectorSelection() {
      clearSelectionHelper();
    },
    dispose() {
      if (mountedNodes) {
        scene.remove(mountedNodes);
        disposeGroup(mountedNodes);
        mountedNodes = null;
      }
      detachInspectorListeners();
      clearSelectionHelper();
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) {
        host.removeChild(renderer.domElement);
      }
    },
  };
}

function nodeToObject(node: EditorNode): Group | Mesh | null {
  if (node.type === "group") {
    const g = new Group();
    applyTransform(g, node);
    return g;
  }

  const mesh = createMesh(node);
  if (!mesh) return null;
  applyTransform(mesh, node);
  mesh.visible = node.visible;
  return mesh;
}

function createMesh(node: EditorNode): Mesh | null {
  if (node.type === "group") return null;
  const material = new MeshStandardMaterial({
    color: "color" in node.material ? new Color(node.material.color) : 0xcccccc,
    transparent: node.material.transparent,
    opacity: node.material.opacity,
  });

  switch (node.type) {
    case "box": {
      return new Mesh(new BoxGeometry(node.geometry.width, node.geometry.height, node.geometry.depth), material);
    }
    case "sphere": {
      return new Mesh(new SphereGeometry(node.geometry.radius, 32, 16), material);
    }
    case "plane": {
      return new Mesh(new PlaneGeometry(node.geometry.width, node.geometry.height), material);
    }
    case "cylinder": {
      return new Mesh(new CylinderGeometry(node.geometry.radiusTop, node.geometry.radiusBottom, node.geometry.height, 32), material);
    }
    case "circle": {
      return new Mesh(new CircleGeometry(node.geometry.radius, 32), material);
    }
    default:
      // text/image/model and the extended primitives — playground only renders
      // the common subset for now. Promote a richer renderer if the
      // experiment needs it.
      return null;
  }
}

function applyTransform(obj: Group | Mesh, node: EditorNode) {
  obj.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z);
  obj.rotation.set(node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z);
  obj.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z);
}

function disposeGroup(group: Group) {
  group.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}
