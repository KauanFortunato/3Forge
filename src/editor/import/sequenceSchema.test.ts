import { describe, it, expect } from "vitest";
import {
  SEQUENCE_SCHEMA_VERSION,
  parseSequenceJson,
  serialiseSequenceJson,
  validateSequenceJson,
  SequenceValidationError,
  type SequenceJsonV2,
} from "./sequenceSchema";

describe("sequenceSchema v2", () => {
  it("reads v1 legacy as format=png in v2 normalised shape", () => {
    const v1Text = JSON.stringify({
      version: 1,
      type: "image-sequence",
      source: "legacy.mov",
      framePattern: "frame_%06d.png",
      frameCount: 60,
      fps: 0,
      width: 0,
      height: 0,
      durationSec: 0,
      loop: true,
      alpha: true,
      pixelFormat: "rgba",
    });
    const parsed = parseSequenceJson(v1Text);
    expect(parsed.version).toBe(2);
    expect(parsed.format).toBe("png");
    expect(parsed.frameCount).toBe(60);
  });

  it("round-trips a webp sequence.json without losing fields", () => {
    const json: SequenceJsonV2 = {
      version: 2,
      type: "image-sequence",
      format: "webp",
      source: "intro.mov",
      framePattern: "frame_%06d.webp",
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
});

describe("sequenceSchema validation", () => {
  const base: SequenceJsonV2 = {
    version: 2,
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

  it("accepts a valid v2 webp", () => {
    expect(() => validateSequenceJson(base)).not.toThrow();
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
});
