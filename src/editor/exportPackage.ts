import JSZip from "jszip";
import { getAvailableFonts, getFontData } from "./fonts";
import { exportBlueprintToJson, generateTypeScriptComponent } from "./exports";
import { MAX_MODEL_FILE_SIZE_BYTES, MODEL_FILE_TOO_LARGE_MESSAGE } from "./models";
import type { ComponentBlueprint, EditableBinding, FontAsset, ImageAsset, ImageNode, ModelAsset, TransformSpec } from "./types";

interface ExportModelNode {
  id: string;
  name: string;
  type: "model";
  parentId: string | null;
  visible: boolean;
  transform: TransformSpec;
  editable: Record<string, EditableBinding>;
  modelId?: string;
  model?: ModelAsset;
}

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
  const modelAssetPathsById: Record<string, string> = {};
  const availableFonts = new Map(getAvailableFonts(blueprint.fonts).map((font) => [font.id, font]));
  const usedFonts = collectUsedFonts(blueprint, availableFonts);
  const usedImages = collectUsedImages(blueprint);
  const usedModels = collectUsedModels(blueprint);
  const imagesById = new Map((blueprint.images ?? []).map((image) => [image.id, image] as const));
  const modelsById = new Map((blueprint.models ?? []).map((model) => [model.id, model] as const));
  const imageAssetPathsBySource = new Map<string, string>();
  const modelAssetPathsBySource = new Map<string, string>();

  for (const font of usedFonts) {
    const path = createUniquePath(usedPaths, "assets/fonts", font.name, ".typeface.json");
    fontAssetPathsById[font.id] = toRelativeAssetPath(path);
    files.push({
      path,
      content: getFontData(font),
    });
  }

  for (const imageNode of usedImages) {
    const image = resolveImageAssetForNode(imageNode, imagesById);
    const imagePath = resolvePackagedImagePath(imageNode, image, usedPaths, imageAssetPathsBySource);
    imageAssetPathsByNodeId[imageNode.id] = toRelativeAssetPath(imagePath.publicPath);

    if (imagePath.file) {
      files.push(imagePath.file);
    }
  }

  for (const modelNode of usedModels) {
    const model = resolveModelAssetForNode(modelNode, modelsById);
    const modelPath = resolvePackagedModelPath(modelNode, model, usedPaths, modelAssetPathsBySource);
    if (model.id) {
      modelAssetPathsById[model.id] = toRelativeAssetPath(modelPath.publicPath);
    }

    if (modelPath.file) {
      files.push(modelPath.file);
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
        modelAssetPathsById,
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

function collectUsedModels(blueprint: ComponentBlueprint): ExportModelNode[] {
  return (blueprint.nodes as Array<ComponentBlueprint["nodes"][number] | ExportModelNode>)
    .filter((node): node is ExportModelNode => node.type === "model");
}

function resolvePackagedImagePath(
  imageNode: ImageNode,
  image: ImageAsset,
  usedPaths: Set<string>,
  imageAssetPathsBySource: Map<string, string>,
): { publicPath: string; file?: ExportPackageFile } {
  const existingPath = imageAssetPathsBySource.get(image.src);
  if (existingPath) {
    return { publicPath: existingPath };
  }

  if (!isDataUrl(image.src)) {
    return { publicPath: image.src };
  }

  const extension = resolveImageExtension(image.name, image.mimeType);
  const path = createUniquePath(usedPaths, "assets/images", image.name || imageNode.name, extension);
  const file = {
    path,
    content: decodeDataUrl(image.src),
  };

  imageAssetPathsBySource.set(image.src, path);
  return {
    publicPath: path,
    file,
  };
}

function resolveImageAssetForNode(node: ImageNode, imagesById: Map<string | undefined, ImageAsset>): ImageAsset {
  if (node.imageId) {
    const asset = imagesById.get(node.imageId);
    if (asset) {
      return asset;
    }
  }

  return node.image;
}

function resolveModelAssetForNode(node: ExportModelNode, modelsById: Map<string | undefined, ModelAsset>): ModelAsset {
  if (node.modelId) {
    const asset = modelsById.get(node.modelId);
    if (asset) {
      return asset;
    }
  }

  if (node.model) {
    return node.model;
  }

  throw new Error(`Model asset not found for model node "${node.name}".`);
}

function resolvePackagedModelPath(
  modelNode: ExportModelNode,
  model: ModelAsset,
  usedPaths: Set<string>,
  modelAssetPathsBySource: Map<string, string>,
): { publicPath: string; file?: ExportPackageFile } {
  const existingPath = modelAssetPathsBySource.get(model.src);
  if (existingPath) {
    return { publicPath: existingPath };
  }

  if (!isDataUrl(model.src)) {
    return { publicPath: model.src };
  }

  const extension = resolveModelExtension(model.name, model.mimeType, model.format);
  const path = createUniquePath(usedPaths, "assets/models", model.name || modelNode.name, extension);
  const content = decodeDataUrl(model.src);
  if (content.byteLength > MAX_MODEL_FILE_SIZE_BYTES) {
    throw new Error(MODEL_FILE_TOO_LARGE_MESSAGE);
  }

  const file = {
    path,
    content,
  };

  modelAssetPathsBySource.set(model.src, path);
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

export function decodeDataUrl(dataUrl: string): Uint8Array {
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

function resolveModelExtension(name: string, mimeType: string, format: ModelAsset["format"]): string {
  const nameMatch = name.match(/(\.[a-z0-9]+)$/i);
  if (nameMatch) {
    return nameMatch[1].toLowerCase();
  }

  if (mimeType === "model/vnd.usdz+zip" || format === "usdz") {
    return ".usdz";
  }

  if (mimeType === "model/gltf+json" || format === "gltf") {
    return ".gltf";
  }

  return ".glb";
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
