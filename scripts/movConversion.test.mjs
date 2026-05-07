// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Hoisted holder so individual tests can swap the mocked ffmpeg-static
// default export between a valid string path and null without re-importing
// the production module.
const ffmpegStaticState = vi.hoisted(() => ({ path: "/mock/path/to/ffmpeg-static" }));

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
vi.mock("ffmpeg-static", () => ({
  get default() {
    return ffmpegStaticState.path;
  },
}));

import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { runMovConversion, resolveFfmpegBinary } from "./movConversion.mjs";

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
  // Reset ffmpeg-static mock to the "valid bundled binary" baseline.
  // Tests that need to simulate ffmpeg-static absent set this to null.
  ffmpegStaticState.path = "/mock/path/to/ffmpeg-static";
  // Also reset the env override so tests don't leak into one another.
  delete process.env.FFMPEG_PATH;
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
    // Each spawn call gets a fresh EventEmitter so the up-front
    // resolveFfmpegBinary probe and the subsequent conversion call
    // both observe their own 'close' event.
    spawn.mockImplementation(() => fakeProc({ exitCode: 0 }));

    const result = await runMovConversion({ folderPath: "C:/proj/with space" });

    // Two spawn calls: (1) `ffmpeg -version` probe, (2) the conversion itself.
    expect(spawn).toHaveBeenCalledTimes(2);
    // Find the conversion call — it's the one with `-i` in argv.
    const conversionCall = spawn.mock.calls.find(([, args]) =>
      Array.isArray(args) && args.includes("-i"),
    );
    expect(conversionCall).toBeDefined();
    const [cmd, args, opts] = conversionCall;
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
    spawn.mockImplementation(() => fakeProc({ exitCode: 0 }));

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

  it("returns FFMPEG_NOT_INSTALLED sentinel when every resolution path fails", async () => {
    // System ffmpeg probe errors with ENOENT and ffmpeg-static is absent —
    // resolveFfmpegBinary returns { path: null }, so runMovConversion
    // short-circuits each pending file with the install-hint sentinel
    // BEFORE attempting any conversion spawn.
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync.mockReturnValueOnce(["PITCH_IN.mov"]);
    const enoent = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    spawn.mockImplementation(() => fakeProc({ error: enoent }));
    ffmpegStaticState.path = null;

    const result = await runMovConversion({ folderPath: "C:/proj" });
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].error).toBe("FFMPEG_NOT_INSTALLED");
    expect(result.ffmpegSource).toBeNull();
  });

  it("captures non-zero ffmpeg exit as a per-file failure with stderr tail", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync.mockReturnValueOnce(["PITCH_IN.mov"]);
    // First spawn call (ffmpeg -version probe) succeeds; second (the
    // conversion) emits a stderr line then exits 1. The events MUST
    // fire AFTER spawn returns the EventEmitter — schedule them inside
    // the mockImplementation so they're queued post-spawn.
    spawn
      .mockImplementationOnce(() => fakeProc({ exitCode: 0 }))
      .mockImplementationOnce(() => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        process.nextTick(() => {
          proc.stderr.emit("data", Buffer.from("Invalid data found when processing input"));
          proc.emit("close", 1);
        });
        return proc;
      });

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
    spawn.mockImplementation(() => fakeProc({ exitCode: 0 }));

    const result = await runMovConversion({ folderPath: "C:/proj", force: true });
    expect(result.skipped.length).toBe(0);
    expect(result.converted).toEqual(["PITCH_IN.mov"]);
    expect(spawn).toHaveBeenCalled();
  });
});

describe("resolveFfmpegBinary", () => {
  it("returns FFMPEG_PATH when the env var is set, regardless of other sources", async () => {
    process.env.FFMPEG_PATH = "/custom/ffmpeg";
    const resolved = await resolveFfmpegBinary();
    expect(resolved.path).toBe("/custom/ffmpeg");
    expect(resolved.source).toBe("env");
    // System probe should NOT have been invoked — env override wins.
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns 'ffmpeg' (system PATH) when the system binary is available", async () => {
    spawn.mockImplementation(() => fakeProc({ exitCode: 0 }));
    const resolved = await resolveFfmpegBinary();
    expect(resolved.path).toBe("ffmpeg");
    expect(resolved.source).toBe("system");
  });

  it("falls back to ffmpeg-static when system PATH ffmpeg is missing (ENOENT)", async () => {
    const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    spawn.mockImplementation(() => fakeProc({ error: enoent }));
    const resolved = await resolveFfmpegBinary();
    expect(resolved.path).toBe("/mock/path/to/ffmpeg-static");
    expect(resolved.source).toBe("static");
  });

  it("returns { path: null, source: 'none' } when both system and ffmpeg-static are unavailable", async () => {
    const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    spawn.mockImplementation(() => fakeProc({ error: enoent }));
    ffmpegStaticState.path = null;
    const resolved = await resolveFfmpegBinary();
    expect(resolved.path).toBeNull();
    expect(resolved.source).toBe("none");
  });
});
