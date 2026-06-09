import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentBlueprint } from "../../../src/editor/types";
import { analyzeW3dXml, type DocumentStats } from "./analyze";
import type { W3DNodeData, W3DQuadData } from "./nodes/data";
import { translateBlueprint } from "./translate";
import { createPlaygroundViewport, type PlaygroundViewport } from "./viewport";
import type { BuildContext } from "./nodes/builder";
import type { W3DResourceRegistry } from "./nodes/resources";
import { buildInspectorReport, type InspectorReport } from "./inspector";
import { buildFontDiagnostics, buildLoadedFontIndex, loadW3DFontFiles, type FontLoadResult } from "./fonts";
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
  fontLoadResults: FontLoadResult[];
  loadedFontIndex: Set<string>;
}

interface SelectedProject {
  files: File[];
  index: W3DProjectIndex;
}

type PanelTab = "tree" | "props" | "debug";
type RenderStats = { calls: number; triangles: number; geometries: number; textures: number };
type RenderOrderRow = { id: string; name: string; kind: string; renderOrder: number };

export function App() {
  const [project, setProject] = useState<SelectedProject | null>(null);
  const [loaded, setLoaded] = useState<LoadedScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("tree");
  const [inspectorReport, setInspectorReport] = useState<InspectorReport | null>(null);
  // Tree / inspect state (engine-style outliner).
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  // Debug controls (temporary dev tooling).
  const [stencilDebugShowMask, setStencilDebugShowMask] = useState(false);
  const [showBox, setShowBox] = useState(true);
  const [showPivot, setShowPivot] = useState(true);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceOpacity, setReferenceOpacity] = useState(0.45);
  const [renderStats, setRenderStats] = useState<RenderStats | null>(null);
  const [renderOrder, setRenderOrder] = useState<RenderOrderRow[]>([]);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<PlaygroundViewport | null>(null);
  const loadedRef = useRef<LoadedScene | null>(null);

  useEffect(() => {
    const host = viewportHostRef.current;
    if (!host) return;
    const vp = createPlaygroundViewport(host);
    viewportRef.current = vp;
    vp.setInspectorEnabled(true); // click-to-pick is always on in the outliner UI
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

  // Click-to-pick in the viewport → select + show Props.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.setInspectorCallback((event) => {
      if (event.phase === "click") {
        const report = buildInspectorReport(event.target, loaded?.resources);
        if (report) {
          setInspectorReport(report);
          setActiveTab("props");
        }
      } else {
        setInspectorReport(null);
      }
    });
    return () => vp.setInspectorCallback(null);
  }, [loaded]);

  // Marker visibility (box / pivot axes).
  useEffect(() => {
    viewportRef.current?.setMarkerVisibility({ box: showBox, pivot: showPivot });
  }, [showBox, showPivot, inspectorReport]);

  // Per-node eye toggles → viewport visibility.
  useEffect(() => {
    viewportRef.current?.setHiddenNodes(hiddenNodeIds);
  }, [hiddenNodeIds, loaded]);

  // Focus/isolate a node's subtree.
  useEffect(() => {
    viewportRef.current?.setFocus(focusNodeId);
  }, [focusNodeId, loaded]);

  // Debug tab: poll render stats + refresh the render-order list while open.
  useEffect(() => {
    if (activeTab !== "debug" || !loaded) return;
    const vp = viewportRef.current;
    if (!vp) return;
    setRenderOrder(vp.getRenderOrderList());
    const tick = () => setRenderStats(vp.getRenderStats());
    tick();
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, [activeTab, loaded]);

  // Esc clears selection + focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setInspectorReport(null);
      setFocusNodeId(null);
      viewportRef.current?.clearInspectorSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { loadedRef.current = loaded; }, [loaded]);
  useEffect(() => () => { cleanupLoadedScene(loadedRef.current); }, []);
  useEffect(() => () => { if (referenceImageUrl) URL.revokeObjectURL(referenceImageUrl); }, [referenceImageUrl]);

  const resetSceneUiState = useCallback(() => {
    setInspectorReport(null);
    setHiddenNodeIds(new Set());
    setFocusNodeId(null);
    setCollapsedIds(new Set());
    viewportRef.current?.clearInspectorSelection();
  }, []);

  const handleProjectFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    cleanupLoadedScene(loaded);
    resetSceneUiState();
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
  }, [loaded, resetSceneUiState]);

  const handleSceneSelect = useCallback(async (scene: W3DProjectScene) => {
    if (!project) return;
    cleanupLoadedScene(loaded);
    resetSceneUiState();
    setLoaded(null);
    await loadScene(project.files, scene, project.index, setLoaded, setError);
  }, [loaded, project, resetSceneUiState]);

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
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loaded]);

  const handleReferenceImage = useCallback((file: File | undefined) => {
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    setReferenceImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextUrl;
    });
  }, []);

  const clearReferenceImage = useCallback(() => {
    setReferenceImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const selectTreeNode = useCallback((node: W3DNodeData) => {
    const target = viewportRef.current?.selectW3DNode(node.id);
    const report = target ? buildInspectorReport(target, loaded?.resources) : null;
    setInspectorReport(report);
    setActiveTab("props");
  }, [loaded]);

  const toggleHide = useCallback((id: string) => {
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleFocus = useCallback((id: string) => {
    setFocusNodeId((prev) => (prev === id ? null : id));
  }, []);

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
      <input
        ref={referenceInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(event) => {
          handleReferenceImage(event.target.files?.[0]);
          event.currentTarget.value = "";
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
            <button className={activeTab === "tree" ? "is-active" : ""} onClick={() => setActiveTab("tree")}>Tree</button>
            <button className={activeTab === "props" ? "is-active" : ""} onClick={() => setActiveTab("props")}>Props</button>
            <button className={activeTab === "debug" ? "is-active" : ""} onClick={() => setActiveTab("debug")}>Debug</button>
          </div>
          <div className="playground__panel-body">
            {!loaded ? (
              <div className="playground__placeholder">
                {error ? <p className="playground__error">{error}</p> : null}
                <p>Pick an R3/W3D project folder, then choose a scene.</p>
              </div>
            ) : activeTab === "tree" ? (
              <NodeTreeView
                nodes={loaded.nodes}
                activeNodeId={inspectorReport?.identity.id ?? null}
                hiddenIds={hiddenNodeIds}
                focusId={focusNodeId}
                collapsedIds={collapsedIds}
                onSelect={selectTreeNode}
                onToggleHide={toggleHide}
                onToggleCollapse={toggleCollapse}
                onToggleFocus={toggleFocus}
              />
            ) : activeTab === "props" ? (
              <PropsView report={inspectorReport} />
            ) : (
              <DebugView
                showMask={stencilDebugShowMask}
                setShowMask={setStencilDebugShowMask}
                showPivot={showPivot}
                setShowPivot={setShowPivot}
                showBox={showBox}
                setShowBox={setShowBox}
                onPickReference={() => referenceInputRef.current?.click()}
                referenceImageUrl={referenceImageUrl}
                referenceOpacity={referenceOpacity}
                setReferenceOpacity={setReferenceOpacity}
                clearReference={clearReferenceImage}
                warnings={loaded.warnings}
                stats={renderStats}
                renderOrder={renderOrder}
                report={inspectorReport}
              />
            )}
          </div>
        </aside>

        <main className="playground__viewport">
          <div ref={viewportHostRef} className="playground__viewport-host" />
          {referenceImageUrl ? (
            <div className="playground__reference" style={{ opacity: referenceOpacity }}>
              <img src={referenceImageUrl} alt="" />
            </div>
          ) : null}
          {loaded ? (
            <div className="playground__viewport-meta">
              <span>{loaded.sceneFileName}</span>
              <span>{loaded.stats.totalElements} elements · max depth {loaded.stats.maxDepth}</span>
              <span>{loaded.movFiles} .mov · {loaded.rasterTextureFiles} textures · {loaded.fontLoadResults.filter((r) => r.registered).length}/{loaded.fontLoadResults.length} fonts</span>
              {focusNodeId ? <span style={{ color: "var(--accent)" }}>focus on · Esc to clear</span> : null}
            </div>
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

    const fontLoadResults = await loadW3DFontFiles(project.fontFiles);
    const loadedFontIndex = buildLoadedFontIndex(fontLoadResults);

    const registeredFamilies = fontLoadResults
      .filter((r) => r.registered && r.parsed)
      .map((r) => r.parsed!.family);
    const sceneFamilies = Array.from(translated.resources.fontStyles.values())
      .map((fs) => fs.fontName)
      .filter((n): n is string => !!n && n.trim().length > 0);
    const fontDiagnostics = buildFontDiagnostics({
      sceneFamilies,
      registeredFamilies,
      discoveredCount: project.fontFiles.length,
    });

    setLoaded({
      sceneFileName: scene.sceneFileName,
      xml,
      blueprint: translated.blueprint,
      nodes: translated.nodes,
      resources: translated.resources,
      textureUrlsByFilename,
      textureCache,
      warnings: [...translated.warnings, ...fontDiagnostics],
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
  if (!project) return null;
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

// ---------------------------------------------------------------------------
// Tree (engine-style outliner): per-row eye (show/hide), type icon, collapse,
// select, and focus/isolate.
// ---------------------------------------------------------------------------

function nodeIcon(node: W3DNodeData): { glyph: string; cls: string } {
  if (node.kind === "Group") return { glyph: "📁", cls: "group" };
  if (node.kind === "TextureText") return { glyph: "T", cls: "texturetext" };
  if (node.kind === "Quad") {
    return (node as W3DQuadData).isMask
      ? { glyph: "◫", cls: "mask" }
      : { glyph: "📷", cls: "quad" };
  }
  return { glyph: "•", cls: "quad" };
}

function NodeTreeView({
  nodes,
  activeNodeId,
  hiddenIds,
  focusId,
  collapsedIds,
  onSelect,
  onToggleHide,
  onToggleCollapse,
  onToggleFocus,
}: {
  nodes: W3DNodeData[];
  activeNodeId: string | null;
  hiddenIds: Set<string>;
  focusId: string | null;
  collapsedIds: Set<string>;
  onSelect: (node: W3DNodeData) => void;
  onToggleHide: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onToggleFocus: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleNodes = useMemo(() => filterNodeTree(nodes, normalizedQuery), [nodes, normalizedQuery]);
  const filtering = normalizedQuery.length > 0;

  return (
    <div className="playground__tree">
      <input
        type="search"
        placeholder="Filter nodes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ptree-list">
        {visibleNodes.map((node) => (
          <TreeRow
            key={node.id || node.name}
            node={node}
            depth={0}
            activeNodeId={activeNodeId}
            hiddenIds={hiddenIds}
            focusId={focusId}
            collapsedIds={collapsedIds}
            forceExpand={filtering}
            onSelect={onSelect}
            onToggleHide={onToggleHide}
            onToggleCollapse={onToggleCollapse}
            onToggleFocus={onToggleFocus}
          />
        ))}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  activeNodeId,
  hiddenIds,
  focusId,
  collapsedIds,
  forceExpand,
  onSelect,
  onToggleHide,
  onToggleCollapse,
  onToggleFocus,
}: {
  node: W3DNodeData;
  depth: number;
  activeNodeId: string | null;
  hiddenIds: Set<string>;
  focusId: string | null;
  collapsedIds: Set<string>;
  forceExpand: boolean;
  onSelect: (node: W3DNodeData) => void;
  onToggleHide: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onToggleFocus: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const collapsed = !forceExpand && collapsedIds.has(node.id);
  const hidden = hiddenIds.has(node.id);
  const icon = nodeIcon(node);
  const isActive = node.id === activeNodeId;
  const isFocus = node.id === focusId;

  return (
    <div className="ptree-item">
      <div
        className={`ptree-row${isActive ? " is-active" : ""}${isFocus ? " is-focus" : ""}${hidden ? " is-hidden" : ""}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          type="button"
          className="ptree-eye"
          title={hidden ? "Show" : "Hide"}
          onClick={() => onToggleHide(node.id)}
        >
          {hidden ? "🚫" : "👁"}
        </button>
        <button
          type="button"
          className="ptree-chev"
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
          onClick={() => hasChildren && onToggleCollapse(node.id)}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className={`ptree-icon kind--${icon.cls}`} title={node.kind}>{icon.glyph}</span>
        <button type="button" className="ptree-name" onClick={() => onSelect(node)} title={nodePathTitle(node)}>
          <span className="name">{node.name || "(unnamed)"}</span>
          {node.kind === "TextureText" ? <span className="text">{node.text}</span> : null}
        </button>
        <button
          type="button"
          className={`ptree-focus${isFocus ? " on" : ""}`}
          title={isFocus ? "Clear focus" : "Focus / isolate"}
          onClick={() => onToggleFocus(node.id)}
        >
          ⌖
        </button>
      </div>
      {hasChildren && !collapsed
        ? node.children.map((child) => (
            <TreeRow
              key={child.id || child.name}
              node={child}
              depth={depth + 1}
              activeNodeId={activeNodeId}
              hiddenIds={hiddenIds}
              focusId={focusId}
              collapsedIds={collapsedIds}
              forceExpand={forceExpand}
              onSelect={onSelect}
              onToggleHide={onToggleHide}
              onToggleCollapse={onToggleCollapse}
              onToggleFocus={onToggleFocus}
            />
          ))
        : null}
    </div>
  );
}

function filterNodeTree(nodes: W3DNodeData[], query: string): W3DNodeData[] {
  if (!query) return nodes;
  const out: W3DNodeData[] = [];
  for (const node of nodes) {
    const children = filterNodeTree(node.children, query);
    if (nodeMatchesQuery(node, query) || children.length > 0) {
      out.push({ ...node, children } as W3DNodeData);
    }
  }
  return out;
}

function nodeMatchesQuery(node: W3DNodeData, query: string): boolean {
  const haystack = [node.kind, node.name, node.id, "text" in node ? node.text : ""].join(" ").toLowerCase();
  return haystack.includes(query);
}

function nodePathTitle(node: W3DNodeData): string {
  if (node.kind === "Quad") {
    return `${node.name} | ${node.kind} | size ${fmtVec2(node.geometry.size)} | pos ${fmtVec3(node.transform.position)}`;
  }
  if (node.kind === "TextureText") {
    return `${node.name} | ${node.kind} | "${node.text}" | box ${fmtVec2(node.textBox)} | pos ${fmtVec3(node.transform.position)}`;
  }
  return `${node.name} | ${node.kind} | pos ${fmtVec3(node.transform.position)}`;
}

// ---------------------------------------------------------------------------
// Props tab — docked inspector report (was the floating panel).
// ---------------------------------------------------------------------------

function PropsView({ report }: { report: InspectorReport | null }) {
  if (!report) {
    return <div className="playground__placeholder">Select a node in the Tree or the viewport.</div>;
  }
  return (
    <div className="playground__props">
      <h3>
        {report.identity.name}
        <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
          ({report.identity.kind}{report.identity.hasChildren ? " w/ children" : ""})
        </span>
      </h3>

      <details open>
        <summary>identity</summary>
        <dl>
          <dt>name</dt><dd>{report.identity.name}</dd>
          <dt>kind</dt><dd>{report.identity.kind}</dd>
          <dt>id (guid)</dt><dd>{report.identity.id || "—"}</dd>
          <dt>path</dt><dd>{report.identity.hierarchyPath}</dd>
          {report.identity.fontFamily
            ? <><dt>font family</dt><dd>{report.identity.fontFamily}{report.identity.fontLoaded === false ? <span style={{ color: "#d97706", marginLeft: 6 }}>(not loaded — fallback)</span> : report.identity.fontLoaded === true ? <span style={{ color: "var(--muted)", marginLeft: 6 }}>(loaded)</span> : null}</dd></>
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
          {report.transform.verticalMode ? <><dt>anchor Y</dt><dd>{report.transform.verticalMode}</dd></> : null}
        </dl>
      </details>

      <details open>
        <summary>geometry</summary>
        <dl>
          {report.geometry.currentSize ? <><dt>size</dt><dd>{fmtVec2(report.geometry.currentSize)}</dd></> : null}
          <dt>bbox min</dt><dd>{fmtVec3(report.geometry.worldBounds.min)}</dd>
          <dt>bbox max</dt><dd>{fmtVec3(report.geometry.worldBounds.max)}</dd>
          <dt>bbox WxH</dt><dd>{fmt(report.geometry.worldBounds.width)} × {fmt(report.geometry.worldBounds.height)}</dd>
          <dt>renderOrder</dt><dd>{report.geometry.renderOrder}</dd>
        </dl>
      </details>

      <details open>
        <summary>visibility</summary>
        <dl>
          {report.visibility.enable !== undefined ? <><dt>enable</dt><dd>{String(report.visibility.enable)}</dd></> : null}
          <dt>visible</dt><dd>{String(report.visibility.visible)}</dd>
          {report.visibility.alpha !== undefined ? <><dt>alpha (W3D)</dt><dd>{fmt(report.visibility.alpha, 3)}</dd></> : null}
          {report.visibility.opacity !== undefined ? <><dt>opacity</dt><dd>{fmt(report.visibility.opacity, 3)}</dd></> : null}
          {report.visibility.transparent !== undefined ? <><dt>transparent</dt><dd>{String(report.visibility.transparent)}</dd></> : null}
          <dt>hiddenReason</dt><dd>{report.visibility.hiddenReason ?? "—"}</dd>
        </dl>
      </details>

      <details open>
        <summary>mask</summary>
        <dl>
          {report.mask.isMask !== undefined ? <><dt>isMask</dt><dd>{String(report.mask.isMask)}</dd></> : null}
          {report.mask.isColoredMask !== undefined ? <><dt>isColoredMask</dt><dd>{String(report.mask.isColoredMask)}</dd></> : null}
          {report.mask.isInvertedMask !== undefined ? <><dt>isInvertedMask</dt><dd>{String(report.mask.isInvertedMask)}</dd></> : null}
          {report.mask.disableBinaryAlpha !== undefined ? <><dt>disableBinaryAlpha</dt><dd>{String(report.mask.disableBinaryAlpha)}</dd></> : null}
          <dt>own maskIds</dt><dd>{report.mask.ownMaskIds.length === 0 ? "—" : report.mask.ownMaskIds.join("; ")}</dd>
          <dt>effective</dt><dd>{report.mask.effectiveMaskIds.length === 0 ? "—" : report.mask.effectiveMaskIds.join("; ")}</dd>
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
          {report.material.materialId ? <><dt>materialId</dt><dd>{report.material.materialId}</dd></> : null}
          {report.material.materialName ? <><dt>material name</dt><dd>{report.material.materialName}</dd></> : null}
          {report.material.textureLayerId ? <><dt>layerId</dt><dd>{report.material.textureLayerId}</dd></> : null}
          {report.material.textureLayerName ? <><dt>layer name</dt><dd>{report.material.textureLayerName}</dd></> : null}
          {report.material.mapFilename ? <><dt>map file</dt><dd>{report.material.mapFilename}</dd></> : null}
          {report.material.alphaMapFilename ? <><dt>alphaMap file</dt><dd>{report.material.alphaMapFilename}</dd></> : null}
          {report.material.textureBlending ? <><dt>TextureBlending</dt><dd>{report.material.textureBlending} <span style={{ color: "var(--muted)" }}>(authored)</span></dd></> : null}
        </dl>
      </details>

      <details open>
        <summary>flow</summary>
        <dl>
          <dt>flow parent</dt><dd>{report.flow.underFlowParent ?? "—"}</dd>
          {report.flow.slotIndex !== undefined ? <><dt>slot index</dt><dd>{report.flow.slotIndex}</dd></> : null}
          {report.flow.parentLeadingSpace !== undefined ? <><dt>LeadingSpace</dt><dd>{report.flow.parentLeadingSpace} <span style={{ color: "var(--muted)" }}>(authored)</span></dd></> : null}
          {report.flow.parentFlowDirection ? <><dt>Direction</dt><dd>{report.flow.parentFlowDirection}</dd></> : null}
          {report.flow.parentFlowAlignment ? <><dt>Alignment</dt><dd>{report.flow.parentFlowAlignment}</dd></> : null}
        </dl>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debug tab — temporary dev tooling (consolidated controls, perf, render order,
// stencil of the selected node).
// ---------------------------------------------------------------------------

function DebugView({
  showMask, setShowMask,
  showPivot, setShowPivot,
  showBox, setShowBox,
  onPickReference, referenceImageUrl, referenceOpacity, setReferenceOpacity, clearReference,
  warnings, stats, renderOrder, report,
}: {
  showMask: boolean; setShowMask: (v: boolean) => void;
  showPivot: boolean; setShowPivot: (v: boolean) => void;
  showBox: boolean; setShowBox: (v: boolean) => void;
  onPickReference: () => void;
  referenceImageUrl: string | null;
  referenceOpacity: number;
  setReferenceOpacity: (v: number) => void;
  clearReference: () => void;
  warnings: string[];
  stats: RenderStats | null;
  renderOrder: RenderOrderRow[];
  report: InspectorReport | null;
}) {
  return (
    <div className="playground__debug">
      <section>
        <h4>Controls</h4>
        <label><input type="checkbox" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} /> show mask (red)</label>
        <label><input type="checkbox" checked={showPivot} onChange={(e) => setShowPivot(e.target.checked)} /> pivot axes</label>
        <label><input type="checkbox" checked={showBox} onChange={(e) => setShowBox(e.target.checked)} /> bounding box</label>
        <div className="debug-ref">
          <button type="button" onClick={onPickReference}>Reference image…</button>
          {referenceImageUrl ? (
            <>
              <label className="debug-range">opacity
                <input type="range" min="0" max="1" step="0.05" value={referenceOpacity} onChange={(e) => setReferenceOpacity(Number(e.target.value))} />
              </label>
              <button type="button" onClick={clearReference}>clear</button>
            </>
          ) : null}
        </div>
      </section>

      <section>
        <h4>Performance</h4>
        {stats ? (
          <dl className="debug-stats">
            <dt>draw calls</dt><dd>{stats.calls}</dd>
            <dt>triangles</dt><dd>{stats.triangles.toLocaleString()}</dd>
            <dt>geometries</dt><dd>{stats.geometries}</dd>
            <dt>textures</dt><dd>{stats.textures}</dd>
          </dl>
        ) : <p className="playground__placeholder">—</p>}
      </section>

      <section>
        <h4>Render order ({renderOrder.length})</h4>
        <div className="debug-order">
          {renderOrder.map((r) => (
            <div key={r.id} className="debug-order-row">
              <span className={`ord ${r.id === report?.identity.id ? "hit" : ""}`}>{r.renderOrder}</span>
              <span className="nm">{r.name}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4>Stencil (selected)</h4>
        {report?.stencil ? (
          <dl className="debug-stats">
            <dt>ref</dt><dd>{report.stencil.stencilRef} ({fmtBin(report.stencil.stencilRef)})</dd>
            <dt>writeMask</dt><dd>{fmtBin(report.stencil.stencilWriteMask)}</dd>
            <dt>func</dt><dd>{report.stencil.stencilFunc}</dd>
            <dt>funcMask</dt><dd>{fmtBin(report.stencil.stencilFuncMask)}</dd>
            <dt>colorWrite</dt><dd>{String(report.stencil.colorWrite)}</dd>
          </dl>
        ) : <p className="playground__placeholder">Select a node with stencil.</p>}
      </section>

      {warnings.length > 0 ? (
        <section>
          <h4>Warnings ({warnings.length})</h4>
          <ul className="debug-warnings">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers.
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
