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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const FRAME_PATTERN = "frame_%06d.png";

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
