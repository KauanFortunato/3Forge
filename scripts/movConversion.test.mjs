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
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMovConversion, resolveFfmpegBinary, runMovConversionInTemp, probeWebpEncoder, _resetEncoderProbeCache, smokeTestWebpFrame } from "./movConversion.mjs";

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

  it("writes sequence.json with v2 schema (type, format, alpha, pixelFormat, fps)", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync
      .mockReturnValueOnce(["PITCH_IN.mov"])
      .mockReturnValueOnce(["frame_000001.png", "frame_000002.png"]);
    spawn.mockImplementation(() => fakeProc({ exitCode: 0 }));

    await runMovConversion({ folderPath: "C:/proj" });

    const writeCall = writeFileSync.mock.calls.find(([p]) => String(p).endsWith("sequence.json"));
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall[1]);
    expect(written.version).toBe(2);
    expect(written.type).toBe("image-sequence");
    expect(written.format).toBe("png");
    expect(written.source).toBe("PITCH_IN.mov");
    expect(written.framePattern).toBe("frame_%06d.png");
    expect(written.frameCount).toBe(2);
    expect(written.fps).toBe(25);
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

describe("runMovConversionInTemp dual format", () => {
  it("emits .webp frames + format:webp when preferredFormat=webp and probe is available", async () => {
    _resetEncoderProbeCache();
    // mkdirSync and writeFileSync are mocked (no-op); readdirSync must return frames.
    // First call to readdirSync is the cleanup loop (returns []); second is the frame scan.
    readdirSync
      .mockReturnValueOnce([])          // cleanup: no existing files to wipe
      .mockReturnValueOnce(["frame_000001.webp"]);  // frame scan after ffmpeg run
    const capturedArgs = [];
    const result = await runMovConversionInTemp({
      movBuffer: Buffer.from([0x00, 0x00, 0x00, 0x14]),
      filename: "x.mov",
      jobId: "job-1",
      tempRoot: join(tmpdir(), "r3-mov-test-task8"),
      preferredFormat: "webp",
      _ffmpegOverride: {
        run: async (args, _framesDir) => {
          capturedArgs.push(...args);
        },
      },
      _probeOverride: { available: true },
      _smokeOverride: { ok: true },
    });
    expect(capturedArgs).toContain("-c:v");
    expect(capturedArgs).toContain("libwebp");
    expect(capturedArgs).toContain("-lossless");
    expect(capturedArgs).toContain("1");
    expect(result.sequenceJson.format).toBe("webp");
    expect(result.sequenceJson.framePattern).toBe("frame_%06d.webp");
    expect(result.sequenceJson.fps).toBe(25);
    expect(result.framePaths[0].endsWith(".webp")).toBe(true);
    expect(result.fallbackReason ?? null).toBeNull();
  });

  it("falls back to png with reason webp_validation_failed when smoke test rejects the webp output", async () => {
    _resetEncoderProbeCache();
    // readdirSync calls in order:
    //   1. cleanup loop before first ffmpeg run (webp) -> []
    //   2. cleanup loop before second ffmpeg run (png fallback) -> []
    //   3. frame scan after second run -> ["frame_000001.png"]
    readdirSync
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce(["frame_000001.png"]);
    const ffmpegArgs = [];
    const result = await runMovConversionInTemp({
      movBuffer: Buffer.from([0x00]),
      filename: "x.mov",
      jobId: "job-smoke-fail",
      tempRoot: join(tmpdir(), "r3-mov-test-smoke"),
      preferredFormat: "webp",
      _ffmpegOverride: {
        run: async (args, _framesDir) => {
          ffmpegArgs.push(args.slice());
        },
      },
      _probeOverride: { available: true },
      _smokeOverride: { ok: false, reason: "rgba_mismatch" },
    });
    expect(result.sequenceJson.format).toBe("png");
    expect(result.sequenceJson.framePattern).toBe("frame_%06d.png");
    expect(result.fallbackReason).toBe("webp_validation_failed");
    expect(result.framePaths[0].endsWith(".png")).toBe(true);
    expect(result.framePaths[0].endsWith(".webp")).toBe(false);
    // ffmpeg called twice: once for webp, once for png re-run
    expect(ffmpegArgs.length).toBe(2);
    expect(ffmpegArgs[0].some((a) => typeof a === "string" && a.includes("libwebp"))).toBe(true);
    expect(ffmpegArgs[1].some((a) => typeof a === "string" && a.includes("libwebp"))).toBe(false);
  });

  it("falls back to png with reason webp_encoder_unavailable when probe says no", async () => {
    _resetEncoderProbeCache();
    readdirSync
      .mockReturnValueOnce([])           // cleanup loop
      .mockReturnValueOnce(["frame_000001.png"]);  // frame scan
    const capturedArgs = [];
    const result = await runMovConversionInTemp({
      movBuffer: Buffer.from([0x00]),
      filename: "x.mov",
      jobId: "job-2",
      tempRoot: join(tmpdir(), "r3-mov-test-task8"),
      preferredFormat: "webp",
      _ffmpegOverride: {
        run: async (args, _framesDir) => {
          capturedArgs.push(...args);
        },
      },
      _probeOverride: { available: false },
    });
    expect(capturedArgs).not.toContain("-c:v");
    expect(result.sequenceJson.format).toBe("png");
    expect(result.sequenceJson.framePattern).toBe("frame_%06d.png");
    expect(result.fallbackReason).toBe("webp_encoder_unavailable");
  });
});

describe("smokeTestWebpFrame", () => {
  it("returns ok:true when the webp and png decoded RGBA buffers match", async () => {
    const result = await smokeTestWebpFrame({
      ffmpegPath: "/fake/ffmpeg",
      sourcePath: "/fake/source.mov",
      webpFrame: "/fake/frame.webp",
      _decode: async (_target) => {
        // Same buffer for both webp and png paths -> match.
        return Buffer.from([1, 2, 3, 4]);
      },
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when buffers differ", async () => {
    let i = 0;
    const result = await smokeTestWebpFrame({
      ffmpegPath: "/fake/ffmpeg",
      sourcePath: "/fake/source.mov",
      webpFrame: "/fake/frame.webp",
      _decode: async () => Buffer.from(i++ === 0 ? [1, 2, 3, 4] : [9, 9, 9, 9]),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rgba_mismatch");
  });

  it("returns ok:false when decode throws", async () => {
    const result = await smokeTestWebpFrame({
      ffmpegPath: "/fake/ffmpeg",
      sourcePath: "/fake/source.mov",
      webpFrame: "/fake/frame.webp",
      _decode: async () => { throw new Error("boom"); },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("decode_error");
  });

  it("tolerates RGB drift in fully-transparent pixels (libwebp canonicalises RGB to 0 there)", async () => {
    // Webp pixel: alpha=0, RGB zeroed by libwebp. Source pixel: alpha=0,
    // arbitrary RGB. Visually identical (invisible), so must NOT fall back.
    let i = 0;
    const result = await smokeTestWebpFrame({
      ffmpegPath: "/fake/ffmpeg",
      sourcePath: "/fake/source.mov",
      webpFrame: "/fake/frame.webp",
      _decode: async () =>
        Buffer.from(i++ === 0
          ? [0, 0, 0, 0, 200, 100, 50, 255]
          : [180, 90, 40, 0, 200, 100, 50, 255]),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects RGB drift in visible pixels", async () => {
    let i = 0;
    const result = await smokeTestWebpFrame({
      ffmpegPath: "/fake/ffmpeg",
      sourcePath: "/fake/source.mov",
      webpFrame: "/fake/frame.webp",
      _decode: async () =>
        Buffer.from(i++ === 0
          ? [10, 20, 30, 255]
          : [10, 21, 30, 255]),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rgba_mismatch");
  });

  it("rejects alpha mismatches even when RGB matches", async () => {
    let i = 0;
    const result = await smokeTestWebpFrame({
      ffmpegPath: "/fake/ffmpeg",
      sourcePath: "/fake/source.mov",
      webpFrame: "/fake/frame.webp",
      _decode: async () =>
        Buffer.from(i++ === 0
          ? [10, 20, 30, 128]
          : [10, 20, 30, 200]),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rgba_mismatch");
  });
});

describe("probeWebpEncoder", () => {
  beforeEach(() => _resetEncoderProbeCache());

  it("returns { available: true } when libwebp is present in -encoders output", async () => {
    const r = await probeWebpEncoder({
      _spawn: (_bin, args) => ({
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev, cb) => {
          if (ev === "close") setImmediate(() => cb(0, args));
        },
        _stdoutPayload: "V..... libwebp              libwebp WebP image\n",
      }),
      _readStdout: async (proc) => proc._stdoutPayload,
    });
    expect(r).toEqual({ available: true });
  });

  it("returns { available: false } when ffmpeg has no libwebp encoder line", async () => {
    const r = await probeWebpEncoder({
      _spawn: (_bin, _args) => ({
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev, cb) => { if (ev === "close") setImmediate(() => cb(0)); },
        _stdoutPayload: "V..... png_pipe              PNG (Portable Network Graphics)\n",
      }),
      _readStdout: async (proc) => proc._stdoutPayload,
    });
    expect(r).toEqual({ available: false });
  });

  it("does not hang when the child process emits 'close' only once (regression)", async () => {
    // Real ChildProcess emits 'close' exactly once. The earlier code added
    // a second `proc.on('close')` listener AFTER awaiting readStdout, which
    // never fired in production and hung the entire conversion pipeline.
    // The 2s vitest timeout below catches any reintroduced second-listener
    // pattern; the assertion catches a wrong availability decision.
    const fakeSpawn = () => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      process.nextTick(() => {
        proc.stdout.emit("data", Buffer.from("V..... libwebp              libwebp WebP image\n"));
        proc.emit("close", 0);
      });
      return proc;
    };
    const r = await probeWebpEncoder({ _spawn: fakeSpawn });
    expect(r).toEqual({ available: true });
  }, 2000);

  it("caches the probe result across calls", async () => {
    let calls = 0;
    const fakeSpawn = () => {
      calls += 1;
      return {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev, cb) => { if (ev === "close") setImmediate(() => cb(0)); },
        _stdoutPayload: "V..... libwebp\n",
      };
    };
    const opts = { _spawn: fakeSpawn, _readStdout: async (p) => p._stdoutPayload };
    await probeWebpEncoder(opts);
    await probeWebpEncoder(opts);
    expect(calls).toBe(1);
  });
});

describe("runMovConversion v2 schema (CLI)", () => {
  it("writes sequence.json with version: 2 and format: png on the cli path", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync
      .mockReturnValueOnce(["intro.mov"])
      .mockReturnValueOnce(["frame_000001.png", "frame_000002.png"]);
    spawn.mockImplementation(() => fakeProc({ exitCode: 0 }));

    const result = await runMovConversion({ folderPath: "C:/proj" });

    const writeCall = writeFileSync.mock.calls.find(([p]) => String(p).endsWith("sequence.json"));
    expect(writeCall).toBeDefined();
    const seq = JSON.parse(writeCall[1]);
    expect(seq.version).toBe(2);
    expect(["webp", "png"]).toContain(seq.format);
    expect(seq.fps).toBeGreaterThan(0);
    expect(result.converted).toContain("intro.mov");
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
