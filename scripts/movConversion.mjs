/*
 * Shared conversion lib used by the CLI wrapper (convert-w3d-mov-to-sequence.mjs)
 * AND the Vite dev plugin (movConvertPlugin.mjs).
 *
 * Public API:
 *   runMovConversion({ folderPath, force?, onProgress? })
 *     -> { converted[], skipped[], failed[], sequenceJsonPaths[], warnings[],
 *          ffmpegSource? }
 *   resolveFfmpegBinary() -> { path, source }
 *
 * Conventions enforced:
 *   - ffmpeg invoked via spawn(cmd, argsArray) — NEVER exec — so paths
 *     with spaces or unicode tricks can't shell-inject.
 *   - sequence.json is the locked v1 schema (type, alpha, pixelFormat).
 *   - When ffmpeg is missing (ENOENT), every pending file gets the
 *     FFMPEG_NOT_INSTALLED sentinel so the caller can format a single
 *     install hint instead of N stderr dumps.
 *   - The ffmpeg binary is resolved via resolveFfmpegBinary() in priority:
 *     env override -> system PATH -> bundled ffmpeg-static -> none.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const FRAME_PATTERN = "frame_%06d.png";
const FRAME_PATTERN_PNG = "frame_%06d.png";
const FRAME_PATTERN_WEBP = "frame_%06d.webp";

/**
 * Round-trip frame 1: encode the source's first frame to PNG via ffmpeg
 * (`-vframes 1` ground truth), decode both the produced WebP and the
 * ground-truth PNG to raw RGBA via two more ffmpeg invocations, and
 * `Buffer.compare()` the two raw buffers. With `-c:v libwebp -lossless 1`,
 * the bytes MUST match -- any difference means the encoder is buggy.
 */
export async function smokeTestWebpFrame({
  ffmpegPath, sourcePath, webpFrame, _decode,
}) {
  const decode = _decode ?? defaultDecodeRgba;
  let webpRgba, pngRgba;
  try {
    webpRgba = await decode({ ffmpegPath, target: webpFrame, kind: "webp" });
    pngRgba = await decode({ ffmpegPath, target: sourcePath, kind: "source-frame-1" });
  } catch {
    return { ok: false, reason: "decode_error" };
  }
  if (!webpRgba || !pngRgba || webpRgba.length === 0 || pngRgba.length === 0) {
    return { ok: false, reason: "decode_error" };
  }
  if (Buffer.compare(webpRgba, pngRgba) !== 0) {
    return { ok: false, reason: "rgba_mismatch" };
  }
  return { ok: true };
}

async function defaultDecodeRgba({ ffmpegPath, target, kind }) {
  const args = kind === "source-frame-1"
    ? ["-y", "-i", target, "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]
    : ["-y", "-i", target, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"];
  return new Promise((resolve, reject) => {
    const chunks = [];
    let stderrBuf = "";
    const proc = spawn(ffmpegPath, args, { shell: false });
    proc.stdout?.on("data", (c) => chunks.push(c));
    proc.stderr?.on("data", (c) => {
      stderrBuf += c.toString();
      if (stderrBuf.length > 8 * 1024) stderrBuf = stderrBuf.slice(-8 * 1024);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`decode exit ${code}: ${stderrBuf.slice(-200)}`));
    });
  });
}

/**
 * Buffer-based variant: convert a .mov already in memory to a PNG sequence
 * inside `<tempRoot>/<jobId>/frames/`. Does NOT write sequence.json — the
 * Vite plugin returns the manifest object to the browser, which keeps the
 * frames in-memory only (no disk write on the user's project folder).
 *
 * Returns { framesDir, framePaths[], sequenceJson, ffmpegSource }.
 * Throws { code: "FFMPEG_NOT_INSTALLED" } / { code: "MOV_DECODE_FAILED" }.
 */
export async function runMovConversionInTemp({
  movBuffer, filename, jobId, tempRoot, preferredFormat = "webp",
  _probeOverride, _ffmpegOverride, _smokeOverride,
} = {}) {
  if (!movBuffer || !filename || !jobId || !tempRoot) {
    throw Object.assign(new Error("missing argument"), { code: "INVALID_ARGS" });
  }
  const ff = await resolveFfmpegBinary();
  if (!ff.path) {
    throw Object.assign(new Error("ffmpeg is required"), { code: "FFMPEG_NOT_INSTALLED" });
  }
  const probe = _probeOverride ?? (await probeWebpEncoder());
  let chosenFormat = preferredFormat === "webp" && probe.available ? "webp" : "png";
  let fallbackReason = null;
  if (preferredFormat === "webp" && !probe.available) {
    fallbackReason = "webp_encoder_unavailable";
  }

  const jobDir = path.join(tempRoot, jobId);
  const framesDir = path.join(jobDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const sourcePath = path.join(jobDir, "source.mov");
  writeFileSync(sourcePath, movBuffer);

  const runOnce = async (format) => {
    // Wipe the frames dir between attempts so a failed webp run does not
    // leave .webp files alongside a fallback .png run.
    for (const n of readdirSync(framesDir)) {
      const p = path.join(framesDir, n);
      try { statSync(p).isFile() && unlinkSync(p); } catch { /* ignore */ }
    }
    const pattern = format === "webp" ? FRAME_PATTERN_WEBP : FRAME_PATTERN_PNG;
    const baseArgs = [
      "-y", "-i", sourcePath, "-vsync", "0",
    ];
    const formatArgs = format === "webp"
      ? [
          "-c:v", "libwebp",
          "-lossless", "1",
          "-compression_level", "6",
          "-pix_fmt", "rgba",
        ]
      : ["-pix_fmt", "rgba"];
    const tailArgs = ["-start_number", "1", path.join(framesDir, pattern)];
    const args = [...baseArgs, ...formatArgs, ...tailArgs];
    if (_ffmpegOverride) {
      await _ffmpegOverride.run(args, framesDir);
    } else {
      await runFfmpeg(ff.path, args);
    }
  };

  await runOnce(chosenFormat);

  // WebP smoke-test: round-trip frame 1 against a ground-truth PNG re-encode
  // of the same input frame. Only enforced when we picked webp.
  if (chosenFormat === "webp") {
    const smoke = _smokeOverride ?? (await smokeTestWebpFrame({
      ffmpegPath: ff.path,
      sourcePath,
      webpFrame: path.join(framesDir, "frame_000001.webp"),
    }));
    if (!smoke.ok) {
      chosenFormat = "png";
      fallbackReason = "webp_validation_failed";
      await runOnce("png");
    }
  }

  const ext = chosenFormat === "webp" ? "webp" : "png";
  const framePaths = readdirSync(framesDir)
    .filter((n) => new RegExp(`^frame_\\d+\\.${ext}$`, "i").test(n))
    .sort()
    .map((n) => path.join(framesDir, n));
  if (framePaths.length === 0) {
    throw Object.assign(new Error("MOV_DECODE_FAILED: zero frames produced"), {
      code: "MOV_DECODE_FAILED",
    });
  }

  const sequenceJson = {
    version: 2,
    type: "image-sequence",
    format: chosenFormat,
    source: filename,
    framePattern: chosenFormat === "webp" ? FRAME_PATTERN_WEBP : FRAME_PATTERN_PNG,
    frameCount: framePaths.length,
    fps: 25,
    width: 0,
    height: 0,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
    ...(fallbackReason ? { fallbackReason } : {}),
  };
  return { framesDir, framePaths, sequenceJson, ffmpegSource: ff.source, fallbackReason };
}

async function runFfmpeg(bin, args) {
  let stderrBuf = "";
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { shell: false });
      proc.stderr?.on("data", (c) => {
        stderrBuf += c.toString();
        if (stderrBuf.length > 16 * 1024) stderrBuf = stderrBuf.slice(-16 * 1024);
      });
      proc.on("error", reject);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    });
  } catch (err) {
    const tail = stderrBuf.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
    throw Object.assign(new Error(`MOV_DECODE_FAILED: ${tail || err.message}`), {
      code: "MOV_DECODE_FAILED",
    });
  }
}

/**
 * Frame size lookup helper for the manifest.
 */
export function frameSizeBytes(framePath) {
  try { return statSync(framePath).size; } catch { return 0; }
}

/**
 * Resolves the ffmpeg binary in priority order:
 *   1. process.env.FFMPEG_PATH   — operator override
 *   2. "ffmpeg" on system PATH   — what most dev boxes have
 *   3. ffmpeg-static (npm)       — bundled fallback so the user never has to
 *                                  install ffmpeg manually
 *   4. null                      — caller treats as FFMPEG_NOT_INSTALLED
 *
 * Returns { path, source } where source is "env" | "system" | "static" | "none".
 */
export async function resolveFfmpegBinary() {
  if (process.env.FFMPEG_PATH) {
    return { path: process.env.FFMPEG_PATH, source: "env" };
  }
  // Probe system PATH by running `ffmpeg -version` — cheapest portable check.
  const systemAvailable = await new Promise((resolve) => {
    try {
      const proc = spawn("ffmpeg", ["-version"], { shell: false });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  if (systemAvailable) return { path: "ffmpeg", source: "system" };
  // Fallback: ffmpeg-static publishes a path string at default export.
  // Loaded lazily so that environments without the package installed
  // (e.g. someone who removed devDependencies) still see source: "none"
  // rather than throwing on import.
  try {
    const mod = await import("ffmpeg-static");
    const staticPath = mod.default ?? mod;
    if (typeof staticPath === "string" && staticPath.length > 0) {
      return { path: staticPath, source: "static" };
    }
  } catch {
    // ffmpeg-static not installed — fall through.
  }
  return { path: null, source: "none" };
}

// Cached result of the libwebp probe. `null` means "not probed yet".
let _encoderProbeCache = null;

/**
 * One-time probe: does the resolved ffmpeg ship with libwebp?
 * Caches the answer for the lifetime of the process. Tests can pass
 * `_spawn` / `_readStdout` overrides and `_resetEncoderProbeCache()`
 * to drive deterministic outcomes.
 */
export async function probeWebpEncoder(opts = {}) {
  if (_encoderProbeCache !== null) return _encoderProbeCache;
  const ff = await resolveFfmpegBinary();
  if (!ff.path) {
    _encoderProbeCache = { available: false };
    return _encoderProbeCache;
  }
  const spawnFn = opts._spawn ?? spawn;
  const readStdout = opts._readStdout ?? defaultReadStdout;
  let stdoutText = "";
  try {
    const proc = spawnFn(ff.path, ["-hide_banner", "-encoders"], { shell: false });
    stdoutText = await readStdout(proc);
    await new Promise((resolve) => {
      proc.on("close", () => resolve());
    });
  } catch {
    _encoderProbeCache = { available: false };
    return _encoderProbeCache;
  }
  _encoderProbeCache = { available: /\blibwebp\b/.test(stdoutText) };
  return _encoderProbeCache;
}

export function _resetEncoderProbeCache() {
  _encoderProbeCache = null;
}

function defaultReadStdout(proc) {
  return new Promise((resolve) => {
    let buf = "";
    proc.stdout?.on("data", (c) => { buf += c.toString(); });
    proc.on("close", () => resolve(buf));
  });
}

export async function runMovConversion({ folderPath, force = false, onProgress } = {}) {
  const result = {
    converted: [],
    skipped: [],
    failed: [],
    sequenceJsonPaths: [],
    warnings: [],
    ffmpegSource: null,
  };
  if (!folderPath) {
    result.warnings.push("folderPath is required");
    return result;
  }
  // Normalize backslashes so test predicates and downstream `endsWith`
  // checks see canonical forward-slash paths. Node's fs/spawn accept
  // forward slashes on Windows, so this is safe.
  const folderPathNorm = String(folderPath).replace(/\\/g, "/");
  const texturesDir = path.posix.join(folderPathNorm, "Resources", "Textures");
  if (!existsSync(texturesDir)) {
    result.warnings.push(
      `No Resources/Textures directory under ${folderPathNorm} — nothing to convert.`,
    );
    return result;
  }
  const movFiles = readdirSync(texturesDir).filter((n) => n.toLowerCase().endsWith(".mov"));
  if (movFiles.length === 0) {
    return result;
  }

  // Lazily resolve ffmpeg — only probe if at least one file actually
  // needs conversion. Cache across the loop iterations so we probe once.
  let ffmpegResolved = null;
  const resolveOnce = async () => {
    if (ffmpegResolved !== null) return ffmpegResolved;
    ffmpegResolved = await resolveFfmpegBinary();
    if (ffmpegResolved.path) {
      result.ffmpegSource = ffmpegResolved.source;
    }
    return ffmpegResolved;
  };

  for (let i = 0; i < movFiles.length; i += 1) {
    const filename = movFiles[i];
    if (typeof onProgress === "function") {
      onProgress({ index: i, total: movFiles.length, filename });
    }
    const stem = filename.replace(/\.mov$/i, "");
    const framesDir = path.posix.join(texturesDir, `${stem}_frames`);
    const sequenceJsonPath = path.posix.join(framesDir, "sequence.json");
    if (!force && existsSync(sequenceJsonPath)) {
      result.skipped.push(filename);
      continue;
    }
    // Resolve ffmpeg on first file that actually needs conversion. If
    // nothing is available, short-circuit THIS and every remaining file
    // with the FFMPEG_NOT_INSTALLED sentinel — saves N stderr dumps and
    // surfaces a single, actionable hint to the caller.
    const resolved = await resolveOnce();
    if (!resolved.path) {
      result.failed.push({ filename, error: "FFMPEG_NOT_INSTALLED" });
      for (let j = i + 1; j < movFiles.length; j += 1) {
        result.failed.push({ filename: movFiles[j], error: "FFMPEG_NOT_INSTALLED" });
      }
      return result;
    }
    mkdirSync(framesDir, { recursive: true });
    const movAbs = path.posix.join(texturesDir, filename);
    const framePathArg = path.posix.join(framesDir, FRAME_PATTERN);
    const args = [
      "-y",
      "-i", movAbs,
      "-vsync", "0",
      "-pix_fmt", "rgba",
      "-start_number", "1",
      framePathArg,
    ];
    let stderrBuf = "";
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(resolved.path, args, { shell: false });
        proc.stderr?.on("data", (chunk) => {
          stderrBuf += chunk.toString();
          if (stderrBuf.length > 16 * 1024) {
            stderrBuf = stderrBuf.slice(-16 * 1024);
          }
        });
        proc.on("error", (err) => reject(err));
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited with code ${code}`));
        });
      });
      // Count the actual PNG files written — never trust ffprobe alone.
      const written = readdirSync(framesDir).filter((n) => /^frame_\d+\.png$/i.test(n));
      const sequence = {
        version: 1,
        type: "image-sequence",
        source: filename,
        framePattern: FRAME_PATTERN,
        frameCount: written.length,
        // ffprobe wiring is intentionally minimal in this round; values
        // stay 0 if the operator doesn't have ffprobe. The renderer's
        // player handles fps=0 by falling back to 25.
        fps: 0,
        width: 0,
        height: 0,
        durationSec: 0,
        loop: true,
        alpha: true,
        pixelFormat: "rgba",
      };
      writeFileSync(sequenceJsonPath, JSON.stringify(sequence, null, 2), "utf8");
      result.converted.push(filename);
      result.sequenceJsonPaths.push(sequenceJsonPath);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        // No ffmpeg on PATH — flag THIS file and every remaining one
        // with the same sentinel; further attempts will all fail too.
        result.failed.push({ filename, error: "FFMPEG_NOT_INSTALLED" });
        for (let j = i + 1; j < movFiles.length; j += 1) {
          result.failed.push({ filename: movFiles[j], error: "FFMPEG_NOT_INSTALLED" });
        }
        return result;
      }
      const tail = stderrBuf.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
      result.failed.push({ filename, error: tail || (err?.message ?? "unknown error") });
    }
  }
  return result;
}
