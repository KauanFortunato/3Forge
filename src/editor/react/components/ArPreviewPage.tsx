import { useEffect, useMemo, useRef, useState } from "react";
import { AmbientLight, Box3, Color, DirectionalLight, Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface ArPreviewMetadata {
  id: string;
  name: string;
  expiresAt: number;
  viewerUrl: string;
  glbUrl: string;
  usdzUrl: string;
}

interface ArPreviewPageProps {
  previewId: string;
}

export function ArPreviewPage({ previewId }: ArPreviewPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [metadata, setMetadata] = useState<ArPreviewMetadata | null>(null);
  const [status, setStatus] = useState("Loading preview...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/__3forge_ar_preview/metadata/${encodeURIComponent(previewId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.status === 404 ? "Preview expired or unavailable." : "Unable to load preview.");
        }
        return await response.json() as ArPreviewMetadata;
      })
      .then((nextMetadata) => {
        if (!cancelled) {
          setMetadata(nextMetadata);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load preview.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !metadata) {
      return;
    }

    let disposed = false;
    let animationFrameId = 0;
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setClearColor(new Color("#111116"));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new Scene();
    scene.background = new Color("#111116");
    const camera = new PerspectiveCamera(45, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    scene.add(new AmbientLight(0xffffff, 1.4));
    const keyLight = new DirectionalLight(0xffffff, 3);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0xb9a7ff, 1.2);
    fillLight.position.set(-4, 3, -2);
    scene.add(fillLight);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const frameObject = (object: Object3D) => {
      const box = new Box3().setFromObject(object);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      const radius = Math.max(size.x, size.y, size.z, 1);
      controls.target.copy(center);
      camera.position.set(center.x + radius * 1.4, center.y + radius * 0.9, center.z + radius * 1.8);
      camera.near = Math.max(0.01, radius / 100);
      camera.far = Math.max(100, radius * 100);
      camera.updateProjectionMatrix();
      controls.update();
    };

    resize();
    window.addEventListener("resize", resize);
    setStatus("Loading model...");

    new GLTFLoader().load(
      metadata.glbUrl,
      (gltf) => {
        if (disposed) {
          return;
        }
        scene.add(gltf.scene);
        frameObject(gltf.scene);
        setStatus("Ready");
      },
      undefined,
      (loadError) => {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "Unable to render GLB preview.");
        }
      },
    );

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrameId = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      controls.dispose();
      renderer.dispose();
    };
  }, [metadata]);

  const androidSceneViewerUrl = useMemo(() => {
    if (!metadata) {
      return "";
    }
    const fallback = encodeURIComponent(metadata.viewerUrl);
    return `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(metadata.glbUrl)}&mode=ar_preferred#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end;`;
  }, [metadata]);

  if (error) {
    return (
      <main className="ar-preview-page">
        <section className="ar-preview-page__empty">
          <h1>Preview unavailable</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="ar-preview-page">
      <canvas ref={canvasRef} className="ar-preview-page__canvas" aria-label="3D model preview" />
      <section className="ar-preview-page__hud">
        <div>
          <span className="ar-preview-page__eyebrow">3Forge local preview</span>
          <h1>{metadata?.name ?? "Loading model"}</h1>
          <p>{status}</p>
        </div>
        {metadata ? (
          <div className="ar-preview-page__actions">
            <a className="tbtn is-primary" href={metadata.usdzUrl} rel="ar">
              View AR on iPhone
            </a>
            <a className="tbtn" href={androidSceneViewerUrl}>
              View AR on Android
            </a>
            <a className="tbtn is-ghost" href={metadata.glbUrl} download={`${metadata.name}.glb`}>
              GLB
            </a>
            <a className="tbtn is-ghost" href={metadata.usdzUrl} download={`${metadata.name}.usdz`}>
              USDZ
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}
