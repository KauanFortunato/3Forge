import type { ImageAsset, ImageSequenceMetadata, SequenceFallbackReason, SequenceFormat } from "./types";

export const EMPTY_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9erVkAAAAASUVORK5CYII=";

export function createTransparentImageAsset(): ImageAsset {
  return {
    name: "Transparent PNG",
    mimeType: "image/png",
    src: EMPTY_IMAGE_DATA_URL,
    width: 1,
    height: 1,
  };
}

export function normalizeImageAsset(value: unknown, fallback: ImageAsset = createTransparentImageAsset()): ImageAsset {
  if (!value || typeof value !== "object") {
    return cloneImageAsset(fallback);
  }

  const source = value as Record<string, unknown>;
  const src = typeof source.src === "string" && source.src.trim()
    ? source.src
    : fallback.src;

  const normalized: ImageAsset = {
    ...(typeof source.id === "string" && source.id.trim() ? { id: source.id.trim() } : {}),
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : fallback.name,
    mimeType: typeof source.mimeType === "string" && source.mimeType.trim() ? source.mimeType.trim() : fallback.mimeType,
    src,
    width: clampNumber(normalizeNumber(source.width, fallback.width), 1),
    height: clampNumber(normalizeNumber(source.height, fallback.height), 1),
  };

  const sequence = normalizeImageSequenceMetadata(source.sequence, fallback.sequence);
  if (sequence) {
    normalized.sequence = sequence;
  }

  return normalized;
}

export function normalizeImageLibrary(value: unknown): ImageAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: ImageAsset[] = [];
  const usedIds = new Set<string>();

  for (const entry of value) {
    const asset = normalizeImageAsset(entry);
    const proposedId = asset.id?.trim() || toImageAssetId(asset.name || "image", result.length + 1);
    let id = proposedId;
    let counter = 2;
    while (usedIds.has(id)) {
      id = `${proposedId}-${counter}`;
      counter += 1;
    }

    asset.id = id;
    usedIds.add(id);
    result.push(asset);
  }

  return result;
}

export async function imageFileToAsset(file: File): Promise<ImageAsset> {
  const src = await readFileAsDataUrl(file);
  const dimensions = await readImageDimensions(src);

  return {
    name: file.name || "Image",
    mimeType: file.type || inferMimeType(file.name),
    src,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export function imageSequenceToAsset(name: string, sequence: ImageSequenceMetadata): ImageAsset {
  const width = clampNumber(sequence.width || 1, 1);
  const height = clampNumber(sequence.height || 1, 1);

  return {
    name: name || sequence.source || "Image sequence",
    mimeType: "application/x-image-sequence",
    src: sequence.frameUrls[0] ?? EMPTY_IMAGE_DATA_URL,
    width,
    height,
    sequence: {
      ...sequence,
      width,
      height,
      frameUrls: [...sequence.frameUrls],
    },
  };
}

const VIDEO_EXT_PATTERN = /\.(mov|mp4|webm|m4v)$/i;

export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

export function isVideoFileName(fileName: string): boolean {
  return VIDEO_EXT_PATTERN.test(fileName);
}

/**
 * Wrap a video file as an ImageAsset using a session-scoped object URL.
 * Note: object URLs do NOT survive a page reload; videos must be re-imported
 * from the source folder. They are also too big to data-URL into localStorage.
 */
export async function videoFileToAsset(file: File): Promise<ImageAsset> {
  const src = URL.createObjectURL(file);
  const dimensions = await readVideoDimensions(src);
  return {
    name: file.name || "Video",
    mimeType: file.type || inferVideoMimeType(file.name),
    src,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function readVideoDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth || 1,
        height: video.videoHeight || 1,
      });
      video.src = "";
    };
    video.onerror = () => reject(new Error("Failed to read video metadata."));
    video.src = src;
  });
}

export function inferVideoMimeType(fileName: string): string {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".mov")) return "video/quicktime";
  if (normalized.endsWith(".mp4") || normalized.endsWith(".m4v")) return "video/mp4";
  if (normalized.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

export function fitImageToMaxSize(width: number, height: number, maxSize = 2): { width: number; height: number } {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const aspect = safeWidth / safeHeight;

  if (aspect >= 1) {
    return {
      width: maxSize,
      height: Number((maxSize / aspect).toFixed(4)),
    };
  }

  return {
    width: Number((maxSize * aspect).toFixed(4)),
    height: maxSize,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image file."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid image file result."));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

export function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width || 1,
        height: image.naturalHeight || image.height || 1,
      });
    };
    image.onerror = () => reject(new Error("Failed to decode image."));
    image.src = src;
  });
}

function inferMimeType(fileName: string): string {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function clampNumber(value: number, min: number): number {
  return Math.max(value, min);
}

function toImageAssetId(name: string, fallbackIndex: number): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `image-${normalized}` : `image-${fallbackIndex}`;
}

function cloneImageAsset(asset: ImageAsset): ImageAsset {
  return {
    ...asset,
    ...(asset.sequence ? { sequence: cloneImageSequenceMetadata(asset.sequence) } : {}),
  };
}

function cloneImageSequenceMetadata(sequence: ImageSequenceMetadata): ImageSequenceMetadata {
  return {
    ...sequence,
    frameUrls: [...sequence.frameUrls],
  };
}

function normalizeImageSequenceMetadata(
  value: unknown,
  fallback?: ImageSequenceMetadata,
): ImageSequenceMetadata | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const framePattern = typeof source.framePattern === "string" && source.framePattern.trim()
    ? source.framePattern.trim()
    : fallback?.framePattern;
  const format = normalizeSequenceFormat(source.format, framePattern, fallback?.format);
  const frameUrls = Array.isArray(source.frameUrls)
    ? source.frameUrls.filter((entry): entry is string => typeof entry === "string")
    : fallback
      ? [...fallback.frameUrls]
      : [];
  const fallbackFrameCount = fallback?.frameCount ?? Math.max(frameUrls.length, 1);

  const normalized: ImageSequenceMetadata = {
    type: "image-sequence",
    version: source.version === 1 || source.version === 2 ? source.version : fallback?.version ?? 2,
    format,
    source: typeof source.source === "string" && source.source.trim()
      ? source.source.trim()
      : fallback?.source ?? "sequence.mov",
    framePattern: framePattern ?? `frame_%06d.${format}`,
    frameCount: clampInteger(normalizeNumber(source.frameCount, fallbackFrameCount), 1),
    fps: clampNumber(normalizeNumber(source.fps, fallback?.fps ?? 25), 0.0001),
    width: clampNumber(normalizeNumber(source.width, fallback?.width ?? 0), 0),
    height: clampNumber(normalizeNumber(source.height, fallback?.height ?? 0), 0),
    durationSec: clampNumber(normalizeNumber(source.durationSec, fallback?.durationSec ?? 0), 0),
    loop: typeof source.loop === "boolean" ? source.loop : fallback?.loop ?? true,
    alpha: typeof source.alpha === "boolean" ? source.alpha : fallback?.alpha ?? true,
    pixelFormat: "rgba",
    frameUrls,
  };

  const fallbackReason = normalizeSequenceFallbackReason(source.fallbackReason);
  if (fallbackReason) {
    normalized.fallbackReason = fallbackReason;
  } else if (fallback?.fallbackReason) {
    normalized.fallbackReason = fallback.fallbackReason;
  }
  if (source.autoRepaired === true || fallback?.autoRepaired === true) {
    normalized.autoRepaired = true;
  }
  if (source.legacy === true || fallback?.legacy === true) {
    normalized.legacy = true;
  }

  return normalized;
}

function normalizeSequenceFormat(
  value: unknown,
  framePattern: string | undefined,
  fallback: SequenceFormat | undefined,
): SequenceFormat {
  if (value === "webp" || value === "png") {
    return value;
  }
  const lowerPattern = framePattern?.toLowerCase() ?? "";
  if (lowerPattern.endsWith(".webp")) {
    return "webp";
  }
  if (lowerPattern.endsWith(".png")) {
    return "png";
  }
  return fallback ?? "png";
}

function normalizeSequenceFallbackReason(value: unknown): SequenceFallbackReason | undefined {
  if (value === "webp_encoder_unavailable" || value === "webp_validation_failed") {
    return value;
  }
  return undefined;
}

function clampInteger(value: number, min: number): number {
  return Math.max(Math.round(value), min);
}
