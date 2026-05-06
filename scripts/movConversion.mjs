/*
 * Shared conversion lib used by the CLI wrapper (convert-w3d-mov-to-sequence.mjs)
 * AND the Vite dev plugin (movConvertPlugin.mjs).
 *
 * Public API:
 *   runMovConversion({ folderPath, force?, onProgress? })
 *     -> { converted[], skipped[], failed[], sequenceJsonPaths[], warnings[] }
 *
 * Conventions enforced:
 *   - ffmpeg invoked via spawn(cmd, argsArray) — NEVER exec — so paths
 *     with spaces or unicode tricks can't shell-inject.
 *   - sequence.json is the locked v1 schema (type, alpha, pixelFormat).
 *   - When ffmpeg is missing (ENOENT), every pending file gets the
 *     FFMPEG_NOT_INSTALLED sentinel so the caller can format a single
 *     install hint instead of N stderr dumps.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const FRAME_PATTERN = "frame_%06d.png";

export async function runMovConversion({ folderPath, force = false, onProgress } = {}) {
  const result = {
    converted: [],
    skipped: [],
    failed: [],
    sequenceJsonPaths: [],
    warnings: [],
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
        const proc = spawn("ffmpeg", args, { shell: false });
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
