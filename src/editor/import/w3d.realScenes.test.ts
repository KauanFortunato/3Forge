import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { afterAll, describe, it } from "vitest";
import { parseW3D } from "./w3d";
import type { ImageAsset } from "../types";

/**
 * End-to-end smoke against real .w3d scenes from the user's R3 projects folder.
 *
 * The root is resolved in this order:
 *   1. `process.env.R3_PROJECTS_ROOT` if defined.
 *   2. Hard-coded fallback `C:\Users\diogo.esteves\Documents\R3.Space.Projects\Projects`.
 *
 * Scenes are auto-discovered: every immediate subdirectory of the root that
 * contains a `scene.w3d` is imported, except for `__Trash` and `teste` which
 * are known duplicates/garbage. When the root does not exist or is empty, a
 * single visible warning test is emitted instead of being silently skipped.
 *
 * On the dev box it logs a summary so we can eyeball the import behaviour.
 */
const EXCLUDED_DIRS = new Set(["__Trash", "teste"]);

const projectsRoot =
  process.env.R3_PROJECTS_ROOT ??
  "C:\\Users\\diogo.esteves\\Documents\\R3.Space.Projects\\Projects";

function discoverScenes(root: string): string[] {
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const subdir = `${root}/${entry}`;
    let isDir = false;
    try {
      isDir = statSync(subdir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const scenePath = `${subdir}/scene.w3d`;
    if (existsSync(scenePath)) found.push(entry);
  }
  found.sort();
  return found;
}

const sceneNames = discoverScenes(projectsRoot);

describe("real W3D scenes smoke", () => {
  let importedCount = 0;
  let totalWarningsCount = 0;

  if (sceneNames.length === 0) {
    it(`warns: no R3 projects found at ${projectsRoot}`, () => {
      // eslint-disable-next-line no-console
      console.warn(
        `\n[smoke] No R3 .w3d projects discovered.` +
          `\n  Tried root: ${projectsRoot}` +
          `\n  Override with the R3_PROJECTS_ROOT environment variable.` +
          `\n  Skipping smoke test (no fixtures available on this machine).`,
      );
    });
  } else {
    for (const name of sceneNames) {
      const path = `${projectsRoot}/${name}/scene.w3d`;
      const texturesDir = `${projectsRoot}/${name}/Resources/Textures`;
      const meshesDir = `${projectsRoot}/${name}/Resources/Meshes`;
      it(`imports ${name} and reports a sensible summary`, () => {
        const xml = readFileSync(path, "utf8");
        // Simulate folder import by passing the texture filenames available on
        // disk + the mesh GUIDs — that's the path the UI takes via
        // parseW3DFromFolder. Without this the parser only sees the XML and
        // emits "Scene references X textures — re-import via folder".
        const textures = new Map<string, ImageAsset>();
        if (existsSync(texturesDir)) {
          for (const file of readdirSync(texturesDir)) {
            textures.set(file, {
              name: file,
              mimeType: file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
              src: `file://${texturesDir}/${file}`,
              width: 0,
              height: 0,
            });
          }
        }
        const meshAssets = new Set<string>();
        if (existsSync(meshesDir)) {
          for (const file of readdirSync(meshesDir)) {
            if (file.endsWith(".vert")) meshAssets.add(file.slice(0, -5).toLowerCase());
          }
        }
        const result = parseW3D(xml, { sceneName: name, textures, meshAssets });
        const bp = result.blueprint;
        const counts = bp.nodes.reduce<Record<string, number>>((acc, n) => {
          acc[n.type] = (acc[n.type] ?? 0) + 1;
          return acc;
        }, {});
        const totalKfs = bp.animation.clips.reduce(
          (sum, c) => sum + c.tracks.reduce((s, t) => s + t.keyframes.length, 0),
          0,
        );
        const cam = bp.engine?.camera;
        const camStr = cam
          ? `${cam.mode} fovY=${cam.fovY ?? "n/a"} pos=${cam.position ? `(${cam.position.x},${cam.position.y},${cam.position.z})` : "n/a"}`
          : "(none)";
        const w3d = bp.metadata?.w3d as { initialDisabledNodeIds?: string[] } | undefined;
        const designViewPromoted = w3d?.initialDisabledNodeIds?.length ?? 0;
        const bgStr = bp.engine?.background?.type === "color"
          ? bp.engine.background.color
          : bp.engine?.background?.type === "transparent"
            ? "transparent"
            : "(none)";
        importedCount += 1;
        totalWarningsCount += result.warnings.length;
        // eslint-disable-next-line no-console
        console.log(
          `\n[${name}] sceneMode=${bp.sceneMode} bg=${bgStr} cam=${camStr}` +
          `\n  nodes=${bp.nodes.length} byType=${JSON.stringify(counts)}` +
          `\n  designView: ${designViewPromoted} nodes promoted from Enable=False to visible` +
          `\n  clips=${bp.animation.clips.length} kfs=${totalKfs}` +
          `\n  warnings(${result.warnings.length}):\n    - ${result.warnings.join("\n    - ")}`,
        );
      });
    }
  }

  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(
      `\n[smoke] root=${projectsRoot} projects=${sceneNames.length} imported=${importedCount} totalWarnings=${totalWarningsCount}`,
    );
  });
});
