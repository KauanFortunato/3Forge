import { describe, it, expect } from "vitest";
import { computeSequenceSourceHash, shortHashFromSourceHash } from "./sequenceHash";

describe("computeSequenceSourceHash", () => {
  it("returns a canonical sha256:<hex> string for an empty buffer", async () => {
    const hash = await computeSequenceSourceHash(new Uint8Array());
    // sha256("") is well-known. Mostly we care that the format is right
    // and the result is deterministic.
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hash).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic for identical inputs", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const a = await computeSequenceSourceHash(bytes);
    const b = await computeSequenceSourceHash(bytes);
    expect(a).toBe(b);
  });

  it("returns different hashes for different inputs", async () => {
    const a = await computeSequenceSourceHash(new Uint8Array([1, 2, 3]));
    const b = await computeSequenceSourceHash(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });

  it("accepts an ArrayBuffer just like a Uint8Array", async () => {
    const data = new Uint8Array([9, 8, 7, 6]);
    const fromArrayBuffer = await computeSequenceSourceHash(data.buffer);
    const fromTypedArray = await computeSequenceSourceHash(data);
    expect(fromArrayBuffer).toBe(fromTypedArray);
  });
});

describe("shortHashFromSourceHash", () => {
  it("takes the first 8 hex chars and lowercases them", () => {
    expect(shortHashFromSourceHash("sha256:A1B2C3D4E5F6A7B8C9D0E1F2")).toBe("a1b2c3d4");
  });

  it("throws if the prefix is wrong", () => {
    expect(() => shortHashFromSourceHash("md5:deadbeef00000000")).toThrow();
  });

  it("throws if the hex body is too short", () => {
    expect(() => shortHashFromSourceHash("sha256:abc")).toThrow();
  });
});
