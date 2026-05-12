import { imageSequenceToAsset, readImageDimensions } from "../images";
import type { ImageAsset, ImageSequenceMetadata } from "../types";

/**
 * Convert a list of `.mov` Files via the dev backend, returning a
 * `Map<sourceMov, ImageSequenceMetadata>` whose `frameUrls` point at
 * the dev server's GET endpoint. The browser fetches each frame
 * lazily when the renderer loads textures — no disk write on the
 * user's project folder.
 *
 * Throws `ConvertViaBackendError` with a recognisable `code` so the
 * caller can pivot to a fallback UI.
 */
export type ConvertProgress =
  | { phase: "uploading"; movName: string; movIndex: number; movTotal: number }
  | { phase: "converted"; movName: string; movIndex: number; movTotal: number }
  | { phase: "done" }
  | { phase: "cancelled" };

export interface ConvertViaBackendOptions {
  movFiles: File[];
  signal: AbortSignal;
  onProgress?: (p: ConvertProgress) => void;
}

export interface ConvertViaBackendResult {
  /** Keyed by source `.mov` filename, ready to merge into the parser's sequences map. */
  sequences: Map<string, ImageSequenceMetadata>;
  /** Per-mov failures; the import can still proceed for the converted ones. */
  failed: { mov: string; error: string }[];
}

export interface ConvertMovFileToImageSequenceAssetOptions {
  file: File;
  signal: AbortSignal;
  onProgress?: (p: ConvertProgress) => void;
  readDimensions?: (src: string) => Promise<{ width: number; height: number }>;
}

interface BackendManifest {
  jobId: string;
  source: string;
  format?: "webp" | "png";
  fallbackReason?: "webp_encoder_unavailable" | "webp_validation_failed" | null;
  sequenceJson: {
    version?: number;
    format?: "webp" | "png";
    framePattern: string;
    frameCount: number;
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    loop: boolean;
    alpha: boolean;
    pixelFormat: string;
    fallbackReason?: "webp_encoder_unavailable" | "webp_validation_failed";
  };
  frameCount: number;
  fps: number;
  alpha: boolean;
  frames: { index: number; filename: string; url: string; sizeBytes: number }[];
  ffmpegSource?: string;
}

export class ConvertViaBackendError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ConvertViaBackendError";
    this.code = code;
  }
}

export async function convertMovsViaBackend(
  opts: ConvertViaBackendOptions,
): Promise<ConvertViaBackendResult> {
  const { movFiles, signal, onProgress } = opts;
  const sequences = new Map<string, ImageSequenceMetadata>();
  const failed: { mov: string; error: string }[] = [];

  for (let i = 0; i < movFiles.length; i += 1) {
    if (signal.aborted) {
      onProgress?.({ phase: "cancelled" });
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const file = movFiles[i];
    onProgress?.({ phase: "uploading", movName: file.name, movIndex: i, movTotal: movFiles.length });
    let manifest: BackendManifest;
    try {
      const buf = await file.arrayBuffer();
      const resp = await fetch("/api/w3d/convert-mov", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": file.name,
        },
        body: buf,
        signal,
      });
      if (!resp.ok) {
        let errBody: { code?: string; message?: string; installHint?: string } = {};
        try { errBody = await resp.json(); } catch { /* non-json */ }
        if (resp.status === 404) {
          throw new ConvertViaBackendError("NO_BACKEND", "Conversion endpoint unreachable.");
        }
        if (errBody.code === "FFMPEG_NOT_INSTALLED") {
          throw new ConvertViaBackendError("FFMPEG_NOT_INSTALLED", errBody.installHint ?? "ffmpeg not installed");
        }
        throw new ConvertViaBackendError(errBody.code ?? `HTTP_${resp.status}`, errBody.message ?? `HTTP ${resp.status}`);
      }
      manifest = await resp.json() as BackendManifest;
    } catch (err) {
      const e = err as { name?: string; code?: string; message?: string };
      if (e.name === "AbortError") {
        onProgress?.({ phase: "cancelled" });
        throw err;
      }
      // Hard errors (NO_BACKEND, FFMPEG_NOT_INSTALLED) propagate to the caller —
      // the caller pivots the modal to "error" phase. Per-mov soft failures
      // (bad codec, etc.) are collected.
      if (e.code === "NO_BACKEND" || e.code === "FFMPEG_NOT_INSTALLED") {
        throw err;
      }
      failed.push({ mov: file.name, error: e.message ?? String(err) });
      continue;
    }

    const detectedFormat: "webp" | "png" =
      manifest.format === "webp" || manifest.sequenceJson.format === "webp" ? "webp" : "png";
    const fps = manifest.fps > 0 ? manifest.fps : 25;
    const seq: ImageSequenceMetadata = {
      version: 3,
      type: "image-sequence",
      format: detectedFormat,
      source: file.name,
      framePattern: manifest.sequenceJson.framePattern,
      frameCount: manifest.frameCount,
      fps,
      width: manifest.sequenceJson.width,
      height: manifest.sequenceJson.height,
      durationSec: manifest.sequenceJson.durationSec,
      loop: manifest.sequenceJson.loop !== false,
      alpha: manifest.alpha,
      pixelFormat: "rgba",
      frameUrls: manifest.frames.map((f) => f.url),
      // No manifestPath here — the caller will set
      // `storageType: "project-folder"` + `manifestPath` after copying the
      // frames into the project folder. Anything that comes straight off
      // the backend lives in the dev-cache and must not be considered
      // persistent.
      storageType: "dev-cache",
    };
    const reason = manifest.fallbackReason ?? manifest.sequenceJson.fallbackReason;
    if (reason) seq.fallbackReason = reason;
    sequences.set(file.name, seq);
    onProgress?.({ phase: "converted", movName: file.name, movIndex: i, movTotal: movFiles.length });
  }

  onProgress?.({ phase: "done" });
  return { sequences, failed };
}

export async function convertMovFileToImageSequenceAsset(
  opts: ConvertMovFileToImageSequenceAssetOptions,
): Promise<ImageAsset> {
  const { file, signal, onProgress, readDimensions = readImageDimensions } = opts;
  const result = await convertMovsViaBackend({
    movFiles: [file],
    signal,
    onProgress,
  });
  const sequence =
    result.sequences.get(file.name)
    ?? findSequenceCaseInsensitive(result.sequences, file.name);

  if (!sequence) {
    const failed = result.failed.find((entry) => entry.mov.toLowerCase() === file.name.toLowerCase());
    throw new ConvertViaBackendError(
      "MOV_DECODE_FAILED",
      failed?.error ?? `No image sequence was returned for ${file.name}.`,
    );
  }

  let hydratedSequence = sequence;
  const firstFrame = sequence.frameUrls[0];
  if (firstFrame && (!sequence.width || !sequence.height)) {
    try {
      const dimensions = await readDimensions(firstFrame);
      hydratedSequence = {
        ...sequence,
        width: dimensions.width,
        height: dimensions.height,
      };
    } catch {
      // Keep backend metadata if the browser cannot decode the first frame.
    }
  }

  return imageSequenceToAsset(file.name, hydratedSequence);
}

/**
 * Ask the dev backend to run `npm install` so the bundled `ffmpeg-static`
 * dependency is materialised. Used by the editor's "Install" affordance
 * after FFMPEG_NOT_INSTALLED. Resolves only when the backend confirms
 * ffmpeg is now reachable; throws ConvertViaBackendError otherwise.
 *
 * Notes:
 *   - This calls a dev-only endpoint; in production builds it 404s.
 *   - The npm install can take 10-60 seconds. Caller should show a
 *     "A instalar…" UI and avoid extra concurrent fetches.
 */
export async function installFfmpegViaBackend(signal: AbortSignal): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch("/api/w3d/convert-mov/install-ffmpeg", {
      method: "POST",
      signal,
    });
  } catch (err) {
    const e = err as { name?: string };
    if (e.name === "AbortError") throw err;
    throw new ConvertViaBackendError("NO_BACKEND", "Conversion endpoint unreachable.");
  }
  if (resp.status === 404) {
    throw new ConvertViaBackendError("NO_BACKEND", "Install endpoint not available in this build.");
  }
  if (!resp.ok) {
    let body: { code?: string; message?: string } = {};
    try { body = await resp.json(); } catch { /* non-json */ }
    throw new ConvertViaBackendError(
      body.code ?? `HTTP_${resp.status}`,
      body.message ?? "Install failed",
    );
  }
}

function findSequenceCaseInsensitive(
  sequences: Map<string, ImageSequenceMetadata>,
  fileName: string,
): ImageSequenceMetadata | undefined {
  const target = fileName.toLowerCase();
  for (const [key, value] of sequences) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}
