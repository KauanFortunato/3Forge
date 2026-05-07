import { imageFileToAsset, isVideoFileName, videoFileToAsset } from "../images";
import type { ComponentBlueprint, ImageAsset, ImageSequenceMetadata } from "../types";
import { parseW3D } from "./w3d";

export interface W3DFolderImportResult {
  blueprint: ComponentBlueprint;
  warnings: string[];
  /** scene file we used. */
  sceneFileName: string;
}

const RASTER_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".svg"];
const VIDEO_EXTENSIONS = [".mov", ".mp4", ".webm"];

export interface W3DFolderProgress {
  /** Called with a human-readable status string at each stage. */
  onProgress?: (label: string) => void;
}

export async function parseW3DFromFolder(
  files: FileList | File[],
  progress: W3DFolderProgress = {},
): Promise<W3DFolderImportResult> {
  const report = (label: string) => progress.onProgress?.(label);
  const list = Array.from(files);

  let sceneFile: File | null = null;
  let sceneFileFallback: File | null = null;
  let lockPresent = false;
  const textureFiles: File[] = [];
  const videoFilenames = new Set<string>();
  // Map of mesh resource GUID (lowercase, no extension) → vert/ind file pair.
  // We don't yet load the buffers, but indexing them lets the parser emit
  // accurate "asset present, loader missing" warnings instead of silently
  // dropping every <Mesh>.
  const meshAssets = new Map<string, { vert?: File; ind?: File }>();
  // Sibling PNG-sequence outputs of `<basename>.mov` files, indexed by stem
  // (e.g. "PITCH_IN" → sequence.json file + frame_*.png files). Resolved
  // below after we know which .mov files the scene references.
  const sequenceFiles = new Map<string, File>();
  const sequenceFrames = new Map<string, Map<string, File>>();

  for (const file of list) {
    const relPath = relativePath(file);
    const lower = relPath.toLowerCase();
    const baseName = baseNameOf(relPath);
    const ext = extensionOf(baseName);

    if (baseName.toLowerCase() === "scene.lock") {
      lockPresent = true;
      continue;
    }

    if (baseName.toLowerCase() === "scene.w3d" && depthOf(relPath) <= 1) {
      sceneFile = file;
      continue;
    }
    if (ext === ".w3d") {
      // Legacy duplicate (e.g. scene_3.5.2.w3d) — only used if scene.w3d absent.
      sceneFileFallback = file;
      continue;
    }

    if (lower.includes("/resources/textures/")) {
      if (RASTER_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext)) {
        textureFiles.push(file);
      }
      if (VIDEO_EXTENSIONS.includes(ext)) {
        videoFilenames.add(baseName);
      }
      // Capture the converted-PNG-sequence siblings of any .mov:
      //   Resources/Textures/<stem>_frames/sequence.json
      //   Resources/Textures/<stem>_frames/frame_NNNNNN.png
      const sequenceMatch = relPath
        .replace(/\\/g, "/")
        .match(/Resources\/Textures\/([^/]+)_frames\/(.+)$/i);
      if (sequenceMatch) {
        const stem = sequenceMatch[1];
        const tail = sequenceMatch[2];
        if (tail.toLowerCase() === "sequence.json") {
          sequenceFiles.set(stem, file);
        } else if (/^frame_\d+\.png$/i.test(tail)) {
          const inner = sequenceFrames.get(stem) ?? new Map<string, File>();
          inner.set(tail, file);
          sequenceFrames.set(stem, inner);
        }
      }
    }

    if (lower.includes("/resources/meshes/") && (ext === ".vert" || ext === ".ind")) {
      const guid = baseName.slice(0, -ext.length).toLowerCase();
      const entry = meshAssets.get(guid) ?? {};
      if (ext === ".vert") entry.vert = file;
      else entry.ind = file;
      meshAssets.set(guid, entry);
    }
  }

  const chosenScene = sceneFile ?? sceneFileFallback;
  if (!chosenScene) {
    const sample = list.slice(0, 8).map((f) => relativePath(f)).join(", ");
    throw new Error(
      `No .w3d scene file found in the selected folder (saw ${list.length} files: ${sample}${list.length > 8 ? ", …" : ""}). Make sure to pick the folder that directly contains scene.w3d.`,
    );
  }
  // Only count meshes with at least the .vert buffer present — an .ind by
  // itself isn't usable.
  const completeMeshGuids = new Set(
    Array.from(meshAssets.entries())
      .filter(([, pair]) => Boolean(pair.vert))
      .map(([guid]) => guid),
  );
  // eslint-disable-next-line no-console
  console.info(
    `[w3d folder import] scene=${relativePath(chosenScene)} textures=${textureFiles.length} videos=${videoFilenames.size} meshes=${completeMeshGuids.size} lock=${lockPresent}`,
  );

  report(`Reading ${chosenScene.name}…`);
  const xmlText = await chosenScene.text();

  const textures = new Map<string, ImageAsset>();
  if (textureFiles.length > 0) {
    report(`Loading textures (0/${textureFiles.length})…`);
  }
  for (let i = 0; i < textureFiles.length; i += 1) {
    const file = textureFiles[i];
    try {
      const asset = isVideoFileName(file.name)
        ? await videoFileToAsset(file)
        : await imageFileToAsset(file);
      textures.set(file.name, asset);
    } catch {
      // Skip unreadable textures; parser will emit "missing" warning if referenced.
    }
    if (textureFiles.length > 0 && (i + 1) % 4 === 0) {
      report(`Loading textures (${i + 1}/${textureFiles.length})…`);
    }
  }
  if (textureFiles.length > 0) {
    report(`Loaded ${textures.size}/${textureFiles.length} textures`);
  }

  const sceneNameFromFolder = topLevelFolder(chosenScene) ?? stripExtension(chosenScene.name);

  // Resolve every <stem>_frames/sequence.json into an in-memory
  // `ImageSequenceMetadata` keyed by the source .mov filename. Each frame
  // becomes a session-scoped blob URL — the renderer will swap them onto
  // the texture in playback order. Any failure (parse error, missing
  // framePattern/frameCount, frame-count mismatch on disk) is logged as a
  // warning and the .mov falls back through the existing video path so we
  // never drop the asset entirely (Task 1 invariant).
  const sequenceWarnings: string[] = [];
  const sequences = new Map<string, ImageSequenceMetadata>();
  for (const [stem, jsonFile] of sequenceFiles) {
    const sourceMov = `${stem}.mov`;
    let parsed: Partial<ImageSequenceMetadata> | null = null;
    try {
      const text = await jsonFile.text();
      parsed = JSON.parse(text);
    } catch {
      sequenceWarnings.push(
        `sequence.json for ${stem} is invalid (parse error) — falling back to .mov.`,
      );
      continue;
    }
    if (!parsed?.framePattern || typeof parsed.frameCount !== "number") {
      sequenceWarnings.push(
        `sequence.json for ${stem} is invalid (missing framePattern/frameCount) — falling back to .mov.`,
      );
      continue;
    }
    const frames = sequenceFrames.get(stem) ?? new Map<string, File>();
    const frameUrls: string[] = [];
    let missing = false;
    for (let i = 1; i <= parsed.frameCount; i += 1) {
      const fname = formatFramePattern(parsed.framePattern, i);
      const f = frames.get(fname);
      if (!f) {
        missing = true;
        break;
      }
      // Use a direct object URL — image dimensions live in the
      // metadata block, so we don't need the synchronous-decode path
      // imageFileToAsset takes (and that path can be flaky for large
      // PNG fleets in tests / older browsers).
      frameUrls.push(URL.createObjectURL(f));
    }
    if (missing) {
      sequenceWarnings.push(
        `sequence.json for ${stem} is invalid (missing frame files) — falling back to .mov.`,
      );
      continue;
    }
    sequences.set(sourceMov, {
      version: 1,
      type: "image-sequence",
      source: sourceMov,
      framePattern: parsed.framePattern,
      frameCount: parsed.frameCount,
      fps: typeof parsed.fps === "number" ? parsed.fps : 0,
      width: typeof parsed.width === "number" ? parsed.width : 0,
      height: typeof parsed.height === "number" ? parsed.height : 0,
      durationSec: typeof parsed.durationSec === "number" ? parsed.durationSec : 0,
      loop: parsed.loop !== false,
      alpha: parsed.alpha !== false,
      pixelFormat: "rgba",
      frameUrls,
    });
  }

  const result = parseW3D(xmlText, {
    sceneName: sceneNameFromFolder,
    textures,
    videos: videoFilenames,
    meshAssets: completeMeshGuids,
    sequences,
  });

  const warnings = [...sequenceWarnings, ...result.warnings];
  if (lockPresent) {
    warnings.unshift(
      "scene.lock present — Designer may have the project open; saving back may not be picked up until Designer releases the lock.",
    );
  }

  return {
    blueprint: result.blueprint,
    warnings,
    sceneFileName: chosenScene.name,
  };
}

/**
 * Walk a FileSystemDirectoryHandle (File System Access API) and produce a flat
 * File[] with each file's webkitRelativePath set to its position relative to
 * the picked root, matching the shape `<input type=file webkitdirectory>` would
 * have produced. This is the primary picker path on Chromium browsers because
 * `<input webkitdirectory>` is fragile through React's attribute pipeline.
 */
export async function collectFilesFromDirectory(
  rootHandle: FileSystemDirectoryHandle,
): Promise<File[]> {
  const out: File[] = [];
  const rootName = rootHandle.name;

  async function walk(handle: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    // entries() is an async iterable of [name, FileSystemHandle]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name, entry] of (handle as unknown as { entries(): AsyncIterable<[string, any]> }).entries()) {
      if (entry.kind === "file") {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        // Files retrieved this way don't have webkitRelativePath set — define
        // it so the rest of parseW3DFromFolder doesn't need to know which path
        // was used.
        Object.defineProperty(file, "webkitRelativePath", {
          value: prefix + name,
          configurable: true,
        });
        out.push(file);
      } else if (entry.kind === "directory") {
        await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`);
      }
    }
  }

  await walk(rootHandle, `${rootName}/`);
  return out;
}

function relativePath(file: File): string {
  // webkitdirectory uses forward slashes on all platforms.
  const wk = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return wk && wk.length > 0 ? wk : file.name;
}

function depthOf(path: string): number {
  // SceneName/scene.w3d → depth 1 (one separator).
  return path.split("/").length - 1;
}

function baseNameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

function topLevelFolder(file: File): string | null {
  const rel = relativePath(file);
  const idx = rel.indexOf("/");
  return idx > 0 ? rel.slice(0, idx) : null;
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx <= 0 ? name : name.slice(0, idx);
}

/**
 * Resolve a 1-based frame index against an ffmpeg-style %0Nd pattern.
 * Matches the convention scripts/movConversion.mjs uses (default
 * "frame_%06d.png") and is forgiving of alternate widths.
 */
function formatFramePattern(pattern: string, n: number): string {
  return pattern.replace(/%0(\d+)d/, (_, digits) =>
    String(n).padStart(parseInt(digits, 10), "0"),
  );
}

export interface MovClassification {
  withSequence: { videoName: string; sequencePath: string }[];
  withoutSequence: { videoName: string }[];
}

/**
 * Pure: classifies every .mov in `Resources/Textures` of the supplied
 * file list into "has a sibling <basename>_frames/sequence.json" vs
 * "no sequence yet". Used by the import flow to decide whether to
 * open the conversion modal. Files outside Resources/Textures and
 * non-.mov files are ignored.
 */
export function classifyMovAssets(files: File[] | FileList): MovClassification {
  const list = Array.from(files);
  const movs: { videoName: string; basePath: string; baseName: string }[] = [];
  const sequenceJsons = new Set<string>();
  for (const file of list) {
    const rel = relativePath(file).replace(/\\/g, "/");
    const lower = rel.toLowerCase();
    if (!lower.includes("/resources/textures/")) continue;
    if (lower.endsWith(".mov")) {
      const basename = baseNameOf(rel);
      const stem = basename.replace(/\.mov$/i, "");
      const dir = rel.slice(0, rel.length - basename.length);
      movs.push({ videoName: basename, basePath: dir, baseName: stem });
    } else if (lower.endsWith("/sequence.json")) {
      // Normalise to the "<basename>_frames/sequence.json" form so we can
      // index by the .mov stem.
      sequenceJsons.add(rel);
    }
  }
  const withSequence: MovClassification["withSequence"] = [];
  const withoutSequence: MovClassification["withoutSequence"] = [];
  for (const mov of movs) {
    const expected = `${mov.basePath}${mov.baseName}_frames/sequence.json`;
    if (sequenceJsons.has(expected)) {
      withSequence.push({ videoName: mov.videoName, sequencePath: expected });
    } else {
      withoutSequence.push({ videoName: mov.videoName });
    }
  }
  return { withSequence, withoutSequence };
}
