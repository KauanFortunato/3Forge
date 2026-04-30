import { imageFileToAsset, isVideoFileName, videoFileToAsset } from "../images";
import type { ComponentBlueprint, ImageAsset } from "../types";
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
    }
  }

  const chosenScene = sceneFile ?? sceneFileFallback;
  if (!chosenScene) {
    const sample = list.slice(0, 8).map((f) => relativePath(f)).join(", ");
    throw new Error(
      `No .w3d scene file found in the selected folder (saw ${list.length} files: ${sample}${list.length > 8 ? ", …" : ""}). Make sure to pick the folder that directly contains scene.w3d.`,
    );
  }
  // eslint-disable-next-line no-console
  console.info(
    `[w3d folder import] scene=${relativePath(chosenScene)} textures=${textureFiles.length} videos=${videoFilenames.size} lock=${lockPresent}`,
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

  const result = parseW3D(xmlText, {
    sceneName: sceneNameFromFolder,
    textures,
    videos: videoFilenames,
  });

  const warnings = [...result.warnings];
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
