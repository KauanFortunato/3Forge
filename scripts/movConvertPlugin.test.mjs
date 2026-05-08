// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./movConversion.mjs", () => ({
  runMovConversion: vi.fn(),
  runMovConversionInTemp: vi.fn(),
  frameSizeBytes: vi.fn(() => 1024),
  resolveFfmpegBinary: vi.fn(),
}));
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return { ...actual, spawn: vi.fn() };
});
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return { ...actual, existsSync: vi.fn() };
});

import { runMovConversion, runMovConversionInTemp, resolveFfmpegBinary } from "./movConversion.mjs";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { movConvertPlugin } from "./movConvertPlugin.mjs";

function makeReq(body) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req = {
    method: "POST",
    url: "/api/w3d/convert-mov",
    on(event, cb) {
      if (event === "data") for (const c of chunks) cb(c);
      if (event === "end") cb();
    },
  };
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = s; this.ended = true; },
  };
}

function getMiddleware(plugin) {
  let middleware;
  const fakeServer = {
    middlewares: { use(path, fn) { if (path === "/api/w3d/convert-mov") middleware = fn; } },
  };
  plugin.configureServer(fakeServer);
  return middleware;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.R3_PROJECTS_ROOT;
});

describe("movConvertPlugin", () => {
  it("does not register the endpoint when command is not 'serve'", () => {
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "build" });
    let registered = false;
    const fakeServer = { middlewares: { use() { registered = true; } } };
    plugin.configureServer(fakeServer);
    expect(registered).toBe(false);
  });

  it("rejects projectName containing path traversal", async () => {
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeReq({ projectName: "../../etc/passwd" }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("INVALID_PROJECT_NAME");
  });

  it("rejects projectName with forward slash", async () => {
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeReq({ projectName: "foo/bar" }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("INVALID_PROJECT_NAME");
  });

  it("returns PROJECT_PATH_NOT_FOUND when projectName cannot be resolved", async () => {
    process.env.R3_PROJECTS_ROOT = "C:/projects";
    existsSync.mockReturnValue(false);
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeReq({ projectName: "Unknown_Proj" }), res);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("PROJECT_PATH_NOT_FOUND");
    expect(body.suggestedEnv).toBe("R3_PROJECTS_ROOT");
    expect(body.manualPathAllowed).toBe(true);
  });

  it("accepts an explicit folderPath in dev (manual fallback path)", async () => {
    existsSync.mockReturnValue(true);
    runMovConversion.mockResolvedValue({
      converted: ["a.mov"], skipped: [], failed: [], sequenceJsonPaths: ["x"], warnings: [],
    });
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeReq({ folderPath: "C:/Users/me/scene with space" }), res);
    expect(res.statusCode).toBe(200);
    expect(runMovConversion).toHaveBeenCalledWith(expect.objectContaining({
      folderPath: "C:/Users/me/scene with space",
    }));
  });

  it("returns FFMPEG_NOT_INSTALLED with installHint when conversion lib reports it", async () => {
    existsSync.mockReturnValue(true);
    runMovConversion.mockResolvedValue({
      converted: [], skipped: [], failed: [{ filename: "a.mov", error: "FFMPEG_NOT_INSTALLED" }],
      sequenceJsonPaths: [], warnings: [],
    });
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeReq({ folderPath: "C:/p" }), res);
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("FFMPEG_NOT_INSTALLED");
    expect(body.installHint).toMatch(/install/i);
  });

  it("forwards converted/skipped/failed shape on partial success", async () => {
    existsSync.mockReturnValue(true);
    runMovConversion.mockResolvedValue({
      converted: ["a.mov", "b.mov"], skipped: ["c.mov"],
      failed: [{ filename: "d.mov", error: "ffmpeg exited with code 1" }],
      sequenceJsonPaths: ["x", "y"], warnings: [],
    });
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeReq({ folderPath: "C:/p" }), res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.converted).toEqual(["a.mov", "b.mov"]);
    expect(body.skipped).toEqual(["c.mov"]);
    expect(body.failed.length).toBe(1);
  });
});

describe("movConvertPlugin (octet-stream upload)", () => {
  function makeBufferReq(buffer, headers = {}) {
    return {
      method: "POST",
      url: "/api/w3d/convert-mov",
      headers: { "content-type": "application/octet-stream", ...headers },
      on(event, cb) {
        if (event === "data") cb(buffer);
        if (event === "end") cb();
      },
    };
  }

  it("converts uploaded MOV bytes and returns a manifest with per-frame URLs", async () => {
    existsSync.mockReturnValue(true);
    runMovConversionInTemp.mockResolvedValue({
      framesDir: "/tmp/r3-mov/abc/frames",
      framePaths: [
        "/tmp/r3-mov/abc/frames/frame_000001.png",
        "/tmp/r3-mov/abc/frames/frame_000002.png",
        "/tmp/r3-mov/abc/frames/frame_000003.png",
      ],
      sequenceJson: {
        version: 1, type: "image-sequence", source: "intro.mov",
        framePattern: "frame_%06d.png", frameCount: 3,
        fps: 0, width: 0, height: 0, durationSec: 0,
        loop: true, alpha: true, pixelFormat: "rgba",
      },
      ffmpegSource: "static",
    });
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(
      makeBufferReq(Buffer.from("fake-mov-bytes"), { "x-filename": "intro.mov" }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.source).toBe("intro.mov");
    expect(body.frameCount).toBe(3);
    expect(body.frames).toHaveLength(3);
    expect(body.frames[0]).toMatchObject({
      index: 1,
      filename: "frame_000001.png",
      sizeBytes: 1024,
    });
    expect(body.frames[0].url).toMatch(
      new RegExp(`^/api/w3d/convert-mov/jobs/${body.jobId}/frames/frame_000001\\.png$`),
    );
    expect(body.sequenceJson.framePattern).toBe("frame_%06d.png");
    expect(runMovConversionInTemp).toHaveBeenCalledWith(expect.objectContaining({
      filename: "intro.mov",
      jobId: body.jobId,
    }));
  });

  it("rejects octet-stream POST without an X-Filename header", async () => {
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeBufferReq(Buffer.from("x"), {}), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("MISSING_FILENAME");
  });

  it("returns FFMPEG_NOT_INSTALLED when conversion throws that code", async () => {
    runMovConversionInTemp.mockRejectedValue(
      Object.assign(new Error("ffmpeg required"), { code: "FFMPEG_NOT_INSTALLED" }),
    );
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(
      makeBufferReq(Buffer.from("x"), { "x-filename": "intro.mov" }),
      res,
    );
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("FFMPEG_NOT_INSTALLED");
    expect(body.installHint).toMatch(/install/i);
  });
});

describe("movConvertPlugin (install-ffmpeg endpoint)", () => {
  function makeFakeProc({ exitCode = 0 } = {}) {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => proc.emit("close", exitCode));
    return proc;
  }

  function makeInstallReq() {
    return {
      method: "POST",
      url: "/api/w3d/convert-mov/install-ffmpeg",
      headers: {},
      on(event, cb) {
        if (event === "end") cb();
      },
    };
  }

  it("returns ok immediately if ffmpeg is already available", async () => {
    resolveFfmpegBinary.mockResolvedValueOnce({ path: "/path/to/ffmpeg", source: "static" });
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeInstallReq(), res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.alreadyAvailable).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("runs npm install and re-probes when ffmpeg is missing", async () => {
    resolveFfmpegBinary
      .mockResolvedValueOnce({ path: null, source: "none" }) // before
      .mockResolvedValueOnce({ path: "/path/to/ffmpeg", source: "static" }); // after
    spawn.mockImplementationOnce(() => makeFakeProc({ exitCode: 0 }));
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeInstallReq(), res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.source).toBe("static");
    expect(spawn).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install"]),
      expect.objectContaining({ shell: true }),
    );
  });

  it("returns INSTALL_FAILED when npm install exits non-zero", async () => {
    resolveFfmpegBinary.mockResolvedValueOnce({ path: null, source: "none" });
    spawn.mockImplementationOnce(() => makeFakeProc({ exitCode: 1 }));
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeInstallReq(), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).code).toBe("INSTALL_FAILED");
  });

  it("returns STILL_MISSING when npm install succeeds but ffmpeg still not resolvable", async () => {
    resolveFfmpegBinary
      .mockResolvedValueOnce({ path: null, source: "none" }) // before
      .mockResolvedValueOnce({ path: null, source: "none" }); // after — still nothing
    spawn.mockImplementationOnce(() => makeFakeProc({ exitCode: 0 }));
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeInstallReq(), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).code).toBe("STILL_MISSING");
  });
});
