import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  LinearToneMapping,
  Mesh,
  MeshPhysicalMaterial,
  NoToneMapping,
  Object3D,
  Object3DEventMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  TorusKnotGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import type { HdrAsset, SceneSettings } from "../../types";

interface HdrEnvironmentPreviewProps {
  hdrAsset: HdrAsset | null;
  intensity: number;
  exposure: number;
  toneMapping: SceneSettings["toneMapping"]["type"];
  isActive?: boolean;
}

interface PreviewRuntime {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  pmremGenerator: PMREMGenerator;
  geometry: SphereGeometry;
  centerGeometry: TorusKnotGeometry;
  materials: MeshPhysicalMaterial[];
  centerMesh: Mesh<TorusKnotGeometry, MeshPhysicalMaterial>;
  resize: () => void;
  environmentTarget: ReturnType<PMREMGenerator["fromEquirectangular"]> | null;
  hdrTexture: Awaited<ReturnType<RGBELoader["loadAsync"]>> | null;
  environmentLoadToken: number;
}

export function HdrEnvironmentPreview({
  hdrAsset,
  intensity,
  exposure,
  toneMapping,
  isActive = true,
}: HdrEnvironmentPreviewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<PreviewRuntime | null>(null);
  const animationFrameRef = useRef(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus("HDR preview unavailable in this environment.");
      return;
    }

    const scene = new Scene();
    scene.background = new Color("#101216");

    const camera = new PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(4.8, 3.2, 6.2);

    scene.add(new AmbientLight(0xffffff, 0.12));
    const key = new DirectionalLight(0xffffff, 1.5);
    key.position.set(4, 5, 3);
    scene.add(key);

    const root = new Object3D();
    scene.add(root);

    const grid = new GridHelper(7, 14, 0x3a3d45, 0x23262d);
    grid.position.y = -0.82;
    scene.add(grid);

    const geometry = new SphereGeometry(0.72, 64, 32);
    const centerGeometry = new TorusKnotGeometry(0.56, 0.18, 128, 18);
    const materials = [
      new MeshPhysicalMaterial({ color: "#f3f5f8", roughness: 0.08, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.05 }),
      new MeshPhysicalMaterial({ color: "#d6b77a", roughness: 0.34, metalness: 1 }),
      new MeshPhysicalMaterial({ color: "#8f99a8", roughness: 0.72, metalness: 0.15 }),
      new MeshPhysicalMaterial({ color: "#f7f0e8", roughness: 0.18, metalness: 0, transmission: 0.28, thickness: 0.4, ior: 1.45 }),
      new MeshPhysicalMaterial({ color: "#bfc7d5", roughness: 0.18, metalness: 0.65, clearcoat: 0.7 }),
    ];
    const positions = [
      new Vector3(-1.9, 0, 0.8),
      new Vector3(0, 0.28, -0.55),
      new Vector3(1.9, 0, 0.8),
      new Vector3(-0.95, -0.15, -1.85),
    ];
    const meshes: Array<Mesh<BufferGeometry, MeshPhysicalMaterial, Object3DEventMap>> = positions.map((position, index) => {
      const mesh = new Mesh(geometry, materials[index]);
      mesh.position.copy(position);
      root.add(mesh);
      return mesh;
    });
    const centerMesh = new Mesh(centerGeometry, materials[4]);
    centerMesh.position.set(0.95, 0.05, -1.85);
    root.add(centerMesh);
    meshes.push(centerMesh);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "settings-hdr-preview__canvas";
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controls.minDistance = 3;
    controls.maxDistance = 12;
    controls.update();

    const pmremGenerator = new PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    runtimeRef.current = {
      renderer,
      scene,
      camera,
      controls,
      pmremGenerator,
      geometry,
      centerGeometry,
      materials,
      centerMesh,
      resize,
      environmentTarget: null,
      hdrTexture: null,
      environmentLoadToken: 0,
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const render = () => {
      animationFrameRef.current = window.requestAnimationFrame(render);
      controls.update();
      centerMesh.rotation.x += 0.006;
      centerMesh.rotation.y += 0.012;
      renderer.render(scene, camera);
    };
    render();

    return () => {
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      window.cancelAnimationFrame(animationFrameRef.current);
      resizeObserver.disconnect();

      if (!runtime) {
        return;
      }

      runtime.controls.dispose();
      runtime.scene.environment = null;
      runtime.environmentTarget?.dispose();
      runtime.hdrTexture?.dispose();
      runtime.pmremGenerator.dispose();
      runtime.geometry.dispose();
      runtime.centerGeometry.dispose();
      for (const material of runtime.materials) {
        material.dispose();
      }
      runtime.renderer.dispose();
      runtime.renderer.forceContextLoss();
      runtime.renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    runtime.renderer.toneMapping = toneMapping === "acesFilmic"
      ? ACESFilmicToneMapping
      : toneMapping === "linear"
        ? LinearToneMapping
        : NoToneMapping;
    runtime.renderer.toneMappingExposure = exposure;
    (runtime.scene as Scene & { environmentIntensity?: number }).environmentIntensity = intensity;
  }, [exposure, intensity, toneMapping]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    const token = runtime.environmentLoadToken + 1;
    runtime.environmentLoadToken = token;
    runtime.scene.environment = null;
    runtime.environmentTarget?.dispose();
    runtime.environmentTarget = null;
    runtime.hdrTexture?.dispose();
    runtime.hdrTexture = null;

    if (!hdrAsset?.src) {
      setStatus("Select an HDR environment to preview material response.");
      return;
    }

    setStatus("Loading HDR preview...");

    new RGBELoader().loadAsync(hdrAsset.src)
      .then((texture) => {
        const activeRuntime = runtimeRef.current;
        if (!activeRuntime || activeRuntime.environmentLoadToken !== token) {
          texture.dispose();
          return;
        }

        const target = activeRuntime.pmremGenerator.fromEquirectangular(texture);
        activeRuntime.hdrTexture = texture;
        activeRuntime.environmentTarget = target;
        activeRuntime.scene.environment = target.texture;
        setStatus(null);
      })
      .catch(() => {
        const activeRuntime = runtimeRef.current;
        if (activeRuntime?.environmentLoadToken === token) {
          activeRuntime.scene.environment = null;
          setStatus("Unable to decode this HDR file.");
        }
      });
  }, [hdrAsset]);

  useEffect(() => {
    if (isActive) {
      runtimeRef.current?.resize();
    }
  }, [isActive]);

  return (
    <div className="settings-hdr-preview" ref={mountRef}>
      {status ? <div className="settings-hdr-preview__status">{status}</div> : null}
    </div>
  );
}
