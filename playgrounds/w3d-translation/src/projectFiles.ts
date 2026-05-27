export interface W3DProjectScene {
  id: string;
  name: string;
  sceneFileName: string;
  sceneDir: string;
  file: File;
}

export interface W3DProjectIndex {
  projectName: string;
  scenes: W3DProjectScene[];
  fontFiles: File[];
}

const FONT_EXTENSIONS = [".ttf", ".otf"];
const VIDEO_EXTENSIONS = [".mov", ".mp4", ".webm"];
const RASTER_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".svg"];

export function indexW3DProject(files: File[]): W3DProjectIndex {
  const scenes: W3DProjectScene[] = [];
  const fontFiles: File[] = [];

  for (const file of files) {
    const path = relPath(file);
    const lower = path.toLowerCase();
    const baseName = basenameOf(path).toLowerCase();
    const ext = extensionOf(baseName);

    if (baseName === "scene.w3d") {
      const sceneDir = dirnameOf(path);
      scenes.push({
        id: path,
        name: basenameOf(sceneDir) || basenameOf(dirnameOf(sceneDir)) || "Scene",
        sceneFileName: path,
        sceneDir,
        file,
      });
      continue;
    }

    if (isProjectFontPath(lower, ext)) {
      fontFiles.push(file);
    }
  }

  scenes.sort((a, b) => a.name.localeCompare(b.name) || a.sceneFileName.localeCompare(b.sceneFileName));
  fontFiles.sort((a, b) => relPath(a).localeCompare(relPath(b)));

  return {
    projectName: inferProjectName(files),
    scenes,
    fontFiles,
  };
}

export function collectSceneTextureFiles(files: File[], scene: W3DProjectScene): File[] {
  return collectSceneFilesByExtensions(files, scene, RASTER_EXTENSIONS);
}

export function collectSceneMovFiles(files: File[], scene: W3DProjectScene): File[] {
  return collectSceneFilesByExtensions(files, scene, VIDEO_EXTENSIONS);
}

export function relPath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return normalizePath(withPath.webkitRelativePath?.length ? withPath.webkitRelativePath : file.name);
}

function collectSceneFilesByExtensions(
  files: File[],
  scene: W3DProjectScene,
  extensions: string[],
): File[] {
  const texturePrefix = `${scene.sceneDir.toLowerCase()}/resources/textures/`;
  return files.filter((file) => {
    const path = relPath(file).toLowerCase();
    return path.startsWith(texturePrefix) && extensions.includes(extensionOf(path));
  });
}

function isProjectFontPath(lowerPath: string, ext: string): boolean {
  const inFontFolder = lowerPath.includes("/resources/fonts/") || lowerPath.includes("/fonts/");
  if (!inFontFolder) {
    return false;
  }
  return FONT_EXTENSIONS.includes(ext) || lowerPath.endsWith(".typeface.json");
}

function inferProjectName(files: File[]): string {
  const first = files.map((file) => relPath(file)).find((path) => path.includes("/"));
  if (!first) return "Selected Project";
  return first.split("/")[0] || "Selected Project";
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function basenameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}
