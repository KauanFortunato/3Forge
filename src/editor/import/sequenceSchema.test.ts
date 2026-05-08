import { describe, it, expect } from "vitest";
import {
  SEQUENCE_SCHEMA_VERSION,
  parseSequenceJson,
  serialiseSequenceJson,
  type SequenceJsonV2,
} from "./sequenceSchema";

describe("sequenceSchema v2", () => {
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
