/**
 * Tiny Three.js scene used to visualise the result of `translateBlueprint`.
 * Intentionally simpler than the editor's `SceneEditor` — no gizmos, no
 * orbit controls when locked, no selection. Just "draw whatever the
 * blueprint says".
 */

import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ComponentBlueprint, EditorNode } from "../../../src/editor/types";
import { buildNodeTree, type BuildContext } from "./nodes/builder";
import type { W3DNodeData } from "./nodes/data";

export interface PlaygroundViewport {
  /** Replace what's drawn. Call whenever the blueprint changes. */
  setBlueprint(blueprint: ComponentBlueprint): void;
  setNodes(roots: W3DNodeData[], ctx?: BuildContext): void;
  dispose(): void;
}

export function createPlaygroundViewport(host: HTMLElement): PlaygroundViewport {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
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

  const resize = () => {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    renderer.setSize(w, h);
    if (activeCam instanceof PerspectiveCamera) {
      activeCam.aspect = w / h;
      activeCam.updateProjectionMatrix();
    } else {
      // ortho frustum stays fixed at 16:9 inside the host (letterbox style)
      const aspect = w / h;
      const halfH = 5;
      const halfW = halfH * aspect;
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

  let frame = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    if (activeCam === perspectiveCam) controls?.update();
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
    dispose() {
      if (mountedNodes) {
        scene.remove(mountedNodes);
        disposeGroup(mountedNodes);
        mountedNodes = null;
      }
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
