import JSZip from "jszip";
import { getAvailableFonts, getFontData } from "./fonts";
import { exportBlueprintToJson, generateTypeScriptComponent } from "./exports";
import type {
  ComponentBlueprint,
  FontAsset,
  ImageAsset,
  ImageNode,
  ImageSequenceMetadata,
  SequenceStorageType,
} from "./types";

export interface ExportPackageFile {
  path: string;
  content: string | Uint8Array;
}

export interface ExportPackageDiagnostics {
  /** Total number of unique sequences referenced by the blueprint. */
  sequencesFound: number;
  /** Sequences whose frames + manifest were written into the zip. */
  sequencesPackaged: number;
  /** Sequences we could not package (frame fetch failed, missing URLs, etc.). */
  sequencesSkipped: Array<{ name: string; reason: string }>;
  /** New `assets/sequences/<folder>/sequence.json` paths embedded in the zip. */
  rewrittenManifestPaths: string[];
  /** Operator-facing warnings the UI can toast / log. */
  warnings: string[];
}

export interface ExportPackageData {
  zipFileName: string;
  typeScriptFileName: string;
  blueprintFileName: string;
  files: ExportPackageFile[];
  diagnostics: ExportPackageDiagnostics;
}

export interface ExportPackageArchive {
  fileName: string;
  blob: Blob;
}

/** Internal: a sequence collected from the blueprint that we attempt to package. */
interface CollectedSequence {
  /** Lookup key used to map back to the in-blueprint sequence references. */
  key: string;
  /** Operator-facing name (asset.name or sequence.source). */
  name: string;
  /** Original storageType, so we can decide whether to emit a "non-portable" warning. */
  originalStorageType: SequenceStorageType;
  /** A reference to the metadata so we can copy preserved fields into sequence.json. */
  metadata: ImageSequenceMetadata;
  /** Cached frame URL list (already deduplicated by key). */
  frameUrls: string[];
  /** Source-derived 8-char hash (for folder name when manifestPath is absent). */
  sourceHashShort: string;
}

export async function createExportPackageData(blueprint: ComponentBlueprint): Promise<ExportPackageData> {
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
  const imagesById = new Map((blueprint.images ?? []).map((image) => [image.id, image] as const));
  const imageAssetPathsBySource = new Map<string, string>();

  const diagnostics: ExportPackageDiagnostics = {
    sequencesFound: 0,
    sequencesPackaged: 0,
    sequencesSkipped: [],
    rewrittenManifestPaths: [],
    warnings: [],
  };
  const sequenceRewrites = new Map<string, { manifestPath: string; storageType: SequenceStorageType }>();

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
    // Sequence-mime assets are handled below — skip the data-URL pipeline for them.
    if (image.sequence) {
      continue;
    }
    const imagePath = resolvePackagedImagePath(imageNode, image, usedPaths, imageAssetPathsBySource);
    imageAssetPathsByNodeId[imageNode.id] = toRelativeAssetPath(imagePath.publicPath);

    if (imagePath.file) {
      files.push(imagePath.file);
    }
  }

  // --- Phase 2: package image-sequence assets, mirroring the project folder
  // layout so the zip contains Resources/Textures/<slug>_sequence_<hash8>/...
  // (same path the editor wrote during import via Phase 1). storageType
  // stays "project-folder" — same code reads sequences out of either an
  // unzipped export or the original project folder. ---
  const usedSequences = collectUsedSequences(blueprint, imagesById);
  const usedManifestPaths = new Set<string>();

  for (const seq of usedSequences) {
    diagnostics.sequencesFound += 1;
    const seqJsonZipPath = ensureUniqueManifestPath(
      deriveZipManifestPath(seq),
      usedManifestPaths,
    );
    const folderPath = seqJsonZipPath.replace(/\/sequence\.json$/i, "");

    if (seq.frameUrls.length === 0) {
      const reason = "frameUrls empty (transient sequence frames are no longer in memory)";
      diagnostics.sequencesSkipped.push({ name: seq.name, reason });
      diagnostics.warnings.push(
        seq.originalStorageType === "dev-cache"
          ? `Temporary MOV sequence "${seq.name}" cannot be exported (frame URLs no longer available). Re-import with project folder access to restore.`
          : `Sequence "${seq.name}" could not be packaged: ${reason}.`,
      );
      continue;
    }

    try {
      const frameBytes: Uint8Array[] = [];
      for (let i = 0; i < seq.frameUrls.length; i += 1) {
        const url = seq.frameUrls[i];
        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`fetch frame ${i + 1}/${seq.frameUrls.length} failed (status=${resp.status})`);
        }
        const buf = await resp.arrayBuffer();
        frameBytes.push(new Uint8Array(buf));
      }

      // Mark zip paths as taken so subsequent files don't collide.
      usedPaths.add(seqJsonZipPath);

      files.push({ path: seqJsonZipPath, content: serialiseSequenceJson(seq.metadata, seqJsonZipPath) });
      for (let i = 0; i < frameBytes.length; i += 1) {
        const frameName = formatFramePattern(seq.metadata.framePattern, i + 1, seq.metadata.format);
        const framePath = `${folderPath}/${frameName}`;
        usedPaths.add(framePath);
        files.push({ path: framePath, content: frameBytes[i] });
      }

      sequenceRewrites.set(seq.key, {
        manifestPath: seqJsonZipPath,
        storageType: "project-folder",
      });
      diagnostics.sequencesPackaged += 1;
      diagnostics.rewrittenManifestPaths.push(seqJsonZipPath);

      if (seq.originalStorageType === "dev-cache") {
        diagnostics.warnings.push(
          `Temporary MOV sequence "${seq.name}" was promoted to project-folder storage in the export. ` +
            `Re-import with project folder access to keep the sequence in sync.`,
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      diagnostics.sequencesSkipped.push({ name: seq.name, reason });
      diagnostics.warnings.push(
        seq.originalStorageType === "dev-cache"
          ? `Temporary MOV sequence "${seq.name}" cannot be exported (frame URLs no longer available). Re-import with project folder access to restore.`
          : `Sequence "${seq.name}" could not be packaged: ${reason}`,
      );
    }
  }

  const exportBlueprint = rewriteBlueprintForExport(blueprint, sequenceRewrites);

  files.unshift(
    {
      path: blueprintFileName,
      content: exportBlueprintToJson(exportBlueprint),
    },
    {
      path: typeScriptFileName,
      content: generateTypeScriptComponent(exportBlueprint, {
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
    diagnostics,
  };
}

export async function createExportPackageZipBlob(blueprint: ComponentBlueprint): Promise<Blob> {
  const packageData = await createExportPackageData(blueprint);
  const zip = new JSZip();

  for (const file of packageData.files) {
    zip.file(file.path, file.content);
  }

  return zip.generateAsync({ type: "blob" });
}

export async function createExportPackageZip(blueprint: ComponentBlueprint): Promise<ExportPackageArchive> {
  const packageData = await createExportPackageData(blueprint);
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

/**
 * Walks the blueprint looking for image nodes whose ImageAsset carries
 * `sequence` metadata. Deduplicates by sourceHash || manifestPath || name.
 */
function collectUsedSequences(
  blueprint: ComponentBlueprint,
  imagesById: Map<string | undefined, ImageAsset>,
): CollectedSequence[] {
  const seen = new Map<string, CollectedSequence>();

  const consider = (asset: ImageAsset | undefined): void => {
    if (!asset?.sequence) return;
    const seq = asset.sequence;
    const key = sequenceKey(asset);
    if (seen.has(key)) return;
    seen.set(key, {
      key,
      name: asset.name || seq.source || "sequence",
      originalStorageType: seq.storageType ?? "dev-cache",
      metadata: seq,
      frameUrls: Array.isArray(seq.frameUrls) ? seq.frameUrls.slice() : [],
      sourceHashShort: shortSourceHash(seq.sourceHash),
    });
  };

  for (const node of blueprint.nodes) {
    if (node.type !== "image") continue;
    const fromLibrary = node.imageId ? imagesById.get(node.imageId) : undefined;
    consider(fromLibrary ?? node.image);
  }
  for (const asset of blueprint.images ?? []) {
    consider(asset);
  }
  return Array.from(seen.values());
}

function sequenceKey(asset: ImageAsset): string {
  const seq = asset.sequence!;
  return seq.sourceHash || seq.manifestPath || asset.name || seq.source || "sequence";
}

function shortSourceHash(sourceHash: string | undefined): string {
  if (!sourceHash) return "00000000";
  const hex = sourceHash.replace(/^sha256:/, "");
  return (hex.slice(0, 8) || "00000000").toLowerCase();
}

/**
 * Returns the in-zip path of the sequence's manifest. We mirror the project
 * folder layout: `Resources/Textures/<folder>/sequence.json`.
 *
 * - If the source already has a canonical `Resources/Textures/<folder>/sequence.json`
 *   manifestPath (Phase 1's writer always produces this for project-folder
 *   sequences), reuse it as-is so the exported blueprint and the original
 *   on-disk project agree byte-for-byte.
 * - Otherwise (legacy / dev-cache / missing manifestPath), derive a fresh
 *   `Resources/Textures/<slug>_sequence_<hash8>/sequence.json` from the
 *   asset name + first 8 hex chars of the source hash.
 */
function deriveZipManifestPath(seq: CollectedSequence): string {
  const existing = seq.metadata.manifestPath?.replace(/\\/g, "/").trim();
  if (existing && /^Resources\/Textures\/[^/]+\/sequence\.json$/i.test(existing)) {
    return existing;
  }
  const slug = sanitizeFileNameBase(seq.name, "sequence");
  return `Resources/Textures/${slug}_sequence_${seq.sourceHashShort}/sequence.json`;
}

/**
 * If `base` collides with another sequence already packaged in this run,
 * suffix the FOLDER segment (not the file name) so the result stays a
 * valid `<...>/sequence.json` path. Two unique sequences never share a
 * folder under Phase 1's writer (the hash8 is collision-resistant for
 * realistic project sizes), but legacy blueprints with hand-edited
 * manifestPaths can still trip this — degrade safely.
 */
function ensureUniqueManifestPath(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const m = base.match(/^(.*\/)([^/]+)\/sequence\.json$/i);
  if (!m) {
    used.add(base);
    return base;
  }
  const prefix = m[1];
  const folder = m[2];
  let suffix = 2;
  let candidate = `${prefix}${folder}-${suffix}/sequence.json`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${prefix}${folder}-${suffix}/sequence.json`;
  }
  used.add(candidate);
  return candidate;
}

/** Replaces `%0Nd` (or `%d`) in a framePattern with the (1-based) frame number. */
function formatFramePattern(pattern: string, n: number, format: string): string {
  if (!pattern) {
    const ext = format || "webp";
    return `frame_${String(n).padStart(6, "0")}.${ext}`;
  }
  let replaced = false;
  const out = pattern.replace(/%0?(\d+)?d/, (_match, digits) => {
    replaced = true;
    const width = digits ? parseInt(digits, 10) : 1;
    return String(n).padStart(width, "0");
  });
  if (replaced) return out;
  // No printf-style token — fall back to a sane default.
  const ext = format || "webp";
  return `frame_${String(n).padStart(6, "0")}.${ext}`;
}

/** Build the in-zip `sequence.json` payload (frameUrls / transient flags stripped). */
function serialiseSequenceJson(seq: ImageSequenceMetadata, manifestPath: string): string {
  const persistable = {
    type: seq.type,
    version: seq.version,
    format: seq.format,
    source: seq.source,
    framePattern: seq.framePattern,
    frameCount: seq.frameCount,
    fps: seq.fps,
    width: seq.width,
    height: seq.height,
    durationSec: seq.durationSec,
    loop: seq.loop,
    alpha: seq.alpha,
    pixelFormat: seq.pixelFormat,
    ...(seq.fallbackReason !== undefined ? { fallbackReason: seq.fallbackReason } : {}),
    ...(seq.sourceHash !== undefined ? { sourceHash: seq.sourceHash } : {}),
    storageType: "project-folder" as SequenceStorageType,
    manifestPath,
  };
  return JSON.stringify(persistable, null, 2);
}

/**
 * Produces a deep-cloned blueprint suitable for embedding in the zip:
 *   - Every image-sequence asset has its `sequence.manifestPath` rewritten
 *     to the in-zip path and `storageType` flipped to "embedded-zip".
 *   - Transient `frameUrls` / `autoRepaired` / `legacy` markers are stripped.
 *   - Sequences that failed to package are left with their original metadata
 *     EXCEPT for `frameUrls`, which is always cleared (those blob URLs
 *     would not survive the zip anyway).
 */
function rewriteBlueprintForExport(
  blueprint: ComponentBlueprint,
  rewrites: Map<string, { manifestPath: string; storageType: SequenceStorageType }>,
): ComponentBlueprint {
  const cloned = JSON.parse(JSON.stringify(blueprint)) as ComponentBlueprint;

  const applyRewrite = (asset: ImageAsset | undefined): void => {
    if (!asset?.sequence) return;
    const key = sequenceKey(asset);
    const rewrite = rewrites.get(key);
    if (rewrite) {
      asset.sequence.manifestPath = rewrite.manifestPath;
      asset.sequence.storageType = rewrite.storageType;
      // Replace the transient blob:fake-frame src with the in-zip frame 1
      // path so the exported blueprint contains no blob: URLs.
      const folder = rewrite.manifestPath.replace(/\/sequence\.json$/i, "");
      const firstFrame = formatFramePattern(asset.sequence.framePattern, 1, asset.sequence.format);
      asset.src = `${folder}/${firstFrame}`;
    } else if (typeof asset.src === "string" && asset.src.startsWith("blob:")) {
      // Failed to package — still scrub the blob URL so the exported blueprint
      // doesn't carry a dangling reference.
      asset.src = "";
    }
    asset.sequence.frameUrls = [];
    delete asset.sequence.autoRepaired;
    delete asset.sequence.legacy;
  };

  for (const node of cloned.nodes) {
    if (node.type === "image") {
      applyRewrite(node.image);
    }
  }
  for (const asset of cloned.images ?? []) {
    applyRewrite(asset);
  }
  return cloned;
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
