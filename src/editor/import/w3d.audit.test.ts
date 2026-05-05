import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, it } from "vitest";
import { parseW3D } from "./w3d";
import { inferVideoMimeType, isVideoFileName } from "../images";
import type { ImageAsset, EditorNode } from "../types";

/**
 * Visual-fidelity audit. OPT-IN — runs only when `R3_AUDIT=1` is set, so it
 * never adds noise to the regular test run.
 *
 *   R3_AUDIT=1 R3_PROJECTS_ROOT="C:/path/to/Projects" npx vitest run \
 *     src/editor/import/w3d.audit.test.ts --reporter=verbose
 *
 * Emits a JSON-ish summary per scene capturing:
 *   - node-type counts
 *   - image vs video image-node split
 *   - missing textures + mesh placeholders + design-view promotions
 *   - opacity histogram (zero / partial / full)
 *   - Z-coordinate distribution (min/max/distinct count) per type
 *   - mask coverage (isMask, single + multi maskIds, inverted)
 *   - animated tracks per material.* path
 *   - top warnings
 */

const EXCLUDED_DIRS = new Set(["__Trash", "teste"]);

const projectsRoot =
  process.env.R3_PROJECTS_ROOT ??
  "C:\\Users\\diogo.esteves\\Documents\\R3.Space.Projects\\Projects";
const auditEnabled = process.env.R3_AUDIT === "1";

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
    if (existsSync(`${subdir}/scene.w3d`)) found.push(entry);
  }
  found.sort();
  return found;
}

function bucketOpacity(node: EditorNode): "zero" | "partial" | "full" {
  if (node.type === "group") return "full";
  const op = node.material.opacity;
  if (op <= 0.001) return "zero";
  if (op >= 0.999) return "full";
  return "partial";
}

function distinct<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

describe("real W3D scenes audit (opt-in)", () => {
  const scenes = discoverScenes(projectsRoot);
  const itFn = auditEnabled && scenes.length > 0 ? it : it.skip;

  itFn("emits a per-scene fidelity dump", () => {
    for (const name of scenes) {
      const path = `${projectsRoot}/${name}/scene.w3d`;
      const texturesDir = `${projectsRoot}/${name}/Resources/Textures`;
      const meshesDir = `${projectsRoot}/${name}/Resources/Meshes`;
      const xml = readFileSync(path, "utf8");

      const textures = new Map<string, ImageAsset>();
      const videoFilenames = new Set<string>();
      if (existsSync(texturesDir)) {
        for (const file of readdirSync(texturesDir)) {
          const isVideo = isVideoFileName(file);
          const lower = file.toLowerCase();
          textures.set(file, {
            name: file,
            mimeType: isVideo
              ? inferVideoMimeType(file)
              : lower.endsWith(".png")
                ? "image/png"
                : lower.endsWith(".webp")
                  ? "image/webp"
                  : "image/jpeg",
            src: `file://${texturesDir}/${file}`,
            width: 0,
            height: 0,
          });
          if (isVideo) videoFilenames.add(file);
        }
      }
      const meshAssets = new Set<string>();
      if (existsSync(meshesDir)) {
        for (const file of readdirSync(meshesDir)) {
          if (file.endsWith(".vert")) meshAssets.add(file.slice(0, -5).toLowerCase());
        }
      }

      const result = parseW3D(xml, { sceneName: name, textures, videos: videoFilenames, meshAssets });
      const bp = result.blueprint;
      const w3d = bp.metadata?.w3d as
        | {
            missingTextureNodeIds?: string[];
            meshPlaceholderNodeIds?: string[];
            initialDisabledNodeIds?: string[];
          }
        | undefined;

      // Counts ------------------------------------------------------------
      const byType: Record<string, number> = {};
      for (const n of bp.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;

      const imageNodes = bp.nodes.filter((n) => n.type === "image");
      const videoImageNodes = imageNodes.filter(
        (n) => n.type === "image" && n.image.mimeType.startsWith("video/"),
      );
      const stillImageNodes = imageNodes.filter(
        (n) => n.type === "image" && !n.image.mimeType.startsWith("video/"),
      );

      // Asset resolution --------------------------------------------------
      const missingTextureCount = w3d?.missingTextureNodeIds?.length ?? 0;
      const meshPlaceholderCount = w3d?.meshPlaceholderNodeIds?.length ?? 0;
      const designViewPromoted = w3d?.initialDisabledNodeIds?.length ?? 0;

      // Visibility / opacity ---------------------------------------------
      const visibilityCount = {
        visibleTrue: bp.nodes.filter((n) => n.visible).length,
        visibleFalse: bp.nodes.filter((n) => !n.visible).length,
      };
      const opacityBuckets = { zero: 0, partial: 0, full: 0, na: 0 };
      for (const n of bp.nodes) {
        if (n.type === "group") opacityBuckets.na += 1;
        else opacityBuckets[bucketOpacity(n)] += 1;
      }

      // Z distribution per type -----------------------------------------
      const zPerType: Record<string, { min: number; max: number; distinct: number }> = {};
      for (const n of bp.nodes) {
        const z = n.transform.position.z;
        const slot = zPerType[n.type] ?? { min: Infinity, max: -Infinity, distinct: 0 };
        slot.min = Math.min(slot.min, z);
        slot.max = Math.max(slot.max, z);
        zPerType[n.type] = slot;
      }
      for (const t of Object.keys(zPerType)) {
        const zs = bp.nodes.filter((n) => n.type === t).map((n) => +n.transform.position.z.toFixed(4));
        zPerType[t].distinct = distinct(zs).length;
      }

      // Masks ------------------------------------------------------------
      const masksOwn = bp.nodes.filter((n) => n.isMask).length;
      const masksUsedSingle = bp.nodes.filter((n) => n.maskId && (!n.maskIds || n.maskIds.length === 0)).length;
      const masksUsedMulti = bp.nodes.filter((n) => n.maskIds && n.maskIds.length > 0).length;
      const masksInverted = bp.nodes.filter((n) => n.maskInverted).length;

      // Animation summary ------------------------------------------------
      const allTracks = bp.animation.clips.flatMap((c) => c.tracks);
      const tracksByProp: Record<string, number> = {};
      for (const t of allTracks) tracksByProp[t.property] = (tracksByProp[t.property] ?? 0) + 1;

      const dump = {
        scene: name,
        sceneMode: bp.sceneMode,
        cam: bp.engine?.camera ? {
          mode: bp.engine.camera.mode,
          fovY: bp.engine.camera.fovY ?? null,
          pos: bp.engine.camera.position ?? null,
        } : null,
        bg: bp.engine?.background?.type ?? null,
        nodeCount: bp.nodes.length,
        byType,
        imageNodes: { total: imageNodes.length, video: videoImageNodes.length, still: stillImageNodes.length },
        assets: {
          texturesOnDisk: textures.size,
          videosOnDisk: videoFilenames.size,
          meshesOnDisk: meshAssets.size,
          missingTextureNodeCount: missingTextureCount,
          meshPlaceholderNodeCount: meshPlaceholderCount,
        },
        visibility: visibilityCount,
        opacity: opacityBuckets,
        designViewPromoted,
        zPerType,
        masks: {
          declared: masksOwn,
          consumersSingle: masksUsedSingle,
          consumersMulti: masksUsedMulti,
          inverted: masksInverted,
        },
        animation: {
          clipCount: bp.animation.clips.length,
          totalTracks: allTracks.length,
          totalKeyframes: allTracks.reduce((s, t) => s + t.keyframes.length, 0),
          tracksByProp,
        },
        warningCount: result.warnings.length,
        warnings: result.warnings,
      };

      // eslint-disable-next-line no-console
      console.log(`\n===== AUDIT [${name}] =====\n${JSON.stringify(dump, null, 2)}`);
    }
  });
});
