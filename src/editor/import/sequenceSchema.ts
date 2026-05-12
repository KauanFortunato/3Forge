export const SEQUENCE_SCHEMA_VERSION = 3 as const;

export type SequenceFormat = "webp" | "png";
export type SequenceFallbackReason =
  | "webp_encoder_unavailable"
  | "webp_validation_failed";

export interface SequenceJsonV3 {
  version: 3;
  type: "image-sequence";
  format: SequenceFormat;
  source: string;
  framePattern: string;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  loop: boolean;
  alpha: boolean;
  pixelFormat: "rgba";
  /** Optional sha256 of the source .mov, used to detect "same video,
   * folder already converted" so we can skip ffmpeg. Stored as
   * "sha256:<full-hex>". The folder name encodes only the first 8 hex
   * chars; the full digest lives here so reuse checks are exact. */
  sourceHash?: string;
  /** Free-form provenance string. We write "3forge" for sequences this
   * editor produced; legacy / hand-rolled folders may omit it. */
  createdBy?: string;
  /** Converter version that wrote this manifest. Bumped when the on-disk
   * layout or pixel pipeline changes in a way that invalidates reuse. */
  converterVersion?: string;
  fallbackReason?: SequenceFallbackReason;
}

export interface SequenceJsonV2 {
  version: 2;
  type: "image-sequence";
  format: SequenceFormat;
  source: string;
  framePattern: string;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  loop: boolean;
  alpha: boolean;
  pixelFormat: "rgba";
  fallbackReason?: SequenceFallbackReason;
}

export interface SequenceJsonV1 {
  version: 1;
  type: "image-sequence";
  source: string;
  framePattern: string;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  loop: boolean;
  alpha: boolean;
  pixelFormat: "rgba";
}

export type SequenceJson = SequenceJsonV1 | SequenceJsonV2 | SequenceJsonV3;

export function serialiseSequenceJson(j: SequenceJsonV3): string {
  return JSON.stringify(j, null, 2);
}

export function parseSequenceJson(text: string): SequenceJsonV3 {
  const raw = JSON.parse(text) as SequenceJson;
  return normaliseToV3(raw);
}

export class SequenceValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "SequenceValidationError";
  }
}

export function validateSequenceJson(j: SequenceJsonV3): void {
  if (!Number.isFinite(j.fps) || j.fps <= 0) {
    throw new SequenceValidationError(
      "SEQUENCE_FPS_INVALID",
      `fps must be > 0, got ${j.fps}`,
    );
  }
  const expectedExt = j.format === "webp" ? ".webp" : ".png";
  if (!j.framePattern.toLowerCase().endsWith(expectedExt)) {
    throw new SequenceValidationError(
      "SEQUENCE_FORMAT_MISMATCH",
      `framePattern ${j.framePattern} does not match format ${j.format}`,
    );
  }
  if (!Number.isInteger(j.frameCount) || j.frameCount < 1) {
    throw new SequenceValidationError(
      "SEQUENCE_FRAMECOUNT_INVALID",
      `frameCount must be a positive integer, got ${j.frameCount}`,
    );
  }
  if (j.sourceHash !== undefined && !/^sha256:[0-9a-fA-F]{8,}$/.test(j.sourceHash)) {
    throw new SequenceValidationError(
      "SEQUENCE_SOURCEHASH_INVALID",
      `sourceHash must look like "sha256:<hex>", got ${JSON.stringify(j.sourceHash)}`,
    );
  }
}

export function normaliseToV3(raw: SequenceJson): SequenceJsonV3 {
  if (raw.version === 3) {
    return {
      // Re-emit through a known field set so unknown extras don't survive.
      version: 3,
      type: "image-sequence",
      format: raw.format,
      source: raw.source,
      framePattern: raw.framePattern,
      frameCount: raw.frameCount,
      fps: raw.fps,
      width: raw.width,
      height: raw.height,
      durationSec: raw.durationSec,
      loop: raw.loop,
      alpha: raw.alpha,
      pixelFormat: "rgba",
      ...(raw.sourceHash ? { sourceHash: raw.sourceHash } : {}),
      ...(raw.createdBy ? { createdBy: raw.createdBy } : {}),
      ...(raw.converterVersion ? { converterVersion: raw.converterVersion } : {}),
      ...(raw.fallbackReason ? { fallbackReason: raw.fallbackReason } : {}),
    };
  }
  if (raw.version === 2) {
    return {
      version: 3,
      type: "image-sequence",
      format: raw.format,
      source: raw.source,
      framePattern: raw.framePattern,
      frameCount: raw.frameCount,
      fps: raw.fps,
      width: raw.width,
      height: raw.height,
      durationSec: raw.durationSec,
      loop: raw.loop,
      alpha: raw.alpha,
      pixelFormat: "rgba",
      ...(raw.fallbackReason ? { fallbackReason: raw.fallbackReason } : {}),
    };
  }
  // v1
  return {
    version: 3,
    type: "image-sequence",
    format: "png",
    source: raw.source,
    framePattern: raw.framePattern,
    frameCount: raw.frameCount,
    fps: raw.fps,
    width: raw.width,
    height: raw.height,
    durationSec: raw.durationSec,
    loop: raw.loop,
    alpha: raw.alpha,
    pixelFormat: "rgba",
  };
}

/** @deprecated kept for source compatibility — prefer normaliseToV3. */
export function normaliseToV2(raw: SequenceJson): SequenceJsonV3 {
  return normaliseToV3(raw);
}
