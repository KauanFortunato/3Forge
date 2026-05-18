import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseW3DFromFolder } from "../../../src/editor/import/w3dFolder";
import type { ComponentBlueprint } from "../../../src/editor/types";
import { analyzeW3dXml, type DocumentStats } from "./analyze";
import { dumpNodes, type DumpRow } from "./nodes/diagnostics";
import type { W3DNodeData } from "./nodes/data";
import { translateBlueprint } from "./translate";
import { createPlaygroundViewport, type PlaygroundViewport } from "./viewport";
import type { BuildContext } from "./nodes/builder";
import type { W3DResourceRegistry } from "./nodes/resources";
import type { Texture } from "three";

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
}

export function App() {
  const [loaded, setLoaded] = useState<LoadedScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<"stats" | "xml" | "blueprint" | "quads">("stats");
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<PlaygroundViewport | null>(null);

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
      };
      viewportRef.current.setBlueprint(loaded.blueprint);
      viewportRef.current.setNodes(loaded.nodes, ctx);
    }
  }, [loaded]);

  useEffect(() => {
    return () => {
      if (loaded) {
        for (const url of loaded.textureUrlsByFilename.values()) URL.revokeObjectURL(url);
        for (const tex of loaded.textureCache.values()) tex.dispose();
      }
    };
  }, [loaded]);

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    // Revoke previous blob URLs and dispose textures to avoid memory leaks
    if (loaded) {
      for (const url of loaded.textureUrlsByFilename.values()) URL.revokeObjectURL(url);
      for (const tex of loaded.textureCache.values()) tex.dispose();
    }
    setError(null);
    try {
      const folder = await parseW3DFromFolder(files);
      const sceneFile = files.find((f) => relPath(f).endsWith(folder.sceneFileName));
      const xml = sceneFile ? await sceneFile.text() : "";
      const stats = analyzeW3dXml(xml);
      const translated = translateBlueprint(xml);
      // Build blob URL map from the raster texture files provided by the folder picker
      const textureUrlsByFilename = new Map<string, string>();
      for (const f of folder.rasterTextureFiles) {
        textureUrlsByFilename.set(f.name, URL.createObjectURL(f));
      }
      setLoaded({
        sceneFileName: folder.sceneFileName,
        xml,
        blueprint: translated.blueprint,
        nodes: translated.nodes,
        resources: translated.resources,
        textureUrlsByFilename,
        textureCache: new Map(),
        warnings: [...folder.warnings, ...translated.warnings],
        stats,
        movFiles: folder.movFiles.length,
        rasterTextureFiles: folder.rasterTextureFiles.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loaded]);

  const reTranslate = useCallback(() => {
    if (!loaded) return;
    try {
      const translated = translateBlueprint(loaded.xml);
      setLoaded({
        ...loaded,
        blueprint: translated.blueprint,
        nodes: translated.nodes,
        resources: translated.resources,
        warnings: translated.warnings,
        // Preserve existing textureUrlsByFilename and textureCache — do not revoke/recreate
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
            Open W3D folder…
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
          await handleFiles(files);
        }}
      />

      <div className="playground__body">
        <aside className="playground__panel">
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
                <p>Pick a W3D folder containing <code>scene.w3d</code> to begin.</p>
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
              <span>{loaded.movFiles} .mov · {loaded.rasterTextureFiles} textures</span>
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
        </main>
      </div>
    </div>
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

function relPath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath?.length ? withPath.webkitRelativePath : file.name;
}

function QuadsView({ loaded }: { loaded: LoadedScene }) {
  const rows: DumpRow[] = dumpNodes(loaded.nodes, loaded.resources);
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
