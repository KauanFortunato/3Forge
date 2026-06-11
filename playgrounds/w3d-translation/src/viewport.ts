/**
 * Tiny Three.js scene used to visualise the result of `translateBlueprint`.
 * Intentionally simpler than the editor's `SceneEditor` — no gizmos, no
 * orbit controls when locked, no selection. Just "draw whatever the
 * blueprint says".
 */

import {
  AmbientLight,
  AxesHelper,
  Box3,
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
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ComponentBlueprint, EditorNode } from "../../../src/editor/types";
import { buildNodeTree, W3D_FRAME_PX_PER_UNIT, type BuildContext } from "./nodes/builder";
import type { W3DNodeData } from "./nodes/data";

/**
 * Phase V — W3D 2D broadcast frame px-per-world-unit conversion.
 *
 * 3Forge stores `sceneSettings.canvas` in PIXEL units (default 1920×1080),
 * but R3 authors content in world units where the broadcast frame is
 * 7.363797 × 4.142136. The conversion is fixed at 1080/4.142136 ≈ 260.7349
 * pixels per world unit — and equivalently 1920/7.363797. Every TextureLayer
 * / Quad / TextureText size in the 2D corpus implicitly assumes this scale.
 *
 * So to map `canvas.height` (in px) onto the ortho frustum half-height (in
 * world units), divide by this constant. For the default 1080 canvas the
 * result is 1080/2/260.7349 ≈ 2.071068 — exactly half the W3D 4.142 frame.
 *
 * The constant lives in the builder (which derives full-frame detection from
 * the same conversion via frameWorldSizeFor); re-exported here for the
 * viewport's existing consumers.
 */
export { W3D_FRAME_PX_PER_UNIT };

/**
 * Default ortho half-height used for non-2D scenes (e.g. 3D / AR / no
 * sceneSettings). Matches the previous hardcoded value so existing
 * non-2D playgrounds keep their framing.
 */
export const ORTHO_DEFAULT_HALF_HEIGHT = 5;

/**
 * Pure helper — extracted so it can be unit-tested without spinning up a
 * WebGLRenderer / DOM. Returns the world-units half-height to use for the
 * ortho frustum when rendering this scene.
 *
 * - For `mode === "2d"` with a non-degenerate canvas: convert
 *   `canvas.height / 2` from pixels to world units via
 *   `W3D_FRAME_PX_PER_UNIT`.
 * - Otherwise: fall back to `ORTHO_DEFAULT_HALF_HEIGHT`.
 *
 * Degenerate canvases (height <= 0) fall back to the default to avoid
 * collapsing the ortho frustum to zero height.
 */
export function computeOrtho2DHalfHeight(
  sceneSettings:
    | { mode: "2d" | "3d"; canvas?: { width: number; height: number } }
    | undefined,
): number {
  if (sceneSettings?.mode === "2d") {
    const h = sceneSettings.canvas?.height;
    if (typeof h === "number" && h > 0) {
      return (h / 2) / W3D_FRAME_PX_PER_UNIT;
    }
  }
  return ORTHO_DEFAULT_HALF_HEIGHT;
}

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
  /** DEV-Inspector — select a built W3D object directly from the node tree. */
  selectW3DNode(nodeId: string): Object3D | null;
  /** DEV-Inspector — clear the current selection outline. */
  clearInspectorSelection(): void;
  /** DEV-Inspector — toggle the bounding-box / pivot markers on/off. */
  setMarkerVisibility(opts: { box?: boolean; pivot?: boolean }): void;
  /**
   * DEV-Inspector — FOCUS/ISOLATE. When on, only the selected node's subtree is
   * shown (the rest is hidden) and invisible masks in the selection are
   * force-painted so their shape is visible. Re-applies to the current selection.
   */
  setFocusMode(on: boolean): void;
  /** Focus/isolate a node by id (show only its subtree + ancestors). null clears. */
  setFocus(nodeId: string | null): void;
  /** Per-node visibility — the tree eye toggles. Hides each id and its subtree. */
  setHiddenNodes(ids: Set<string>): void;
  /** Renderer cost snapshot for the Debug tab. */
  getRenderStats(): { calls: number; triangles: number; geometries: number; textures: number };
  /** Built leaf meshes with their renderOrder, sorted — for the Debug tab. */
  getRenderOrderList(): { id: string; name: string; kind: string; renderOrder: number }[];
  dispose(): void;
}

export function createPlaygroundViewport(host: HTMLElement): PlaygroundViewport {
  // stencil:true is required by Phase 1a photo mask clipping.
  const renderer = new WebGLRenderer({ antialias: true, stencil: true });
  // Invisible matte windows (builder applySiblingMatteWindows) clip via
  // per-material clipping planes — requires local clipping on the renderer.
  renderer.localClippingEnabled = true;
  // Supersample: render at ~2× the display resolution and let the browser
  // downscale the canvas. MSAA only antialiases polygon edges, not the binary
  // stencil/alphaTest contour used to cut the player silhouettes — that edge is
  // written at fragment resolution and otherwise shows a 1px staircase on the
  // margins. Rendering more fragments and averaging on downscale smooths it.
  // Capped at 3 so the backing buffer stays bounded on hi-DPI displays.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio * 2, 3));
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
  // Phase V — 2D ortho frustum tracking the authored W3D broadcast canvas.
  // The active half-height is set by setBlueprint() based on the scene
  // settings; resize() reads it whenever the ortho camera is active. Default
  // matches the previous hardcoded halfH=5 so non-2D / no-blueprint paths
  // remain unchanged.
  let ortho2DHalfH = ORTHO_DEFAULT_HALF_HEIGHT;
  // Compute the LARGEST 16:9 rectangle that fits inside the host. The canvas
  // is then stretched to that exact pixel size via renderer.setSize (which
  // also updates the inline width/height styles on the canvas). CSS just
  // centers the resulting fixed-size canvas and paints the letterbox bars in
  // the host's background.
  const resize = () => {
    const hostW = Math.max(host.clientWidth, 1);
    const hostH = Math.max(host.clientHeight, 1);
    let w = hostW;
    let h = hostW / TARGET_ASPECT;
    if (h > hostH) {
      h = hostH;
      w = hostH * TARGET_ASPECT;
    }
    renderer.setSize(w, h); // updateStyle=true (default): set inline w/h in px
    if (activeCam instanceof PerspectiveCamera) {
      activeCam.aspect = TARGET_ASPECT;
      activeCam.updateProjectionMatrix();
    } else {
      const halfH = ortho2DHalfH;
      const halfW = halfH * TARGET_ASPECT;
      activeCam.left = -halfW;
      activeCam.right = halfW;
      activeCam.top = halfH;
      activeCam.bottom = -halfH;
      activeCam.updateProjectionMatrix();
    }
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // ---- DEV-Inspector state ----------------------------------------------
  let inspectorEnabled = false;
  let inspectorCallback: ((event: InspectorEvent) => void) | null = null;
  let selectionHelper: BoxHelper | null = null;
  // Pivot/anchor marker: AxesHelper at the node's world origin (the point the
  // mesh position lands — i.e. its anchor). Drawn on top (depthTest off) so it
  // shows over the geometry. Lives in the scene, not the panel, so it persists
  // when the inspector panel is closed.
  let pivotHelper: AxesHelper | null = null;
  const markerVis = { box: true, pivot: true };
  const tmpV = new Vector3();
  const tmpQ = new Quaternion();
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  // Track pointerdown coords to distinguish click vs OrbitControls drag.
  let downX = 0;
  let downY = 0;
  const CLICK_THRESHOLD_PX = 3;

  // DEV-Inspector — FOCUS / ISOLATE. When on, only the selected node's subtree
  // (plus its ancestors, so it stays positioned) is shown; everything else is
  // hidden. Meshes in the selection that paint nothing (mask writers with
  // colorWrite=false, or alpha≈0 helpers) are temporarily force-painted in the
  // selection colour so an otherwise-invisible mask reveals its actual shape.
  // Originals are saved and restored when focus turns off or the selection moves.
  let focusTarget: Object3D | null = null;
  let currentTarget: Object3D | null = null;
  let hiddenIds: Set<string> = new Set();
  const savedVis = new Map<Object3D, boolean>();
  const FOCUS_PAINT = 0x7c44de;
  const savedMat = new Map<MeshBasicMaterial, { colorWrite: boolean; opacity: number; transparent: boolean; color: number }>();

  // True when `o` or any ancestor was hidden via the tree eye toggle.
  function isHidden(o: Object3D): boolean {
    if (hiddenIds.size === 0) return false;
    for (let a: Object3D | null = o; a; a = a.parent) {
      const id = (a.userData?.w3d as { id?: string } | undefined)?.id;
      if (id && hiddenIds.has(id)) return true;
    }
    return false;
  }

  function restoreFocus(): void {
    for (const [o, v] of savedVis) o.visible = v;
    savedVis.clear();
    for (const [m, s] of savedMat) {
      m.colorWrite = s.colorWrite;
      m.opacity = s.opacity;
      m.transparent = s.transparent;
      m.color.setHex(s.color);
      m.needsUpdate = true;
    }
    savedMat.clear();
  }

  // Unified visibility: a node is shown when (no focus, or it's in the focused
  // subtree/ancestor chain) AND it isn't hidden via the eye toggle. Focus and
  // the per-node eye are independent overlays; this recomputes both at once.
  function recomputeVisibility(): void {
    restoreFocus();
    if (!mountedNodes) return;
    let keep: Set<Object3D> | null = null;
    if (focusTarget) {
      keep = new Set<Object3D>();
      focusTarget.traverse((o) => keep!.add(o));           // target + descendants
      for (let a: Object3D | null = focusTarget; a; a = a.parent) keep!.add(a); // ancestors
    }
    if (!keep && hiddenIds.size === 0) return;             // nothing to override
    mountedNodes.traverse((o) => {
      savedVis.set(o, o.visible);
      let vis = o.visible;
      if (keep && !keep.has(o)) vis = false;
      if (vis && isHidden(o)) vis = false;
      o.visible = vis;
    });
    // Force-paint invisible meshes in the focused subtree so masks show shape.
    if (focusTarget) {
      focusTarget.traverse((o) => {
        if (!(o as Mesh).isMesh) return;
        const m = (o as Mesh).material as MeshBasicMaterial | undefined;
        if (!m) return;
        const invisible = m.colorWrite === false || (typeof m.opacity === "number" && m.opacity <= 0.01);
        if (!invisible) return;
        savedMat.set(m, { colorWrite: m.colorWrite, opacity: m.opacity, transparent: m.transparent, color: m.color.getHex() });
        m.colorWrite = true;
        m.opacity = 0.6;
        m.transparent = true;
        m.color.setHex(FOCUS_PAINT);
        m.needsUpdate = true;
      });
    }
  }

  function clearSelectionHelper(): void {
    if (selectionHelper) {
      scene.remove(selectionHelper);
      selectionHelper.geometry.dispose();
      // BoxHelper carries a LineBasicMaterial — dispose via the generic Material type.
      (selectionHelper.material as { dispose?: () => void }).dispose?.();
      selectionHelper = null;
    }
    if (pivotHelper) {
      scene.remove(pivotHelper);
      pivotHelper.geometry.dispose();
      (pivotHelper.material as { dispose?: () => void }).dispose?.();
      pivotHelper = null;
    }
  }

  function setSelection(target: Object3D | null): void {
    clearSelectionHelper();
    currentTarget = target;
    if (!target) return;
    selectionHelper = new BoxHelper(target, 0x7c44de);
    // Draw the outline ON TOP of the 3D geometry (otherwise the photos/panels in
    // front of the text occlude it and it looks like "nothing shows").
    const boxMat = selectionHelper.material as { depthTest?: boolean; depthWrite?: boolean; transparent?: boolean };
    boxMat.depthTest = false;
    boxMat.depthWrite = false;
    boxMat.transparent = true;
    selectionHelper.renderOrder = 100000;
    selectionHelper.visible = markerVis.box;
    scene.add(selectionHelper);

    // Size the axes to the node so the marker is visible but not overwhelming.
    const box = new Box3().setFromObject(target);
    const dim = box.isEmpty() ? 0.4 : Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
    const size = Math.min(Math.max(dim * 0.6, 0.15), 1.5);
    pivotHelper = new AxesHelper(size);
    pivotHelper.position.copy(target.getWorldPosition(tmpV));
    pivotHelper.quaternion.copy(target.getWorldQuaternion(tmpQ));
    const axMat = pivotHelper.material as { depthTest?: boolean; depthWrite?: boolean; transparent?: boolean };
    axMat.depthTest = false;
    axMat.depthWrite = false;
    axMat.transparent = true;
    pivotHelper.renderOrder = 100001;
    pivotHelper.visible = markerVis.pivot;
    scene.add(pivotHelper);
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

  function findW3DObjectById(nodeId: string): Object3D | null {
    if (!mountedNodes) return null;
    let foundRealNode: Object3D | null = null;
    let foundHelper: Object3D | null = null;
    mountedNodes.traverse((obj) => {
      if (foundRealNode) return;
      const w3d = (obj.userData as Record<string, unknown> | undefined)?.w3d as
        | { id?: string; forNodeId?: string }
        | undefined;
      if (w3d?.id === nodeId) {
        foundRealNode = obj;
      } else if (w3d?.forNodeId === nodeId) {
        foundHelper = obj;
      }
    });
    return foundRealNode ?? foundHelper;
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

      // Phase V — fit the ortho frustum to the authored broadcast canvas in
      // 2D mode. resize() reads ortho2DHalfH on every frame; updating it here
      // and then calling resize() applies the new framing immediately.
      ortho2DHalfH = computeOrtho2DHalfHeight(blueprint.sceneSettings);

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
      // A rebuild invalidates any focus/selection state (objects are disposed).
      savedVis.clear();
      savedMat.clear();
      currentTarget = null;
      focusTarget = null;
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
    selectW3DNode(nodeId: string) {
      const target = findW3DObjectById(nodeId);
      setSelection(target);
      return target;
    },
    clearInspectorSelection() {
      clearSelectionHelper();
    },
    setMarkerVisibility(opts: { box?: boolean; pivot?: boolean }) {
      if (opts.box !== undefined) markerVis.box = opts.box;
      if (opts.pivot !== undefined) markerVis.pivot = opts.pivot;
      if (selectionHelper) selectionHelper.visible = markerVis.box;
      if (pivotHelper) pivotHelper.visible = markerVis.pivot;
    },
    setFocusMode(on: boolean) {
      focusTarget = on ? currentTarget : null;
      recomputeVisibility();
    },
    setFocus(nodeId: string | null) {
      focusTarget = nodeId ? findW3DObjectById(nodeId) : null;
      recomputeVisibility();
    },
    setHiddenNodes(ids: Set<string>) {
      hiddenIds = ids;
      recomputeVisibility();
    },
    getRenderStats() {
      const info = renderer.info;
      return {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      };
    },
    getRenderOrderList() {
      const out: { id: string; name: string; kind: string; renderOrder: number }[] = [];
      if (!mountedNodes) return out;
      mountedNodes.traverse((o) => {
        if (!(o as Mesh).isMesh) return;
        const w = (o.userData as Record<string, unknown> | undefined)?.w3d as
          | { id?: string; name?: string; kind?: string }
          | undefined;
        if (!w?.id) return;
        out.push({ id: w.id, name: w.name ?? "", kind: w.kind ?? "", renderOrder: o.renderOrder });
      });
      out.sort((a, b) => a.renderOrder - b.renderOrder);
      return out;
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
