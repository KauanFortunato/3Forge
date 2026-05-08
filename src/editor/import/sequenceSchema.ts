export const SEQUENCE_SCHEMA_VERSION = 2 as const;

export type SequenceFormat = "webp" | "png";
export type SequenceFallbackReason =
  | "webp_encoder_unavailable"
  | "webp_validation_failed";

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

export type SequenceJson = SequenceJsonV1 | SequenceJsonV2;

export function serialiseSequenceJson(j: SequenceJsonV2): string {
  return JSON.stringify(j, null, 2);
}

export function parseSequenceJson(text: string): SequenceJsonV2 {
  const raw = JSON.parse(text) as SequenceJson;
  return normaliseToV2(raw);
}

export class SequenceValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "SequenceValidationError";
  }
}

export function validateSequenceJson(j: SequenceJsonV2): void {
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
}

export function normaliseToV2(raw: SequenceJson): SequenceJsonV2 {
  if (raw.version === 2) return raw;
  return {
    version: 2,
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
