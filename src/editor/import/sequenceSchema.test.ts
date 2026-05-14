import { describe, it, expect } from "vitest";
import {
  SEQUENCE_SCHEMA_VERSION,
  parseSequenceJson,
  serialiseSequenceJson,
  validateSequenceJson,
  SequenceValidationError,
  normaliseToV3,
  type SequenceJsonV3,
} from "./sequenceSchema";

describe("sequenceSchema migrations", () => {
  it("normalises a v1 legacy manifest to v3 with format=png", () => {
    const v1Text = JSON.stringify({
      version: 1,
      type: "image-sequence",
      source: "legacy.mov",
      framePattern: "frame_%06d.png",
      frameCount: 60,
      fps: 25,
      width: 0,
      height: 0,
      durationSec: 0,
      loop: true,
      alpha: true,
      pixelFormat: "rgba",
    });
    const parsed = parseSequenceJson(v1Text);
    expect(parsed.version).toBe(3);
    expect(parsed.format).toBe("png");
    expect(parsed.frameCount).toBe(60);
    expect(parsed.sourceHash).toBeUndefined();
  });

  it("normalises a v2 manifest to v3, preserving fallbackReason", () => {
    const v2Text = JSON.stringify({
      version: 2,
      type: "image-sequence",
      format: "png",
      source: "intro.mov",
      framePattern: "frame_%06d.png",
      frameCount: 120,
      fps: 25,
      width: 1920,
      height: 1080,
      durationSec: 4.8,
      loop: true,
      alpha: true,
      pixelFormat: "rgba",
      fallbackReason: "webp_validation_failed",
    });
    const parsed = parseSequenceJson(v2Text);
    expect(parsed.version).toBe(3);
    expect(parsed.format).toBe("png");
    expect(parsed.fallbackReason).toBe("webp_validation_failed");
    expect(parsed.sourceHash).toBeUndefined();
    expect(parsed.createdBy).toBeUndefined();
  });

  it("round-trips a v3 manifest including sourceHash/createdBy/converterVersion", () => {
    const json: SequenceJsonV3 = {
      version: 3,
      type: "image-sequence",
      format: "png",
      source: "intro.mov",
      sourceHash: "sha256:a1b2c3d4e5f6a7b8",
      createdBy: "3forge",
      converterVersion: "1.0.0",
      framePattern: "frame_%06d.png",
      frameCount: 120,
      fps: 25,
      width: 1920,
      height: 1080,
      durationSec: 4.8,
      loop: true,
      alpha: true,
      pixelFormat: "rgba",
    };
    const text = serialiseSequenceJson(json);
    const parsed = parseSequenceJson(text);
    expect(parsed).toEqual(json);
    expect(parsed.version).toBe(SEQUENCE_SCHEMA_VERSION);
  });

  it("drops unknown extra fields from a v3 manifest", () => {
    const v3WithExtras = JSON.stringify({
      version: 3,
      type: "image-sequence",
      format: "png",
      source: "x.mov",
      framePattern: "frame_%06d.png",
      frameCount: 10,
      fps: 24,
      width: 100,
      height: 100,
      durationSec: 0.42,
      loop: true,
      alpha: true,
      pixelFormat: "rgba",
      bogusField: "should-be-dropped",
    });
    const parsed = parseSequenceJson(v3WithExtras);
    expect((parsed as unknown as { bogusField?: string }).bogusField).toBeUndefined();
  });
});

describe("sequenceSchema validation", () => {
  const base: SequenceJsonV3 = {
    version: 3,
    type: "image-sequence",
    format: "webp",
    source: "x.mov",
    framePattern: "frame_%06d.webp",
    frameCount: 5,
    fps: 25,
    width: 0,
    height: 0,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
  };

  it("accepts a valid v3 webp", () => {
    expect(() => validateSequenceJson(base)).not.toThrow();
  });

  it("accepts a valid v3 with sourceHash", () => {
    expect(() => validateSequenceJson({
      ...base,
      sourceHash: "sha256:a1b2c3d4",
    })).not.toThrow();
  });

  it("rejects fps <= 0", () => {
    expect(() => validateSequenceJson({ ...base, fps: 0 }))
      .toThrow(SequenceValidationError);
    expect(() => validateSequenceJson({ ...base, fps: -1 }))
      .toThrow(SequenceValidationError);
  });

  it("rejects framePattern that does not match format extension", () => {
    expect(() => validateSequenceJson({ ...base, framePattern: "frame_%06d.png" }))
      .toThrow(/SEQUENCE_FORMAT_MISMATCH/);
  });

  it("rejects a sourceHash with no sha256: prefix", () => {
    expect(() => validateSequenceJson({ ...base, sourceHash: "deadbeef" }))
      .toThrow(/SEQUENCE_SOURCEHASH_INVALID/);
  });
});

describe("normaliseToV3 direct", () => {
  it("treats version=2 with format=webp as v3 webp", () => {
    const v3 = normaliseToV3({
      version: 2,
      type: "image-sequence",
      format: "webp",
      source: "x.mov",
      framePattern: "frame_%06d.webp",
      frameCount: 1,
      fps: 25,
      width: 10,
      height: 10,
      durationSec: 0.04,
      loop: false,
      alpha: false,
      pixelFormat: "rgba",
    });
    expect(v3.version).toBe(3);
    expect(v3.format).toBe("webp");
    expect(v3.loop).toBe(false);
  });
});
