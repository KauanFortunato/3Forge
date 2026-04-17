import { useCallback, useEffect, useRef, useState } from "react";
import { AmbientLight, Box3, Color, DirectionalLight, GridHelper, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { discoverGeneratedModules, getAnimationCapabilities, resolveExportedComponent, type ExportRunnerComponentInstance } from "./runtime";

const DEFAULT_OPTIONS_JSON = "{\n  \n}";
const generatedModuleImporters = import.meta.glob<Record<string, unknown>>("./generated/**/*.ts");
const generatedModules = discoverGeneratedModules(generatedModuleImporters);

export function ExportRunnerApp() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const mountedGroupRef = useRef<Group | null>(null);
  const frameHandleRef = useRef<number | null>(null);
  const instanceRef = useRef<ExportRunnerComponentInstance | null>(null);

  const [optionsJson, setOptionsJson] = useState(DEFAULT_OPTIONS_JSON);
  const [status, setStatus] = useState("Ready to load the exported component.");
  const [frameInput, setFrameInput] = useState("0");
  const [clipName, setClipName] = useState("");
  const [buildCount, setBuildCount] = useState(0);
  const [selectedModulePath, setSelectedModulePath] = useState(() => generatedModules[0]?.modulePath ?? "");
  const [selectedModuleExportName, setSelectedModuleExportName] = useState<string | null>(null);

  const animationCapabilities = getAnimationCapabilities(instanceRef.current);
  const selectedModule = generatedModules.find((entry) => entry.modulePath === selectedModulePath) ?? null;

  useEffect(() => {
    if (generatedModules.length === 0) {
      return;
    }

    if (!selectedModulePath || !generatedModules.some((entry) => entry.modulePath === selectedModulePath)) {
      setSelectedModulePath(generatedModules[0].modulePath);
    }
  }, [selectedModulePath]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    const scene = new Scene();
    scene.background = new Color("#111318");

    const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(5, 4, 6);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.6, 0);

    const ambient = new AmbientLight("#ffffff", 1.15);
    const key = new DirectionalLight("#ffffff", 2.2);
    key.castShadow = true;
    key.position.set(6, 10, 8);
    scene.add(ambient, key, new GridHelper(16, 16, "#3a3f4a", "#2a2f38"));

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const renderLoop = () => {
      controls.update();
      renderer.render(scene, camera);
      frameHandleRef.current = window.requestAnimationFrame(renderLoop);
    };
    renderLoop();

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    rendererRef.current = renderer;

    return () => {
      if (frameHandleRef.current) {
        window.cancelAnimationFrame(frameHandleRef.current);
      }
      observer.disconnect();
      disposeMountedComponent();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  const disposeMountedComponent = useCallback(() => {
    const mountedGroup = mountedGroupRef.current;
    const scene = sceneRef.current;
    if (mountedGroup && scene) {
      scene.remove(mountedGroup);
    }
    mountedGroupRef.current = null;

    instanceRef.current?.dispose();
    instanceRef.current = null;
  }, []);

  const fitCameraToGroup = useCallback((group: Group) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) {
      return;
    }

    const bounds = new Box3().setFromObject(group);
    if (bounds.isEmpty()) {
      controls.target.set(0, 0, 0);
      camera.position.set(5, 4, 6);
      return;
    }

    const center = new Vector3();
    const size = new Vector3();
    bounds.getCenter(center);
    bounds.getSize(size);

    const maxSize = Math.max(size.x, size.y, size.z, 1);
    const distance = Math.max(maxSize * 1.6, 4);
    camera.position.set(center.x + distance, center.y + distance * 0.85, center.z + distance);
    controls.target.copy(center);
    controls.update();
  }, []);

  const handleBuild = useCallback(async () => {
    if (!selectedModule) {
      setStatus("No generated TypeScript file was detected in ./generated.");
      return;
    }

    const scene = sceneRef.current;
    if (!scene) {
      setStatus("Scene host is not ready yet.");
      return;
    }

    let parsedOptions: Record<string, unknown> = {};
    try {
      const parsed = optionsJson.trim() ? JSON.parse(optionsJson) : {};
      parsedOptions = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
    } catch {
      setStatus("Options JSON is invalid.");
      return;
    }

    try {
      const loadedModule = await selectedModule.importModule();
      const resolvedComponent = resolveExportedComponent(loadedModule);
      if (!resolvedComponent) {
        setStatus(`No exported component class was detected in ${selectedModule.fileName}.ts.`);
        return;
      }

      disposeMountedComponent();

      const instance = new resolvedComponent.constructor(parsedOptions);
      await instance.build();
      scene.add(instance.group);
      mountedGroupRef.current = instance.group;
      instanceRef.current = instance;
      fitCameraToGroup(instance.group);
      setSelectedModuleExportName(resolvedComponent.exportName);
      setBuildCount((value) => value + 1);
      setStatus(`Built ${resolvedComponent.exportName} from ${selectedModule.fileName}.ts.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to build the exported component.");
    }
  }, [disposeMountedComponent, fitCameraToGroup, optionsJson, selectedModule]);

  const handleDispose = useCallback(() => {
    disposeMountedComponent();
    setStatus("Disposed exported component.");
  }, [disposeMountedComponent]);

  const runAnimationAction = useCallback((action: "play" | "pause" | "stop") => {
    const instance = instanceRef.current;
    const method = instance?.[action];
    if (typeof method !== "function") {
      return;
    }

    method.call(instance);
    setStatus(`${action[0].toUpperCase()}${action.slice(1)} animation.`);
  }, []);

  const handleSeek = useCallback(() => {
    const instance = instanceRef.current;
    if (typeof instance?.seek !== "function") {
      return;
    }

    const frame = Number(frameInput);
    if (!Number.isFinite(frame)) {
      setStatus("Frame must be numeric.");
      return;
    }

    instance.seek(frame);
    setStatus(`Seeked to frame ${Math.round(frame)}.`);
  }, [frameInput]);

  const handlePlayClip = useCallback(() => {
    const instance = instanceRef.current;
    if (typeof instance?.playClip !== "function") {
      return;
    }

    const normalizedClip = clipName.trim();
    if (!normalizedClip) {
      setStatus("Clip name is required.");
      return;
    }

    instance.playClip(normalizedClip);
    setStatus(`Playing clip "${normalizedClip}".`);
  }, [clipName]);

  return (
    <div className="runner-shell">
      <aside className="runner-sidebar">
        <div className="runner-card">
          <p className="runner-eyebrow">Export Runner</p>
          <h1 className="runner-title">TypeScript Export Sandbox</h1>
          <p className="runner-copy">
            Save any generated `.ts` export into `playgrounds/export-runner/src/generated/`, choose the file here, then rebuild it.
          </p>
        </div>

        <div className="runner-card runner-card--stack">
          <label className="runner-field">
            <span>Generated File</span>
            <select
              className="runner-select"
              value={selectedModulePath}
              onChange={(event) => {
                setSelectedModulePath(event.target.value);
                setSelectedModuleExportName(null);
              }}
            >
              {generatedModules.length > 0 ? generatedModules.map((entry) => (
                <option key={entry.modulePath} value={entry.modulePath}>
                  {entry.fileName}.ts
                </option>
              )) : (
                <option value="">No generated files found</option>
              )}
            </select>
          </label>

          <div className="runner-meta">
            <span>Detected export</span>
            <strong>{selectedModuleExportName ?? "Build to detect export"}</strong>
          </div>
          <div className="runner-meta">
            <span>Selected file</span>
            <strong>{selectedModule ? `${selectedModule.fileName}.ts` : "None detected"}</strong>
          </div>
          <div className="runner-meta">
            <span>Build count</span>
            <strong>{buildCount}</strong>
          </div>
          <div className="runner-meta">
            <span>Status</span>
            <strong>{status}</strong>
          </div>
        </div>

        <div className="runner-card runner-card--stack">
          <label className="runner-field">
            <span>Runtime Options JSON</span>
            <textarea
              className="runner-textarea"
              value={optionsJson}
              onChange={(event) => setOptionsJson(event.target.value)}
              spellCheck={false}
            />
          </label>

          <div className="runner-button-row">
            <button type="button" className="runner-button runner-button--primary" onClick={() => void handleBuild()}>
              Build export
            </button>
            <button type="button" className="runner-button" onClick={handleDispose}>
              Dispose
            </button>
          </div>
        </div>

        <div className="runner-card runner-card--stack">
          <p className="runner-section-title">Animation</p>

          <div className="runner-button-row">
            <button type="button" className="runner-button" disabled={!animationCapabilities.canPlay} onClick={() => runAnimationAction("play")}>
              Play
            </button>
            <button type="button" className="runner-button" disabled={!animationCapabilities.canPause} onClick={() => runAnimationAction("pause")}>
              Pause
            </button>
            <button type="button" className="runner-button" disabled={!animationCapabilities.canStop} onClick={() => runAnimationAction("stop")}>
              Stop
            </button>
          </div>

          <div className="runner-inline-fields">
            <label className="runner-field">
              <span>Frame</span>
              <input
                className="runner-input"
                type="number"
                value={frameInput}
                onChange={(event) => setFrameInput(event.target.value)}
              />
            </label>
            <button type="button" className="runner-button" disabled={!animationCapabilities.canSeek} onClick={handleSeek}>
              Seek
            </button>
          </div>

          <div className="runner-inline-fields">
            <label className="runner-field">
              <span>Clip Name</span>
              <input
                className="runner-input"
                type="text"
                value={clipName}
                onChange={(event) => setClipName(event.target.value)}
                placeholder="Optional explicit clip"
              />
            </label>
            <button type="button" className="runner-button" disabled={!animationCapabilities.canPlayClip} onClick={handlePlayClip}>
              Play Clip
            </button>
          </div>
        </div>
      </aside>

      <main className="runner-stage">
        <div className="runner-stage__header">
            <span className="runner-eyebrow">Viewport</span>
          <div className="runner-stage__badges">
            <span className="runner-badge">{selectedModuleExportName ?? selectedModule?.fileName ?? "No component"}</span>
            <span className="runner-badge">{animationCapabilities.canPlay ? "Animation API detected" : "Static export"}</span>
          </div>
        </div>
        <div ref={canvasHostRef} className="runner-canvas-host" />
      </main>
    </div>
  );
}
