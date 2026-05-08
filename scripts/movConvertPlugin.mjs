/*
 * Vite dev plugin exposing the MOV-conversion HTTP API.
 *
 * Routes (all under /api/w3d/convert-mov):
 *   POST /                                       — JSON body { projectName | folderPath } (legacy)
 *                                                  Resolves a folder on disk via R3_PROJECTS_ROOT
 *                                                  and converts every .mov in Resources/Textures.
 *   POST /  (Content-Type: application/octet-stream, X-Filename header)
 *                                                — raw .mov bytes; converts to a temp dir and
 *                                                  returns a manifest with per-frame fetch URLs.
 *                                                  Caller never needs an absolute project path.
 *   GET  /jobs/:jobId/frames/:filename           — streams a PNG from temp.
 *   DELETE /jobs/:jobId                          — drops the temp dir.
 *
 * Registered only in `serve` mode; production builds get a no-op object.
 */
import path from "node:path";
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  frameSizeBytes,
  resolveFfmpegBinary,
  runMovConversion,
  runMovConversionInTemp,
} from "./movConversion.mjs";

const PROJECT_NAME_RE = /^[A-Za-z0-9_.\- ]+$/;
const FRAME_NAME_RE = /^frame_\d+\.png$/i;

const INSTALL_HINT =
  "Install ffmpeg and ensure it is on PATH:\n" +
  "  Windows: winget install ffmpeg (or https://ffmpeg.org/)\n" +
  "  macOS:   brew install ffmpeg\n" +
  "  Linux:   apt-get install ffmpeg / dnf install ffmpeg\n";

const TEMP_ROOT = path.join(tmpdir(), "r3-mov");
const STALE_AGE_MS = 24 * 60 * 60 * 1000;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c))).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function readBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function resolveFolder({ projectName, folderPath }) {
  if (folderPath) {
    if (!path.isAbsolute(folderPath)) {
      return { error: { status: 400, code: "INVALID_FOLDER_PATH", message: "folderPath must be absolute." } };
    }
    if (!existsSync(folderPath)) {
      return { error: { status: 400, code: "PROJECT_PATH_NOT_FOUND", message: `Folder ${folderPath} does not exist.`, suggestedEnv: "R3_PROJECTS_ROOT", manualPathAllowed: true } };
    }
    return { folder: folderPath };
  }
  if (!projectName) {
    return { error: { status: 400, code: "MISSING_BODY", message: "Body must contain projectName or folderPath." } };
  }
  if (!PROJECT_NAME_RE.test(projectName)) {
    return { error: { status: 400, code: "INVALID_PROJECT_NAME", message: "projectName must match /^[A-Za-z0-9_.\\- ]+$/." } };
  }
  const root = process.env.R3_PROJECTS_ROOT
    ?? "C:\\Users\\diogo.esteves\\Documents\\R3.Space.Projects\\Projects";
  const resolved = path.resolve(root, projectName);
  if (!resolved.startsWith(path.resolve(root))) {
    return { error: { status: 400, code: "INVALID_PROJECT_NAME", message: "projectName resolved outside root." } };
  }
  if (!existsSync(resolved)) {
    return { error: { status: 400, code: "PROJECT_PATH_NOT_FOUND", message: `${resolved} does not exist.`, suggestedEnv: "R3_PROJECTS_ROOT", manualPathAllowed: true } };
  }
  return { folder: resolved };
}

function createJobRegistry({ rootDir }) {
  if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true });
  const jobs = new Map();
  return {
    rootDir,
    register(entry) { jobs.set(entry.jobId, { ...entry, createdAt: Date.now() }); },
    get(jobId) { return jobs.get(jobId); },
    delete(jobId) {
      jobs.delete(jobId);
      const dir = path.join(rootDir, jobId);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
    sweepStale(maxAgeMs) {
      if (!existsSync(rootDir)) return;
      const now = Date.now();
      for (const name of readdirSync(rootDir)) {
        const dir = path.join(rootDir, name);
        try {
          if (now - statSync(dir).mtimeMs > maxAgeMs) {
            rmSync(dir, { recursive: true, force: true });
            jobs.delete(name);
          }
        } catch { /* ignore */ }
      }
    },
  };
}

export function movConvertPlugin() {
  let isServe = false;
  const registry = createJobRegistry({ rootDir: TEMP_ROOT });
  return {
    name: "3forge-w3d-mov-convert",
    config(_userConfig, env) {
      isServe = env?.command === "serve";
    },
    configureServer(server) {
      if (!isServe) return;
      // Boot-time cleanup: drop any temp dirs older than 24h from prior sessions.
      try { registry.sweepStale(STALE_AGE_MS); } catch { /* ignore */ }

      server.middlewares.use("/api/w3d/convert-mov", async (req, res) => {
        const url = req.url ?? "/";
        let pathPart = url.split("?")[0];
        // Defensive: Connect strips the mount prefix in production but the
        // test harness calls handlers directly with the full path, so accept
        // either form.
        const PREFIX = "/api/w3d/convert-mov";
        if (pathPart.startsWith(PREFIX)) {
          pathPart = pathPart.slice(PREFIX.length) || "/";
        }
        try {
          if (req.method === "POST" && (pathPart === "/" || pathPart === "")) {
            const ct = String((req.headers && req.headers["content-type"]) ?? "").toLowerCase();
            if (ct.startsWith("application/octet-stream")) {
              return await handleOctetStreamPost(req, res, registry);
            }
            return await handleLegacyPost(req, res);
          }
          const getFrame = pathPart.match(/^\/jobs\/([^/]+)\/frames\/([^/]+)$/);
          if (req.method === "GET" && getFrame) {
            return handleGetFrame(req, res, registry, getFrame[1], getFrame[2]);
          }
          const delJob = pathPart.match(/^\/jobs\/([^/]+)$/);
          if (req.method === "DELETE" && delJob) {
            return handleDeleteJob(res, registry, delJob[1]);
          }
          if (req.method === "POST" && pathPart === "/install-ffmpeg") {
            return await handleInstallFfmpeg(res);
          }
          return send(res, 405, { code: "METHOD_NOT_ALLOWED" });
        } catch (err) {
          return send(res, 500, {
            code: err?.code ?? "INTERNAL_ERROR",
            message: err?.message ?? String(err),
            ...(err?.code === "FFMPEG_NOT_INSTALLED" ? { installHint: INSTALL_HINT } : {}),
          });
        }
      });
    },
  };
}

async function handleLegacyPost(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch { return send(res, 400, { code: "INVALID_BODY" }); }
  const resolved = resolveFolder(body);
  if (resolved.error) return send(res, resolved.error.status, resolved.error);
  const result = await runMovConversion({ folderPath: resolved.folder, force: !!body.force });
  const ffmpegMissing = result.failed.some((f) => f.error === "FFMPEG_NOT_INSTALLED");
  if (ffmpegMissing) {
    return send(res, 500, {
      code: "FFMPEG_NOT_INSTALLED",
      message: "ffmpeg is required to convert .mov assets.",
      installHint: INSTALL_HINT,
      partial: result,
    });
  }
  return send(res, 200, result);
}

async function handleOctetStreamPost(req, res, registry) {
  const filename = String((req.headers && req.headers["x-filename"]) ?? "");
  if (!filename || !filename.toLowerCase().endsWith(".mov")) {
    return send(res, 400, { code: "MISSING_FILENAME", message: "X-Filename header with a .mov filename is required." });
  }
  const buf = await readBuffer(req);
  if (buf.length === 0) {
    return send(res, 400, { code: "EMPTY_BODY", message: "Request body was empty." });
  }
  const jobId = randomUUID();
  let result;
  try {
    result = await runMovConversionInTemp({
      movBuffer: buf,
      filename,
      jobId,
      tempRoot: TEMP_ROOT,
    });
  } catch (err) {
    // Cleanup best-effort
    try { registry.delete(jobId); } catch { /* ignore */ }
    if (err?.code === "FFMPEG_NOT_INSTALLED") {
      return send(res, 500, {
        code: "FFMPEG_NOT_INSTALLED",
        message: "ffmpeg is required to convert .mov assets.",
        installHint: INSTALL_HINT,
      });
    }
    return send(res, 500, {
      code: err?.code ?? "MOV_DECODE_FAILED",
      message: err?.message ?? "conversion failed",
    });
  }
  registry.register({
    jobId,
    framesDir: result.framesDir,
    totalFrames: result.framePaths.length,
  });
  const frames = result.framePaths.map((p, i) => {
    const name = path.basename(p);
    return {
      index: i + 1,
      filename: name,
      url: `/api/w3d/convert-mov/jobs/${jobId}/frames/${name}`,
      sizeBytes: frameSizeBytes(p),
    };
  });
  return send(res, 200, {
    jobId,
    source: filename,
    sequenceJson: result.sequenceJson,
    frameCount: result.framePaths.length,
    fps: 0,
    alpha: true,
    frames,
    ffmpegSource: result.ffmpegSource,
  });
}

function handleGetFrame(req, res, registry, jobId, frameName) {
  if (!FRAME_NAME_RE.test(frameName)) {
    return send(res, 400, { code: "INVALID_FRAME_NAME" });
  }
  const job = registry.get(jobId);
  if (!job) return send(res, 404, { code: "JOB_NOT_FOUND" });
  const filePath = path.join(job.framesDir, frameName);
  if (!existsSync(filePath)) return send(res, 404, { code: "FRAME_NOT_FOUND" });
  res.statusCode = 200;
  res.setHeader("content-type", "image/png");
  createReadStream(filePath).pipe(res);
}

function handleDeleteJob(res, registry, jobId) {
  registry.delete(jobId);
  return send(res, 200, { ok: true });
}

/**
 * Run `npm install` in the project root so the bundled `ffmpeg-static`
 * dependency is materialised on disk. Used by the editor's "Instalar e
 * converter" affordance — fresh checkouts often hit FFMPEG_NOT_INSTALLED
 * just because the user picked the project folder before running
 * `npm install`. After install we re-probe ffmpeg and only return ok
 * when the binary actually resolves; otherwise the modal stays in error.
 *
 * Safety: the only command spawned is `npm install` (no user input is
 * concatenated into the args), and it runs in the dev-only Vite plugin
 * which is never registered in production builds.
 */
async function handleInstallFfmpeg(res) {
  // Up-front: maybe ffmpeg is already there (the user might have
  // installed since the modal opened). Skip the npm install in that case.
  const before = await resolveFfmpegBinary();
  if (before.path) {
    return send(res, 200, { ok: true, source: before.source, alreadyAvailable: true });
  }
  let stderr = "";
  let stdout = "";
  try {
    await new Promise((resolve, reject) => {
      // npm on Windows is `npm.cmd`; let the OS resolve via shell.
      const proc = spawn("npm", ["install", "--no-audit", "--no-fund"], {
        shell: true,
        cwd: process.cwd(),
      });
      proc.stdout?.on("data", (c) => {
        stdout += c.toString();
        if (stdout.length > 32 * 1024) stdout = stdout.slice(-32 * 1024);
      });
      proc.stderr?.on("data", (c) => {
        stderr += c.toString();
        if (stderr.length > 32 * 1024) stderr = stderr.slice(-32 * 1024);
      });
      proc.on("error", reject);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`npm install exit ${code}`)));
    });
  } catch (err) {
    const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-5).join(" | ");
    return send(res, 500, {
      code: "INSTALL_FAILED",
      message: tail || err?.message || "npm install failed",
    });
  }
  // Re-probe so the next conversion attempt actually finds ffmpeg.
  const after = await resolveFfmpegBinary();
  if (!after.path) {
    return send(res, 500, {
      code: "STILL_MISSING",
      message:
        "npm install completed but ffmpeg is still not available. Verify ffmpeg-static is in package.json dependencies.",
    });
  }
  return send(res, 200, { ok: true, source: after.source });
}
