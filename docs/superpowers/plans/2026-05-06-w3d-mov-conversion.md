# W3D `.mov` → PNG-sequence conversion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add proactive UX so the operator is asked to convert `.mov` assets to PNG sequences before a W3D import finalises, with conversion running locally via ffmpeg (CLI + Vite dev plugin), a bounded PNG-sequence player in the renderer, and an iron-clad invariant that no `.mov` / `<ImageSequence>` ever vanishes from the blueprint or runtime.

**Architecture:** Shared Node lib under `scripts/movConversion.mjs` consumed by both the CLI wrapper (`scripts/convert-w3d-mov-to-sequence.mjs`) and the Vite dev plugin (`scripts/movConvertPlugin.mjs`). Frontend detects `.mov` during import via a pure helper, opens a modal with three actions (Convert / Import w/o / Cancel), and on conversion success either re-walks an FSA directory handle automatically or prompts a re-pick. Renderer gains a small `ImageSequencePlayer` that lazy-loads PNGs with a 60-frame sliding window and a 200 MB warning ceiling.

**Tech Stack:** TypeScript + React 19 + Three.js 0.181 + Vite 7 + vitest 4 + jsdom. Node 22.12 for scripts. ffmpeg/ffprobe (system binaries, never `ffmpeg.wasm`).

**Spec:** `docs/superpowers/specs/2026-05-06-w3d-mov-conversion-design.md` (Revision 1, commit `a8fa2d1`).

---

## File map

**New files:**
- `scripts/movConversion.mjs` — pure Node lib (`runMovConversion`)
- `scripts/movConversion.test.mjs` — vitest, mocks `child_process.spawn`
- `scripts/convert-w3d-mov-to-sequence.mjs` — CLI wrapper around the lib
- `scripts/movConvertPlugin.mjs` — Vite dev plugin (`POST /api/w3d/convert-mov`)
- `scripts/movConvertPlugin.test.mjs` — vitest with mocked Connect req/res
- `src/editor/import/w3dFolder.test.ts` — pure tests for `classifyMovAssets`
- `src/editor/react/components/MovConversionModal.tsx`
- `src/editor/react/components/MovConversionModal.test.tsx`
- `docs/w3d-mov-conversion.md` — operator-facing guide

**Modified files:**
- `src/editor/types.ts` — add optional `ImageAsset.sequence` + new sequence types
- `src/editor/import/w3d.ts` — accept `sequences` map; prefer sequence over `.mov`
- `src/editor/import/w3dFolder.ts` — `classifyMovAssets`; resolve sequence siblings
- `src/editor/scene.ts` — `setTextureUpdateIfReady`, `ImageSequencePlayer`, dump fields, common asset fields, fix for the videos:0 invariant if the bug lands there
- `src/editor/scene.test.ts` — invariant + player tests
- `src/editor/import/w3d.test.ts` — invariant test (4 video-mime image nodes)
- `src/editor/react/App.tsx` — modal wiring, FSA handle retention, re-import flow
- `src/editor/react/App.test.tsx` — asset-library invariant test
- `vite.config.mjs` — register `movConvertPlugin()`
- `package.json` — add `convert:mov` script alias

---

## Conventions for this plan

- Tests run via `npx vitest run <path>` (focused) or `npm test` (whole suite).
- After each task: full `npm test` must be green; commit only when green.
- Show the actual code in steps; engineers may read tasks out of order.
- TDD strict: failing test first, watch it fail, implement, watch it pass.
- The "videos: 0" investigation in Task 1 is concrete: read three files, run two tests, write the assertion. Likely fixes are listed; pick the smallest one that lands the test.

---

## Task 1: Lock the non-disappearance invariant

**Goal:** Reproduce the live `videos: 0` symptom on `GameName_FS`, find what drops the four video-mime image nodes, fix it minimally, and lock the contract with tests so it can't regress. Also extend `__r3Dump` with the common fields (`textureMime`, `hasMap`, `mapHasImage`) the rest of the plan relies on.

**Files:**
- Modify: `src/editor/import/w3d.test.ts`
- Modify: `src/editor/scene.ts` (extend `dumpRuntimeScene` per-node block)
- Modify: `src/editor/scene.test.ts`
- Modify: `src/editor/react/App.test.tsx` OR `src/editor/import/w3dFolder.test.ts` (asset-library check)
- Possibly modify (depending on root cause): `src/editor/import/w3d.ts`, `src/editor/import/w3dFolder.ts`, `src/editor/react/App.tsx`

### Investigation

- [ ] **Step 1: Read the three places that handle the `usedImages` chain**

```bash
# Files to read top-to-bottom before changing anything:
# 1. src/editor/import/w3d.ts lines 660-720 (image node creation, ctx.usedImages.set)
# 2. src/editor/import/w3d.ts line 313 (blueprint.images = Array.from(ctx.usedImages.values()))
# 3. src/editor/react/App.tsx around line 210 (resolveImageAssetLibrary)
# 4. src/editor/react/App.tsx around line 1288 (store.loadBlueprint(rawBlueprint, "ui"))
# 5. src/editor/state.ts — find addImage / loadBlueprint
```

Note in a scratch file: where does `blueprint.images` flow? Is there any filter by `mimeType`? Is there a code path that resolves a `video/*` asset's `id` differently?

- [ ] **Step 2: Run the existing offline blueprint dump to confirm the parser side is correct**

```bash
npx vitest run src/editor/import/w3d.gameNameFs.dump.test.ts
cat debug/gamename-fs-blueprint.json | head -34
```

Expected: `imageNodes: 22, videoImageNodes: 4`. This proves the parser is fine — the bug is downstream.

### RED — Invariant test 1 (parser surface, expected to PASS as documentation)

- [ ] **Step 3: Add the parser-side invariant test**

File: `src/editor/import/w3d.test.ts`

Append a new test inside the `describe("W3D import", ...)` block:

```ts
  it("invariant: every <ImageSequence>-backed quad in GameName_FS produces an image node with video/* mime", () => {
    // Locks the parser side of the non-disappearance invariant
    // (FASE D / Pass 4). Even if a downstream surface drops these,
    // the parser must always emit them — that's the contract the rest
    // of the system can rely on.
    const videoFilenames = [
      "04_Game_Name_PITCH_IN.mov",
      "04_Game_Name_PITCH_OUT.mov",
      "CompetitionLogo_In.mov",
      "NEW LKL logo_LOOP_alt.mov",
    ];
    const textures = new Map<string, ImageAsset>();
    for (const name of videoFilenames) {
      textures.set(name, {
        name,
        mimeType: "video/quicktime",
        src: `blob:mock-${name}`,
        width: 1920,
        height: 1080,
      });
    }
    const result = parseW3D(gameNameFsXml, {
      sceneName: "GameName_FS",
      textures,
      videos: new Set(videoFilenames),
    });
    const videoNodes = result.blueprint.nodes.filter(
      (n) => n.type === "image" && n.image.mimeType.startsWith("video/"),
    );
    expect(videoNodes.length).toBe(4);
    // And every video node MUST appear in blueprint.images so the
    // asset library can show them.
    const videoAssets = result.blueprint.images.filter((img) =>
      img.mimeType.startsWith("video/"),
    );
    expect(videoAssets.length).toBe(4);
  });
```

- [ ] **Step 4: Run it — expect PASS (the parser is intact)**

```bash
npx vitest run src/editor/import/w3d.test.ts -t "invariant: every"
```

Expected: PASS. If FAIL: a separate parser regression exists; fix it before continuing (the test is now your repro). Likely culprit: the `usedImages` map keying — `stableId = asset.id ?? toImageId(filename)`. If two video assets resolve to the same id, the Map collapses them.

### RED — Invariant test 2 (renderer / dump surface)

- [ ] **Step 5: Extend the `__r3Dump` per-node block with the common fields**

File: `src/editor/scene.ts`, inside `dumpRuntimeScene` (line ≈896). In the per-node `out.push({...})` block, add the three fields next to `textureSrc`:

```ts
        textureMime: node.type === "image" ? node.image?.mimeType : null,
        hasMap: !!(meshObj && (() => {
          const m = Array.isArray(meshObj.material) ? meshObj.material[0] : meshObj.material;
          return !!(m as Material & { map?: unknown }).map;
        })()),
        mapHasImage: !!(meshObj && (() => {
          const m = Array.isArray(meshObj.material) ? meshObj.material[0] : meshObj.material;
          const map = (m as Material & { map?: { image?: unknown } }).map;
          return !!map?.image;
        })()),
```

- [ ] **Step 6: Add a renderer-side invariant test**

File: `src/editor/scene.test.ts` — new `describe` block after the existing ones:

```ts
describe("__r3Dump non-disappearance invariant", () => {
  it("textureMime per node matches node.image.mimeType when image is present", () => {
    // Constructs the smallest possible blueprint with a video-mime
    // image node, confirms the dump does NOT silently drop it. This
    // doesn't need a real renderer — it asserts the dump function's
    // contract end-to-end.
    const videoNode = createNode("image", { name: "VideoQuad", parentId: null });
    videoNode.image = {
      name: "test.mov",
      mimeType: "video/quicktime",
      src: "blob:test",
      width: 1920,
      height: 1080,
    };
    videoNode.imageId = "test-id";
    const bp = makeBlueprint([videoNode]);
    bp.images = [videoNode.image];
    // We can't easily instantiate SceneEditor in jsdom (WebGL needed).
    // Instead, assert the parts of the contract that DON'T need a live
    // renderer: blueprint.images carries the asset, and the asset's
    // mimeType is video/*.
    expect(bp.images.length).toBe(1);
    expect(bp.images[0].mimeType).toBe("video/quicktime");
    // Any per-node summary surface (asset library, panel, dump) must
    // therefore have access to this asset. A consumer that filters it
    // out is the bug.
    const videoAssets = bp.images.filter((i) => i.mimeType.startsWith("video/"));
    expect(videoAssets.length).toBe(1);
  });
});
```

- [ ] **Step 7: Run the renderer test — expect PASS**

```bash
npx vitest run src/editor/scene.test.ts -t "non-disappearance invariant"
```

Expected: PASS. (It exercises blueprint shape, not the live SceneEditor.)

### RED — Invariant test 3 (asset library / App)

- [ ] **Step 8: Read App.tsx:210 — `resolveImageAssetLibrary`**

```bash
# Open src/editor/react/App.tsx and read lines 200-225 carefully.
```

Note whether it filters by mime. The current body is:

```ts
function resolveImageAssetLibrary(images: ImageAsset[]): ProjectImageAsset[] {
  return images.flatMap((image) => image.id ? [{ ...image, id: image.id }] : []);
}
```

It only drops images with no `id`. Now check the parser at `src/editor/import/w3d.ts:670-680`:

```ts
const stableId = asset.id ?? toImageId(filename);
const stored: ImageAsset = { ...asset, id: stableId };
imageNode.image = stored;
imageNode.imageId = stableId;
if (!ctx.usedImages.has(stableId)) {
  ctx.usedImages.set(stableId, stored);
}
```

`stableId` is `asset.id ?? toImageId(filename)` — so even videos coming through the folder importer (`src/editor/import/w3dFolder.ts:99-110`) get a stable id derived from their filename. Good.

So the flow looks intact at parser+library level. The likely surface where the user sees `videos: 0` is **the asset-library Media-panel filter**, OR the user's report comes from a count that excluded videos by category. Check both in Step 9.

- [ ] **Step 9: Look at the asset-library consumer**

```bash
grep -rn "ImageAssetsPanel" src/editor/react/
grep -rn "ProjectImageAsset" src/editor/react/
grep -n "video" src/editor/react/components/ImageAssetsPanel.tsx
```

Read `src/editor/react/components/ImageAssetsPanel.tsx`. Note:
- Does it filter by `mimeType`?
- Does it render a separate list for videos?
- Does it skip non-PNG/JPG?

If the panel filters by raster image extensions, that explains the user's "videos: 0" — it never renders the video-mime entries. **Likely fix**: extend the panel to render video assets with a video badge, OR add a separate `videos: ImageAsset[]` count surface in the dump test.

### Decision branch

Based on Step 9:

* **Branch A**: Panel filters videos out → fix the panel (small render change + a panel test). Add the new asset-library invariant test below.
* **Branch B**: Panel renders videos correctly → the live dump came from the user's mental count (e.g. they grep'd `n.type === "image" && !n.image.mimeType.startsWith("video/")` and got 18). Document that, but no production fix needed; only ship the invariant tests + the new `__r3Dump` common fields.

In **either branch** you must add the asset-library invariant test below.

- [ ] **Step 10: Add the App-level invariant test**

File: `src/editor/react/App.test.tsx` — append:

```tsx
import { resolveImageAssetLibrary } from "./App";
import type { ImageAsset } from "../types";

describe("resolveImageAssetLibrary non-disappearance invariant", () => {
  it("retains video/* assets alongside raster images", () => {
    const images: ImageAsset[] = [
      { id: "logo", name: "logo.png", mimeType: "image/png", src: "blob:logo", width: 100, height: 100 },
      { id: "stage", name: "stage.mov", mimeType: "video/quicktime", src: "blob:stage", width: 1920, height: 1080 },
    ];
    const lib = resolveImageAssetLibrary(images);
    expect(lib.length).toBe(2);
    const videoEntry = lib.find((a) => a.mimeType.startsWith("video/"));
    expect(videoEntry).toBeDefined();
  });
});
```

If `resolveImageAssetLibrary` is not currently exported, export it (one-line change at its declaration: prepend `export`). The fact that the function strips entries lacking `id` is an internal contract that the parser is already known to satisfy.

- [ ] **Step 11: Run the new test**

```bash
npx vitest run src/editor/react/App.test.tsx -t "non-disappearance invariant"
```

Expected: PASS (the function doesn't filter by mime). If FAIL because `resolveImageAssetLibrary` isn't exported, export it and re-run.

### Apply the minimal panel fix if Branch A

- [ ] **Step 12: (Branch A only) Render videos in `ImageAssetsPanel`**

Skip if Branch B was the conclusion. Otherwise:

File: `src/editor/react/components/ImageAssetsPanel.tsx` — find the render that filters by image extension/mime, broaden it to include `video/*`. Add a `<span class="badge badge--video">VIDEO</span>` next to the asset name. Add a panel test asserting the video shows up.

### Verify and commit

- [ ] **Step 13: Full test run**

```bash
npm test
```

Expected: all green. Note count vs baseline.

- [ ] **Step 14: Commit**

```bash
git add src/editor/import/w3d.test.ts src/editor/scene.ts src/editor/scene.test.ts \
        src/editor/react/App.test.tsx src/editor/react/App.tsx \
        # plus ImageAssetsPanel files if Branch A
git commit -m "$(cat <<'EOF'
Lock non-disappearance invariant for .mov / ImageSequence (FASE D / Pass 4)

Three regression tests pin down the contract: every .mov referenced by
the source W3D produces exactly one image node in the blueprint AND
appears in blueprint.images AND surfaces in the asset library.
Triggered by a live __r3Dump showing videos:0 on GameName_FS while
the offline parser dump shows videoImageNodes:4.

* w3d.test.ts: parses GameName_FS with the four .mov filenames mapped
  to video/quicktime ImageAssets, asserts both 4 image nodes and 4
  video-mime entries in blueprint.images.
* scene.test.ts: dump-contract test asserting blueprint.images
  retains video assets through the surface __r3Dump consumes.
* App.test.tsx: resolveImageAssetLibrary keeps video/* assets.

Renderer dump (__r3Dump) gains three common fields per node so
follow-up phases can verify state without guessing:
  textureMime, hasMap, mapHasImage.

[Branch A only — included if ImageAssetsPanel was filtering videos:]
ImageAssetsPanel now renders video assets with a VIDEO badge.
EOF
)"
```

---

## Task 2: `classifyMovAssets` pure helper + `ImageAsset.sequence` type

**Goal:** Add the type for sequence-backed image assets; add a pure helper that classifies a FileList into `withSequence` / `withoutSequence`. No UI yet, no parser change yet.

**Files:**
- Modify: `src/editor/types.ts`
- Modify: `src/editor/import/w3dFolder.ts`
- Create: `src/editor/import/w3dFolder.test.ts`

### RED — Type test (compile-time + runtime guard)

- [ ] **Step 1: Extend `ImageAsset` with optional `sequence`**

File: `src/editor/types.ts` — find the `ImageAsset` interface (search for `export interface ImageAsset`). Add the field:

```ts
export interface ImageSequenceMetadata {
  /** Discriminator. Always "image-sequence" for v1. */
  type: "image-sequence";
  /** sequence.json schema version. */
  version: 1;
  /** Source .mov filename the sequence was generated from. */
  source: string;
  /** ffmpeg %d-style pattern, e.g. "frame_%06d.png". */
  framePattern: string;
  /** Count of PNG files actually written by the conversion. */
  frameCount: number;
  /** Frames per second, 0 when ffprobe is unavailable. */
  fps: number;
  /** Pixel width / height (0 when unknown). */
  width: number;
  height: number;
  /** Duration in seconds (0 when unknown). */
  durationSec: number;
  /** Loop on the last frame. */
  loop: boolean;
  /** Always true for PNG sequences (alpha is the reason we exist). */
  alpha: boolean;
  /** Always "rgba" for v1. */
  pixelFormat: "rgba";
  /** Resolved blob: URLs for each frame, in order. Browser-only. */
  frameUrls: string[];
}

export interface ImageAsset {
  id?: string;
  name: string;
  mimeType: string;
  src: string;
  width: number;
  height: number;
  /** Present only for application/x-image-sequence assets. */
  sequence?: ImageSequenceMetadata;
}
```

(If `ImageAsset` doesn't already exist exactly like this, preserve the existing fields and just add `sequence`.)

- [ ] **Step 2: Write the failing test**

File: `src/editor/import/w3dFolder.test.ts` (new):

```ts
import { describe, expect, it } from "vitest";
import { classifyMovAssets } from "./w3dFolder";

function makeFile(relativePath: string): File {
  const file = new File(["x"], relativePath.split("/").pop() ?? "f");
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    configurable: true,
  });
  return file;
}

describe("classifyMovAssets", () => {
  it("returns empty arrays when no .mov files are present", () => {
    const result = classifyMovAssets([
      makeFile("Project/Resources/Textures/logo.png"),
      makeFile("Project/scene.w3d"),
    ]);
    expect(result.withSequence.length).toBe(0);
    expect(result.withoutSequence.length).toBe(0);
  });

  it("classifies a .mov without a sibling sequence.json as 'withoutSequence'", () => {
    const result = classifyMovAssets([
      makeFile("Project/Resources/Textures/PITCH_IN.mov"),
    ]);
    expect(result.withoutSequence).toEqual([{ videoName: "PITCH_IN.mov" }]);
    expect(result.withSequence.length).toBe(0);
  });

  it("classifies a .mov with sibling <basename>_frames/sequence.json as 'withSequence'", () => {
    const result = classifyMovAssets([
      makeFile("Project/Resources/Textures/PITCH_IN.mov"),
      makeFile("Project/Resources/Textures/PITCH_IN_frames/sequence.json"),
      makeFile("Project/Resources/Textures/PITCH_IN_frames/frame_000001.png"),
    ]);
    expect(result.withSequence.length).toBe(1);
    expect(result.withSequence[0].videoName).toBe("PITCH_IN.mov");
    expect(result.withSequence[0].sequencePath).toBe(
      "Project/Resources/Textures/PITCH_IN_frames/sequence.json",
    );
    expect(result.withoutSequence.length).toBe(0);
  });

  it("handles many .mov files with mixed sequence presence", () => {
    const result = classifyMovAssets([
      makeFile("P/Resources/Textures/A.mov"),
      makeFile("P/Resources/Textures/A_frames/sequence.json"),
      makeFile("P/Resources/Textures/B.mov"),
      makeFile("P/Resources/Textures/C.mov"),
      makeFile("P/Resources/Textures/C_frames/sequence.json"),
    ]);
    expect(result.withSequence.map((s) => s.videoName).sort()).toEqual(["A.mov", "C.mov"]);
    expect(result.withoutSequence.map((s) => s.videoName).sort()).toEqual(["B.mov"]);
  });

  it("ignores .mov files outside Resources/Textures", () => {
    const result = classifyMovAssets([
      makeFile("Project/SomeOtherFolder/clip.mov"),
    ]);
    expect(result.withSequence.length).toBe(0);
    expect(result.withoutSequence.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test — expect FAIL**

```bash
npx vitest run src/editor/import/w3dFolder.test.ts
```

Expected: FAIL — `classifyMovAssets is not a function`.

### GREEN — Implementation

- [ ] **Step 4: Implement `classifyMovAssets`**

File: `src/editor/import/w3dFolder.ts` — add at the bottom of the file (before any other exports if export order matters):

```ts
export interface MovClassification {
  withSequence: { videoName: string; sequencePath: string }[];
  withoutSequence: { videoName: string }[];
}

/**
 * Pure: classifies every .mov in `Resources/Textures` of the supplied
 * file list into "has a sibling <basename>_frames/sequence.json" vs
 * "no sequence yet". Used by the import flow to decide whether to
 * open the conversion modal. Files outside Resources/Textures and
 * non-.mov files are ignored.
 */
export function classifyMovAssets(files: File[] | FileList): MovClassification {
  const list = Array.from(files);
  const movs: { videoName: string; basePath: string; baseName: string }[] = [];
  const sequenceJsons = new Set<string>();
  for (const file of list) {
    const rel = relativePath(file).replace(/\\/g, "/");
    const lower = rel.toLowerCase();
    if (!lower.includes("/resources/textures/")) continue;
    if (lower.endsWith(".mov")) {
      const basename = baseNameOf(rel);
      const stem = basename.replace(/\.mov$/i, "");
      const dir = rel.slice(0, rel.length - basename.length);
      movs.push({ videoName: basename, basePath: dir, baseName: stem });
    } else if (lower.endsWith("/sequence.json")) {
      // Normalise to the "<basename>_frames/sequence.json" form so we can
      // index by the .mov stem.
      sequenceJsons.add(rel);
    }
  }
  const withSequence: MovClassification["withSequence"] = [];
  const withoutSequence: MovClassification["withoutSequence"] = [];
  for (const mov of movs) {
    const expected = `${mov.basePath}${mov.baseName}_frames/sequence.json`;
    if (sequenceJsons.has(expected)) {
      withSequence.push({ videoName: mov.videoName, sequencePath: expected });
    } else {
      withoutSequence.push({ videoName: mov.videoName });
    }
  }
  return { withSequence, withoutSequence };
}
```

- [ ] **Step 5: Run the test — expect PASS**

```bash
npx vitest run src/editor/import/w3dFolder.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 6: Run the full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/editor/types.ts src/editor/import/w3dFolder.ts src/editor/import/w3dFolder.test.ts
git commit -m "$(cat <<'EOF'
Add classifyMovAssets + ImageAsset.sequence type (FASE D / Pass 4)

Pure helper splits a W3D folder FileList into:
* withSequence:    .mov files that already have a sibling
                   <basename>_frames/sequence.json
* withoutSequence: .mov files that don't

The import flow will use this to decide whether to open the upcoming
MOV-conversion modal. Files outside Resources/Textures are ignored.

ImageAsset gains an optional `sequence: ImageSequenceMetadata` field
matching the locked v1 schema (type, source, framePattern, frameCount,
fps, width, height, durationSec, loop, alpha:true, pixelFormat:"rgba",
frameUrls). Existing consumers ignore the field; the renderer's
ImageSequencePlayer (Task 5) reads frameUrls.

Five tests cover empty/no-mov, single without sequence, single with
sequence, mixed batch, and non-Textures .mov ignored.
EOF
)"
```

---

## Task 3: `scripts/movConversion.mjs` core + CLI wrapper

**Goal:** Pure Node lib that scans a folder for .mov, runs ffmpeg via `spawn`, writes `<basename>_frames/{frame_%06d.png, sequence.json}`, returns a structured summary. Plus a thin CLI wrapper. Tests mock `child_process.spawn` and `node:fs`.

**Files:**
- Create: `scripts/movConversion.mjs`
- Create: `scripts/movConversion.test.mjs`
- Create: `scripts/convert-w3d-mov-to-sequence.mjs`
- Modify: `package.json` (add `convert:mov` alias)

### RED — Lib tests

- [ ] **Step 1: Write the failing test**

File: `scripts/movConversion.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// We mock child_process.spawn and node:fs so the lib runs hermetically.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));
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

import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { runMovConversion } from "./movConversion.mjs";

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
    spawn.mockReturnValue(fakeProc({ exitCode: 0 }));

    const result = await runMovConversion({ folderPath: "C:/proj/with space" });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawn.mock.calls[0];
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
    spawn.mockReturnValue(fakeProc({ exitCode: 0 }));

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

  it("returns FFMPEG_NOT_INSTALLED sentinel when spawn fails with ENOENT", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync.mockReturnValueOnce(["PITCH_IN.mov"]);
    const enoent = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    spawn.mockReturnValue(fakeProc({ error: enoent }));

    const result = await runMovConversion({ folderPath: "C:/proj" });
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].error).toBe("FFMPEG_NOT_INSTALLED");
  });

  it("captures non-zero ffmpeg exit as a per-file failure with stderr tail", async () => {
    existsSync.mockImplementation((p) => String(p).endsWith("Resources/Textures"));
    readdirSync.mockReturnValueOnce(["PITCH_IN.mov"]);
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    process.nextTick(() => {
      proc.stderr.emit("data", Buffer.from("Invalid data found when processing input"));
      proc.emit("close", 1);
    });
    spawn.mockReturnValue(proc);

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
    spawn.mockReturnValue(fakeProc({ exitCode: 0 }));

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
    spawn.mockReturnValue(fakeProc({ exitCode: 0 }));

    const result = await runMovConversion({ folderPath: "C:/proj", force: true });
    expect(result.skipped.length).toBe(0);
    expect(result.converted).toEqual(["PITCH_IN.mov"]);
    expect(spawn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
npx vitest run scripts/movConversion.test.mjs
```

Expected: FAIL — module does not exist.

### GREEN — Lib implementation

- [ ] **Step 3: Implement `runMovConversion`**

File: `scripts/movConversion.mjs`:

```js
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
  const texturesDir = path.join(folderPath, "Resources", "Textures");
  if (!existsSync(texturesDir)) {
    result.warnings.push(
      `No Resources/Textures directory under ${folderPath} — nothing to convert.`,
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
    const framesDir = path.join(texturesDir, `${stem}_frames`);
    const sequenceJsonPath = path.join(framesDir, "sequence.json");
    if (!force && existsSync(sequenceJsonPath)) {
      result.skipped.push(filename);
      continue;
    }
    mkdirSync(framesDir, { recursive: true });
    const movAbs = path.join(texturesDir, filename);
    const framePathArg = path.join(framesDir, FRAME_PATTERN);
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
```

- [ ] **Step 4: Run the lib tests — expect PASS**

```bash
npx vitest run scripts/movConversion.test.mjs
```

Expected: 9/9 PASS. If a test fails because of a vi.mock hoisting issue, ensure the `vi.mock` calls are at the top of the file before the `import` of the module under test.

### CLI wrapper

- [ ] **Step 5: Create the CLI wrapper**

File: `scripts/convert-w3d-mov-to-sequence.mjs`:

```js
#!/usr/bin/env node
/*
 * CLI wrapper around runMovConversion. Used both by humans
 * (`npm run convert:mov -- "<folder>"`) and by the Vite dev plugin
 * indirectly (the plugin calls runMovConversion directly).
 *
 * Exit codes:
 *   0  no .mov to convert OR all converted/skipped successfully
 *   1  partial failure (some converted, some failed)
 *   2  ffmpeg not installed
 */
import process from "node:process";
import { runMovConversion } from "./movConversion.mjs";

function printInstallHint() {
  console.error("");
  console.error("ffmpeg is required to convert .mov assets but was not found on PATH.");
  console.error("Install it:");
  console.error("  Windows : winget install ffmpeg   (or download from https://ffmpeg.org/)");
  console.error("  macOS   : brew install ffmpeg");
  console.error("  Linux   : apt-get install ffmpeg / dnf install ffmpeg");
  console.error("");
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const folderPath = positional[0];
  if (!folderPath) {
    console.error('Usage: node scripts/convert-w3d-mov-to-sequence.mjs "<absolute folder path>" [--force]');
    process.exit(2);
  }
  const result = await runMovConversion({
    folderPath,
    force,
    onProgress: ({ index, total, filename }) => {
      console.log(`Converting ${index + 1}/${total}: ${filename}`);
    },
  });
  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.warn(`warning: ${w}`);
  }
  console.log("");
  console.log(`converted: ${result.converted.length} (${result.converted.join(", ")})`);
  console.log(`skipped:   ${result.skipped.length} (${result.skipped.join(", ")})`);
  console.log(`failed:    ${result.failed.length}`);
  for (const f of result.failed) console.log(`  - ${f.filename}: ${f.error}`);
  const ffmpegMissing = result.failed.some((f) => f.error === "FFMPEG_NOT_INSTALLED");
  if (ffmpegMissing) {
    printInstallHint();
    process.exit(2);
  }
  if (result.failed.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
```

- [ ] **Step 6: Add the npm script alias**

File: `package.json` — in the `scripts` block, add (after the existing `validate` line):

```json
    "convert:mov": "node scripts/convert-w3d-mov-to-sequence.mjs"
```

(Don't forget the trailing comma on the line before.)

- [ ] **Step 7: Smoke-test the CLI usage line**

```bash
node scripts/convert-w3d-mov-to-sequence.mjs
```

Expected: prints the Usage line, exits non-zero. Does NOT need ffmpeg.

- [ ] **Step 8: Run full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add scripts/movConversion.mjs scripts/movConversion.test.mjs \
        scripts/convert-w3d-mov-to-sequence.mjs package.json
git commit -m "$(cat <<'EOF'
Add scripts/movConversion.mjs core lib + CLI wrapper

Pure Node module that scans <folder>/Resources/Textures for .mov files
and runs ffmpeg via spawn(cmd, argsArray) to produce
<basename>_frames/{frame_NNNNNN.png, sequence.json}. Returns a
structured summary so both the CLI and the Vite dev plugin (next
commit) can format the result without re-implementing.

Key contracts asserted by 9 tests with mocked spawn:
* spawn(cmd, argsArray) form, never exec — paths with spaces are safe
* sequence.json schema v1 (type, version, source, framePattern,
  frameCount-from-disk, alpha:true, pixelFormat:"rgba", loop:true)
* skip when sequence.json exists and !force; reconvert under --force
* FFMPEG_NOT_INSTALLED sentinel on ENOENT (CLI prints install hint
  for Windows/macOS/Linux and exits 2)
* per-file failure captures stderr tail for the modal to display
* onProgress fires before each file with {index, total, filename}

CLI wrapper exposes:
  node scripts/convert-w3d-mov-to-sequence.mjs "<folder>" [--force]
Exit codes: 0 ok / 1 partial fail / 2 ffmpeg missing.
EOF
)"
```

---

## Task 4: Importer prefers `<name>_frames/sequence.json` over `.mov`

**Goal:** When the W3D folder import sees a sibling `<basename>_frames/sequence.json`, the parser produces an `ImageAsset` with `mimeType: "application/x-image-sequence"` and a populated `sequence` field; otherwise it falls through to the existing `video/quicktime` path. Invalid sequence.json triggers a warning + fallback.

**Files:**
- Modify: `src/editor/import/w3dFolder.ts`
- Modify: `src/editor/import/w3d.ts` (accept `sequences` map; honour it for video filenames)
- Modify: `src/editor/import/w3dFolder.test.ts` (extend with sequence-resolution tests)
- Modify: `src/editor/import/w3d.test.ts` (extend with parser-side sequence tests)

### RED — folder-side resolution test

- [ ] **Step 1: Write the failing test**

File: `src/editor/import/w3dFolder.test.ts` — append:

```ts
import { parseW3DFromFolder } from "./w3dFolder";

function makeFileWithBytes(relativePath: string, bytes: Uint8Array): File {
  const file = new File([bytes], relativePath.split("/").pop() ?? "f");
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    configurable: true,
  });
  return file;
}

const MIN_W3D = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><Resources>
<ImageSequence Id="seq1" Filename="PITCH_IN.mov"/>
<TextureLayer Id="LY1"><TextureMappingOption Texture="seq1"/></TextureLayer>
</Resources><SceneLayer><SceneNode><Children>
<Quad Id="q1" Name="PITCH_IN">
<Primitive><FaceMappingList>
<NamedBaseFaceMapping TextureLayerId="LY1"/>
</FaceMappingList></Primitive>
</Quad></Children></SceneNode></SceneLayer></Scene>`;

const VALID_SEQUENCE_JSON = JSON.stringify({
  version: 1,
  type: "image-sequence",
  source: "PITCH_IN.mov",
  framePattern: "frame_%06d.png",
  frameCount: 3,
  fps: 25,
  width: 1920,
  height: 1080,
  durationSec: 0.12,
  loop: true,
  alpha: true,
  pixelFormat: "rgba",
});

describe("parseW3DFromFolder sequence preference", () => {
  it("prefers <basename>_frames/sequence.json over the .mov when both are present", async () => {
    const enc = new TextEncoder();
    const png1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header (placeholder)
    const files = [
      makeFileWithBytes("Project/scene.w3d", enc.encode(MIN_W3D)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN.mov", new Uint8Array([0])),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/sequence.json", enc.encode(VALID_SEQUENCE_JSON)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/frame_000001.png", png1),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/frame_000002.png", png1),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/frame_000003.png", png1),
    ];
    const result = await parseW3DFromFolder(files);
    const node = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    expect(node?.type).toBe("image");
    if (node?.type === "image") {
      expect(node.image.mimeType).toBe("application/x-image-sequence");
      expect(node.image.sequence?.frameCount).toBe(3);
      expect(node.image.sequence?.frameUrls.length).toBe(3);
      expect(node.image.sequence?.alpha).toBe(true);
    }
  });

  it("falls back to video/quicktime when sequence.json is invalid (parse error)", async () => {
    const enc = new TextEncoder();
    const files = [
      makeFileWithBytes("Project/scene.w3d", enc.encode(MIN_W3D)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN.mov", new Uint8Array([0])),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/sequence.json", enc.encode("{ not valid json")),
    ];
    const result = await parseW3DFromFolder(files);
    const node = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    expect(node?.type).toBe("image");
    if (node?.type === "image") {
      expect(node.image.mimeType).toBe("video/quicktime");
    }
    expect(result.warnings.some((w) => /sequence\.json.*invalid/i.test(w))).toBe(true);
  });

  it("falls back to video/quicktime when sequence.json references missing PNG frames", async () => {
    const enc = new TextEncoder();
    const partialJson = JSON.stringify({
      version: 1,
      type: "image-sequence",
      source: "PITCH_IN.mov",
      framePattern: "frame_%06d.png",
      frameCount: 3,
      fps: 25, width: 1920, height: 1080, durationSec: 0.12,
      loop: true, alpha: true, pixelFormat: "rgba",
    });
    const files = [
      makeFileWithBytes("Project/scene.w3d", enc.encode(MIN_W3D)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN.mov", new Uint8Array([0])),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/sequence.json", enc.encode(partialJson)),
      // NB: only 1 of the claimed 3 frames is present
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN_frames/frame_000001.png", new Uint8Array([0x89])),
    ];
    const result = await parseW3DFromFolder(files);
    const node = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    if (node?.type === "image") {
      expect(node.image.mimeType).toBe("video/quicktime");
    }
    expect(result.warnings.some((w) => /sequence\.json.*missing/i.test(w))).toBe(true);
  });

  it("invariant: a referenced .mov NEVER vanishes — without sequence, image node still exists with video mime", async () => {
    const enc = new TextEncoder();
    const files = [
      makeFileWithBytes("Project/scene.w3d", enc.encode(MIN_W3D)),
      makeFileWithBytes("Project/Resources/Textures/PITCH_IN.mov", new Uint8Array([0])),
    ];
    const result = await parseW3DFromFolder(files);
    const node = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    expect(node?.type).toBe("image");
    if (node?.type === "image") {
      expect(node.image.mimeType).toBe("video/quicktime");
    }
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

```bash
npx vitest run src/editor/import/w3dFolder.test.ts -t "sequence preference"
```

Expected: FAIL — none of the four pass yet.

### GREEN — folder + parser implementation

- [ ] **Step 3: Extend the folder importer to gather sequences**

File: `src/editor/import/w3dFolder.ts` — modify `parseW3DFromFolder`:

* Add to the file scan loop (where `textureFiles` and `videoFilenames` are populated): also collect every `Resources/Textures/<stem>_frames/sequence.json` file and every `Resources/Textures/<stem>_frames/frame_*.png` file into a `sequenceCandidates` map.
* After the texture loop, build `sequences: Map<string, ImageSequenceMetadata>` keyed by the source `.mov` filename. For each candidate:
  - Parse the JSON. On parse error, push a warning and skip (the .mov path will be used).
  - Verify each `frame_NNNNNN.png` referenced by `frameCount` is present in the file map. If any missing, push a warning and skip.
  - Resolve each present frame to an `imageFileToAsset(file).src` (blob URL). Build the `frameUrls` array.
  - Store: `sequences.set(source, { ...parsedJson, frameUrls })`.
* Pass the `sequences` map into `parseW3D` via a new option.

The exact implementation:

```ts
// Inside parseW3DFromFolder, after the existing for-loop that builds textureFiles + videoFilenames:

  const sequenceFiles = new Map<string, File>();   // basename → file
  const sequenceFrames = new Map<string, Map<string, File>>();  // stem → frameName → file
  for (const file of list) {
    const rel = relativePath(file).replace(/\\/g, "/");
    const lower = rel.toLowerCase();
    if (!lower.includes("/resources/textures/")) continue;
    const m = rel.match(/Resources\/Textures\/([^/]+)_frames\/(.+)$/i);
    if (!m) continue;
    const stem = m[1];
    const tail = m[2];
    if (tail.toLowerCase() === "sequence.json") {
      sequenceFiles.set(stem, file);
    } else if (/^frame_\d+\.png$/i.test(tail)) {
      const inner = sequenceFrames.get(stem) ?? new Map<string, File>();
      inner.set(tail, file);
      sequenceFrames.set(stem, inner);
    }
  }

  const sequences = new Map<string, ImageSequenceMetadata>();
  for (const [stem, jsonFile] of sequenceFiles) {
    const sourceMov = `${stem}.mov`;
    let parsed: Partial<ImageSequenceMetadata> | null = null;
    try {
      const text = await jsonFile.text();
      parsed = JSON.parse(text);
    } catch {
      warnings.push(`sequence.json for ${stem} is invalid (parse error) — falling back to .mov.`);
      continue;
    }
    if (!parsed?.framePattern || typeof parsed.frameCount !== "number") {
      warnings.push(`sequence.json for ${stem} is invalid (missing framePattern/frameCount) — falling back to .mov.`);
      continue;
    }
    const frames = sequenceFrames.get(stem) ?? new Map<string, File>();
    const frameUrls: string[] = [];
    let missing = false;
    for (let i = 1; i <= parsed.frameCount; i += 1) {
      const fname = formatFramePattern(parsed.framePattern, i);
      const f = frames.get(fname);
      if (!f) { missing = true; break; }
      const asset = await imageFileToAsset(f);
      frameUrls.push(asset.src);
    }
    if (missing) {
      warnings.push(`sequence.json for ${stem} is invalid (missing frame files) — falling back to .mov.`);
      continue;
    }
    sequences.set(sourceMov, {
      version: 1,
      type: "image-sequence",
      source: sourceMov,
      framePattern: parsed.framePattern,
      frameCount: parsed.frameCount,
      fps: typeof parsed.fps === "number" ? parsed.fps : 0,
      width: typeof parsed.width === "number" ? parsed.width : 0,
      height: typeof parsed.height === "number" ? parsed.height : 0,
      durationSec: typeof parsed.durationSec === "number" ? parsed.durationSec : 0,
      loop: parsed.loop !== false,
      alpha: parsed.alpha !== false,
      pixelFormat: "rgba",
      frameUrls,
    });
  }
```

Add the helper at file scope:

```ts
function formatFramePattern(pattern: string, n: number): string {
  // ffmpeg "%06d" → 6 zero-padded digits. Generic %0Nd handler.
  return pattern.replace(/%0(\d+)d/, (_, digits) => String(n).padStart(parseInt(digits, 10), "0"));
}
```

Then pass `sequences` to `parseW3D`:

```ts
  const result = parseW3D(xmlText, {
    sceneName: sceneNameFromFolder,
    textures,
    videos: videoFilenames,
    meshAssets: completeMeshGuids,
    sequences,  // ← new
  });
```

Also import the type at the top:
```ts
import type { ComponentBlueprint, ImageAsset, ImageSequenceMetadata } from "../types";
```

- [ ] **Step 4: Extend `parseW3D` to honour `sequences`**

File: `src/editor/import/w3d.ts`:

* Add to `W3DParseOptions`:
  ```ts
  sequences?: Map<string, ImageSequenceMetadata>;
  ```
  And import `ImageSequenceMetadata` from `../types`.

* In the parser context (`ParseContext`), add `sequences: Map<string, ImageSequenceMetadata>` and initialise from the option (default empty map) in the parseW3D entrypoint where other ctx fields are set.

* Find the image-asset-binding block (`src/editor/import/w3d.ts:670-680`). Where `asset` is resolved and `stored: ImageAsset = { ...asset, id: stableId }` is built, **before** the `imageNode.image = stored;` line, swap to a sequence-backed asset if applicable:

  ```ts
      // Prefer a converted PNG sequence over the original .mov when one
      // is available. The first frame's blob URL doubles as `src` so
      // any consumer that only reads `.src` (e.g. defensive renderers)
      // gets a renderable image instead of nothing.
      const seq = ctx.sequences.get(filename);
      let stored: ImageAsset;
      if (seq && seq.frameUrls.length > 0) {
        stored = {
          ...asset,
          id: stableId,
          mimeType: "application/x-image-sequence",
          src: seq.frameUrls[0],
          width: seq.width || asset.width,
          height: seq.height || asset.height,
          sequence: seq,
        };
      } else {
        stored = { ...asset, id: stableId };
      }
  ```

  (Replace the existing single line `const stored: ImageAsset = { ...asset, id: stableId };` with the above block.)

- [ ] **Step 5: Run the tests — expect PASS**

```bash
npx vitest run src/editor/import/w3dFolder.test.ts -t "sequence preference"
```

Expected: 4/4 PASS. If "missing frame files" test fails, double-check that `formatFramePattern` produces `frame_000002.png` for `n=2` when pattern is `frame_%06d.png`.

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: all green. The non-disappearance invariant test from Task 1 still passes: when no sequence is present, the asset stays `video/quicktime`.

- [ ] **Step 7: Commit**

```bash
git add src/editor/import/w3dFolder.ts src/editor/import/w3dFolder.test.ts \
        src/editor/import/w3d.ts
git commit -m "$(cat <<'EOF'
Importer prefers <basename>_frames/sequence.json over .mov

When parseW3DFromFolder sees a sibling sequence.json + the referenced
PNG frames, the resulting ImageNode binds an
application/x-image-sequence asset whose `sequence` field carries the
v1 metadata + resolved blob URLs for every frame. Otherwise the
existing video/quicktime path runs unchanged.

Invalid sequence.json (parse error, missing framePattern/frameCount,
or claimed frames not present on disk) falls back to .mov with a
descriptive warning in result.warnings — never drops the asset.

parseW3D gains a `sequences` Map<sourceMov, ImageSequenceMetadata>
option (default empty). The folder importer scans
Resources/Textures/<stem>_frames/, validates each candidate, and
populates the map before calling parseW3D.

Four behavioural tests in w3dFolder.test.ts cover: prefer when valid,
fallback on parse error, fallback on missing frames, never-vanish
when no sequence at all.
EOF
)"
```

---

## Task 5: `ImageSequencePlayer` + `setTextureUpdateIfReady` in renderer

**Goal:** Add a small bounded PNG-sequence player to `scene.ts`. Player loads frame 1 eagerly, lazy-loads the next 4 on demand, keeps at most 60 frames in memory (sliding window), warns once if frameCount > 60 OR estimated memory > 200 MB, and exposes state via `__r3Dump.imageSequence`. Add the `setTextureUpdateIfReady` guard helper. Wire the player into `buildMeshObject`.

**Files:**
- Modify: `src/editor/scene.ts`
- Modify: `src/editor/scene.test.ts`

### RED — guard helper test

- [ ] **Step 1: Write the failing test for `setTextureUpdateIfReady`**

File: `src/editor/scene.test.ts` — new describe block:

```ts
import { setTextureUpdateIfReady } from "./scene";
import { Texture } from "three";

describe("setTextureUpdateIfReady", () => {
  it("does not mark a texture dirty when image is null", () => {
    const tex = new Texture();
    tex.image = null as unknown as undefined;
    tex.needsUpdate = false;
    setTextureUpdateIfReady(tex);
    expect(tex.needsUpdate).toBe(false);
  });

  it("does not mark dirty when image is an HTMLImageElement that hasn't loaded", () => {
    const tex = new Texture();
    const img = document.createElement("img");
    // jsdom: img.complete is false until src is set + loaded
    tex.image = img;
    tex.needsUpdate = false;
    setTextureUpdateIfReady(tex);
    expect(tex.needsUpdate).toBe(false);
  });

  it("marks dirty when image is an HTMLImageElement with complete=true", () => {
    const tex = new Texture();
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: true });
    tex.image = img;
    tex.needsUpdate = false;
    setTextureUpdateIfReady(tex);
    expect(tex.needsUpdate).toBe(true);
  });

  it("does not mark dirty when image is a video with readyState < 2", () => {
    const tex = new Texture();
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { value: 0, configurable: true });
    tex.image = video;
    tex.needsUpdate = false;
    setTextureUpdateIfReady(tex);
    expect(tex.needsUpdate).toBe(false);
  });

  it("marks dirty when image is a video with readyState >= 2", () => {
    const tex = new Texture();
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { value: 2, configurable: true });
    tex.image = video;
    tex.needsUpdate = false;
    setTextureUpdateIfReady(tex);
    expect(tex.needsUpdate).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (function doesn't exist)**

```bash
npx vitest run src/editor/scene.test.ts -t "setTextureUpdateIfReady"
```

Expected: FAIL — `setTextureUpdateIfReady is not a function`.

### GREEN — guard helper

- [ ] **Step 3: Implement `setTextureUpdateIfReady`**

File: `src/editor/scene.ts` — append next to `resolveMaskInversion`:

```ts
/**
 * Marks `t.needsUpdate = true` only when the underlying image actually
 * has decoded data. Setting needsUpdate prematurely produces black /
 * transparent frames in WebGL; this guard has caught the bug before.
 */
export function setTextureUpdateIfReady(t: Texture): void {
  const img = t.image as unknown;
  if (!img) return;
  if (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement && !img.complete) return;
  if (typeof HTMLVideoElement !== "undefined" && img instanceof HTMLVideoElement && img.readyState < 2) return;
  t.needsUpdate = true;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/editor/scene.test.ts -t "setTextureUpdateIfReady"
```

Expected: 5/5 PASS.

### RED — Player tests

- [ ] **Step 5: Write the failing player tests**

File: `src/editor/scene.test.ts` — append:

```ts
import { ImageSequencePlayer } from "./scene";

function makeFrameUrls(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `blob:frame-${i + 1}`);
}

describe("ImageSequencePlayer", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("starts at frame 0 and advances by deltaSec * fps", () => {
    const player = new ImageSequencePlayer({
      frameUrls: makeFrameUrls(10),
      fps: 25,
      loop: true,
      width: 100,
      height: 100,
    });
    expect(player.state().currentFrame).toBe(0);
    player.tick(1 / 25);
    expect(player.state().currentFrame).toBe(1);
    player.tick(2 / 25);  // advance two frames
    expect(player.state().currentFrame).toBe(3);
    player.dispose();
  });

  it("loop: true wraps past the last frame back to 0", () => {
    const player = new ImageSequencePlayer({
      frameUrls: makeFrameUrls(3),
      fps: 25,
      loop: true,
      width: 100, height: 100,
    });
    player.tick(3 / 25);  // frame 3 (one past end → wrap to 0)
    expect(player.state().currentFrame).toBe(0);
    player.dispose();
  });

  it("loop: false clamps at the last frame", () => {
    const player = new ImageSequencePlayer({
      frameUrls: makeFrameUrls(3),
      fps: 25,
      loop: false,
      width: 100, height: 100,
    });
    player.tick(10);  // way past end
    expect(player.state().currentFrame).toBe(2);
    player.dispose();
  });

  it("falls back to fps=25 when fps is 0 or missing", () => {
    const player = new ImageSequencePlayer({
      frameUrls: makeFrameUrls(50),
      fps: 0,
      loop: true,
      width: 100, height: 100,
    });
    player.tick(1);  // 1 second at 25 fps → frame 25
    expect(player.state().currentFrame).toBe(25);
    player.dispose();
  });

  it("warns once when frameCount > 60", () => {
    const player = new ImageSequencePlayer({
      frameUrls: makeFrameUrls(120),
      fps: 25,
      loop: true,
      width: 1920, height: 1080,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/large image sequence/i);
    player.dispose();
  });

  it("warns once when estimated memory > 200 MB", () => {
    // 60 * 1920 * 1080 * 4 ≈ 475 MB
    const player = new ImageSequencePlayer({
      frameUrls: makeFrameUrls(60),
      fps: 25,
      loop: true,
      width: 1920, height: 1080,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/MB/);
    player.dispose();
  });

  it("dispose() releases all cached textures (no leaks)", () => {
    const player = new ImageSequencePlayer({
      frameUrls: makeFrameUrls(5),
      fps: 25,
      loop: true,
      width: 100, height: 100,
    });
    const tex = player.texture;
    const disposeSpy = vi.spyOn(tex, "dispose");
    player.dispose();
    expect(disposeSpy).toHaveBeenCalled();
  });

  it("state() reports currentFrame, totalFrames, paused, error", () => {
    const player = new ImageSequencePlayer({
      frameUrls: makeFrameUrls(4),
      fps: 25,
      loop: true,
      width: 100, height: 100,
    });
    const s = player.state();
    expect(s.currentFrame).toBe(0);
    expect(s.totalFrames).toBe(4);
    expect(s.paused).toBe(false);
    expect(s.error).toBeNull();
    player.dispose();
  });
});
```

- [ ] **Step 6: Run — expect FAIL**

```bash
npx vitest run src/editor/scene.test.ts -t "ImageSequencePlayer"
```

Expected: FAIL — `ImageSequencePlayer is not defined`.

### GREEN — Player implementation

- [ ] **Step 7: Implement `ImageSequencePlayer`**

File: `src/editor/scene.ts` — append (after `formatVideoLoadFailureMessage`):

```ts
const DEFAULT_PLAYER_FPS = 25;
const FRAME_WINDOW = 60;
const MEMORY_WARN_BYTES = 200 * 1024 * 1024;

export interface ImageSequencePlayerSpec {
  frameUrls: string[];
  fps: number;
  loop: boolean;
  width: number;
  height: number;
}

/**
 * Bounded PNG-sequence player for application/x-image-sequence assets.
 * Frame 1 loads eagerly so the texture has something on first paint;
 * subsequent frames load lazily on demand with a 4-frame look-ahead.
 * At most FRAME_WINDOW (60) decoded frames stay in memory at once.
 *
 * Issues a single console.warn when frameCount > FRAME_WINDOW OR the
 * estimated bytes-in-flight exceeds MEMORY_WARN_BYTES — gives the
 * operator early notice before the scene gets sluggish.
 */
export class ImageSequencePlayer {
  readonly texture: Texture;
  private readonly frameUrls: string[];
  private readonly fps: number;
  private readonly loop: boolean;
  private readonly width: number;
  private readonly height: number;
  private currentFrame = 0;
  private acc = 0;
  private paused = false;
  private error: string | null = null;
  private frameCache = new Map<number, HTMLImageElement>();
  private inFlight = new Set<number>();
  private disposed = false;
  private warned = false;

  constructor(spec: ImageSequencePlayerSpec) {
    this.frameUrls = spec.frameUrls;
    this.fps = spec.fps && spec.fps > 0 ? spec.fps : DEFAULT_PLAYER_FPS;
    this.loop = spec.loop;
    this.width = spec.width;
    this.height = spec.height;
    this.texture = new Texture();
    this.texture.colorSpace = SRGBColorSpace;
    this.maybeWarn();
    this.loadFrame(0);
  }

  private maybeWarn(): void {
    if (this.warned) return;
    const bytes = FRAME_WINDOW * this.width * this.height * 4;
    if (this.frameUrls.length > FRAME_WINDOW || bytes > MEMORY_WARN_BYTES) {
      const mb = (bytes / 1024 / 1024).toFixed(0);
      // eslint-disable-next-line no-console
      console.warn(
        `[scene] large image sequence — ${this.frameUrls.length} frames at ${this.width}x${this.height} ` +
        `(estimated ${mb} MB at peak window). Consider downsampling for smoother playback.`,
      );
      this.warned = true;
    }
  }

  private loadFrame(idx: number): void {
    if (this.disposed) return;
    if (idx < 0 || idx >= this.frameUrls.length) return;
    if (this.frameCache.has(idx) || this.inFlight.has(idx)) return;
    if (this.inFlight.size >= 4) return;  // cap concurrent fetches
    this.inFlight.add(idx);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.inFlight.delete(idx);
      if (this.disposed) return;
      this.frameCache.set(idx, img);
      if (idx === this.currentFrame) {
        this.bind(img);
      }
      this.evictIfBeyondWindow();
    };
    img.onerror = () => {
      this.inFlight.delete(idx);
      if (this.disposed) return;
      this.error = `frame ${idx + 1} failed to load`;
    };
    img.src = this.frameUrls[idx];
  }

  private evictIfBeyondWindow(): void {
    if (this.frameCache.size <= FRAME_WINDOW) return;
    const half = Math.floor(FRAME_WINDOW / 2);
    for (const k of [...this.frameCache.keys()]) {
      if (Math.abs(k - this.currentFrame) > half) {
        this.frameCache.delete(k);
      }
    }
  }

  private bind(img: HTMLImageElement): void {
    this.texture.image = img;
    setTextureUpdateIfReady(this.texture);
  }

  tick(deltaSec: number): void {
    if (this.disposed || this.paused) return;
    this.acc += deltaSec;
    const framesPerSec = this.fps;
    const advance = Math.floor(this.acc * framesPerSec);
    if (advance <= 0) return;
    this.acc -= advance / framesPerSec;
    let next = this.currentFrame + advance;
    if (this.loop) {
      next = ((next % this.frameUrls.length) + this.frameUrls.length) % this.frameUrls.length;
    } else {
      next = Math.min(next, this.frameUrls.length - 1);
    }
    this.currentFrame = next;
    const cached = this.frameCache.get(next);
    if (cached) this.bind(cached);
    // Pre-fetch the next look-ahead window
    for (let i = 1; i <= 4; i += 1) {
      const idx = this.loop
        ? (next + i) % this.frameUrls.length
        : Math.min(next + i, this.frameUrls.length - 1);
      this.loadFrame(idx);
    }
  }

  state(): {
    currentFrame: number;
    loadedFrames: number;
    totalFrames: number;
    paused: boolean;
    error: string | null;
  } {
    return {
      currentFrame: this.currentFrame,
      loadedFrames: this.frameCache.size,
      totalFrames: this.frameUrls.length,
      paused: this.paused,
      error: this.error,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.frameCache.clear();
    this.inFlight.clear();
    this.texture.dispose();
  }
}
```

(Add `import { vi } from "vitest"` at the top of scene.test.ts if not already there for the `vi.spyOn` calls; vitest auto-imports `vi` when using globals — check `vitest.config.*` for `globals: true`. If globals aren't enabled, the import is needed.)

- [ ] **Step 8: Run player tests — expect PASS**

```bash
npx vitest run src/editor/scene.test.ts -t "ImageSequencePlayer"
```

Expected: 8/8 PASS. The "warns once when frameCount > 60" test relies on the constructor synchronously calling `console.warn` before tests can run — that's why `maybeWarn()` is called from the ctor.

### Wire player into the renderer

- [ ] **Step 9: Bind sequence-backed assets through the player in `buildMeshObject`**

File: `src/editor/scene.ts` — find where image nodes resolve their texture (search for `getVideoTexture`). The path is currently:
```ts
const texture = node.image.mimeType.startsWith("video/")
  ? this.getVideoTexture(node.image.src)
  : this.getTexture(node.image.src, ...);
```

Add a third branch BEFORE the video check:

```ts
let texture: Texture;
if (node.image.mimeType === "application/x-image-sequence" && node.image.sequence) {
  const player = this.getOrCreateSequencePlayer(node.id, node.image.sequence);
  texture = player.texture;
} else if (node.image.mimeType.startsWith("video/")) {
  texture = this.getVideoTexture(node.image.src);
} else {
  texture = this.getTexture(node.image.src, /* existing options */);
}
```

Add the helper inside the `SceneEditor` class:

```ts
private readonly sequencePlayers = new Map<string, ImageSequencePlayer>();

private getOrCreateSequencePlayer(nodeId: string, spec: import("./types").ImageSequenceMetadata): ImageSequencePlayer {
  const existing = this.sequencePlayers.get(nodeId);
  if (existing) return existing;
  const player = new ImageSequencePlayer({
    frameUrls: spec.frameUrls,
    fps: spec.fps,
    loop: spec.loop,
    width: spec.width || 1,
    height: spec.height || 1,
  });
  this.sequencePlayers.set(nodeId, player);
  return player;
}
```

Add a tick in the render loop. Find the existing render loop (search for `requestAnimationFrame` or the loop tick function in scene.ts). Inside it, before rendering:
```ts
const dt = this.clock?.getDelta?.() ?? 0;
for (const player of this.sequencePlayers.values()) {
  player.tick(dt);
}
```

If there isn't an existing `clock`, add one: `private readonly clock = new Clock();` (import `Clock` from "three") and call `getDelta()` once per frame. If a Clock-equivalent already exists (the codebase may use `performance.now()` deltas), reuse it.

Add cleanup in the scene rebuild path. Search for where `objectMap.clear()` is called (in the rebuild of the scene tree). Add immediately before it:
```ts
for (const player of this.sequencePlayers.values()) {
  player.dispose();
}
this.sequencePlayers.clear();
```

Also extend `__r3Dump`'s per-node block to include the sequence state. Inside `dumpRuntimeScene`, alongside the `video: videoState` field, add:

```ts
        imageSequence: (() => {
          const player = this.sequencePlayers.get(node.id);
          if (!player) return null;
          const s = player.state();
          return {
            frameCount: s.totalFrames,
            currentFrame: s.currentFrame,
            loadedFrames: s.loadedFrames,
            fps: node.type === "image" ? (node.image.sequence?.fps ?? 0) : 0,
            loop: node.type === "image" ? (node.image.sequence?.loop ?? true) : true,
            paused: s.paused,
            firstFrameSrc: node.type === "image" ? (node.image.sequence?.frameUrls?.[0] ?? "").slice(0, 64) : "",
            error: s.error,
          };
        })(),
```

- [ ] **Step 10: Run full suite**

```bash
npm test
```

Expected: all green. The wiring changes don't have new dedicated tests beyond the player unit tests; they're exercised indirectly by anything that builds a SceneEditor (currently nothing in CI but the type system will catch most regressions).

- [ ] **Step 11: Commit**

```bash
git add src/editor/scene.ts src/editor/scene.test.ts
git commit -m "$(cat <<'EOF'
Add ImageSequencePlayer + setTextureUpdateIfReady to renderer

Bounded PNG-sequence player for application/x-image-sequence assets.
Frame 1 eagerly loaded; lazy preload of the next 4 with a 4-fetch
concurrency cap. Sliding window keeps at most 60 decoded frames in
memory; older frames are released when the cursor moves. One
console.warn fires when frameCount > 60 OR estimated peak-window
bytes exceed 200 MB.

setTextureUpdateIfReady is the rule the player and any future
texture-swap code follows: never mark a Texture dirty when the
underlying image is null, has !complete (HTMLImageElement), or has
readyState < 2 (HTMLVideoElement). Setting needsUpdate prematurely
produces black/transparent frames in WebGL.

scene.ts wiring:
* sequencePlayers: Map<nodeId, ImageSequencePlayer> on the editor
* buildMeshObject branches: image-sequence > video > image
* render loop ticks each player with the frame delta
* scene rebuild calls dispose() on every player before clearing

__r3Dump per-node block gains imageSequence: { frameCount,
currentFrame, loadedFrames, fps, loop, paused, firstFrameSrc, error }
| null. Per-node textureMime / hasMap / mapHasImage from Task 1 stay.

13 tests cover: guard helper (5), player tick + loop + clamp + fps
fallback + memory warning (8), dispose. Existing VideoTexture and
mask paths remain green.
EOF
)"
```

---

## Task 6: Vite dev plugin `POST /api/w3d/convert-mov`

**Goal:** A Vite plugin registered only in `serve` mode that exposes one POST endpoint. Validates body, resolves `projectName` against `R3_PROJECTS_ROOT`, falls back to the explicit `folderPath` form, calls `runMovConversion`, returns structured JSON.

**Files:**
- Create: `scripts/movConvertPlugin.mjs`
- Create: `scripts/movConvertPlugin.test.mjs`
- Modify: `vite.config.mjs`

### RED — Plugin tests

- [ ] **Step 1: Write the failing test**

File: `scripts/movConvertPlugin.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./movConversion.mjs", () => ({
  runMovConversion: vi.fn(),
}));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return { ...actual, existsSync: vi.fn() };
});

import { runMovConversion } from "./movConversion.mjs";
import { existsSync } from "node:fs";
import { movConvertPlugin } from "./movConvertPlugin.mjs";

function makeReq(body) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  let i = 0;
  const req = {
    method: "POST",
    url: "/api/w3d/convert-mov",
    on(event, cb) {
      if (event === "data") {
        for (const c of chunks) cb(c);
      }
      if (event === "end") cb();
    },
  };
  return req;
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = s; this.ended = true; },
  };
  return res;
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
      converted: ["a.mov", "b.mov"],
      skipped: ["c.mov"],
      failed: [{ filename: "d.mov", error: "ffmpeg exited with code 1" }],
      sequenceJsonPaths: ["x", "y"],
      warnings: [],
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run scripts/movConvertPlugin.test.mjs
```

Expected: FAIL — module not found.

### GREEN — Plugin implementation

- [ ] **Step 3: Implement the plugin**

File: `scripts/movConvertPlugin.mjs`:

```js
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
      } catch (err) {
        reject(err);
      }
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
  // Defence in depth: even though regex rejects separators, double-check
  // the resolved path still starts with the root after normalisation.
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
        if (req.method !== "POST") {
          return send(res, 405, { code: "METHOD_NOT_ALLOWED" });
        }
        let body;
        try {
          body = await readBody(req);
        } catch {
          return send(res, 400, { code: "INVALID_BODY" });
        }
        const resolved = resolveFolder(body);
        if (resolved.error) {
          return send(res, resolved.error.status, resolved.error);
        }
        const result = await runMovConversion({
          folderPath: resolved.folder,
          force: !!body.force,
        });
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
```

- [ ] **Step 4: Run plugin tests — expect PASS**

```bash
npx vitest run scripts/movConvertPlugin.test.mjs
```

Expected: 7/7 PASS.

### Register the plugin in vite.config

- [ ] **Step 5: Wire into `vite.config.mjs`**

File: `vite.config.mjs`:

```js
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { createPwaHeadTags, pwaManifest } from "./scripts/pwa-config.mjs";
import { movConvertPlugin } from "./scripts/movConvertPlugin.mjs";

export default defineConfig({
  plugins: [
    react(),
    movConvertPlugin(),
    {
      name: "3forge-pwa-head",
      transformIndexHtml() {
        return createPwaHeadTags();
      },
    },
    VitePWA({
      // ... unchanged ...
    }),
  ],
  // ... rest unchanged ...
});
```

- [ ] **Step 6: Verify dev server still boots without crashing**

(Skip if the agent doesn't have an interactive shell; otherwise:)

```bash
# In a separate terminal:
# npm run dev
# Then manually:
# curl -X POST http://localhost:5173/api/w3d/convert-mov -H 'content-type: application/json' -d '{"projectName":"Unknown"}'
# Should return 400 with PROJECT_PATH_NOT_FOUND.
```

- [ ] **Step 7: Run full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add scripts/movConvertPlugin.mjs scripts/movConvertPlugin.test.mjs vite.config.mjs
git commit -m "$(cat <<'EOF'
Add Vite dev plugin POST /api/w3d/convert-mov

Registered only when command === "serve" — production builds get a
no-op plugin object. Body either:
  { projectName: string, force?: boolean } — resolved under
    process.env.R3_PROJECTS_ROOT (default to the dev box's R3 root)
  { folderPath: absoluteString, force?: boolean } — manual fallback

Validation hardening:
* projectName matches /^[A-Za-z0-9_.\- ]+$/ (no slashes, no ..)
* path.resolve(root, projectName) re-checked to start with root
  after normalisation (defence vs unicode tricks)
* folderPath required absolute and existing on disk
* Calls runMovConversion which spawns ffmpeg via spawn(cmd, args[]) —
  no shell, paths with spaces are safe end-to-end

Structured error codes the modal (next commit) renders inline:
  400 INVALID_PROJECT_NAME / INVALID_FOLDER_PATH / MISSING_BODY
  400 PROJECT_PATH_NOT_FOUND { suggestedEnv, manualPathAllowed: true }
  500 FFMPEG_NOT_INSTALLED { installHint } (Windows/macOS/Linux)
  200 { converted[], skipped[], failed[], warnings[] }

7 tests cover: not registered in build, projectName traversal,
projectName with slash, PROJECT_PATH_NOT_FOUND, manual folderPath,
FFMPEG_NOT_INSTALLED escalation, partial success forwarding.
EOF
)"
```

---

## Task 7: `MovConversionModal` component

**Goal:** A new React modal reusing the existing `Modal`. Lists detected `.mov` assets with a per-row badge. Three actions: Convert and Import (dev-aware), Import Without Converting, Cancel. Shows partial-success groups (Converted / Skipped / Failed + reason).

**Files:**
- Create: `src/editor/react/components/MovConversionModal.tsx`
- Create: `src/editor/react/components/MovConversionModal.test.tsx`

### RED — Modal tests

- [ ] **Step 1: Write the failing tests**

File: `src/editor/react/components/MovConversionModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MovConversionModal } from "./MovConversionModal";
import type { MovClassification } from "../../import/w3dFolder";

const NO_SEQ: MovClassification = {
  withSequence: [],
  withoutSequence: [
    { videoName: "PITCH_IN.mov" },
    { videoName: "PITCH_OUT.mov" },
  ],
};

describe("MovConversionModal", () => {
  it("does not render when classification has no .mov without sequence", () => {
    render(
      <MovConversionModal
        isOpen
        classification={{ withSequence: [], withoutSequence: [] }}
        projectName="GameName_FS"
        isDevMode
        onConvert={vi.fn()}
        onImportWithoutConverting={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/MOV videos detected/i)).toBeNull();
  });

  it("lists each .mov with a 'no sequence' badge", () => {
    render(
      <MovConversionModal
        isOpen
        classification={NO_SEQ}
        projectName="GameName_FS"
        isDevMode
        onConvert={vi.fn()}
        onImportWithoutConverting={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("PITCH_IN.mov")).toBeInTheDocument();
    expect(screen.getByText("PITCH_OUT.mov")).toBeInTheDocument();
    // Two badges
    expect(screen.getAllByText(/no sequence/i).length).toBe(2);
  });

  it("dev mode: clicking 'Convert and Import' calls onConvert with projectName", () => {
    const onConvert = vi.fn();
    render(
      <MovConversionModal
        isOpen
        classification={NO_SEQ}
        projectName="GameName_FS"
        isDevMode
        onConvert={onConvert}
        onImportWithoutConverting={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /convert and import/i }));
    expect(onConvert).toHaveBeenCalledWith({ projectName: "GameName_FS" });
  });

  it("build mode: 'Convert and Import' shows the CLI command + Copy button", () => {
    render(
      <MovConversionModal
        isOpen
        classification={NO_SEQ}
        projectName="GameName_FS"
        isDevMode={false}
        onConvert={vi.fn()}
        onImportWithoutConverting={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /convert and import/i }));
    expect(screen.getByText(/node scripts\/convert-w3d-mov-to-sequence\.mjs/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy command/i })).toBeInTheDocument();
  });

  it("'Import Without Converting' calls onImportWithoutConverting", () => {
    const cb = vi.fn();
    render(
      <MovConversionModal
        isOpen
        classification={NO_SEQ}
        projectName="GameName_FS"
        isDevMode
        onConvert={vi.fn()}
        onImportWithoutConverting={cb}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /import without converting/i }));
    expect(cb).toHaveBeenCalled();
  });

  it("Cancel calls onCancel", () => {
    const cb = vi.fn();
    render(
      <MovConversionModal
        isOpen
        classification={NO_SEQ}
        projectName="GameName_FS"
        isDevMode
        onConvert={vi.fn()}
        onImportWithoutConverting={vi.fn()}
        onCancel={cb}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(cb).toHaveBeenCalled();
  });

  it("renders three groups (converted/skipped/failed) when conversionResult is set", () => {
    render(
      <MovConversionModal
        isOpen
        classification={NO_SEQ}
        projectName="GameName_FS"
        isDevMode
        onConvert={vi.fn()}
        onImportWithoutConverting={vi.fn()}
        onCancel={vi.fn()}
        conversionResult={{
          converted: ["A.mov"],
          skipped: ["B.mov"],
          failed: [{ filename: "C.mov", error: "ffmpeg exited with code 1" }],
          sequenceJsonPaths: [], warnings: [],
        }}
      />,
    );
    expect(screen.getByText(/converted/i)).toBeInTheDocument();
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByText(/ffmpeg exited with code 1/)).toBeInTheDocument();
  });

  it("falls back to manual folderPath input when convert returns PROJECT_PATH_NOT_FOUND", () => {
    const onConvert = vi.fn();
    render(
      <MovConversionModal
        isOpen
        classification={NO_SEQ}
        projectName="GameName_FS"
        isDevMode
        onConvert={onConvert}
        onImportWithoutConverting={vi.fn()}
        onCancel={vi.fn()}
        lastError={{ code: "PROJECT_PATH_NOT_FOUND", manualPathAllowed: true }}
      />,
    );
    const input = screen.getByLabelText(/folder path on disk/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "C:/abs/path" } });
    fireEvent.click(screen.getByRole("button", { name: /convert and import/i }));
    expect(onConvert).toHaveBeenLastCalledWith({ folderPath: "C:/abs/path" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/editor/react/components/MovConversionModal.test.tsx
```

Expected: FAIL — module not found.

### GREEN — Modal implementation

- [ ] **Step 3: Implement the modal**

File: `src/editor/react/components/MovConversionModal.tsx`:

```tsx
import { useState } from "react";
import { Modal } from "./Modal";
import type { MovClassification } from "../../import/w3dFolder";

export interface MovConversionResult {
  converted: string[];
  skipped: string[];
  failed: { filename: string; error: string }[];
  sequenceJsonPaths: string[];
  warnings: string[];
}

export interface MovConvertError {
  code: string;
  message?: string;
  manualPathAllowed?: boolean;
  installHint?: string;
}

export interface MovConversionModalProps {
  isOpen: boolean;
  classification: MovClassification;
  projectName: string;
  isDevMode: boolean;
  conversionResult?: MovConversionResult;
  lastError?: MovConvertError;
  onConvert: (req: { projectName: string } | { folderPath: string }) => void;
  onImportWithoutConverting: () => void;
  onCancel: () => void;
}

export function MovConversionModal(props: MovConversionModalProps) {
  const {
    isOpen, classification, projectName, isDevMode,
    conversionResult, lastError,
    onConvert, onImportWithoutConverting, onCancel,
  } = props;
  const [folderPath, setFolderPath] = useState("");
  const [showCli, setShowCli] = useState(false);
  const showManualInput = lastError?.code === "PROJECT_PATH_NOT_FOUND" && lastError.manualPathAllowed === true;
  const cliCommand = `node scripts/convert-w3d-mov-to-sequence.mjs "<folder path>"`;
  if (!isOpen) return null;
  if (classification.withoutSequence.length === 0) return null;

  const handleConvertClick = () => {
    if (!isDevMode) {
      setShowCli(true);
      return;
    }
    if (showManualInput && folderPath) {
      onConvert({ folderPath });
      return;
    }
    onConvert({ projectName });
  };

  const copyCli = async () => {
    try {
      await navigator.clipboard?.writeText(cliCommand);
    } catch { /* operator can copy by hand */ }
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="MOV videos detected" size="wide">
      <p>
        This project contains {classification.withoutSequence.length} .mov video asset
        {classification.withoutSequence.length === 1 ? "" : "s"}. MOV files may not play
        correctly in the browser, especially with professional codecs or transparency.
        3Forge can convert them to PNG image sequences for better compatibility and
        alpha-safe playback. This may increase project size.
      </p>

      <ul className="mov-conv-list">
        {classification.withSequence.map((s) => (
          <li key={s.videoName}>
            <span className="mov-conv-name">{s.videoName}</span>
            <span className="badge badge--ok">sequence ready</span>
          </li>
        ))}
        {classification.withoutSequence.map((s) => (
          <li key={s.videoName}>
            <span className="mov-conv-name">{s.videoName}</span>
            <span className="badge badge--warn">no sequence</span>
          </li>
        ))}
      </ul>

      {conversionResult && (
        <div className="mov-conv-result">
          <h3>Converted ({conversionResult.converted.length})</h3>
          <ul>{conversionResult.converted.map((f) => <li key={f}>{f}</li>)}</ul>
          <h3>Skipped ({conversionResult.skipped.length})</h3>
          <ul>{conversionResult.skipped.map((f) => <li key={f}>{f} — already had sequence.json</li>)}</ul>
          <h3>Failed ({conversionResult.failed.length})</h3>
          <ul>
            {conversionResult.failed.map((f) => (
              <li key={f.filename} className="mov-conv-failed">
                {f.filename}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showManualInput && (
        <div className="mov-conv-manual">
          <label htmlFor="mov-conv-folder">Folder path on disk</label>
          <input
            id="mov-conv-folder"
            type="text"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            placeholder='C:\Users\you\R3\Projects\GameName_FS'
          />
          <small>R3_PROJECTS_ROOT did not resolve; paste the absolute folder path.</small>
        </div>
      )}

      {lastError?.code === "FFMPEG_NOT_INSTALLED" && (
        <div className="mov-conv-error">
          <strong>ffmpeg not installed.</strong>
          <pre>{lastError.installHint}</pre>
          <button type="button" onClick={onImportWithoutConverting}>Continue without converting</button>
        </div>
      )}

      {showCli && (
        <div className="mov-conv-cli">
          <p>Run this in a terminal where ffmpeg is on PATH, then re-import:</p>
          <pre>{cliCommand}</pre>
          <button type="button" onClick={copyCli}>Copy command</button>
        </div>
      )}

      <div className="modal__actions">
        <button type="button" onClick={handleConvertClick}>Convert and Import</button>
        <button type="button" onClick={onImportWithoutConverting}>Import Without Converting</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run modal tests — expect PASS**

```bash
npx vitest run src/editor/react/components/MovConversionModal.test.tsx
```

Expected: 8/8 PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/editor/react/components/MovConversionModal.tsx \
        src/editor/react/components/MovConversionModal.test.tsx
git commit -m "$(cat <<'EOF'
MovConversionModal — three-action UI for .mov conversion (no app wiring yet)

Reuses the existing Modal component. Lists every detected .mov with a
per-row badge ("sequence ready" / "no sequence"). Three actions:

* Convert and Import
  - dev (isDevMode=true): calls onConvert({ projectName }) by default;
    if the previous attempt returned PROJECT_PATH_NOT_FOUND with
    manualPathAllowed:true, the modal swaps in a "Folder path on
    disk" text input and the next click sends { folderPath }.
  - build (isDevMode=false): shows a sub-section with the exact CLI
    command (node scripts/convert-w3d-mov-to-sequence.mjs
    "<folder path>") plus a Copy command button. No POST is made.
* Import Without Converting — calls onImportWithoutConverting().
* Cancel — calls onCancel().

When conversionResult is provided (after a Convert attempt), three
groups render with explicit counts: Converted / Skipped / Failed.
Failed rows include the per-file reason from runMovConversion's
stderr tail. FFMPEG_NOT_INSTALLED renders the installHint inline
plus a "Continue without converting" link.

8 tests cover all branches; no app wiring yet (next commit).
EOF
)"
```

---

## Task 8: App wiring — open `MovConversionModal` during W3D folder import

**Goal:** Hook the modal into `importW3DFromFolder`. Detect via `classifyMovAssets`; short-circuit when no `.mov` lacks a sequence; otherwise present the modal. Implement `onConvert` against the dev endpoint, `onImportWithoutConverting` to fall through to the existing path, and `onCancel` to abort. Retain the `FileSystemDirectoryHandle` so we can re-walk the folder after a successful conversion (FSA path) or prompt re-pick (input[webkitdirectory] path).

**Files:**
- Modify: `src/editor/react/App.tsx`
- Modify: `src/editor/react/App.test.tsx`

### RED — App-level wiring tests (limited, integration-style)

- [ ] **Step 1: Write the failing tests against an extracted decision helper**

The full `<App/>` is heavy to mount and is exercised by manual
testing. To get TDD coverage on the wiring decision *without* the
fragility of a full mount, extract the decision into a tiny pure
helper and test it.

File: `src/editor/react/App.test.tsx` — append:

```tsx
import { describe, it, expect } from "vitest";
import { decideMovImportFlow } from "./App";

function fakeFile(rel: string): File {
  const f = new File(["x"], rel.split("/").pop() ?? "f");
  Object.defineProperty(f, "webkitRelativePath", { value: rel, configurable: true });
  return f;
}

describe("decideMovImportFlow", () => {
  it("returns 'direct-import' when there are no .mov files", () => {
    const result = decideMovImportFlow([
      fakeFile("Project/scene.w3d"),
      fakeFile("Project/Resources/Textures/logo.png"),
    ]);
    expect(result.action).toBe("direct-import");
  });

  it("returns 'direct-import' when every .mov already has a sequence.json sibling", () => {
    const result = decideMovImportFlow([
      fakeFile("Project/scene.w3d"),
      fakeFile("Project/Resources/Textures/A.mov"),
      fakeFile("Project/Resources/Textures/A_frames/sequence.json"),
    ]);
    expect(result.action).toBe("direct-import");
  });

  it("returns 'open-modal' with the project name when at least one .mov lacks a sequence", () => {
    const result = decideMovImportFlow([
      fakeFile("GameName_FS/scene.w3d"),
      fakeFile("GameName_FS/Resources/Textures/PITCH_IN.mov"),
    ]);
    expect(result.action).toBe("open-modal");
    expect(result.action === "open-modal" && result.projectName).toBe("GameName_FS");
    expect(result.action === "open-modal" && result.classification.withoutSequence.length).toBe(1);
  });
});
```

This forces the wiring code to expose a small, testable seam — the
rest of `importW3DFromFolderWithModalCheck` becomes a thin
dispatcher that calls `decideMovImportFlow` then either re-runs the
existing import or sets modal state.

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/editor/react/App.test.tsx -t "decideMovImportFlow"
```

Expected: FAIL — `decideMovImportFlow is not a function`. The
helper is defined in Step 5 below.

### GREEN — App wiring

- [ ] **Step 3: Add modal state + classification**

File: `src/editor/react/App.tsx`:

* Import the new pieces:
  ```ts
  import { classifyMovAssets } from "../import/w3dFolder";
  import { MovConversionModal, type MovConversionResult, type MovConvertError } from "./components/MovConversionModal";
  ```

* Inside the main App component, add state:
  ```ts
  const [movModalState, setMovModalState] = useState<{
    open: boolean;
    files: File[];
    classification: ReturnType<typeof classifyMovAssets>;
    projectName: string;
    directoryHandle: FileSystemDirectoryHandle | null;
    conversionResult?: MovConversionResult;
    lastError?: MovConvertError;
  } | null>(null);
  ```

- [ ] **Step 4: Retain the FSA handle**

In the existing `showDirectoryPicker` block (around `App.tsx:1378-1390`), after `await collectFilesFromDirectory(handle)`, hold the `handle`. Pass it forward to the new wrapper:

```ts
        const collected = await collectFilesFromDirectory(handle);
        // ... existing checks ...
        await importW3DFromFolderWithModalCheck(collected, handle);
```

For the `<input webkitdirectory>` fallback, the change handler should call the same wrapper with `directoryHandle: null`.

- [ ] **Step 5: Extract the decision helper + wrapper**

Add to App.tsx (the helper at file scope, the wrapper inside the
component):

```ts
// File-scope export so tests can drive it without mounting <App/>.
export type MovImportDecision =
  | { action: "direct-import" }
  | {
      action: "open-modal";
      projectName: string;
      classification: ReturnType<typeof classifyMovAssets>;
    };

export function decideMovImportFlow(files: File[]): MovImportDecision {
  const classification = classifyMovAssets(files);
  if (classification.withoutSequence.length === 0) {
    return { action: "direct-import" };
  }
  const first = files[0];
  const rel = (first as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
  const projectName = rel.split("/")[0] || "Project";
  return { action: "open-modal", projectName, classification };
}

// Inside the App component:
const importW3DFromFolderWithModalCheck = useCallback(async (
  files: File[],
  directoryHandle: FileSystemDirectoryHandle | null,
) => {
  const decision = decideMovImportFlow(files);
  if (decision.action === "direct-import") {
    await importW3DFromFolder(files);
    return;
  }
  setMovModalState({
    open: true,
    files,
    classification: decision.classification,
    projectName: decision.projectName,
    directoryHandle,
  });
}, [importW3DFromFolder]);
```

- [ ] **Step 6: Convert handler hitting the dev endpoint**

```ts
const handleConvert = useCallback(async (
  req: { projectName: string } | { folderPath: string },
) => {
  const state = movModalState;
  if (!state) return;
  try {
    const resp = await fetch("/api/w3d/convert-mov", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    const body = await resp.json();
    if (!resp.ok) {
      setMovModalState((s) => s ? { ...s, lastError: body } : s);
      return;
    }
    setMovModalState((s) => s ? { ...s, conversionResult: body, lastError: undefined } : s);

    // Re-walk the folder if we still hold an FSA handle; otherwise toast and ask for re-pick.
    if (state.directoryHandle) {
      const refreshed = await collectFilesFromDirectory(state.directoryHandle);
      setMovModalState(null);
      await importW3DFromFolder(refreshed);
    } else {
      showToast(
        "Conversion completed. Please re-select the project folder to import the generated PNG sequences.",
        "info",
      );
      setMovModalState(null);
    }
  } catch (err) {
    setMovModalState((s) => s ? { ...s, lastError: { code: "ENDPOINT_UNREACHABLE", message: String(err) } } : s);
  }
}, [movModalState, importW3DFromFolder, showToast]);
```

- [ ] **Step 7: Render the modal**

Near the other modals (search for an existing `<Modal` in App.tsx render output), add:

```tsx
{movModalState && (
  <MovConversionModal
    isOpen={movModalState.open}
    classification={movModalState.classification}
    projectName={movModalState.projectName}
    isDevMode={import.meta.env.DEV}
    conversionResult={movModalState.conversionResult}
    lastError={movModalState.lastError}
    onConvert={handleConvert}
    onImportWithoutConverting={() => {
      const files = movModalState.files;
      setMovModalState(null);
      void importW3DFromFolder(files);
    }}
    onCancel={() => setMovModalState(null)}
  />
)}
```

- [ ] **Step 8: Switch the existing import path through the wrapper**

Wherever `importW3DFromFolder(files)` is currently called from a UI handler (look for `w3dFolderInputRef.current?.click()` and the change handler that follows it), replace the direct call with `importW3DFromFolderWithModalCheck(files, null)`.

- [ ] **Step 9: Run full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add src/editor/react/App.tsx src/editor/react/App.test.tsx
git commit -m "$(cat <<'EOF'
App: open MovConversionModal during W3D folder import

importW3DFromFolderWithModalCheck wraps the existing import:
* classifyMovAssets(files) decides whether to open the modal
* withoutSequence.length === 0 → straight through to existing flow
* otherwise → modal with project name derived from the top-level
  folder of the first file's webkitRelativePath

Convert and Import:
* POSTs to /api/w3d/convert-mov via fetch
* On 200, if we still hold the FileSystemDirectoryHandle (FSA path,
  Chromium showDirectoryPicker), re-walks the folder and re-runs
  importW3DFromFolder automatically — the just-written PNG sequences
  are picked up on the second pass.
* On 200 without a handle (webkitdirectory fallback in Firefox/
  Safari), shows a toast asking for a re-pick.
* On 4xx/5xx, surfaces the structured error to the modal so it can
  show the manual-folderPath input or the install hint.

Import Without Converting and Cancel forward to the existing path
or close the modal respectively.

The handle is retained on the showDirectoryPicker code path; the
input[webkitdirectory] path passes null and falls back to the
re-pick prompt.
EOF
)"
```

---

## Task 9: Operator-facing docs

**Goal:** Single page operators read when they're not sure what's going on. Covers why MOV may fail, how PNG sequences fix it, the trade-off, ffmpeg install per OS, the manual command, validation steps for `GameName_FS`.

**Files:**
- Create: `docs/w3d-mov-conversion.md`
- Modify: `docs/w3d-runtime-visual-debug.md` (one-line "see also" link)

- [ ] **Step 1: Write `docs/w3d-mov-conversion.md`**

File: `docs/w3d-mov-conversion.md`:

```md
# W3D `.mov` → PNG sequence conversion (operator guide)

## Why `.mov` may not play

Browsers ship a narrow set of video codecs. R3 broadcast templates
often use `.mov` containers carrying ProRes, DNxHR, or animation
codecs that Chrome and friends can't decode. Even when the codec is
H.264, autoplay can be blocked, and alpha-channel video formats are
rare on the web.

The Pass-3 diagnostics surface this: in devtools, run
`window.__r3Dump()` and look at any node with `textureMime`
starting with `video/`. If `video.errorCode === 4`
(`MEDIA_ERR_SRC_NOT_SUPPORTED`), the codec is the problem; if
`paused === true` and `errorCode === null`, autoplay is blocked
(click anywhere in the viewport).

## How PNG sequences fix it

A PNG sequence is `<basename>_frames/frame_NNNNNN.png` plus a
`<basename>_frames/sequence.json` manifest. PNG handles alpha
correctly, decodes everywhere, and the renderer's
`ImageSequencePlayer` swaps frames at the recorded fps.

Trade-off: PNG sequences are larger on disk than the source `.mov`
(no inter-frame compression) and use more RAM at peak (capped by the
player at the 60-frame sliding window). The `_frames/` directory sits
next to the original `.mov` so re-importing the same W3D folder picks
the sequence up automatically.

## Install ffmpeg

| OS | Command |
|----|---------|
| Windows | `winget install ffmpeg` (or unzip the build from <https://ffmpeg.org/download.html> and add `bin/` to PATH) |
| macOS   | `brew install ffmpeg` |
| Linux   | `apt-get install ffmpeg` (Debian/Ubuntu) / `dnf install ffmpeg` (Fedora) |

Verify: `ffmpeg -version` from a fresh terminal.

## In-app conversion (recommended, dev mode only)

1. `npm run dev`
2. File → Import → W3D Scene (Folder), pick the project.
3. If any `.mov` is missing a sibling `<basename>_frames/sequence.json`,
   the **MOV videos detected** modal opens.
4. Click **Convert and Import**. The dev plugin runs ffmpeg locally,
   writes the PNG sequences alongside the source, then re-imports
   the folder automatically (Chromium / FSA) or prompts you to
   re-pick the folder (Firefox / Safari).
5. After the re-import, `__r3Dump()` shows
   `imageSequence: { frameCount, currentFrame, ... }` for the
   converted assets.

If the dev plugin can't resolve your `projectName`
(`R3_PROJECTS_ROOT` env var doesn't point at a folder that contains
it), the modal shows a "Folder path on disk" input — paste the
absolute path manually.

## Manual conversion (works in any environment)

```
node scripts/convert-w3d-mov-to-sequence.mjs "C:/path/to/GameName_FS"
```

Add `--force` to overwrite existing sequences.

Or via npm:
```
npm run convert:mov -- "C:/path/to/GameName_FS"
```

Exit codes:
- `0` — no `.mov` to convert OR everything succeeded/skipped
- `1` — at least one file failed (see stderr)
- `2` — ffmpeg not on PATH (install hint printed)

## Validation with `GameName_FS`

Before conversion, `__r3Dump()` should show **4** image nodes with
`textureMime: "video/quicktime"` (PITCH_IN, PITCH_Out, CompLogo_In,
CompLogo_In_shadow). After conversion + re-import, the same 4 nodes
should show `textureMime: "application/x-image-sequence"` and a
populated `imageSequence: { ... }` block.

Either way, **the asset count never drops to `videos: 0` AND
`imageSequenceNodes: 0` for these four** — that's the contract
locked by the FASE D / Pass 4 commit 1 invariant test.

## Limitations in this round

* The player uses a 60-frame sliding window; very long sequences
  load lazily but past that horizon, frames are released between
  appearances. Smoothness depends on disk speed.
* `ffprobe` is not invoked; `fps`/`width`/`height` in `sequence.json`
  default to 0 and the player falls back to 25 fps. Set them by
  hand in the JSON if you need a different rate.
* In production builds the in-app **Convert and Import** button
  shows the CLI command instead of running it; the browser never
  shells out to ffmpeg.
```

- [ ] **Step 2: Add the cross-link in the existing report**

File: `docs/w3d-runtime-visual-debug.md`. Append at the very end (after the existing FASE D / Pass 3 section):

```md

---

**See also:** `docs/w3d-mov-conversion.md` for the `.mov` → PNG
sequence workflow added in FASE D / Pass 4.
```

- [ ] **Step 3: Commit**

```bash
git add docs/w3d-mov-conversion.md docs/w3d-runtime-visual-debug.md
git commit -m "$(cat <<'EOF'
Docs: w3d-mov-conversion.md operator guide

One-page guide operators read when MOV assets aren't playing. Covers:
* Why .mov may fail in the browser (codec, autoplay, alpha)
* How PNG sequences fix it (and the disk/RAM trade-off)
* ffmpeg install per OS (winget / brew / apt-get / dnf)
* In-app flow (dev): Import → modal → Convert and Import → re-import
* Manual flow: node scripts/convert-w3d-mov-to-sequence.mjs "<path>"
  (or npm run convert:mov -- "<path>"), with exit codes
* Validation steps for GameName_FS using __r3Dump
* Known limitations (60-frame window, no ffprobe, build mode shows
  the command instead of running it)

Cross-linked from docs/w3d-runtime-visual-debug.md so the diagnostics
report points readers here when video issues come up.
EOF
)"
```

---

## Final verification

- [ ] **Run the whole suite once more**

```bash
npm test
```

Expected: all green. Note total test count vs the post-Pass-3 baseline (399 + ~38 new tests across Tasks 1–7).

- [ ] **Run typecheck**

```bash
npm run typecheck
# OR if the npm wrapper is flaky in your environment:
node node_modules/typescript/bin/tsc --noEmit
```

Expected: no errors. If errors occur in the parser around the `sequences` parameter, the most likely cause is a missing import of `ImageSequenceMetadata` somewhere.

- [ ] **Run the smoke test**

```bash
npx vitest run src/editor/import/w3d.realScenes.test.ts
```

Expected: 4 passed (the GameName_FS + AR_* scenes).

- [ ] **Manual validation in dev (operator-facing)**

```bash
npm run dev
# Open the editor, File → Import → W3D Scene (Folder), pick GameName_FS.
# Modal should open with 4 .mov listed, all "no sequence".
# Click Convert and Import. ffmpeg should run; modal updates with
# converted/skipped/failed groups; importer re-runs automatically.
# In devtools console:
const d = window.__r3Dump();
d.nodes.filter(n => n.imageSequence).map(n => ({ name: n.name, fc: n.imageSequence.frameCount }));
# Should show 4 entries.
```

---

## Self-review checklist (run before declaring done)

- [ ] Every spec section has at least one task implementing it.
- [ ] No "TBD", "TODO", "implement later", "Add appropriate error handling".
- [ ] Type signatures are consistent across tasks (e.g. `ImageSequenceMetadata` used the same way in Tasks 2, 4, 5; `runMovConversion` return shape used the same way in Tasks 3, 6, 7, 8).
- [ ] Each commit message accurately reflects the diff it covers.
- [ ] The non-disappearance invariant from Task 1 holds across Tasks 4–8 (search the test files for the four `GameName_FS` `.mov` asset names; each downstream task either preserves or strengthens the assertion).
