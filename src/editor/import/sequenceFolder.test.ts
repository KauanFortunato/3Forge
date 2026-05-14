import { describe, it, expect } from "vitest";
import {
  buildSequenceFolderName,
  buildSequenceManifestPath,
  CONVERTER_CREATED_BY,
  CONVERTER_VERSION,
  formatFrameName,
  slugifyVideoName,
  tryReadExistingSequence,
  writeSequenceToProjectFolder,
  type FSADirectoryHandleLike,
  type FSAFileHandleLike,
  type FSAWritableLike,
} from "./sequenceFolder";
import { serialiseSequenceJson, type SequenceJsonV3 } from "./sequenceSchema";

// ---------- in-memory FSA fake ----------

class FakeWritable implements FSAWritableLike {
  constructor(private readonly file: FakeFile) {}
  async write(data: string | BufferSource | Blob): Promise<void> {
    if (typeof data === "string") {
      this.file.text = data;
      this.file.bytes = new TextEncoder().encode(data);
    } else if (data instanceof Blob) {
      this.file.bytes = new Uint8Array(await data.arrayBuffer());
      this.file.text = null;
    } else if (data instanceof Uint8Array) {
      this.file.bytes = data;
      this.file.text = null;
    } else if (ArrayBuffer.isView(data)) {
      const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.file.bytes = new Uint8Array(u8);
      this.file.text = null;
    } else {
      this.file.bytes = new Uint8Array(data);
      this.file.text = null;
    }
  }
  async close(): Promise<void> { /* noop */ }
}

class FakeFile implements FSAFileHandleLike {
  kind = "file" as const;
  text: string | null = null;
  bytes: Uint8Array = new Uint8Array();
  constructor(public name: string) {}
  async getFile(): Promise<File> {
    const buf = this.text !== null ? new TextEncoder().encode(this.text) : this.bytes;
    // Copy through a plain ArrayBuffer so the File constructor accepts the
    // BlobPart in lib.dom under TS strict — Node 22's typed-array generics
    // (`Uint8Array<ArrayBufferLike>`) aren't directly assignable to
    // BlobPart's ArrayBufferView<ArrayBuffer>.
    const partBuffer = new ArrayBuffer(buf.byteLength);
    new Uint8Array(partBuffer).set(buf);
    return new File([partBuffer], this.name);
  }
  async createWritable(): Promise<FSAWritableLike> {
    return new FakeWritable(this);
  }
}

class FakeDir implements FSADirectoryHandleLike {
  kind = "directory" as const;
  private readonly entries = new Map<string, FakeDir | FakeFile>();
  constructor(public name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FSADirectoryHandleLike> {
    const existing = this.entries.get(name);
    if (existing && existing instanceof FakeDir) return existing;
    if (existing) throw new Error(`Entry "${name}" exists but is a file.`);
    if (!options?.create) {
      const err = new Error(`Directory ${name} not found.`);
      (err as { name?: string }).name = "NotFoundError";
      throw err;
    }
    const created = new FakeDir(name);
    this.entries.set(name, created);
    return created;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FSAFileHandleLike> {
    const existing = this.entries.get(name);
    if (existing && existing instanceof FakeFile) return existing;
    if (existing) throw new Error(`Entry "${name}" exists but is a directory.`);
    if (!options?.create) {
      const err = new Error(`File ${name} not found.`);
      (err as { name?: string }).name = "NotFoundError";
      throw err;
    }
    const created = new FakeFile(name);
    this.entries.set(name, created);
    return created;
  }
  // Test-only helper for assertions
  list(): string[] {
    return Array.from(this.entries.keys()).sort();
  }
  // Test-only helper to seed
  setFile(name: string, contents: string | Uint8Array): FakeFile {
    const f = new FakeFile(name);
    if (typeof contents === "string") {
      f.text = contents;
      f.bytes = new TextEncoder().encode(contents);
    } else {
      f.bytes = contents;
    }
    this.entries.set(name, f);
    return f;
  }
}

function makeFakeProjectRoot(): FakeDir {
  return new FakeDir("project");
}

const validHash = "sha256:a1b2c3d4e5f60718a9b8c7d6e5f4030291807060";
const otherHash = "sha256:f1e2d3c4b5a6978869584736251403eeddccbb00";

function baseManifest(overrides: Partial<SequenceJsonV3> = {}): SequenceJsonV3 {
  return {
    version: 3,
    type: "image-sequence",
    format: "png",
    source: "LOOP.mov",
    framePattern: "frame_%06d.png",
    frameCount: 2,
    fps: 25,
    width: 100,
    height: 100,
    durationSec: 0.08,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
    ...overrides,
  };
}

async function readFakeFile(dir: FakeDir, ...path: string[]): Promise<string> {
  let cursor: FSADirectoryHandleLike = dir;
  for (let i = 0; i < path.length - 1; i += 1) {
    cursor = await cursor.getDirectoryHandle(path[i]);
  }
  const fh = await cursor.getFileHandle(path[path.length - 1]);
  return (await fh.getFile()).text();
}

// ---------- slugifyVideoName ----------

describe("slugifyVideoName", () => {
  it("strips the extension and keeps dots / underscores", () => {
    expect(slugifyVideoName("NEW_LKL_logo_LOOP_alt.mov")).toBe("NEW_LKL_logo_LOOP_alt");
    expect(slugifyVideoName("intro.with.dots.mov")).toBe("intro.with.dots");
  });

  it("replaces unsafe chars with _", () => {
    expect(slugifyVideoName("my logo (final v2).mov")).toBe("my_logo_final_v2");
  });

  it("falls back to 'sequence' for empty input", () => {
    expect(slugifyVideoName("   ")).toBe("sequence");
    expect(slugifyVideoName(".mov")).toBe("sequence");
  });

  it("caps at 80 chars", () => {
    const name = "a".repeat(200) + ".mov";
    expect(slugifyVideoName(name).length).toBe(80);
  });
});

// ---------- name builders ----------

describe("buildSequenceFolderName + manifestPath", () => {
  it("appends the first 8 hex of the source hash", () => {
    expect(buildSequenceFolderName("NEW_LKL_logo_LOOP_alt.mov", validHash))
      .toBe("NEW_LKL_logo_LOOP_alt_sequence_a1b2c3d4");
  });

  it("returns the canonical POSIX manifest path", () => {
    const folder = buildSequenceFolderName("x.mov", validHash);
    expect(buildSequenceManifestPath(folder))
      .toBe(`Resources/Textures/${folder}/sequence.json`);
  });
});

describe("formatFrameName", () => {
  it("zero-pads to the pattern width", () => {
    expect(formatFrameName("frame_%06d.png", 1)).toBe("frame_000001.png");
    expect(formatFrameName("frame_%06d.png", 1234)).toBe("frame_001234.png");
    expect(formatFrameName("frame_%04d.webp", 7)).toBe("frame_0007.webp");
  });
});

// ---------- write happy path ----------

describe("writeSequenceToProjectFolder", () => {
  it("creates Resources/Textures/<folder>/{sequence.json, frame_NNNNNN.png}", async () => {
    const root = makeFakeProjectRoot();
    const manifest = baseManifest({ frameCount: 3 });
    const result = await writeSequenceToProjectFolder({
      projectRoot: root,
      videoName: "LOOP.mov",
      sourceHash: validHash,
      manifest,
      frameFetchUrls: ["url-1", "url-2", "url-3"],
      fetchFrame: async (url) => new Blob([`bytes:${url}`], { type: "image/png" }),
    });

    expect(result.folderName).toBe("LOOP_sequence_a1b2c3d4");
    expect(result.manifestPath).toBe("Resources/Textures/LOOP_sequence_a1b2c3d4/sequence.json");
    expect(result.frameFiles.length).toBe(3);

    // Folder structure
    const resources = await root.getDirectoryHandle("Resources");
    const textures = await resources.getDirectoryHandle("Textures");
    const folder = (await textures.getDirectoryHandle(result.folderName)) as FakeDir;
    expect(folder.list()).toEqual([
      "frame_000001.png",
      "frame_000002.png",
      "frame_000003.png",
      "sequence.json",
    ]);

    // sequence.json got stamped with sourceHash + provenance
    const seqText = await readFakeFile(root, "Resources", "Textures", result.folderName, "sequence.json");
    const parsed = JSON.parse(seqText) as SequenceJsonV3;
    expect(parsed.version).toBe(3);
    expect(parsed.sourceHash).toBe(validHash);
    expect(parsed.createdBy).toBe(CONVERTER_CREATED_BY);
    expect(parsed.converterVersion).toBe(CONVERTER_VERSION);
  });

  it("rejects when frameFetchUrls.length disagrees with frameCount", async () => {
    const root = makeFakeProjectRoot();
    await expect(writeSequenceToProjectFolder({
      projectRoot: root,
      videoName: "x.mov",
      sourceHash: validHash,
      manifest: baseManifest({ frameCount: 5 }),
      frameFetchUrls: ["a", "b"],
      fetchFrame: async () => new Blob([""], { type: "image/png" }),
    })).rejects.toThrow(/frameFetchUrls.length/);
  });

  it("calls onProgress once per frame", async () => {
    const root = makeFakeProjectRoot();
    const seen: Array<[number, number]> = [];
    await writeSequenceToProjectFolder({
      projectRoot: root,
      videoName: "x.mov",
      sourceHash: validHash,
      manifest: baseManifest({ frameCount: 4 }),
      frameFetchUrls: ["a", "b", "c", "d"],
      fetchFrame: async () => new Blob([""], { type: "image/png" }),
      onProgress: (i, total) => seen.push([i, total]),
    });
    expect(seen).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });
});

// ---------- reuse / dedupe path ----------

describe("tryReadExistingSequence", () => {
  it("returns null when the folder does not exist", async () => {
    const root = makeFakeProjectRoot();
    const result = await tryReadExistingSequence({
      projectRoot: root,
      videoName: "LOOP.mov",
      sourceHash: validHash,
    });
    expect(result).toBeNull();
  });

  it("returns the manifest + frame files when everything matches", async () => {
    const root = makeFakeProjectRoot();
    await writeSequenceToProjectFolder({
      projectRoot: root,
      videoName: "LOOP.mov",
      sourceHash: validHash,
      manifest: baseManifest({ frameCount: 2 }),
      frameFetchUrls: ["a", "b"],
      fetchFrame: async () => new Blob(["x"], { type: "image/png" }),
    });

    const found = await tryReadExistingSequence({
      projectRoot: root,
      videoName: "LOOP.mov",
      sourceHash: validHash,
    });
    expect(found).not.toBeNull();
    expect(found?.manifest.sourceHash).toBe(validHash);
    expect(found?.manifest.frameCount).toBe(2);
    expect(found?.frameFiles.length).toBe(2);
    expect(found?.manifestPath).toBe("Resources/Textures/LOOP_sequence_a1b2c3d4/sequence.json");
  });

  it("emits a warning and returns null when sequence.json is missing", async () => {
    const root = makeFakeProjectRoot();
    const folderName = buildSequenceFolderName("LOOP.mov", validHash);
    const resources = await root.getDirectoryHandle("Resources", { create: true });
    const textures = await resources.getDirectoryHandle("Textures", { create: true });
    await textures.getDirectoryHandle(folderName, { create: true });

    const warnings: string[] = [];
    const found = await tryReadExistingSequence({
      projectRoot: root,
      videoName: "LOOP.mov",
      sourceHash: validHash,
      onWarning: (m) => warnings.push(m),
    });
    expect(found).toBeNull();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/sequence.json is missing/);
  });

  it("emits a warning and returns null when sequence.json is corrupt", async () => {
    const root = makeFakeProjectRoot();
    const folderName = buildSequenceFolderName("LOOP.mov", validHash);
    const resources = await root.getDirectoryHandle("Resources", { create: true });
    const textures = await resources.getDirectoryHandle("Textures", { create: true });
    const folder = (await textures.getDirectoryHandle(folderName, { create: true })) as FakeDir;
    folder.setFile("sequence.json", "{not json}");

    const warnings: string[] = [];
    const found = await tryReadExistingSequence({
      projectRoot: root,
      videoName: "LOOP.mov",
      sourceHash: validHash,
      onWarning: (m) => warnings.push(m),
    });
    expect(found).toBeNull();
    expect(warnings[0]).toMatch(/invalid/);
  });

  it("returns null when sourceHash inside sequence.json does not match", async () => {
    const root = makeFakeProjectRoot();
    const folderName = buildSequenceFolderName("LOOP.mov", validHash);
    const resources = await root.getDirectoryHandle("Resources", { create: true });
    const textures = await resources.getDirectoryHandle("Textures", { create: true });
    const folder = (await textures.getDirectoryHandle(folderName, { create: true })) as FakeDir;
    folder.setFile(
      "sequence.json",
      serialiseSequenceJson(baseManifest({ sourceHash: otherHash, frameCount: 1 })),
    );
    folder.setFile("frame_000001.png", new Uint8Array([1, 2, 3]));

    const warnings: string[] = [];
    const found = await tryReadExistingSequence({
      projectRoot: root,
      videoName: "LOOP.mov",
      sourceHash: validHash,
      onWarning: (m) => warnings.push(m),
    });
    expect(found).toBeNull();
    expect(warnings[0]).toMatch(/different sourceHash/);
  });

  it("returns null when a referenced frame file is missing", async () => {
    const root = makeFakeProjectRoot();
    const folderName = buildSequenceFolderName("LOOP.mov", validHash);
    const resources = await root.getDirectoryHandle("Resources", { create: true });
    const textures = await resources.getDirectoryHandle("Textures", { create: true });
    const folder = (await textures.getDirectoryHandle(folderName, { create: true })) as FakeDir;
    folder.setFile(
      "sequence.json",
      serialiseSequenceJson(baseManifest({ sourceHash: validHash, frameCount: 2 })),
    );
    folder.setFile("frame_000001.png", new Uint8Array([1, 2, 3]));
    // frame_000002.png intentionally missing

    const warnings: string[] = [];
    const found = await tryReadExistingSequence({
      projectRoot: root,
      videoName: "LOOP.mov",
      sourceHash: validHash,
      onWarning: (m) => warnings.push(m),
    });
    expect(found).toBeNull();
    expect(warnings[0]).toMatch(/missing frame/);
  });
});
