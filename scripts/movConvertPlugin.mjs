/*
 * Vite dev plugin exposing POST /api/w3d/convert-mov.
 * Registered only in `serve` mode; production builds get a no-op
 * object with no side effects.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { runMovConversion } from "./movConversion.mjs";

const PROJECT_NAME_RE = /^[A-Za-z0-9_.\- ]+$/;

const INSTALL_HINT =
  "Install ffmpeg and ensure it is on PATH:\n" +
  "  Windows: winget install ffmpeg (or https://ffmpeg.org/)\n" +
  "  macOS:   brew install ffmpeg\n" +
  "  Linux:   apt-get install ffmpeg / dnf install ffmpeg\n";

function readBody(req) {
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

export function movConvertPlugin() {
  let isServe = false;
  return {
    name: "3forge-w3d-mov-convert",
    config(_userConfig, env) {
      isServe = env?.command === "serve";
    },
    configureServer(server) {
      if (!isServe) return;
      server.middlewares.use("/api/w3d/convert-mov", async (req, res) => {
        if (req.method !== "POST") return send(res, 405, { code: "METHOD_NOT_ALLOWED" });
        let body;
        try { body = await readBody(req); }
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
      });
    },
  };
}
