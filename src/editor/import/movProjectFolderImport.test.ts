import { describe, it, expect } from "vitest";
import {
  ensureWritableProjectRoot,
  mintFrameUrlsFromFiles,
  persistSequencesToProjectFolder,
} from "./movProjectFolderImport";
import {
  buildSequenceFolderName,
  buildSequenceManifestPath,
  writeSequenceToProjectFolder,
  type FSADirectoryHandleLike,
  type FSAFileHandleLike,
  type FSAWritableLike,
} from "./sequenceFolder";
import { computeSequenceSourceHash } from "./sequenceHash";
import type { SequenceJsonV3 } from "./sequenceSchema";

// ----- Reuse the in-memory FSA fake from sequenceFolder tests -----
// (Kept inline rather than exported from a shared test util so each
// test file remains self-contained.)

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
    // Same workaround as sequenceFolder.test.ts — Node 22 typed-array
    // generics aren't directly assignable to BlobPart under strict TS.
    const partBuffer = new ArrayBuffer(buf.byteLength);
    new Uint8Array(partBuffer).set(buf);
    return new File([partBuffer], this.name);
  }
  async createWritable(): Promise<FSAWritableLike> { return new FakeWritable(this); }
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
}

function manifestStub(overrides: Partial<SequenceJsonV3> = {}): SequenceJsonV3 {
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

function urlFactoryFake() {
  let counter = 0;
  return {
    createObjectURL: (_blob: Blob) => `blob:fake-${++counter}`,
  };
}

// ---------- ensureWritableProjectRoot ----------

describe("ensureWritableProjectRoot", () => {
  it("returns denied/no-handle when null is passed", async () => {
    const result = await ensureWritableProjectRoot(null);
    expect(result.kind).toBe("denied");
    if (result.kind === "denied") expect(result.reason).toBe("no-handle");
  });

  it("returns denied/unsupported when permission API is missing", async () => {
    const root = new FakeDir("project") as unknown as FSADirectoryHandleLike;
    const result = await ensureWritableProjectRoot(root);
    expect(result.kind).toBe("denied");
    if (result.kind === "denied") expect(result.reason).toBe("unsupported");
  });

  it("returns ready when permission is already granted", async () => {
    const root = Object.assign(new FakeDir("project"), {
      queryPermission: async () => "granted" as PermissionState,
      requestPermission: async () => "granted" as PermissionState,
    });
    const result = await ensureWritableProjectRoot(root as unknown as FSADirectoryHandleLike);
    expect(result.kind).toBe("ready");
  });

  it("requests permission and becomes ready when granted", async () => {
    const root = Object.assign(new FakeDir("project"), {
      queryPermission: async () => "prompt" as PermissionState,
      requestPermission: async () => "granted" as PermissionState,
    });
    const result = await ensureWritableProjectRoot(root as unknown as FSADirectoryHandleLike);
    expect(result.kind).toBe("ready");
  });

  it("returns denied/permission-denied when the user refuses", async () => {
    const root = Object.assign(new FakeDir("project"), {
      queryPermission: async () => "prompt" as PermissionState,
      requestPermission: async () => "denied" as PermissionState,
    });
    const result = await ensureWritableProjectRoot(root as unknown as FSADirectoryHandleLike);
    expect(result.kind).toBe("denied");
    if (result.kind === "denied") expect(result.reason).toBe("permission-denied");
  });
});

// ---------- mintFrameUrlsFromFiles ----------

describe("mintFrameUrlsFromFiles", () => {
  it("returns one blob URL per file in order", () => {
    const factory = urlFactoryFake();
    const files = [new File([""], "a"), new File([""], "b"), new File([""], "c")];
    expect(mintFrameUrlsFromFiles(files, factory)).toEqual([
      "blob:fake-1",
      "blob:fake-2",
      "blob:fake-3",
    ]);
  });
});

// ---------- persistSequencesToProjectFolder ----------

describe("persistSequencesToProjectFolder", () => {
  it("writes a new sequence and reports written with project-folder metadata", async () => {
    const root = new FakeDir("project") as unknown as FSADirectoryHandleLike;
    const movBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const outcomes = await persistSequencesToProjectFolder({
      projectRoot: root,
      movs: [
        {
          movName: "LOOP.mov",
          movBytes,
          backendManifest: manifestStub({ frameCount: 2, source: "LOOP.mov" }),
          frameFetchUrls: ["http://temp/0001", "http://temp/0002"],
        },
      ],
      fetchFrame: async (url) => new Blob([url], { type: "image/png" }),
      urlFactory: urlFactoryFake(),
    });
    expect(outcomes.length).toBe(1);
    expect(outcomes[0].status).toBe("written");
    const meta = outcomes[0].metadata!;
    expect(meta.storageType).toBe("project-folder");
    expect(meta.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const expectedHash = await computeSequenceSourceHash(movBytes);
    const expectedFolder = buildSequenceFolderName("LOOP.mov", expectedHash);
    expect(meta.manifestPath).toBe(buildSequenceManifestPath(expectedFolder));
    expect(meta.frameUrls).toHaveLength(2);
  });

  it("returns reused when a matching project-folder sequence already exists", async () => {
    const root = new FakeDir("project") as unknown as FSADirectoryHandleLike;
    const movBytes = new Uint8Array([10, 20, 30, 40]);
    const sourceHash = await computeSequenceSourceHash(movBytes);

    // Seed the project folder via writeSequenceToProjectFolder so the
    // on-disk shape is identical to what the orchestrator would have
    // written itself.
    await writeSequenceToProjectFolder({
      projectRoot: root,
      videoName: "INTRO.mov",
      sourceHash,
      manifest: manifestStub({ frameCount: 2, source: "INTRO.mov" }),
      frameFetchUrls: ["http://temp/0001", "http://temp/0002"],
      fetchFrame: async (url) => new Blob([url], { type: "image/png" }),
    });

    // Now run the orchestrator with NO backend manifest — pure reuse
    // path. If the orchestrator ever tried to write again, the missing
    // backendManifest would make it return "missing-backend"; reused
    // means dedupe short-circuited the backend.
    const outcomes = await persistSequencesToProjectFolder({
      projectRoot: root,
      movs: [{ movName: "INTRO.mov", movBytes, backendManifest: null }],
      urlFactory: urlFactoryFake(),
    });
    expect(outcomes[0].status).toBe("reused");
    expect(outcomes[0].metadata?.storageType).toBe("project-folder");
    expect(outcomes[0].metadata?.sourceHash).toBe(sourceHash);
    expect(outcomes[0].frameFiles?.length).toBe(2);
  });

  it("reports missing-backend when no existing folder and no manifest provided", async () => {
    const root = new FakeDir("project") as unknown as FSADirectoryHandleLike;
    const outcomes = await persistSequencesToProjectFolder({
      projectRoot: root,
      movs: [{ movName: "NEW.mov", movBytes: new Uint8Array([1]), backendManifest: null }],
    });
    expect(outcomes[0].status).toBe("missing-backend");
  });

  it("captures per-MOV errors instead of aborting the whole batch", async () => {
    const root = new FakeDir("project") as unknown as FSADirectoryHandleLike;
    const outcomes = await persistSequencesToProjectFolder({
      projectRoot: root,
      movs: [
        {
          movName: "ok.mov",
          movBytes: new Uint8Array([1, 2]),
          backendManifest: manifestStub({ frameCount: 1, source: "ok.mov" }),
          frameFetchUrls: ["http://temp/0001"],
        },
        {
          movName: "bad.mov",
          movBytes: new Uint8Array([3, 4]),
          backendManifest: manifestStub({ frameCount: 1, source: "bad.mov" }),
          // Disagrees with frameCount on purpose — writer throws.
          frameFetchUrls: ["http://temp/0001", "http://temp/0002"],
        },
      ],
      fetchFrame: async (url) => new Blob([url], { type: "image/png" }),
      urlFactory: urlFactoryFake(),
    });
    expect(outcomes.map((o) => o.status)).toEqual(["written", "failed"]);
    expect(outcomes[1].error).toMatch(/frameFetchUrls\.length/);
  });
});
