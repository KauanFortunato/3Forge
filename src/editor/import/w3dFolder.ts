/**
 * Minimal W3D folder walker (Phase C).
 *
 * Accepts the `FileList` produced by `<input type="file" webkitdirectory>`
 * and locates the `scene.w3d` entry. Reads the XML and delegates to
 * `parseW3DSceneMetadata` to produce a blueprint with engine/scene
 * metadata only. Texture/MOV asset handling arrives in later phases.
 */
import { parseW3DSceneMetadata, type W3DImportResult } from "./w3d";

export interface W3DFolderImportResult extends W3DImportResult {
  sceneFileName: string;
}

export async function parseW3DFromFolder(
  files: FileList | File[],
): Promise<W3DFolderImportResult> {
  const list = Array.from(files);
  if (list.length === 0) {
    throw new Error("No files were provided. Pick the folder that contains scene.w3d.");
  }

  let sceneFile: File | null = null;
  let sceneFileFallback: File | null = null;

  for (const file of list) {
    const relPath = relativePath(file);
    const baseName = basenameOf(relPath).toLowerCase();
    const depth = depthOf(relPath);

    if (baseName === "scene.w3d" && depth <= 1) {
      sceneFile = file;
      break;
    }
    if (baseName.endsWith(".w3d")) {
      // Older R3 saves keep `scene_<version>.w3d` siblings; use one as a
      // fallback only if the canonical scene.w3d is absent.
      sceneFileFallback = file;
    }
  }

  const chosen = sceneFile ?? sceneFileFallback;
  if (!chosen) {
    const sample = list.slice(0, 6).map((f) => relativePath(f)).join(", ");
    throw new Error(
      `No .w3d scene file found in the selected folder (saw ${list.length} files: ${sample}${list.length > 6 ? ", …" : ""}). Make sure to pick the folder that directly contains scene.w3d.`,
    );
  }

  const xml = await chosen.text();
  const parsed = parseW3DSceneMetadata(xml);

  return {
    ...parsed,
    sceneFileName: relativePath(chosen),
  };
}

function relativePath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath?.length ? withPath.webkitRelativePath : file.name;
}

function basenameOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function depthOf(path: string): number {
  const normalized = path.replace(/\\/g, "/");
  return (normalized.match(/\//g)?.length ?? 0);
}
