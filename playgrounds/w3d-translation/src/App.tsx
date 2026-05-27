import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentBlueprint } from "../../../src/editor/types";
import { analyzeW3dXml, type DocumentStats } from "./analyze";
import { dumpNodes, type DumpRow } from "./nodes/diagnostics";
import type { W3DNodeData } from "./nodes/data";
import { translateBlueprint } from "./translate";
import { createPlaygroundViewport, type PlaygroundViewport } from "./viewport";
import type { BuildContext } from "./nodes/builder";
import type { W3DResourceRegistry } from "./nodes/resources";
import { buildInspectorReport, type InspectorReport } from "./inspector";
import { buildLoadedFontIndex, loadW3DFontFiles, type FontLoadResult } from "./fonts";
import type { Texture } from "three";
import {
  collectSceneMovFiles,
  collectSceneTextureFiles,
  indexW3DProject,
  type W3DProjectIndex,
  type W3DProjectScene,
} from "./projectFiles";

interface LoadedScene {
  sceneFileName: string;
  xml: string;
  blueprint: ComponentBlueprint;
  nodes: W3DNodeData[];
  resources: W3DResourceRegistry;
  textureUrlsByFilename: Map<string, string>;
  textureCache: Map<string, Texture>;
  warnings: string[];
  stats: DocumentStats;
  movFiles: number;
  rasterTextureFiles: number;
  /** Phase H3 — outcome of registering the W3D corpus fonts via FontFace. */
  fontLoadResults: FontLoadResult[];
  /** Phase H3 — fast lookup: "<family>|<weight>|<style>" → registered. */
  loadedFontIndex: Set<string>;
}

interface SelectedProject {
  files: File[];
  index: W3DProjectIndex;
}

export function App() {
  const [project, setProject] = useState<SelectedProject | null>(null);
  const [loaded, setLoaded] = useState<LoadedScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<"stats" | "xml" | "blueprint" | "quads">("stats");
  const [stencilDebugShowMask, setStencilDebugShowMask] = useState(false);
  const [inspectorEnabled, setInspectorEnabled] = useState(false);
  const [inspectorReport, setInspectorReport] = useState<InspectorReport | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<PlaygroundViewport | null>(null);
  const loadedRef = useRef<LoadedScene | null>(null);

  useEffect(() => {
    const host = viewportHostRef.current;
    if (!host) return;
    const vp = createPlaygroundViewport(host);
    viewportRef.current = vp;
    return () => {
      vp.dispose();
      viewportRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (loaded && viewportRef.current) {
      const builderWarnings: string[] = [];
      const ctx: BuildContext = {
        registry: loaded.resources,
        textureUrlsByFilename: loaded.textureUrlsByFilename,
        textureCache: loaded.textureCache,
        warnings: builderWarnings,
        stencilDebugShowMask,
        loadedFontIndex: loaded.loadedFontIndex,
      };
      viewportRef.current.setBlueprint(loaded.blueprint);
      viewportRef.current.setNodes(loaded.nodes, ctx);
    }
  }, [loaded, stencilDebugShowMask]);

  // DEV-Inspector — wire the toggle into the viewport raycaster + selection.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.setInspectorCallback((event) => {
      if (event.phase === "click") {
        const report = buildInspectorReport(event.target, loaded?.resources);
        if (report) setInspectorReport(report);
      } else {
        setInspectorReport(null);
      }
    });
    vp.setInspectorEnabled(inspectorEnabled);
    return () => {
      vp.setInspectorCallback(null);
    };
  }, [inspectorEnabled, loaded]);

  // DEV-Inspector — Esc clears the panel and the in-viewport selection box.
  useEffect(() => {
    if (!inspectorReport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInspectorReport(null);
        viewportRef.current?.clearInspectorSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectorReport]);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    return () => {
      cleanupLoadedScene(loadedRef.current);
    };
  }, []);

  const handleProjectFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    cleanupLoadedScene(loaded);
    viewportRef.current?.clearInspectorSelection();
    setInspectorReport(null);
    setLoaded(null);
    setError(null);
    const index = indexW3DProject(files);
    if (index.scenes.length === 0) {
      setProject(null);
      setError("No scene.w3d files found. Pick the root folder of an R3/W3D project.");
      return;
    }
    setProject({ files, index });
    if (index.scenes.length === 1) {
      await loadScene(files, index.scenes[0], index, setLoaded, setError);
    }
  }, [loaded]);

  const handleSceneSelect = useCallback(async (scene: W3DProjectScene) => {
    if (!project) return;
    cleanupLoadedScene(loaded);
    viewportRef.current?.clearInspectorSelection();
    setInspectorReport(null);
    setLoaded(null);
    await loadScene(project.files, scene, project.index, setLoaded, setError);
  }, [loaded, project]);

  const reTranslate = useCallback(() => {
    if (!loaded) return;
    setError(null);
    try {
      const translated = translateBlueprint(loaded.xml);
      setLoaded({
        ...loaded,
        blueprint: translated.blueprint,
        nodes: translated.nodes,
        resources: translated.resources,
        warnings: translated.warnings,
        // Preserve existing texture/font URLs and texture cache.
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loaded]);

  const blueprintPreview = useMemo(() => {
    if (!loaded) return "";
    return JSON.stringify(loaded.blueprint, null, 2);
  }, [loaded]);

  return (
    <div className="playground">
      <header className="playground__head">
        <h1>W3D Translation Playground</h1>
        <div className="playground__head-actions">
          <button type="button" onClick={() => folderInputRef.current?.click()}>
            Open W3D project…
          </button>
          {loaded ? (
            <button type="button" onClick={reTranslate} title="Re-run translate.ts against current XML">
              Re-translate
            </button>
          ) : null}
          <label style={{ marginLeft: 12, fontSize: 12, opacity: 0.8 }} title="Debug: paint PHOTO_MASK_0X red 50% so the mask shape is visible">
            <input
              type="checkbox"
              checked={stencilDebugShowMask}
              onChange={(e) => setStencilDebugShowMask(e.target.checked)}
            />
            show mask (red)
          </label>
          <label style={{ marginLeft: 12, fontSize: 12, opacity: 0.8 }} title="Click a node in the viewport to inspect its W3D properties">
            <input
              type="checkbox"
              checked={inspectorEnabled}
              onChange={(e) => {
                setInspectorEnabled(e.target.checked);
                if (!e.target.checked) {
                  setInspectorReport(null);
                  viewportRef.current?.clearInspectorSelection();
                }
              }}
            />
            inspector
          </label>
        </div>
      </header>

      <input
        ref={folderInputRef}
        type="file"
        style={{ display: "none" }}
        // @ts-expect-error webkitdirectory is non-standard
        webkitdirectory=""
        directory=""
        multiple
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          event.currentTarget.value = "";
          await handleProjectFiles(files);
        }}
      />

      <div className="playground__body">
        <aside className="playground__panel">
          <ProjectScenes
            project={project}
            loadedSceneFileName={loaded?.sceneFileName ?? null}
            onSceneSelect={handleSceneSelect}
          />
          <div className="playground__tabs">
            <button className={activePanel === "stats" ? "is-active" : ""} onClick={() => setActivePanel("stats")}>
              Structure
            </button>
            <button className={activePanel === "xml" ? "is-active" : ""} onClick={() => setActivePanel("xml")}>
              Raw XML
            </button>
            <button className={activePanel === "blueprint" ? "is-active" : ""} onClick={() => setActivePanel("blueprint")}>
              Blueprint
            </button>
            <button className={activePanel === "quads" ? "is-active" : ""} onClick={() => setActivePanel("quads")}>
              Quads
            </button>
          </div>
          <div className="playground__panel-body">
            {!loaded ? (
              <div className="playground__placeholder">
                {error ? <p className="playground__error">{error}</p> : null}
                <p>Pick an R3/W3D project folder, then choose a scene.</p>
              </div>
            ) : activePanel === "stats" ? (
              <StatsView loaded={loaded} />
            ) : activePanel === "xml" ? (
              <pre className="playground__code">{loaded.xml}</pre>
            ) : activePanel === "blueprint" ? (
              <pre className="playground__code">{blueprintPreview}</pre>
            ) : activePanel === "quads" ? (
              <QuadsView loaded={loaded} />
            ) : (
              <StatsView loaded={loaded} />
            )}
          </div>
        </aside>

        <main className="playground__viewport">
          <div ref={viewportHostRef} className="playground__viewport-host" />
          {loaded ? (
            <div className="playground__viewport-meta">
              <span>{loaded.sceneFileName}</span>
              <span>{loaded.stats.totalElements} elements · max depth {loaded.stats.maxDepth}</span>
              <span>{loaded.movFiles} .mov · {loaded.rasterTextureFiles} textures · {loaded.fontLoadResults.filter((r) => r.registered).length}/{loaded.fontLoadResults.length} fonts</span>
              {loaded.warnings.length > 0 ? (
                <details>
                  <summary>{loaded.warnings.length} warning(s)</summary>
                  <ul>
                    {loaded.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
          {inspectorReport ? (
            <InspectorPanel
              report={inspectorReport}
              onClose={() => {
                setInspectorReport(null);
                viewportRef.current?.clearInspectorSelection();
              }}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

async function loadScene(
  files: File[],
  scene: W3DProjectScene,
  project: W3DProjectIndex,
  setLoaded: (loaded: LoadedScene | null) => void,
  setError: (error: string | null) => void,
): Promise<void> {
  setError(null);

  const textureUrlsByFilename = new Map<string, string>();
  const textureCache = new Map<string, Texture>();

  try {
    const xml = await scene.file.text();
    const stats = analyzeW3dXml(xml);
    const translated = translateBlueprint(xml);

    for (const file of collectSceneTextureFiles(files, scene)) {
      textureUrlsByFilename.set(file.name, URL.createObjectURL(file));
    }

    // Phase H3 — register R3 fonts via FontFace so canvas TextureText renders
    // with the authored family instead of system sans-serif fallback. Failures
    // are non-fatal; per-file status surfaces in the inspector / summary.
    const fontLoadResults = await loadW3DFontFiles(project.fontFiles);
    const loadedFontIndex = buildLoadedFontIndex(fontLoadResults);

    setLoaded({
      sceneFileName: scene.sceneFileName,
      xml,
      blueprint: translated.blueprint,
      nodes: translated.nodes,
      resources: translated.resources,
      textureUrlsByFilename,
      textureCache,
      warnings: [...translated.warnings],
      stats,
      movFiles: collectSceneMovFiles(files, scene).length,
      rasterTextureFiles: textureUrlsByFilename.size,
      fontLoadResults,
      loadedFontIndex,
    });
  } catch (err) {
    for (const url of textureUrlsByFilename.values()) URL.revokeObjectURL(url);
    for (const tex of textureCache.values()) tex.dispose();
    setLoaded(null);
    setError(err instanceof Error ? err.message : String(err));
  }
}

function cleanupLoadedScene(scene: LoadedScene | null): void {
  if (!scene) return;
  for (const url of scene.textureUrlsByFilename.values()) URL.revokeObjectURL(url);
  for (const tex of scene.textureCache.values()) tex.dispose();
}

function ProjectScenes({
  project,
  loadedSceneFileName,
  onSceneSelect,
}: {
  project: SelectedProject | null;
  loadedSceneFileName: string | null;
  onSceneSelect: (scene: W3DProjectScene) => void;
}) {
  if (!project) {
    return null;
  }

  return (
    <section className="playground__project">
      <div className="playground__project-head">
        <div>
          <strong>{project.index.projectName}</strong>
          <span>{project.index.scenes.length} scenes · {project.index.fontFiles.length} fonts</span>
        </div>
      </div>
      <div className="playground__scene-list">
        {project.index.scenes.map((scene) => (
          <button
            key={scene.id}
            type="button"
            className={scene.sceneFileName === loadedSceneFileName ? "is-active" : ""}
            onClick={() => onSceneSelect(scene)}
            title={scene.sceneFileName}
          >
            <span>{scene.name}</span>
            <code>{scene.sceneFileName}</code>
          </button>
        ))}
      </div>
    </section>
  );
}

function StatsView({ loaded }: { loaded: LoadedScene }) {
  return (
    <div className="playground__stats">
      <table>
        <thead>
          <tr><th>Element</th><th>Count</th><th>Attributes</th></tr>
        </thead>
        <tbody>
          {loaded.stats.byType.map((row) => (
            <tr key={row.name}>
              <td><code>{row.name}</code></td>
              <td>{row.count}</td>
              <td>
                <details>
                  <summary>{row.attributes.length} attr(s)</summary>
                  <code>{row.attributes.join(", ")}</code>
                  <p style={{ marginTop: 8, opacity: 0.7 }}>Sample paths:</p>
                  <ul>{row.samplePaths.map((p, i) => <li key={i}><code>{p}</code></li>)}</ul>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuadsView({ loaded }: { loaded: LoadedScene }) {
  const rows: DumpRow[] = dumpNodes(loaded.nodes, loaded.resources, loaded.textureUrlsByFilename);
  const quadRows = rows.filter((r) => r.kind === "Quad");
  const summary = {
    quads: quadRows.length,
    masks: quadRows.filter((r) => r.isMask).length,
    disabled: quadRows.filter((r) => r.disabledByEnable).length,
    alphaZero: quadRows.filter((r) => r.transparentByAlpha0).length,
    groups: rows.filter((r) => r.kind === "Group").length,
  };
  return (
    <div className="playground__quads">
      <div className="playground__quads-summary">
        {summary.quads} quads · {summary.masks} masks · {summary.disabled} disabled · {summary.alphaZero} alpha-zero · {summary.groups} groups
        {" · "}{rows.filter(r => r.kind === "Quad" && r.hasMaterialResolved).length} mat-resolved
        {" · "}{rows.filter(r => r.kind === "Quad" && r.hasTextureLayerResolved).length} tex-resolved
      </div>
      <table className="playground__quads-table">
        <thead>
          <tr>
            <th>Kind</th><th>Name</th><th>Size</th><th>Pos</th><th>Scale</th><th>Rot</th>
            <th>α</th><th>Vis</th><th>Mask</th><th>Material</th><th>Texture</th><th>#kids</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id + ":" + r.path} className={r.kind === "Group" ? "is-group" : ""}>
              <td>{r.kind}</td>
              <td style={{ paddingLeft: r.depth * 10 + 6 }}><code>{r.name}</code></td>
              <td>{r.size}</td>
              <td><code>{r.position}</code></td>
              <td><code>{r.scale}</code></td>
              <td><code>{r.rotation}</code></td>
              <td>{r.alpha}</td>
              <td title={r.disabledByEnable ? "Enable=False" : r.transparentByAlpha0 ? "Alpha=0" : ""}>{r.effectiveVisible ? "✓" : "—"}</td>
              <td>{r.isMask ? `mask(${r.maskProperties})` : r.maskIds.length > 0 ? `→ ${r.maskIds.join(",")}` : "—"}</td>
              <td><code title={r.materialId}>{shortId(r.materialId)}</code></td>
              <td><code title={r.textureLayerId}>{shortId(r.textureLayerId)}</code></td>
              <td>{r.childrenCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function shortId(s: string): string {
  if (s === "—" || s === "Standard") return s;
  return s.length > 12 ? s.slice(0, 8) + "…" : s;
}

// ---------------------------------------------------------------------------
// DEV-Inspector — floating panel with W3D/XML-style properties of a clicked
// Object3D. Pure read-only view of the InspectorReport built by inspector.ts.
// ---------------------------------------------------------------------------

interface Vec3Like { x: number; y: number; z: number }
interface Vec2Like { x: number; y: number }

function fmt(n: number, digits = 3): string {
  if (!isFinite(n)) return "—";
  return Number(n.toFixed(digits)).toString();
}
function fmtVec3(v: Vec3Like, digits = 3): string {
  return `(${fmt(v.x, digits)}, ${fmt(v.y, digits)}, ${fmt(v.z, digits)})`;
}
function fmtVec2(v: Vec2Like, digits = 3): string {
  return `(${fmt(v.x, digits)}, ${fmt(v.y, digits)})`;
}
function fmtBin(n: number, bits = 8): string {
  if (!isFinite(n)) return "—";
  return "0b" + (n & ((1 << bits) - 1)).toString(2).padStart(bits, "0");
}

function InspectorPanel({ report, onClose }: { report: InspectorReport; onClose: () => void }) {
  return (
    <aside className="playground__inspector">
      <header>
        <h3>
          {report.identity.name}
          <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
            ({report.identity.kind}{report.identity.hasChildren ? " w/ children" : ""})
          </span>
        </h3>
        <button type="button" className="close" onClick={onClose} title="Close (Esc)">×</button>
      </header>

      <details open>
        <summary>identity</summary>
        <dl>
          <dt>name</dt><dd>{report.identity.name}</dd>
          <dt>kind</dt><dd>{report.identity.kind}</dd>
          <dt>id (guid)</dt><dd>{report.identity.id || "—"}</dd>
          <dt>path</dt><dd>{report.identity.hierarchyPath}</dd>
          {report.identity.fontFamily
            ? <><dt>font family</dt><dd>{report.identity.fontFamily}{report.identity.fontLoaded === false ? <span style={{ color: "#d97706", marginLeft: 6 }}>(not loaded — using fallback)</span> : report.identity.fontLoaded === true ? <span style={{ color: "var(--muted)", marginLeft: 6 }}>(loaded)</span> : null}</dd></>
            : null}
        </dl>
      </details>

      <details open>
        <summary>transform</summary>
        <dl>
          <dt>local pos</dt><dd>{fmtVec3(report.transform.localPosition)}</dd>
          <dt>world pos</dt><dd>{fmtVec3(report.transform.worldPosition)}</dd>
          <dt>rotation°</dt><dd>{fmtVec3(report.transform.rotationDeg)}</dd>
          <dt>scale</dt><dd>{fmtVec3(report.transform.scale)}</dd>
          {report.transform.pivot ? <><dt>pivot</dt><dd>{fmtVec3(report.transform.pivot)}</dd></> : null}
          {report.transform.alignmentX ? <><dt>alignX</dt><dd>{report.transform.alignmentX}</dd></> : null}
          {report.transform.alignmentY ? <><dt>alignY</dt><dd>{report.transform.alignmentY}</dd></> : null}
        </dl>
      </details>

      <details open>
        <summary>geometry</summary>
        <dl>
          {report.geometry.currentSize ? (
            <><dt>size</dt><dd>{fmtVec2(report.geometry.currentSize)}</dd></>
          ) : null}
          <dt>bbox min</dt><dd>{fmtVec3(report.geometry.worldBounds.min)}</dd>
          <dt>bbox max</dt><dd>{fmtVec3(report.geometry.worldBounds.max)}</dd>
          <dt>bbox WxH</dt>
          <dd>{fmt(report.geometry.worldBounds.width)} × {fmt(report.geometry.worldBounds.height)}</dd>
          <dt>renderOrder</dt><dd>{report.geometry.renderOrder}</dd>
        </dl>
      </details>

      <details open>
        <summary>visibility</summary>
        <dl>
          {report.visibility.enable !== undefined
            ? <><dt>enable</dt><dd>{String(report.visibility.enable)}</dd></>
            : null}
          <dt>visible</dt><dd>{String(report.visibility.visible)}</dd>
          {report.visibility.alpha !== undefined
            ? <><dt>alpha (W3D)</dt><dd>{fmt(report.visibility.alpha, 3)}</dd></>
            : null}
          {report.visibility.opacity !== undefined
            ? <><dt>opacity</dt><dd>{fmt(report.visibility.opacity, 3)}</dd></>
            : null}
          {report.visibility.transparent !== undefined
            ? <><dt>transparent</dt><dd>{String(report.visibility.transparent)}</dd></>
            : null}
          <dt>hiddenReason</dt><dd>{report.visibility.hiddenReason ?? "—"}</dd>
        </dl>
      </details>

      <details open>
        <summary>mask</summary>
        <dl>
          {report.mask.isMask !== undefined
            ? <><dt>isMask</dt><dd>{String(report.mask.isMask)}</dd></>
            : null}
          {report.mask.isColoredMask !== undefined
            ? <><dt>isColoredMask</dt><dd>{String(report.mask.isColoredMask)}</dd></>
            : null}
          {report.mask.isInvertedMask !== undefined
            ? <><dt>isInvertedMask</dt><dd>{String(report.mask.isInvertedMask)}</dd></>
            : null}
          {report.mask.disableBinaryAlpha !== undefined
            ? <><dt>disableBinaryAlpha</dt><dd>{String(report.mask.disableBinaryAlpha)}</dd></>
            : null}
          <dt>own maskIds</dt>
          <dd>{report.mask.ownMaskIds.length === 0 ? "—" : report.mask.ownMaskIds.join("; ")}</dd>
          <dt>effective</dt>
          <dd>{report.mask.effectiveMaskIds.length === 0 ? "—" : report.mask.effectiveMaskIds.join("; ")}</dd>
        </dl>
      </details>

      {report.stencil ? (
        <details open>
          <summary>stencil</summary>
          <dl>
            <dt>stencilWrite</dt><dd>{String(report.stencil.stencilWrite)}</dd>
            <dt>stencilRef</dt><dd>{report.stencil.stencilRef} ({fmtBin(report.stencil.stencilRef)})</dd>
            <dt>writeMask</dt><dd>{report.stencil.stencilWriteMask} ({fmtBin(report.stencil.stencilWriteMask)})</dd>
            <dt>stencilFunc</dt><dd>{report.stencil.stencilFunc}</dd>
            <dt>funcMask</dt><dd>{report.stencil.stencilFuncMask} ({fmtBin(report.stencil.stencilFuncMask)})</dd>
            <dt>colorWrite</dt><dd>{String(report.stencil.colorWrite)}</dd>
            <dt>depthWrite</dt><dd>{String(report.stencil.depthWrite)}</dd>
            <dt>depthTest</dt><dd>{String(report.stencil.depthTest)}</dd>
          </dl>
        </details>
      ) : null}

      <details open>
        <summary>material / texture</summary>
        <dl>
          {report.material.materialId
            ? <><dt>materialId</dt><dd>{report.material.materialId}</dd></>
            : null}
          {report.material.materialName
            ? <><dt>material name</dt><dd>{report.material.materialName}</dd></>
            : null}
          {report.material.textureLayerId
            ? <><dt>layerId</dt><dd>{report.material.textureLayerId}</dd></>
            : null}
          {report.material.textureLayerName
            ? <><dt>layer name</dt><dd>{report.material.textureLayerName}</dd></>
            : null}
          {report.material.mapFilename
            ? <><dt>map file</dt><dd>{report.material.mapFilename}</dd></>
            : null}
          {report.material.alphaMapFilename
            ? <><dt>alphaMap file</dt><dd>{report.material.alphaMapFilename}</dd></>
            : null}
          {report.material.textureBlending
            ? <><dt>TextureBlending</dt><dd>{report.material.textureBlending} <span style={{ color: "var(--muted)" }}>(authored)</span></dd></>
            : null}
        </dl>
      </details>

      {(report.uv.mapOffset || report.uv.alphaMapOffset) ? (
        <details open>
          <summary>uv</summary>
          <dl>
            {report.uv.mapOffset
              ? <><dt>map offset</dt><dd>{fmtVec2(report.uv.mapOffset)}</dd></>
              : null}
            {report.uv.mapRepeat
              ? <><dt>map repeat</dt><dd>{fmtVec2(report.uv.mapRepeat)}</dd></>
              : null}
            {report.uv.mapRotationRad !== undefined
              ? <><dt>map rot°</dt><dd>{fmt((report.uv.mapRotationRad * 180) / Math.PI, 3)}</dd></>
              : null}
            {report.uv.mapWrapS !== undefined
              ? <><dt>wrapS/wrapT</dt><dd>{report.uv.mapWrapS} / {report.uv.mapWrapT}</dd></>
              : null}
            {report.uv.alphaMapOffset
              ? <><dt>α offset</dt><dd>{fmtVec2(report.uv.alphaMapOffset)}</dd></>
              : null}
            {report.uv.alphaMapRepeat
              ? <><dt>α repeat</dt><dd>{fmtVec2(report.uv.alphaMapRepeat)}</dd></>
              : null}
            {report.uv.alphaMapRotationRad !== undefined
              ? <><dt>α rot°</dt><dd>{fmt((report.uv.alphaMapRotationRad * 180) / Math.PI, 3)}</dd></>
              : null}
          </dl>
        </details>
      ) : null}

      <details open>
        <summary>flow</summary>
        <dl>
          <dt>flow parent</dt><dd>{report.flow.underFlowParent ?? "—"}</dd>
          {report.flow.slotIndex !== undefined
            ? <><dt>slot index</dt><dd>{report.flow.slotIndex}</dd></>
            : null}
          {report.flow.parentLeadingSpace !== undefined
            ? <><dt>LeadingSpace</dt><dd>{report.flow.parentLeadingSpace} <span style={{ color: "var(--muted)" }}>(authored)</span></dd></>
            : null}
          {report.flow.parentFlowDirection
            ? <><dt>Direction</dt><dd>{report.flow.parentFlowDirection}</dd></>
            : null}
          {report.flow.parentFlowAlignment
            ? <><dt>Alignment</dt><dd>{report.flow.parentFlowAlignment}</dd></>
            : null}
        </dl>
      </details>
    </aside>
  );
}
