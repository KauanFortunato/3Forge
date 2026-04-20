import JSZip from "jszip";
import { getAvailableFonts, getFontData } from "./fonts";
import { exportBlueprintToJson, generateTypeScriptComponent } from "./exports";
import type { ComponentBlueprint, FontAsset, ImageNode } from "./types";

export interface ExportPackageFile {
  path: string;
  content: string | Uint8Array;
}

export interface ExportPackageData {
  zipFileName: string;
  typeScriptFileName: string;
  blueprintFileName: string;
  files: ExportPackageFile[];
}

export interface ExportPackageArchive {
  fileName: string;
  blob: Blob;
}

export function createExportPackageData(blueprint: ComponentBlueprint): ExportPackageData {
  const componentBaseName = sanitizeFileNameBase(blueprint.componentName, "3forge-component");
  const typeScriptFileName = `${componentBaseName}.ts`;
  const blueprintFileName = `${componentBaseName}.blueprint.json`;
  const files: ExportPackageFile[] = [];
  const usedPaths = new Set<string>([typeScriptFileName, blueprintFileName]);
  const fontAssetPathsById: Record<string, string> = {};
  const imageAssetPathsByNodeId: Record<string, string> = {};
  const availableFonts = new Map(getAvailableFonts(blueprint.fonts).map((font) => [font.id, font]));
  const usedFonts = collectUsedFonts(blueprint, availableFonts);
  const usedImages = collectUsedImages(blueprint);
  const imageAssetPathsBySource = new Map<string, string>();

  for (const font of usedFonts) {
    const path = createUniquePath(usedPaths, "assets/fonts", font.name, ".typeface.json");
    fontAssetPathsById[font.id] = toRelativeAssetPath(path);
    files.push({
      path,
      content: getFontData(font),
    });
  }

  for (const imageNode of usedImages) {
    const imagePath = resolvePackagedImagePath(imageNode, usedPaths, imageAssetPathsBySource);
    imageAssetPathsByNodeId[imageNode.id] = toRelativeAssetPath(imagePath.publicPath);

    if (imagePath.file) {
      files.push(imagePath.file);
    }
  }

  files.unshift(
    {
      path: blueprintFileName,
      content: exportBlueprintToJson(blueprint),
    },
    {
      path: typeScriptFileName,
      content: generateTypeScriptComponent(blueprint, {
        fontAssetPathsById,
        imageAssetPathsByNodeId,
      }),
    },
  );

  return {
    zipFileName: `${componentBaseName}.zip`,
    typeScriptFileName,
    blueprintFileName,
    files,
  };
}

export async function createExportPackageZipBlob(blueprint: ComponentBlueprint): Promise<Blob> {
  const packageData = createExportPackageData(blueprint);
  const zip = new JSZip();

  for (const file of packageData.files) {
    zip.file(file.path, file.content);
  }

  return zip.generateAsync({ type: "blob" });
}

export async function createExportPackageZip(blueprint: ComponentBlueprint): Promise<ExportPackageArchive> {
  const packageData = createExportPackageData(blueprint);
  const zip = new JSZip();

  for (const file of packageData.files) {
    zip.file(file.path, file.content);
  }

  return {
    fileName: packageData.zipFileName,
    blob: await zip.generateAsync({ type: "blob" }),
  };
}

function collectUsedFonts(
  blueprint: ComponentBlueprint,
  availableFonts: Map<string, FontAsset>,
): FontAsset[] {
  const usedFontIds = new Set<string>();
  const usedFonts: FontAsset[] = [];

  for (const node of blueprint.nodes) {
    if (node.type !== "text" || usedFontIds.has(node.fontId)) {
      continue;
    }

    const font = availableFonts.get(node.fontId);
    if (!font) {
      throw new Error(`Font not found for text node "${node.name}".`);
    }

    usedFontIds.add(node.fontId);
    usedFonts.push(font);
  }

  return usedFonts;
}

function collectUsedImages(blueprint: ComponentBlueprint): ImageNode[] {
  return blueprint.nodes.filter((node): node is ImageNode => node.type === "image");
}

function resolvePackagedImagePath(
  imageNode: ImageNode,
  usedPaths: Set<string>,
  imageAssetPathsBySource: Map<string, string>,
): { publicPath: string; file?: ExportPackageFile } {
  const existingPath = imageAssetPathsBySource.get(imageNode.image.src);
  if (existingPath) {
    return { publicPath: existingPath };
  }

  if (!isDataUrl(imageNode.image.src)) {
    return { publicPath: imageNode.image.src };
  }

  const extension = resolveImageExtension(imageNode.image.name, imageNode.image.mimeType);
  const path = createUniquePath(usedPaths, "assets/images", imageNode.image.name || imageNode.name, extension);
  const file = {
    path,
    content: decodeDataUrl(imageNode.image.src),
  };

  imageAssetPathsBySource.set(imageNode.image.src, path);
  return {
    publicPath: path,
    file,
  };
}

function toRelativeAssetPath(path: string): string {
  return /^(?:[a-z]+:)?\/\//i.test(path) || /^[a-z]+:/i.test(path) || path.startsWith("/") || path.startsWith(".")
    ? path
    : `./${path}`;
}

function isDataUrl(value: string): boolean {
  return value.startsWith("data:");
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const [metadata, payload] = dataUrl.split(",", 2);
  if (!metadata || payload === undefined) {
    throw new Error("Invalid data URL.");
  }

  if (metadata.includes(";base64")) {
    return decodeBase64(payload);
  }

  return new TextEncoder().encode(decodeURIComponent(payload));
}

function decodeBase64(value: string): Uint8Array {
  if (typeof atob === "function") {
    const decoded = atob(value);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  }

  const globalWithBuffer = globalThis as typeof globalThis & {
    Buffer?: { from: (input: string, encoding: string) => Uint8Array };
  };

  if (globalWithBuffer.Buffer) {
    return Uint8Array.from(globalWithBuffer.Buffer.from(value, "base64"));
  }

  throw new Error("Base64 decoding is unavailable in this environment.");
}

function resolveImageExtension(name: string, mimeType: string): string {
  const nameMatch = name.match(/(\.[a-z0-9]+)$/i);
  if (nameMatch) {
    return nameMatch[1].toLowerCase();
  }

  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    case "image/gif":
      return ".gif";
    default:
      return ".bin";
  }
}

function createUniquePath(
  usedPaths: Set<string>,
  directory: string,
  name: string,
  extension: string,
): string {
  const safeDirectory = directory.replace(/\/+$/g, "");
  const safeExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const baseName = sanitizeFileNameBase(name, "asset");
  let candidate = `${safeDirectory}/${baseName}${safeExtension}`;
  let suffix = 2;

  while (usedPaths.has(candidate)) {
    candidate = `${safeDirectory}/${baseName}-${suffix}${safeExtension}`;
    suffix += 1;
  }

  usedPaths.add(candidate);
  return candidate;
}

function sanitizeFileNameBase(name: string, fallback: string): string {
  const normalized = name
    .trim()
    .replace(/\.[a-z0-9.]+$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized || fallback;
}
