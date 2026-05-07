// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./movConversion.mjs", () => ({ runMovConversion: vi.fn() }));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return { ...actual, existsSync: vi.fn() };
});

import { runMovConversion } from "./movConversion.mjs";
import { existsSync } from "node:fs";
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
