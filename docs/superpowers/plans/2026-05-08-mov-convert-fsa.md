# MOV Convert via File System Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Convert and Import" work without `R3_PROJECTS_ROOT`, without manual paths, and without a system-wide `ffmpeg`. The browser's directory handle is the source of truth; the dev backend converts in `os.tmpdir()` and streams frames back over HTTP.

**Architecture:** Manifest + per-frame fetch. Backend writes only inside `os.tmpdir()/r3-mov/<jobId>/`. Frontend uploads each `.mov` as raw octet-stream, receives a manifest with per-frame URLs, fetches frames in batches of 4 with concurrency, writes each frame and `sequence.json` into the picked folder via FSA `createWritable()`, then triggers an automatic re-walk.

**Spec:** `docs/superpowers/specs/2026-05-08-mov-convert-fsa-design.md`

**Tech Stack:** Vitest, Vite dev plugin (Connect middleware), `ffmpeg-static`, `@testing-library/react`, File System Access API.

---

## File Structure

**Backend (Node, ESM):**
- Modify `scripts/movConversion.mjs` — extract `runMovConversionInTemp({ movBuffer, filename, jobId, tempRoot })` returning `{ framesDir, framePaths[], sequenceJson }`. Keep existing `runMovConversion(folderPath)` untouched (used by legacy flow + CLI).
- Modify `scripts/movConvertPlugin.mjs` — replace single endpoint with three Connect routes under `/api/w3d/convert-mov`:
  - `POST /api/w3d/convert-mov` (Content-Type: application/octet-stream, X-Filename header)
  - `GET  /api/w3d/convert-mov/jobs/:jobId/frames/:filename`
  - `DELETE /api/w3d/convert-mov/jobs/:jobId`
  Keep legacy projectName/folderPath path under `?legacy=1` query param.
- Create `scripts/movJobRegistry.mjs` — in-memory `Map<jobId, JobEntry>` + `sweepStaleJobs(rootDir, maxAgeMs)`.
- Modify `scripts/movConvertPlugin.test.mjs` — extend with new tests; keep existing legacy tests under `?legacy=1`.
- Create `scripts/movJobRegistry.test.mjs` — test sweep + register/unregister.

**Frontend (TS):**
- Modify `src/editor/import/w3dFolder.ts` — export `getNestedHandle(root, segments, opts)`. (The .ts side already deals with FSA — single helper added, no refactor.)
- Create `src/editor/import/movConvertViaFSA.ts` — `convertAndWriteFrames()` orchestrator + `ConvertProgress` discriminated union.
- Create `src/editor/import/movConvertViaFSA.test.ts` — mock fetch + mock FSA handles.
- Modify `src/editor/react/components/MovConversionModal.tsx` — three render states: idle/list, in-progress (per-mov + per-frame), fallback.
- Modify `src/editor/react/components/MovConversionModal.test.tsx` — coverage for the three states.
- Modify `src/editor/react/App.tsx` — call `convertAndWriteFrames`, drive modal state, hook re-import.

**Packaging:**
- Modify `package.json` — `ffmpeg-static` from `devDependencies` → `dependencies`.

---

## Task 1: Backend — Extract `runMovConversionInTemp` from `runMovConversion`

**Files:**
- Modify: `scripts/movConversion.mjs`
- Modify: `scripts/movConversion.test.mjs`

- [ ] **Step 1: Read the existing file to locate the ffmpeg invocation block**

Run: read `scripts/movConversion.mjs` lines around the `spawn` call (the Explore report cites lines 136-142). The current `runMovConversion(folderPath)` walks `Resources/Textures/`, finds `.mov` files, and writes outputs back into the same folder. We will introduce a new function that takes an in-memory buffer and a temp root.

- [ ] **Step 2: Write a failing unit test for the new function**

Add to `scripts/movConversion.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import { runMovConversionInTemp } from "./movConversion.mjs";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("runMovConversionInTemp", () => {
  it("writes frames + returns manifest data when given a real .mov buffer", async () => {
    const fixture = readFileSync(
      // small .mov fixture from the existing test corpus
      join(process.cwd(), "tests/fixtures/mov/tiny_alpha.mov"),
    );
    const tempRoot = mkdtempSync(join(tmpdir(), "r3-mov-test-"));
    try {
      const result = await runMovConversionInTemp({
        movBuffer: fixture,
        filename: "tiny_alpha.mov",
        jobId: "job-test-1",
        tempRoot,
      });
      expect(result.framesDir).toBe(join(tempRoot, "job-test-1", "frames"));
      expect(result.framePaths.length).toBeGreaterThan(0);
      expect(result.framePaths[0]).toMatch(/frame_000001\.png$/);
      expect(result.sequenceJson.type).toBe("image-sequence");
      expect(result.sequenceJson.framePattern).toBe("frame_%06d.png");
      expect(result.sequenceJson.frameCount).toBe(result.framePaths.length);
      expect(result.sequenceJson.alpha).toBe(true);
      // every framePath exists on disk
      for (const p of result.framePaths) {
        expect(statSync(p).size).toBeGreaterThan(0);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects when ffmpeg is unavailable", async () => {
    // Force the probe to fail by setting an invalid FFMPEG_PATH that is not 'ffmpeg' or static
    const prev = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = "/definitely/not/a/binary/ffmpeg";
    try {
      await expect(
        runMovConversionInTemp({
          movBuffer: Buffer.from([0]),
          filename: "x.mov",
          jobId: "job-test-2",
          tempRoot: mkdtempSync(join(tmpdir(), "r3-mov-test-")),
        }),
      ).rejects.toThrow(/FFMPEG_NOT_INSTALLED/);
    } finally {
      if (prev === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = prev;
    }
  });
});
```

If `tests/fixtures/mov/tiny_alpha.mov` does not exist, locate a real .mov in the existing test corpus (Explore report mentioned `w3d.realScenes.test.ts` reads from disk) and adjust the path. **Do not synthesise a fake .mov** — ffmpeg will reject it.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run scripts/movConversion.test.mjs -t runMovConversionInTemp`

Expected: FAIL with "runMovConversionInTemp is not a function" (or similar import error).

- [ ] **Step 4: Implement `runMovConversionInTemp`**

In `scripts/movConversion.mjs`, **add** (do not replace the existing `runMovConversion`):

```javascript
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

// existing FRAME_PATTERN / probeFfmpeg helpers reused — do not duplicate

/**
 * Convert a .mov buffer into a PNG sequence inside <tempRoot>/<jobId>/frames/.
 * Returns the framesDir, list of absolute frame paths, and the sequence.json
 * payload (NOT yet written to disk — caller writes if needed).
 */
export async function runMovConversionInTemp({ movBuffer, filename, jobId, tempRoot }) {
  const ff = await probeFfmpeg(); // existing helper: returns {bin, source} or {bin:null}
  if (!ff.bin) {
    const err = new Error("FFMPEG_NOT_INSTALLED");
    err.code = "FFMPEG_NOT_INSTALLED";
    err.installHint = "run 'npm install' from repo root";
    throw err;
  }
  const jobDir = join(tempRoot, jobId);
  const framesDir = join(jobDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const sourcePath = join(jobDir, "source.mov");
  writeFileSync(sourcePath, movBuffer);

  const args = [
    "-y", "-i", sourcePath,
    "-vsync", "0",
    "-pix_fmt", "rgba",
    "-start_number", "1",
    join(framesDir, "frame_%06d.png"),
  ];
  await new Promise((resolve, reject) => {
    const p = spawn(ff.bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (b) => { stderr += b.toString(); });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const err = new Error(`MOV_DECODE_FAILED: ffmpeg exit ${code}\n${stderr.slice(-2000)}`);
        err.code = "MOV_DECODE_FAILED";
        reject(err);
      }
    });
  });

  const framePaths = readdirSync(framesDir)
    .filter((n) => /^frame_\d{6}\.png$/.test(n))
    .sort()
    .map((n) => join(framesDir, n));
  if (framePaths.length === 0) {
    const err = new Error("MOV_DECODE_FAILED: zero frames produced");
    err.code = "MOV_DECODE_FAILED";
    throw err;
  }

  const sequenceJson = {
    version: 1,
    type: "image-sequence",
    source: filename,
    framePattern: "frame_%06d.png",
    frameCount: framePaths.length,
    fps: 0,
    width: 0,
    height: 0,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
  };

  return { framesDir, framePaths, sequenceJson, ffmpegSource: ff.source };
}
```

- [ ] **Step 5: Run the test again to verify it passes**

Run: `npx vitest run scripts/movConversion.test.mjs -t runMovConversionInTemp`

Expected: PASS for the happy-path test. The `FFMPEG_NOT_INSTALLED` test passes if `probeFfmpeg` honours `FFMPEG_PATH`. If it does not, fix `probeFfmpeg` to check `FFMPEG_PATH` first and validate with a synchronous `spawnSync(bin, ["-version"])`.

- [ ] **Step 6: Commit**

```bash
git add scripts/movConversion.mjs scripts/movConversion.test.mjs
git commit -m "feat(mov): add runMovConversionInTemp for buffer→tempdir conversion"
```

---

## Task 2: Backend — In-memory job registry + boot-time sweep

**Files:**
- Create: `scripts/movJobRegistry.mjs`
- Create: `scripts/movJobRegistry.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/movJobRegistry.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJobRegistry } from "./movJobRegistry.mjs";

describe("movJobRegistry", () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "r3-mov-reg-")); });

  it("registers and retrieves a job", () => {
    const reg = createJobRegistry({ rootDir: root });
    reg.register({ jobId: "abc", framesDir: join(root, "abc", "frames"), totalFrames: 3 });
    const got = reg.get("abc");
    expect(got.totalFrames).toBe(3);
  });

  it("get returns undefined for unknown jobId", () => {
    const reg = createJobRegistry({ rootDir: root });
    expect(reg.get("missing")).toBeUndefined();
  });

  it("delete removes the job and its directory on disk", () => {
    const reg = createJobRegistry({ rootDir: root });
    const dir = join(root, "abc");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "marker"), "x");
    reg.register({ jobId: "abc", framesDir: join(dir, "frames"), totalFrames: 1 });
    reg.delete("abc");
    expect(reg.get("abc")).toBeUndefined();
    expect(existsSync(dir)).toBe(false);
  });

  it("sweepStaleJobs removes directories older than maxAgeMs", () => {
    const reg = createJobRegistry({ rootDir: root });
    const oldDir = join(root, "old-job");
    mkdirSync(oldDir, { recursive: true });
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(oldDir, past, past);
    const fresh = join(root, "fresh-job");
    mkdirSync(fresh, { recursive: true });
    reg.sweepStaleJobs({ maxAgeMs: 24 * 60 * 60 * 1000 });
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/movJobRegistry.test.mjs`
Expected: FAIL with "Cannot find module './movJobRegistry.mjs'".

- [ ] **Step 3: Implement the registry**

Create `scripts/movJobRegistry.mjs`:

```javascript
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export function createJobRegistry({ rootDir }) {
  if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true });
  const jobs = new Map();
  return {
    rootDir,
    register({ jobId, framesDir, totalFrames }) {
      jobs.set(jobId, { jobId, framesDir, totalFrames, createdAt: Date.now() });
    },
    get(jobId) { return jobs.get(jobId); },
    delete(jobId) {
      const entry = jobs.get(jobId);
      jobs.delete(jobId);
      const dir = join(rootDir, jobId);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      return Boolean(entry);
    },
    sweepStaleJobs({ maxAgeMs }) {
      if (!existsSync(rootDir)) return;
      const now = Date.now();
      for (const name of readdirSync(rootDir)) {
        const dir = join(rootDir, name);
        let age;
        try { age = now - statSync(dir).mtimeMs; } catch { continue; }
        if (age > maxAgeMs) {
          rmSync(dir, { recursive: true, force: true });
          jobs.delete(name);
        }
      }
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run scripts/movJobRegistry.test.mjs`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/movJobRegistry.mjs scripts/movJobRegistry.test.mjs
git commit -m "feat(mov): in-memory job registry with stale-dir sweep"
```

---

## Task 3: Backend — POST endpoint returning the manifest

**Files:**
- Modify: `scripts/movConvertPlugin.mjs`
- Modify: `scripts/movConvertPlugin.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/movConvertPlugin.test.mjs`:

```javascript
import { runMovConversionInTemp } from "./movConversion.mjs";
vi.mock("./movConversion.mjs", async () => {
  const actual = await vi.importActual("./movConversion.mjs");
  return {
    ...actual,
    runMovConversion: vi.fn(),
    runMovConversionInTemp: vi.fn(),
  };
});

function makeBufferReq(buffer, headers = {}) {
  const chunks = [buffer];
  return {
    method: "POST",
    url: "/api/w3d/convert-mov",
    headers: { "content-type": "application/octet-stream", ...headers },
    on(event, cb) {
      if (event === "data") for (const c of chunks) cb(c);
      if (event === "end") cb();
    },
  };
}

describe("movConvertPlugin POST (new flow)", () => {
  it("converts an uploaded .mov and returns manifest with frame URLs", async () => {
    runMovConversionInTemp.mockResolvedValueOnce({
      framesDir: "/tmp/r3-mov/jobX/frames",
      framePaths: [
        "/tmp/r3-mov/jobX/frames/frame_000001.png",
        "/tmp/r3-mov/jobX/frames/frame_000002.png",
      ],
      sequenceJson: {
        version: 1, type: "image-sequence", source: "intro.mov",
        framePattern: "frame_%06d.png", frameCount: 2, fps: 0,
        width: 0, height: 0, durationSec: 0, loop: true, alpha: true,
        pixelFormat: "rgba",
      },
      ffmpegSource: "static",
    });
    // mock statSync to return size
    vi.spyOn(await import("node:fs"), "statSync").mockReturnValue({ size: 1024 });

    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    const req = makeBufferReq(Buffer.from("FAKE-MOV-BYTES"), { "x-filename": "intro.mov" });
    await mw(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.source).toBe("intro.mov");
    expect(body.frameCount).toBe(2);
    expect(body.frames).toHaveLength(2);
    expect(body.frames[0]).toMatchObject({
      index: 1,
      filename: "frame_000001.png",
      sizeBytes: 1024,
    });
    expect(body.frames[0].url).toMatch(
      new RegExp(`^/api/w3d/convert-mov/jobs/${body.jobId}/frames/frame_000001\\.png$`),
    );
    expect(body.sequenceJson.frameCount).toBe(2);
  });

  it("returns FFMPEG_NOT_INSTALLED when conversion throws that code", async () => {
    runMovConversionInTemp.mockRejectedValueOnce(
      Object.assign(new Error("nope"), { code: "FFMPEG_NOT_INSTALLED", installHint: "run 'npm install' from repo root" }),
    );
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeBufferReq(Buffer.from([0]), { "x-filename": "x.mov" }), res);
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("FFMPEG_NOT_INSTALLED");
    expect(body.installHint).toBe("run 'npm install' from repo root");
  });

  it("rejects POST with no X-Filename header", async () => {
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(makeBufferReq(Buffer.from("x"), {}), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("MISSING_FILENAME");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/movConvertPlugin.test.mjs -t "new flow"`
Expected: FAIL — three tests fail; the plugin still hits the legacy `projectName/folderPath` branch.

- [ ] **Step 3: Implement the new POST handler**

In `scripts/movConvertPlugin.mjs`, replace the body of the existing middleware. **Pseudo-structure** (full code below):

```javascript
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statSync } from "node:fs";
import { runMovConversion, runMovConversionInTemp } from "./movConversion.mjs";
import { createJobRegistry } from "./movJobRegistry.mjs";

const TEMP_ROOT = join(tmpdir(), "r3-mov");
const registry = createJobRegistry({ rootDir: TEMP_ROOT });
registry.sweepStaleJobs({ maxAgeMs: 24 * 60 * 60 * 1000 }); // boot-time

export function movConvertPlugin() {
  let isServe = false;
  return {
    name: "r3-mov-convert",
    config(_c, { command }) { isServe = command === "serve"; },
    configureServer(server) {
      if (!isServe) return;
      server.middlewares.use("/api/w3d/convert-mov", async (req, res) => {
        try {
          const url = req.url ?? "/";
          const path = url.split("?")[0];
          const isRoot = path === "/" || path === "";
          if (req.method === "POST" && isRoot) {
            if (url.includes("legacy=1")) {
              return await handleLegacyPost(req, res); // existing body, unchanged
            }
            return await handleNewPost(req, res);
          }
          if (req.method === "GET" && path.startsWith("/jobs/")) {
            return await handleGetFrame(req, res);
          }
          if (req.method === "DELETE" && path.startsWith("/jobs/")) {
            return await handleDeleteJob(req, res);
          }
          res.statusCode = 405;
          res.end(JSON.stringify({ code: "METHOD_NOT_ALLOWED" }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ code: err.code ?? "INTERNAL_ERROR", message: err.message, installHint: err.installHint }));
        }
      });
    },
  };

  async function handleNewPost(req, res) {
    const filename = req.headers["x-filename"];
    if (typeof filename !== "string" || !filename.toLowerCase().endsWith(".mov")) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ code: "MISSING_FILENAME" }));
    }
    const buf = await readBody(req);
    const jobId = randomUUID();
    const result = await runMovConversionInTemp({
      movBuffer: buf, filename, jobId, tempRoot: TEMP_ROOT,
    });
    registry.register({
      jobId, framesDir: result.framesDir, totalFrames: result.framePaths.length,
    });
    const frames = result.framePaths.map((p, i) => {
      const name = p.split(/[\\/]/).pop();
      return {
        index: i + 1,
        filename: name,
        url: `/api/w3d/convert-mov/jobs/${jobId}/frames/${name}`,
        sizeBytes: statSync(p).size,
      };
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      jobId,
      source: filename,
      sequenceJson: result.sequenceJson,
      frameCount: result.framePaths.length,
      fps: 0,
      alpha: true,
      frames,
      ffmpegSource: result.ffmpegSource,
    }));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  // handleGetFrame, handleDeleteJob — added in tasks 4 and 5
  // handleLegacyPost — preserved from previous version, behind ?legacy=1
}
```

Move the **existing** middleware body (the one that handles `projectName/folderPath`) into `handleLegacyPost`. Do not delete it — the legacy fallback in the modal still uses it.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run scripts/movConvertPlugin.test.mjs`
Expected: New tests PASS, existing legacy tests **still PASS** (they hit `?legacy=1`, which now needs the legacy branch). If existing tests fail because they don't pass `?legacy=1`, update them by adding `?legacy=1` to `req.url` in the existing tests, or expose a way to invoke legacy without the query param while keeping new flow as the default. **Decision: add `?legacy=1` to existing test request URLs.**

- [ ] **Step 5: Commit**

```bash
git add scripts/movConvertPlugin.mjs scripts/movConvertPlugin.test.mjs
git commit -m "feat(mov): POST endpoint returns manifest from temp-dir conversion"
```

---

## Task 4: Backend — GET frame endpoint

**Files:**
- Modify: `scripts/movConvertPlugin.mjs`
- Modify: `scripts/movConvertPlugin.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```javascript
describe("movConvertPlugin GET frame", () => {
  it("streams a PNG for a known jobId/frame", async () => {
    // Register a job by going through POST first (reuse the mock from Task 3 test)
    runMovConversionInTemp.mockResolvedValueOnce({
      framesDir: "/tmp/r3-mov/jobY/frames",
      framePaths: ["/tmp/r3-mov/jobY/frames/frame_000001.png"],
      sequenceJson: { /* …minimum valid… */ frameCount: 1, framePattern: "frame_%06d.png", type: "image-sequence", version: 1, source: "x.mov", fps: 0, width: 0, height: 0, durationSec: 0, loop: true, alpha: true, pixelFormat: "rgba" },
      ffmpegSource: "static",
    });
    vi.spyOn(await import("node:fs"), "statSync").mockReturnValue({ size: 4 });
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fsModule = await import("node:fs");
    vi.spyOn(fsModule, "createReadStream").mockReturnValue(
      Object.assign(require("node:stream").Readable.from([fakePng]), { pipe(target) { target.write(fakePng); target.end(); } }),
    );

    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);

    // POST to register
    const postRes = makeRes();
    await mw(makeBufferReq(Buffer.from("x"), { "x-filename": "y.mov" }), postRes);
    const { jobId } = JSON.parse(postRes.body);

    // GET
    const getRes = makeRes();
    let written = Buffer.alloc(0);
    getRes.write = (chunk) => { written = Buffer.concat([written, Buffer.from(chunk)]); };
    await mw(
      { method: "GET", url: `/jobs/${jobId}/frames/frame_000001.png`, headers: {}, on(){} },
      getRes,
    );
    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers["content-type"]).toBe("image/png");
  });

  it("returns 404 for unknown jobId", async () => {
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(
      { method: "GET", url: "/jobs/00000000-0000-0000-0000-000000000000/frames/frame_000001.png", headers: {}, on(){} },
      res,
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("JOB_NOT_FOUND");
  });

  it("rejects path traversal in frame name", async () => {
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw(
      { method: "GET", url: "/jobs/abc/frames/..%2Fpasswd", headers: {}, on(){} },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("INVALID_FRAME_NAME");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/movConvertPlugin.test.mjs -t "GET frame"`
Expected: FAIL — handleGetFrame not implemented.

- [ ] **Step 3: Implement `handleGetFrame`**

Add to `scripts/movConvertPlugin.mjs`:

```javascript
import { createReadStream } from "node:fs";
import { join } from "node:path";

async function handleGetFrame(req, res) {
  // url shape: /jobs/<jobId>/frames/<filename>
  const m = req.url.match(/^\/jobs\/([^/]+)\/frames\/([^/?#]+)$/);
  if (!m) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ code: "INVALID_FRAME_URL" }));
  }
  const [, jobId, rawName] = m;
  if (!/^frame_\d{6}\.png$/.test(rawName)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ code: "INVALID_FRAME_NAME" }));
  }
  const job = registry.get(jobId);
  if (!job) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ code: "JOB_NOT_FOUND" }));
  }
  const filePath = join(job.framesDir, rawName);
  res.setHeader("content-type", "image/png");
  createReadStream(filePath).pipe(res);
}
```

Hoist the function inside `configureServer` so it can close over `registry`. Wire the dispatcher in the top-level middleware (already present from Task 3).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run scripts/movConvertPlugin.test.mjs -t "GET frame"`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/movConvertPlugin.mjs scripts/movConvertPlugin.test.mjs
git commit -m "feat(mov): GET /jobs/:id/frames/:name streams PNG from registered job"
```

---

## Task 5: Backend — DELETE jobId endpoint

**Files:**
- Modify: `scripts/movConvertPlugin.mjs`
- Modify: `scripts/movConvertPlugin.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
describe("movConvertPlugin DELETE job", () => {
  it("removes the job and returns ok:true", async () => {
    runMovConversionInTemp.mockResolvedValueOnce({
      framesDir: "/tmp/r3-mov/jobZ/frames",
      framePaths: ["/tmp/r3-mov/jobZ/frames/frame_000001.png"],
      sequenceJson: { /* min valid */ frameCount: 1, framePattern: "frame_%06d.png", type: "image-sequence", version: 1, source: "x.mov", fps: 0, width: 0, height: 0, durationSec: 0, loop: true, alpha: true, pixelFormat: "rgba" },
      ffmpegSource: "static",
    });
    vi.spyOn(await import("node:fs"), "statSync").mockReturnValue({ size: 4 });
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const postRes = makeRes();
    await mw(makeBufferReq(Buffer.from("x"), { "x-filename": "z.mov" }), postRes);
    const { jobId } = JSON.parse(postRes.body);
    const delRes = makeRes();
    await mw({ method: "DELETE", url: `/jobs/${jobId}`, headers: {}, on(){} }, delRes);
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body).ok).toBe(true);
    // GET on the same frame should now 404
    const getRes = makeRes();
    await mw({ method: "GET", url: `/jobs/${jobId}/frames/frame_000001.png`, headers: {}, on(){} }, getRes);
    expect(getRes.statusCode).toBe(404);
  });

  it("returns ok:true for unknown jobId (idempotent)", async () => {
    const plugin = movConvertPlugin();
    plugin.config({}, { command: "serve" });
    const mw = getMiddleware(plugin);
    const res = makeRes();
    await mw({ method: "DELETE", url: "/jobs/missing-id", headers: {}, on(){} }, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/movConvertPlugin.test.mjs -t "DELETE job"`
Expected: FAIL.

- [ ] **Step 3: Implement `handleDeleteJob`**

```javascript
async function handleDeleteJob(req, res) {
  const m = req.url.match(/^\/jobs\/([^/?#]+)$/);
  if (!m) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ code: "INVALID_JOB_URL" }));
  }
  registry.delete(m[1]);
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run scripts/movConvertPlugin.test.mjs`
Expected: All tests PASS (new + legacy).

- [ ] **Step 5: Commit**

```bash
git add scripts/movConvertPlugin.mjs scripts/movConvertPlugin.test.mjs
git commit -m "feat(mov): DELETE /jobs/:id removes temp dir and registry entry"
```

---

## Task 6: Promote `ffmpeg-static` to runtime deps

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current package.json**

Read `package.json` and locate `"ffmpeg-static": "^5.2.0"` under `devDependencies`.

- [ ] **Step 2: Move the entry**

Move the line into `dependencies`. Resulting diff (illustrative):

```diff
   "dependencies": {
+    "ffmpeg-static": "^5.2.0",
     "react": "...",
     ...
   },
   "devDependencies": {
-    "ffmpeg-static": "^5.2.0",
     "vitest": "...",
     ...
   },
```

- [ ] **Step 3: Reinstall to verify lockfile updates correctly**

Run: `npm install`
Expected: `package-lock.json` updated; `node_modules/ffmpeg-static` still present.

- [ ] **Step 4: Smoke verify the binary path resolves**

Run: `node -e "import('ffmpeg-static').then(m => console.log(m.default))"`
Expected: prints an absolute path to a `ffmpeg`/`ffmpeg.exe` binary that exists.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): promote ffmpeg-static to runtime dependencies"
```

---

## Task 7: Frontend — `getNestedHandle` helper

**Files:**
- Modify: `src/editor/import/w3dFolder.ts`
- Modify: `src/editor/import/w3dFolder.test.ts` (or create if it doesn't exist)

- [ ] **Step 1: Find the existing test file or create it**

Run: `ls src/editor/import/w3dFolder.test.ts`. If absent, create with the test below; if present, append.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { getNestedHandle } from "./w3dFolder";

function makeMockDir(): any {
  const children = new Map();
  return {
    kind: "directory",
    name: "root",
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      if (!children.has(name)) {
        if (!opts?.create) {
          const err = new Error("not found"); (err as any).name = "NotFoundError"; throw err;
        }
        children.set(name, makeMockDir());
      }
      const h = children.get(name);
      h.name = name;
      return h;
    },
    _children: children,
  };
}

describe("getNestedHandle", () => {
  it("descends a chain of directory names creating each segment", async () => {
    const root = makeMockDir();
    const leaf = await getNestedHandle(root, ["Resources", "Textures", "intro_frames"], { create: true });
    expect(leaf.name).toBe("intro_frames");
    expect(root._children.get("Resources")._children.get("Textures")._children.has("intro_frames")).toBe(true);
  });

  it("throws NotFoundError when create=false and a segment is missing", async () => {
    const root = makeMockDir();
    await expect(
      getNestedHandle(root, ["Resources"], { create: false }),
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/editor/import/w3dFolder.test.ts -t getNestedHandle`
Expected: FAIL ("getNestedHandle is not exported").

- [ ] **Step 4: Implement and export**

In `src/editor/import/w3dFolder.ts`, add:

```typescript
export async function getNestedHandle(
  root: FileSystemDirectoryHandle,
  segments: string[],
  opts: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle> {
  let cur: FileSystemDirectoryHandle = root;
  for (const seg of segments) {
    cur = await cur.getDirectoryHandle(seg, { create: !!opts.create });
  }
  return cur;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/editor/import/w3dFolder.test.ts -t getNestedHandle`
Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/editor/import/w3dFolder.ts src/editor/import/w3dFolder.test.ts
git commit -m "feat(import): getNestedHandle helper for FSA directory descent"
```

---

## Task 8: Frontend — `convertAndWriteFrames` orchestrator (TDD)

**Files:**
- Create: `src/editor/import/movConvertViaFSA.ts`
- Create: `src/editor/import/movConvertViaFSA.test.ts`

- [ ] **Step 1: Write the failing tests for the happy path**

```typescript
import { describe, it, expect, vi } from "vitest";
import { convertAndWriteFrames, type ConvertProgress } from "./movConvertViaFSA";

function mockFile(name: string, bytes = "FAKE-MOV"): File {
  return new File([new Uint8Array([...bytes].map((c) => c.charCodeAt(0)))], name, {
    type: "video/quicktime",
  });
}

function mockHandle() {
  const writes: Record<string, Uint8Array> = {};
  const dirs: Record<string, any> = {};
  const dir: any = {
    kind: "directory",
    name: "root",
    async requestPermission() { return "granted"; },
    async getDirectoryHandle(seg: string, { create } = { create: false }) {
      if (!dirs[seg]) {
        if (!create) throw Object.assign(new Error("nope"), { name: "NotFoundError" });
        dirs[seg] = mockHandle().handle; // recursion: each subdir gets its own writes map
      }
      return dirs[seg];
    },
    async getFileHandle(name: string, { create } = { create: false }) {
      return {
        async createWritable() {
          return {
            async write(blob: Blob | string) {
              const ab = typeof blob === "string"
                ? new TextEncoder().encode(blob)
                : new Uint8Array(await (blob as Blob).arrayBuffer());
              writes[name] = ab;
            },
            async close() {},
          };
        },
        async getFile() {
          if (!writes[name]) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
          return new File([writes[name]], name);
        },
      };
    },
    _writes: writes,
    _dirs: dirs,
  };
  return { handle: dir as FileSystemDirectoryHandle, writes, dirs };
}

describe("convertAndWriteFrames", () => {
  it("uploads each .mov, writes sequence.json + frames into Resources/Textures/<stem>_frames/", async () => {
    const { handle, dirs } = mockHandle();
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST") {
        return new Response(JSON.stringify({
          jobId: "job-1",
          source: "intro.mov",
          sequenceJson: {
            version: 1, type: "image-sequence", source: "intro.mov",
            framePattern: "frame_%06d.png", frameCount: 2, fps: 0,
            width: 0, height: 0, durationSec: 0, loop: true, alpha: true, pixelFormat: "rgba",
          },
          frameCount: 2,
          fps: 0,
          alpha: true,
          frames: [
            { index: 1, filename: "frame_000001.png", url: "/api/w3d/convert-mov/jobs/job-1/frames/frame_000001.png", sizeBytes: 4 },
            { index: 2, filename: "frame_000002.png", url: "/api/w3d/convert-mov/jobs/job-1/frames/frame_000002.png", sizeBytes: 4 },
          ],
          ffmpegSource: "static",
        }), { status: 200 });
      }
      if (init?.method === "DELETE") return new Response(JSON.stringify({ ok: true }));
      // GET frame
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const progress: ConvertProgress[] = [];
    const result = await convertAndWriteFrames({
      rootHandle: handle,
      movFiles: [{ file: mockFile("intro.mov"), relPath: "Resources/Textures/intro.mov" }],
      signal: new AbortController().signal,
      onProgress: (p) => progress.push(p),
    });
    expect(result.converted).toEqual([{ mov: "intro.mov", framesDir: "Resources/Textures/intro_frames" }]);
    // sequence.json was written
    const framesDir = dirs["Resources"]._dirs["Textures"]._dirs["intro_frames"];
    expect(framesDir._writes["sequence.json"]).toBeTruthy();
    expect(framesDir._writes["frame_000001.png"]).toBeTruthy();
    expect(framesDir._writes["frame_000002.png"]).toBeTruthy();
    // POST then DELETE were called
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(true);
    // progress carries "writing-frame" with K/N
    const writes = progress.filter((p) => p.phase === "writing-frame");
    expect(writes.length).toBe(2);
    expect(writes[1]).toMatchObject({ frame: 2, total: 2, movName: "intro.mov" });
  });

  it("skips a .mov when sequence.json already exists in target dir", async () => {
    const { handle, dirs } = mockHandle();
    // Pre-populate: dirs["Resources"]._dirs["Textures"]._dirs["intro_frames"]._writes["sequence.json"]
    const resources = await handle.getDirectoryHandle("Resources", { create: true });
    const textures = await (resources as any).getDirectoryHandle("Textures", { create: true });
    const frames = await (textures as any).getDirectoryHandle("intro_frames", { create: true });
    const fh = await (frames as any).getFileHandle("sequence.json", { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 1, type: "image-sequence", framePattern: "frame_%06d.png", frameCount: 0 }));
    await w.close();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await convertAndWriteFrames({
      rootHandle: handle,
      movFiles: [{ file: mockFile("intro.mov"), relPath: "intro.mov" }],
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(result.skipped).toEqual([{ mov: "intro.mov", reason: "already-has-sequence" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts cleanly on signal.abort()", async () => {
    const { handle } = mockHandle();
    const ctrl = new AbortController();
    const fetchMock = vi.fn((_u, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted"); (err as any).name = "AbortError"; reject(err);
          });
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });
    vi.stubGlobal("fetch", fetchMock);
    const promise = convertAndWriteFrames({
      rootHandle: handle,
      movFiles: [{ file: mockFile("intro.mov"), relPath: "intro.mov" }],
      signal: ctrl.signal,
      onProgress: () => {},
    });
    ctrl.abort();
    await expect(promise).rejects.toThrow(/aborted|AbortError/);
  });

  it("collects per-frame failures and reports them in failed[]", async () => {
    const { handle } = mockHandle();
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({
          jobId: "job-2",
          source: "x.mov",
          sequenceJson: {
            version: 1, type: "image-sequence", source: "x.mov",
            framePattern: "frame_%06d.png", frameCount: 2, fps: 0,
            width: 0, height: 0, durationSec: 0, loop: true, alpha: true, pixelFormat: "rgba",
          },
          frameCount: 2, fps: 0, alpha: true,
          frames: [
            { index: 1, filename: "frame_000001.png", url: "/api/w3d/convert-mov/jobs/job-2/frames/frame_000001.png", sizeBytes: 4 },
            { index: 2, filename: "frame_000002.png", url: "/api/w3d/convert-mov/jobs/job-2/frames/frame_000002.png", sizeBytes: 4 },
          ],
          ffmpegSource: "static",
        }));
      }
      if (init?.method === "DELETE") return new Response(JSON.stringify({ ok: true }));
      // Fail frame 2
      if (String(url).includes("frame_000002")) return new Response("nope", { status: 500 });
      return new Response(new Uint8Array([0x89]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await convertAndWriteFrames({
      rootHandle: handle,
      movFiles: [{ file: mockFile("x.mov"), relPath: "x.mov" }],
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(result.converted).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].mov).toBe("x.mov");
    expect(result.failed[0].failedFrames).toEqual(["frame_000002.png"]);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/editor/import/movConvertViaFSA.test.ts`
Expected: All 4 tests FAIL (module does not exist).

- [ ] **Step 3: Implement `convertAndWriteFrames`**

Create `src/editor/import/movConvertViaFSA.ts`:

```typescript
import { getNestedHandle } from "./w3dFolder";

export type ConvertProgress =
  | { phase: "uploading"; movName: string; movIndex: number; movTotal: number }
  | { phase: "writing-frame"; movName: string; frame: number; total: number }
  | { phase: "writing-json"; movName: string }
  | { phase: "cleanup"; movName: string }
  | { phase: "done" }
  | { phase: "cancelled" };

interface FrameDescriptor {
  index: number;
  filename: string;
  url: string;
  sizeBytes: number;
}

interface Manifest {
  jobId: string;
  source: string;
  sequenceJson: unknown;
  frameCount: number;
  fps: number;
  alpha: boolean;
  frames: FrameDescriptor[];
  ffmpegSource?: string;
}

export interface ConvertAndWriteOptions {
  rootHandle: FileSystemDirectoryHandle;
  movFiles: { file: File; relPath: string }[];
  signal: AbortSignal;
  onProgress: (p: ConvertProgress) => void;
  frameConcurrency?: number;
}

export interface ConvertAndWriteResult {
  converted: { mov: string; framesDir: string }[];
  skipped: { mov: string; reason: "already-has-sequence" }[];
  failed: { mov: string; error: string; failedFrames?: string[] }[];
}

export class PermissionDeniedError extends Error {
  constructor() { super("readwrite permission denied"); this.name = "PermissionDeniedError"; }
}

const stemOf = (name: string) => name.replace(/\.mov$/i, "");

export async function convertAndWriteFrames(
  opts: ConvertAndWriteOptions,
): Promise<ConvertAndWriteResult> {
  const { rootHandle, movFiles, signal, onProgress } = opts;
  const concurrency = opts.frameConcurrency ?? 4;

  const perm = await rootHandle.requestPermission({ mode: "readwrite" });
  if (perm !== "granted") throw new PermissionDeniedError();

  const result: ConvertAndWriteResult = { converted: [], skipped: [], failed: [] };

  for (let i = 0; i < movFiles.length; i++) {
    if (signal.aborted) {
      onProgress({ phase: "cancelled" });
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const { file } = movFiles[i];
    const stem = stemOf(file.name);
    const segs = ["Resources", "Textures", `${stem}_frames`];
    const framesDir = await getNestedHandle(rootHandle, segs, { create: true });

    // skip-if-exists
    let alreadyHas = false;
    try {
      const existing = await framesDir.getFileHandle("sequence.json");
      const txt = await (await existing.getFile()).text();
      const parsed = JSON.parse(txt);
      if (parsed && parsed.framePattern === "frame_%06d.png") alreadyHas = true;
    } catch { /* not present — proceed */ }
    if (alreadyHas) {
      result.skipped.push({ mov: file.name, reason: "already-has-sequence" });
      continue;
    }

    onProgress({ phase: "uploading", movName: file.name, movIndex: i, movTotal: movFiles.length });
    let manifest: Manifest;
    try {
      const resp = await fetch("/api/w3d/convert-mov", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": file.name },
        body: file,
        signal,
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ code: `HTTP_${resp.status}` }));
        throw new Error(errBody.code ?? `HTTP_${resp.status}`);
      }
      manifest = await resp.json() as Manifest;
    } catch (err: any) {
      if (err.name === "AbortError") { onProgress({ phase: "cancelled" }); throw err; }
      result.failed.push({ mov: file.name, error: err.message ?? String(err) });
      continue;
    }

    onProgress({ phase: "writing-json", movName: file.name });
    const seqJsonHandle = await framesDir.getFileHandle("sequence.json", { create: true });
    const seqWritable = await seqJsonHandle.createWritable();
    await seqWritable.write(JSON.stringify(manifest.sequenceJson, null, 2));
    await seqWritable.close();

    // sliding window of N concurrent frame fetches
    const failedFrames: string[] = [];
    let completed = 0;
    const queue = manifest.frames.slice();
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        if (signal.aborted) return;
        const fr = queue.shift()!;
        try {
          const r = await fetch(fr.url, { signal });
          if (!r.ok) throw new Error(`HTTP_${r.status}`);
          const blob = await r.blob();
          const fh = await framesDir.getFileHandle(fr.filename, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
          completed += 1;
          onProgress({ phase: "writing-frame", movName: file.name, frame: completed, total: manifest.frames.length });
        } catch (err: any) {
          if (err.name === "AbortError") throw err;
          failedFrames.push(fr.filename);
        }
      }
    });
    try {
      await Promise.all(workers);
    } catch (err: any) {
      if (err.name === "AbortError") {
        onProgress({ phase: "cancelled" });
        // best-effort cleanup
        fetch(`/api/w3d/convert-mov/jobs/${manifest.jobId}`, { method: "DELETE" }).catch(() => {});
        throw err;
      }
    }

    onProgress({ phase: "cleanup", movName: file.name });
    fetch(`/api/w3d/convert-mov/jobs/${manifest.jobId}`, { method: "DELETE" }).catch(() => {});

    if (failedFrames.length === 0) {
      result.converted.push({ mov: file.name, framesDir: segs.join("/") });
    } else {
      result.failed.push({ mov: file.name, error: "partial frame failures", failedFrames });
    }
  }

  onProgress({ phase: "done" });
  return result;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/import/movConvertViaFSA.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: No errors involving the new file.

- [ ] **Step 6: Commit**

```bash
git add src/editor/import/movConvertViaFSA.ts src/editor/import/movConvertViaFSA.test.ts
git commit -m "feat(import): convertAndWriteFrames orchestrator with progress + cancel"
```

---

## Task 9: Modal — new default UI (no path placeholder)

**Files:**
- Modify: `src/editor/react/components/MovConversionModal.tsx`
- Modify: `src/editor/react/components/MovConversionModal.test.tsx`

- [ ] **Step 1: Write the failing test for the new prop API**

Append to `MovConversionModal.test.tsx`:

```tsx
describe("MovConversionModal — new default UI", () => {
  it("does not render a project name input or path placeholder when fsa is supported and dev backend is reachable", () => {
    render(
      <MovConversionModal
        isOpen
        classification={NO_SEQ}
        mode={{ kind: "fsa-ready" }}
        onConvert={vi.fn()}
        onImportWithoutConverting={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByPlaceholderText(/C:\\Users\\you/i)).toBeNull();
    expect(screen.queryByText(/R3_PROJECTS_ROOT/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Convert and Import/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Import Without Converting/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeEnabled();
  });

  it("calls onConvert with no arguments when Convert and Import is clicked in fsa-ready mode", () => {
    const onConvert = vi.fn();
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ} mode={{ kind: "fsa-ready" }}
        onConvert={onConvert}
        onImportWithoutConverting={vi.fn()} onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Convert and Import/i }));
    expect(onConvert).toHaveBeenCalledWith();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/react/components/MovConversionModal.test.tsx -t "new default UI"`
Expected: FAIL — `mode` prop unknown / placeholder still present.

- [ ] **Step 3: Add the `mode` discriminated prop and new render path**

In `MovConversionModal.tsx`, add to the props type:

```typescript
type ModalMode =
  | { kind: "fsa-ready" }
  | { kind: "in-progress"; current: string; frame: number; total: number; pending: string[] }
  | { kind: "fallback"; reason: "no-fsa" | "permission-denied" | "no-backend" | "ffmpeg-missing"; cliCommand: string }
  | { kind: "legacy-path-input"; lastError?: { code: string } };

interface MovConversionModalProps {
  isOpen: boolean;
  classification: MovClassification;
  mode: ModalMode;
  onConvert: (legacyArg?: { projectName?: string; folderPath?: string }) => void;
  onImportWithoutConverting: () => void;
  onCancel: () => void;
}
```

The default render path (when `mode.kind === "fsa-ready"`) shows ONLY:
- Title: `MOV videos detected`
- The list of un-converted .mov names
- Three buttons: Convert and Import / Import Without Converting / Cancel

No project name field, no path input, no R3_PROJECTS_ROOT mention. Calls `onConvert()` with no args.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/react/components/MovConversionModal.test.tsx -t "new default UI"`
Expected: 2 PASS.

- [ ] **Step 5: Update existing tests that referenced the old prop shape**

The existing tests pass `projectName="GameName_FS"` and `isDevMode`. Migrate them: in callsites, pass `mode={{ kind: "legacy-path-input" }}` (preserves old behaviour) or `mode={{ kind: "fsa-ready" }}` where appropriate. Run the full file:

Run: `npx vitest run src/editor/react/components/MovConversionModal.test.tsx`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/editor/react/components/MovConversionModal.tsx src/editor/react/components/MovConversionModal.test.tsx
git commit -m "feat(modal): fsa-ready render path with no path placeholder"
```

---

## Task 10: Modal — in-progress state + Cancel button

**Files:**
- Modify: `src/editor/react/components/MovConversionModal.tsx`
- Modify: `src/editor/react/components/MovConversionModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("MovConversionModal — in-progress state", () => {
  it("shows 'Writing frame K/N' and a Cancel button", () => {
    const onCancel = vi.fn();
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ}
        mode={{ kind: "in-progress", current: "intro.mov", frame: 25, total: 120, pending: ["door_anim.mov", "boss_loop.mov"] }}
        onConvert={vi.fn()} onImportWithoutConverting={vi.fn()} onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/Writing frame 25\/120/i)).toBeInTheDocument();
    expect(screen.getByText(/intro\.mov/i)).toBeInTheDocument();
    expect(screen.getByText(/door_anim\.mov/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/react/components/MovConversionModal.test.tsx -t "in-progress"`
Expected: FAIL.

- [ ] **Step 3: Implement the in-progress branch**

In the modal render switch, when `mode.kind === "in-progress"`:

```tsx
return (
  <ModalShell title="Converting MOV videos" onCancel={props.onCancel}>
    <div className="mov-current">{mode.current}</div>
    <div className="mov-progress-text">Writing frame {mode.frame}/{mode.total}</div>
    <progress max={mode.total} value={mode.frame} />
    {mode.pending.length > 0 && (
      <div className="mov-pending">Pending: {mode.pending.join(", ")}</div>
    )}
    <button onClick={props.onCancel}>Cancel</button>
  </ModalShell>
);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/react/components/MovConversionModal.test.tsx -t "in-progress"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/react/components/MovConversionModal.tsx src/editor/react/components/MovConversionModal.test.tsx
git commit -m "feat(modal): in-progress state with 'Writing frame K/N' + Cancel"
```

---

## Task 11: Modal — fallback variants

**Files:**
- Modify: `src/editor/react/components/MovConversionModal.tsx`
- Modify: `src/editor/react/components/MovConversionModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe("MovConversionModal — fallback variants", () => {
  const cases: Array<[ModalMode["kind"] extends "fallback" ? any : never, RegExp]> = [
    [{ kind: "fallback", reason: "no-fsa", cliCommand: "npm run convert:mov -- --folder \"<path>\"" }, /browser can't write back/i],
    [{ kind: "fallback", reason: "permission-denied", cliCommand: "npm run convert:mov -- --folder \"<path>\"" }, /Permission to write was denied/i],
    [{ kind: "fallback", reason: "no-backend", cliCommand: "npm run convert:mov -- --folder \"<path>\"" }, /No local converter/i],
    [{ kind: "fallback", reason: "ffmpeg-missing", cliCommand: "npm run convert:mov -- --folder \"<path>\"" }, /ffmpeg is not installed/i],
  ] as any;
  it.each(cases)("renders the correct reason text and the CLI command for %j", (mode, regex) => {
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ} mode={mode}
        onConvert={vi.fn()} onImportWithoutConverting={vi.fn()} onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(regex)).toBeInTheDocument();
    expect(screen.getByText(/npm run convert:mov/)).toBeInTheDocument();
    expect(screen.queryByText(/R3_PROJECTS_ROOT/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/react/components/MovConversionModal.test.tsx -t "fallback variants"`
Expected: FAIL.

- [ ] **Step 3: Implement the fallback branch**

Map reason → message:

```tsx
const FALLBACK_TEXT: Record<string, string> = {
  "no-fsa": "Your browser can't write back to the picked folder.",
  "permission-denied": "Permission to write was denied.",
  "no-backend": "No local converter is available in this build.",
  "ffmpeg-missing": "ffmpeg is not installed — run 'npm install' from repo root.",
};
```

When `mode.kind === "fallback"`:

```tsx
return (
  <ModalShell title="MOV conversion unavailable" onCancel={props.onCancel}>
    <p>{FALLBACK_TEXT[mode.reason]}</p>
    <p>You can convert offline:</p>
    <pre><code>{mode.cliCommand}</code></pre>
    <div>
      <button onClick={() => props.onImportWithoutConverting()}>Import Without Converting</button>
      <button onClick={props.onCancel}>Cancel</button>
    </div>
  </ModalShell>
);
```

For `mode.kind === "legacy-path-input"`: keep the old manual-path UI (project name field) — this is what existing legacy tests already cover.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/react/components/MovConversionModal.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/react/components/MovConversionModal.tsx src/editor/react/components/MovConversionModal.test.tsx
git commit -m "feat(modal): fallback variants render reason + CLI command, no R3 mention"
```

---

## Task 12: App.tsx — wire the new flow

**Files:**
- Modify: `src/editor/react/App.tsx`

This task has no new unit test (App.tsx is integration-tested via the modal + orchestrator units). Verification is `npm test` + `npm run typecheck` + manual smoke (Task 13).

- [ ] **Step 1: Locate the existing modal call site**

Read App.tsx around the area cited by the Explore report (≈ line 1403-1493): `importW3DFromFolderWithModalCheck`, `decideMovImportFlow`, the `movModalState` setup, and `pickW3DFolder`.

- [ ] **Step 2: Replace `onConvert` handler with the new orchestrator**

Replace the inline `onConvert` callback. New shape:

```tsx
const abortRef = useRef<AbortController | null>(null);

async function onConvert() {
  if (!movModalState) return;
  const dirHandle = movModalState.directoryHandle;
  if (!dirHandle) {
    setMovModalState({ ...movModalState, mode: { kind: "fallback", reason: "no-fsa", cliCommand: CLI_HINT } });
    return;
  }
  const ctrl = new AbortController();
  abortRef.current = ctrl;
  // Move to in-progress state with the first .mov
  const movFiles = movModalState.classification.withoutSequence.map((c) => ({
    file: movModalState.filesByName.get(c.videoName)!,
    relPath: c.videoName,
  }));
  setMovModalState((s) => s ? { ...s, mode: { kind: "in-progress", current: movFiles[0].file.name, frame: 0, total: 1, pending: movFiles.slice(1).map(m => m.file.name) }} : s);
  try {
    const result = await convertAndWriteFrames({
      rootHandle: dirHandle,
      movFiles,
      signal: ctrl.signal,
      onProgress: (p) => {
        setMovModalState((s) => {
          if (!s) return s;
          if (p.phase === "writing-frame") {
            return { ...s, mode: { kind: "in-progress", current: p.movName, frame: p.frame, total: p.total, pending: movFiles.slice(movFiles.findIndex(m => m.file.name === p.movName) + 1).map(m => m.file.name) }};
          }
          return s;
        });
      },
    });
    // Re-walk and re-import using the same handle
    const refreshedFiles = await collectFilesFromDirectory(dirHandle);
    await reimportFromCollectedFiles(refreshedFiles); // existing helper
    setMovModalState(null);
    if (result.failed.length > 0) {
      // surface a non-blocking toast or console warning
      console.warn("[mov-convert] partial failures:", result.failed);
    }
  } catch (err: any) {
    if (err?.name === "PermissionDeniedError") {
      setMovModalState((s) => s ? { ...s, mode: { kind: "fallback", reason: "permission-denied", cliCommand: CLI_HINT }} : s);
    } else if (err?.name === "AbortError") {
      setMovModalState(null);
    } else if (err?.message?.includes("FFMPEG_NOT_INSTALLED")) {
      setMovModalState((s) => s ? { ...s, mode: { kind: "fallback", reason: "ffmpeg-missing", cliCommand: CLI_HINT }} : s);
    } else if (err?.message?.startsWith("HTTP_404")) {
      setMovModalState((s) => s ? { ...s, mode: { kind: "fallback", reason: "no-backend", cliCommand: CLI_HINT }} : s);
    } else {
      console.error("[mov-convert] failure:", err);
    }
  }
}

function onCancelInProgress() {
  abortRef.current?.abort();
}
```

- [ ] **Step 3: Default the modal mode based on capability detection**

When opening the modal:

```tsx
const initialMode: ModalMode =
  typeof window.showDirectoryPicker === "function" && movModalState?.directoryHandle
    ? { kind: "fsa-ready" }
    : { kind: "fallback", reason: "no-fsa", cliCommand: CLI_HINT };
```

Where:
```tsx
const CLI_HINT = 'npm run convert:mov -- --folder "<path>"';
```

- [ ] **Step 4: Typecheck and run all tests**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/react/App.tsx
git commit -m "feat(app): wire convertAndWriteFrames + abort + capability-based fallback"
```

---

## Task 13: QA / Regression smoke

**Files:** none (manual + scripted verification)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke against a real W3D fixture**

Start dev server: `npm run dev`. Open the editor in Chrome. Pick a W3D folder containing un-converted `.mov` files via the folder picker.

Verify each:
- [ ] No path placeholder string `C:\Users\you\…` appears anywhere.
- [ ] No "R3_PROJECTS_ROOT" string appears anywhere.
- [ ] Clicking Convert and Import triggers a `read → readwrite` permission prompt.
- [ ] Modal shows `Writing frame K/N` ticking up.
- [ ] After completion, on disk: `<picked>/Resources/Textures/<stem>_frames/sequence.json` and `frame_000001.png … frame_NNNNNN.png` exist.
- [ ] Re-import is automatic; the editor's Media panel shows `SEQUENCE` badges; `__r3Dump()` lists image-sequence nodes.
- [ ] Re-running Convert and Import on the same folder skips already-converted files (look for "skipped: already-has-sequence" entries in console logs).
- [ ] Click Cancel mid-conversion: the modal closes, partially-written frames remain on disk, no uncaught exception in console.

- [ ] **Step 4: Permission-deny smoke**

Repeat the smoke but click "Block" on the readwrite permission prompt.
Verify: modal pivots to fallback variant `permission-denied` with the CLI hint.

- [ ] **Step 5: ffmpeg-missing smoke**

Temporarily rename `node_modules/ffmpeg-static/ffmpeg.exe` (or `.../ffmpeg` on POSIX). Repeat the smoke.
Verify: modal pivots to fallback variant `ffmpeg-missing` showing `run 'npm install' from repo root`.
Restore the binary afterwards.

- [ ] **Step 6: Commit any QA notes**

If any of the smokes uncovered fixes, commit them as small follow-ups (one commit per concern).

---

## Definition of Done (mirrors the spec's success criteria)

1. ✅ `R3_PROJECTS_ROOT` not consulted on the new flow (Task 3 removed it from `handleNewPost`).
2. ✅ No manual path input on default path (Task 9 removed it from `fsa-ready` render).
3. ✅ No system ffmpeg required (Task 6 promoted `ffmpeg-static` to deps; probe priority unchanged).
4. ✅ No giant ZIP (Tasks 3-5 are per-frame fetch).
5. ✅ Frames never all in memory (Task 8 sliding window of 4).
6. ✅ "Writing frame K/N" shown (Tasks 8 + 10).
7. ✅ `*_frames/sequence.json` + PNGs land in picked folder (Task 8 via FSA writes).
8. ✅ Auto re-import (Task 12 calls `collectFilesFromDirectory` + `reimportFromCollectedFiles` after success).
9. ✅ `npm test` green (Task 13).

## Out of scope reminders

- `.vert` / `.ind` / `Size.YProp` — untouched.
- `ImageSequencePlayer` internals — untouched (last touched in commits 1611bfb / 7ecacb5 / 63d4462).
- `frameUrls` localStorage persistence — strip stays as-is.
- Streaming multipart, ffmpeg.wasm — explicit non-goals.
- Production-build conversion (no dev plugin in prod) — fallback variant `no-backend` covers messaging; no implementation work.

## Subagent-driven dispatch notes

If you choose Subagent-Driven Development for execution:
- **Tasks 1, 2, 6** (Backend extraction, Registry, Packaging) are independent — can dispatch in parallel.
- **Tasks 3, 4, 5** (POST, GET, DELETE) must serialise — they all edit `movConvertPlugin.mjs`.
- **Task 7** (getNestedHandle) is independent — can run in parallel with backend tasks.
- **Task 8** (FSA orchestrator) depends on Task 7's helper and the manifest contract from Task 3.
- **Tasks 9, 10, 11** must serialise — same modal file.
- **Task 12** depends on Tasks 8 and 9-11.
- **Task 13** is last and serial.

Recommended waves:
1. {Task 1, Task 2, Task 6, Task 7} in parallel.
2. Task 3.
3. Task 4.
4. Task 5.
5. Task 8.
6. Task 9.
7. Task 10.
8. Task 11.
9. Task 12.
10. Task 13.
