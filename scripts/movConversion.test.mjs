// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// We mock child_process.spawn and node:fs so the lib runs hermetically.
vi.mock("node:child_process", () => {
  const spawnFn = vi.fn();
  return {
    spawn: spawnFn,
    default: { spawn: spawnFn },
  };
});
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual("node:fs/promises");
  return {
    ...actual,
    readdir: vi.fn(),
  };
});

import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { runMovConversion } from "./movConversion.mjs";

function fakeProc({ exitCode = 0, error = null } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  process.nextTick(() => {
    if (error) {
      proc.emit("error", error);
    } else {
      proc.emit("close", exitCode);
    }
  });
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runMovConversion", () => {
  it("rejects when folderPath does not contain Resources/Textures", async () => {
    existsSync.mockReturnValue(false);
    const result = await runMovConversion({ folderPath: "C:/nope" });
    expect(result.failed.length).toBe(0);
    expect(result.warnings.some((w) => /Resources\/Textures/.test(w))).toBe(true);
  });

  it("returns 'no .mov assets' when Textures has no .mov files", async () => {
    existsSync.mockReturnValue(true);
    readdirSync.mockReturnValue(["logo.png", "scene.w3d"]);
    const result = await runMovConversion({ folderPath: "C:/proj" });
    expect(result.converted.length).toBe(0);
    expect(result.skipped.length).toBe(0);
    expect(result.failed.length).toBe(0);
  });

  it("skips a .mov when sequence.json already exists and force=false", async () => {
    existsSync.mockImplementation((p) =>
      String(p).endsWith("Resources/Textures") ||
      String(p).endsWith("PITCH_IN_frames/sequence.json"),
    );
    readdirSync.mockReturnValue(["PITCH_IN.mov"]);
    const result = await runMovConversion({ folderPath: "C:/proj", force: false });
    expect(result.skipped).toEqual(["PITCH_IN.mov"]);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("invokes ffmpeg via spawn(cmd, argsArray) — never as a shell string", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync
      .mockReturnValueOnce(["PITCH_IN.mov"])  // initial Textures listing
      .mockReturnValueOnce(["frame_000001.png", "frame_000002.png", "frame_000003.png"]);  // post-convert frame count
    spawn.mockReturnValue(fakeProc({ exitCode: 0 }));

    const result = await runMovConversion({ folderPath: "C:/proj/with space" });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawn.mock.calls[0];
    expect(cmd).toBe("ffmpeg");
    expect(Array.isArray(args)).toBe(true);
    // Args MUST contain the input and output as separate entries — never quoted into the cmd string.
    expect(args).toContain("-i");
    expect(args.some((a) => a.includes("with space") && a.endsWith("PITCH_IN.mov"))).toBe(true);
    expect(opts?.shell).toBeFalsy();
    expect(result.converted).toEqual(["PITCH_IN.mov"]);
  });

  it("writes sequence.json with the locked v1 schema (type, alpha, pixelFormat)", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync
      .mockReturnValueOnce(["PITCH_IN.mov"])
      .mockReturnValueOnce(["frame_000001.png", "frame_000002.png"]);
    spawn.mockReturnValue(fakeProc({ exitCode: 0 }));

    await runMovConversion({ folderPath: "C:/proj" });

    const writeCall = writeFileSync.mock.calls.find(([p]) => String(p).endsWith("sequence.json"));
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall[1]);
    expect(written.version).toBe(1);
    expect(written.type).toBe("image-sequence");
    expect(written.source).toBe("PITCH_IN.mov");
    expect(written.framePattern).toBe("frame_%06d.png");
    expect(written.frameCount).toBe(2);
    expect(written.alpha).toBe(true);
    expect(written.pixelFormat).toBe("rgba");
    expect(written.loop).toBe(true);
  });

  it("returns FFMPEG_NOT_INSTALLED sentinel when spawn fails with ENOENT", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync.mockReturnValueOnce(["PITCH_IN.mov"]);
    const enoent = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    spawn.mockReturnValue(fakeProc({ error: enoent }));

    const result = await runMovConversion({ folderPath: "C:/proj" });
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].error).toBe("FFMPEG_NOT_INSTALLED");
  });

  it("captures non-zero ffmpeg exit as a per-file failure with stderr tail", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync.mockReturnValueOnce(["PITCH_IN.mov"]);
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    process.nextTick(() => {
      proc.stderr.emit("data", Buffer.from("Invalid data found when processing input"));
      proc.emit("close", 1);
    });
    spawn.mockReturnValue(proc);

    const result = await runMovConversion({ folderPath: "C:/proj" });
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].filename).toBe("PITCH_IN.mov");
    expect(result.failed[0].error).toContain("Invalid data");
  });

  it("calls onProgress before each file with index/total/filename", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync
      .mockReturnValueOnce(["A.mov", "B.mov"])
      .mockReturnValueOnce(["frame_000001.png"])
      .mockReturnValueOnce(["frame_000001.png"]);
    // mockImplementation (not mockReturnValue) so each spawn() gets a fresh
    // EventEmitter — otherwise the second iteration awaits a 'close' event
    // that already fired on the shared instance during the first iteration.
    spawn.mockImplementation(() => fakeProc({ exitCode: 0 }));

    const events = [];
    await runMovConversion({
      folderPath: "C:/proj",
      onProgress: (e) => events.push(e),
    });
    expect(events.length).toBe(2);
    expect(events[0]).toEqual({ index: 0, total: 2, filename: "A.mov" });
    expect(events[1]).toEqual({ index: 1, total: 2, filename: "B.mov" });
  });

  it("force=true reconverts even when sequence.json exists", async () => {
    existsSync.mockImplementation((p) =>
      String(p).endsWith("Resources/Textures") ||
      String(p).endsWith("sequence.json"),
    );
    readdirSync
      .mockReturnValueOnce(["PITCH_IN.mov"])
      .mockReturnValueOnce(["frame_000001.png"]);
    spawn.mockReturnValue(fakeProc({ exitCode: 0 }));

    const result = await runMovConversion({ folderPath: "C:/proj", force: true });
    expect(result.skipped.length).toBe(0);
    expect(result.converted).toEqual(["PITCH_IN.mov"]);
    expect(spawn).toHaveBeenCalled();
  });
});
