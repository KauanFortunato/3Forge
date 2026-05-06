# W3D `.mov` → PNG-sequence conversion (design)

**Date:** 2026-05-06
**Topic:** `feat/w3d-scene-support` follow-up after FASE D / Pass 3
**Status:** approved by user across three brainstorming Q&A turns
(Q1=C hybrid, Q2=A revised — full PNG sequence player included this
round; see §"Revision 1 — 2026-05-06 (post first review)" below;
Q3=A+B fallback). Revision 1 also adds an explicit non-disappearance
invariant for `.mov` / ImageSequence assets and corresponding
diagnostics.

## Problem

When importing a W3D folder, `.mov` videos may not play in the browser
(ProRes/DNxHR codecs, autoplay gates, alpha channel issues). The Pass-3
diagnostics surface this *after* the import; this round adds a
proactive UX so the operator can convert `.mov` → PNG sequence
**before** finalising the import, with the conversion running locally
via ffmpeg (never inside the browser).

## Non-goals

* In-browser conversion (no `ffmpeg.wasm`).
* `.vert` / `.ind` mesh loader.
* `Size.YProp` animations.
* Refactoring the scene renderer beyond the minimum needed (the new
  PNG-sequence player added in Revision 1 below is the *only* renderer
  expansion in scope).
* Sprite-sheet packing for sequence playback (explicitly off the
  table — texture-size limits + loop friction).

## Architecture

```
                           ┌─────────────────────────┐
                           │  React App (browser)    │
                           │                         │
   Pick W3D folder ───────▶│  parseW3DFromFolder()   │
                           │  └─ classifyMovAssets() │
                           │       returns           │
                           │       { withSequence,   │
                           │         withoutSequence │
                           │       }                 │
                           │           │             │
                           │           ▼             │
                           │  if withoutSequence > 0:│
                           │  MovConversionModal     │──── Cancel ──▶ abort
                           │   ┌───────────────┐     │
                           │   │ Import w/o    │─────┼──▶ existing flow
                           │   │ Convert+Imp.  │     │
                           │   └───────────────┘     │
                           └────────┬────────────────┘
                                    │ POST /api/w3d/convert-mov
                                    ▼
                           ┌─────────────────────────┐
                           │ Vite dev plugin         │
                           │ (dev only)              │
                           │  resolveProjectPath()   │
                           │           │             │
                           │           ▼             │
                           │  runMovConversion()     │── shared lib
                           └────────┬────────────────┘
                                    ▼
                           ┌─────────────────────────┐
                           │ scripts/                │
                           │   convert-w3d-mov-      │
                           │   to-sequence.mjs       │
                           │   (CLI, also imports    │
                           │    runMovConversion)    │
                           └─────────────────────────┘
```

## Components

### 1. `scripts/movConversion.mjs` (shared core)
Pure Node module under `scripts/` so both the CLI wrapper and the Vite
plugin import from the same place. No Vite, no React, no test runner.
Exports:

```js
export async function runMovConversion({ folderPath, force = false, onProgress })
  → Promise<{
      converted: string[],   // .mov filenames that were processed
      skipped:   string[],   // .mov filenames that already had a sequence (force=false)
      failed:    Array<{ filename, error }>,
      sequenceJsonPaths: string[],  // absolute paths written
      warnings:  string[],
    }>
```

Behaviour:
1. Resolve `folderPath/Resources/Textures/`. If absent, return failure.
2. List every `.mov`. For each:
   * If `<basename>_frames/sequence.json` exists and `!force`, push to `skipped`.
   * Else: run `ffmpeg -i <mov> -start_number 1 <basename>_frames/frame_%06d.png`.
   * On success, write `<basename>_frames/sequence.json` with the format below.
   * On ffmpeg failure (non-zero exit, ENOENT, etc.), push to `failed` with the stderr tail.
3. Surface ffmpeg-not-installed via a sentinel `ENOENT` error returned to the caller (CLI prints install hint, endpoint returns structured error).
4. Progress callback fires before each file: `onProgress({ index, total, filename })`.

`sequence.json` shape (v1, locked):
```json
{
  "version": 1,
  "type": "image-sequence",
  "source": "04_Game_Name_PITCH_IN.mov",
  "framePattern": "frame_%06d.png",
  "frameCount": 240,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "durationSec": 8.0,
  "loop": true,
  "alpha": true,
  "pixelFormat": "rgba"
}
```

`type` and `alpha`/`pixelFormat` are recorded explicitly even when
`alpha` is always true at conversion time (PNG conversion preserves
the source's alpha channel). The fields document intent — "this
sequence exists to preserve transparency" — and let a future format
upgrade signal a different choice without ambiguity.
`fps`/`width`/`height`/`durationSec` come from `ffprobe` when
available. `frameCount` is always set from the actual number of PNG
files written (counted post-conversion, never trusted from ffprobe).
When `ffprobe` is unavailable, the metadata fields stay 0 — the
importer treats 0 as "unknown" and uses frame 1 as the still
regardless. The deferred animator (follow-up commit) will require
non-zero `fps` and degrade gracefully when missing.

### 2. `scripts/convert-w3d-mov-to-sequence.mjs` (CLI)

Thin wrapper:
```bash
node scripts/convert-w3d-mov-to-sequence.mjs "C:/path/to/GameName_FS" [--force]
```
Calls `runMovConversion`, prints a colour-free summary table on stdout,
exits non-zero when any conversion failed or ffmpeg is missing. Used
by humans running it manually AND by the Vite endpoint internally so
the conversion logic is tested once.

### 3. Vite dev plugin (`scripts/movConvertPlugin.mjs` + import in `vite.config.mjs`)

The plugin lives next to the conversion lib so both stay under
`scripts/` and `vite.config.mjs` only does the import + registration.
Adds an in-process plugin with `configureServer(server)`. Endpoint:
`POST /api/w3d/convert-mov`. Body either:
* `{ projectName: "GameName_FS", force?: boolean }` — resolves under
  `process.env.R3_PROJECTS_ROOT` (default
  `C:\Users\diogo.esteves\Documents\R3.Space.Projects\Projects`).
* `{ folderPath: "C:/abs/path", force?: boolean }` — used by the
  fallback path; absolute path required.

Validation:
* `projectName` must be a single path segment — reject `..`, `/`, `\`.
* Resolved/passed `folderPath` must exist on disk and contain
  `Resources/Textures` to look like a real W3D folder.
* On `projectName` not resolving: respond `400` with
  `{ code: "PROJECT_PATH_NOT_FOUND", message, suggestedEnv: "R3_PROJECTS_ROOT", manualPathAllowed: true }`.
* On ffmpeg missing: respond `500` with
  `{ code: "FFMPEG_NOT_INSTALLED", message: "...", installHint: "..." }`.
* Success: 200 with the `runMovConversion` result.

The endpoint **only registers in dev** (gated on `config.command ===
"serve"`). In `vite build`, the plugin is a no-op so production
bundles never reach a dev-only surface.

### 4. Frontend — detection (`src/editor/import/w3dFolder.ts`)

New helper exported from this file:
```ts
export interface MovClassification {
  withSequence:   { videoName: string; sequencePath: string }[];
  withoutSequence:{ videoName: string }[];
}
export function classifyMovAssets(files: File[]): MovClassification
```
Pure: looks at `webkitRelativePath`, finds every `.mov` in
`Resources/Textures`, and checks for a sibling
`Resources/Textures/<basename>_frames/sequence.json` in the SAME file
list. Used by the App before the modal opens.

`parseW3DFromFolder` is also extended to **prefer sequences when
present**, with a structured outcome (`mimeType` and side-data) the
renderer reads:

* No `<basename>_frames/` for a referenced video → existing video path:
  `ImageAsset { mimeType: "video/quicktime", src: blob:<mov> }`. The
  importer still creates an `ImageNode`. **NEVER omit it.**
* `<basename>_frames/sequence.json` present and parseable →
  `ImageAsset { mimeType: "application/x-image-sequence", src:
  blob:<frame_000001.png>, sequence: { framePattern, frameCount, fps,
  width, height, loop, alpha, frameUrls: blob:[…] } }`. The first
  frame's URL is used as `src` so the existing render path can show
  something even if the player isn't ready yet (defence in depth).
  The renderer's PNG-sequence player (§5) reads
  `image.sequence.frameUrls` to drive playback.
* `<basename>_frames/sequence.json` present but invalid (parse error,
  missing `framePattern`, missing referenced PNG files) → fall back to
  the `.mov` path with a warning surfaced in `result.warnings`:
  `"sequence.json for <basename> is invalid (<reason>) — falling back
  to VideoTexture."` **NEVER drop the asset entirely.**

The new `ImageAsset.sequence` field is optional and only present for
the sequence path. Adding it is type-safe (existing code that doesn't
read `sequence` keeps working).

### 4b. Renderer — PNG sequence player (`src/editor/scene.ts`)

**Scope reversal vs the original Q2=B answer.** The renderer now
includes a small player so converted assets actually animate (and so
the non-disappearance invariant in §"Invariant" below is satisfied
end-to-end). Bounded scope, hard memory ceilings:

* New private `ImageSequencePlayer` class held in the scene editor:
  ```ts
  class ImageSequencePlayer {
    constructor(spec: { frameUrls: string[]; fps: number; loop: boolean });
    readonly texture: Texture;            // exposed as `material.map`
    tick(deltaSec: number): void;         // called from the render loop
    dispose(): void;                      // releases textures + listeners
    state(): {                            // surfaced in __r3Dump
      currentFrame: number;
      loadedFrames: number;
      totalFrames: number;
      paused: boolean;
      error: string | null;
    };
  }
  ```
* **Frame loading strategy** (defence against memory blow-up):
  - Always load frame 1 eagerly so the texture has *something* on first
    paint.
  - Lazy-load subsequent frames on demand: when `tick` is about to
    advance to frame `N`, kick off the fetch for frame `N` and the
    next 4 frames if not already loaded. Cap concurrent fetches at 4.
  - **Hard ceiling**: at most 60 decoded frames in memory at any time
    (a sliding window centred on `currentFrame`). Older frames are
    `dispose()`d when the window moves. For sequences ≤ 60 frames the
    full set stays resident.
  - **Pre-load warning**: if `frameCount > 60` *or* estimated memory
    (`width * height * 4 * 60` bytes) exceeds 200 MB, log a
    `console.warn` once with the estimate so the operator is aware
    before the scene gets sluggish.
* **Playback**: `tick(deltaSec)` accumulates `deltaSec * fps` and
  steps forward integer frames. `loop: true` wraps to 0; `loop:
  false` clamps at the last frame. When `currentFrame` changes, the
  texture's `image` is swapped to the corresponding `HTMLImageElement`
  and `texture.needsUpdate = true` is set **only if the image has
  data** (this is the §"Renderer guard" rule below — never set
  `needsUpdate` when the image isn't ready, that has caused WebGL
  black frames in the past).
* **Failure mode**: if frame-fetch errors out (e.g. blob URL revoked,
  PNG corrupt), the player records `error: <message>`, stops
  advancing, and the texture stays bound to whichever frame loaded
  last (frame 1 in the worst case). It does NOT throw.
* **Cleanup**: the scene editor calls `player.dispose()` when the
  blueprint is rebuilt or the editor unmounts. Disposing releases all
  cached `Texture` objects and clears the frame cache.

This player is wired into the existing texture-binding path:
`buildMeshObject` checks `mimeType === "application/x-image-sequence"`
before the existing video / image branches and constructs an
`ImageSequencePlayer`, registering it in a `sequencePlayers:
Map<nodeId, ImageSequencePlayer>` on the editor. The render loop ticks
every registered player.

### 5. Frontend — modal (`src/editor/react/components/MovConversionModal.tsx`)

New component. Reuses the existing `Modal`. Title: "MOV videos
detected". Body lists each detected `.mov` with a one-row badge
("sequence ready" / "no sequence"). Three actions:

* **Convert and Import**
  * Dev (`import.meta.env.DEV === true`): POST to
    `/api/w3d/convert-mov` with `{ projectName }`. On 200, invoke
    `onConvertedRetry` (re-import flow). On `PROJECT_PATH_NOT_FOUND`,
    swap to a text-input fallback: "Folder path on disk: [_______]" →
    resends with `{ folderPath }`. On `FFMPEG_NOT_INSTALLED`, show the
    install hint inline with a "Continue without converting" link.
    Partial success (`failed[].length > 0` with `converted[].length >
    0`) shows three explicit groups in the modal body:
    - **Converted** (green badge) — filename + frame count
    - **Skipped** (grey, "already had sequence.json") — filename
    - **Failed** (red badge) — filename + truncated reason from
      `failed[i].error`
    The re-import button stays enabled so the operator can proceed
    with the videos that did convert; the failed ones fall back to
    `VideoTexture` in the re-import (still respecting the
    non-disappearance invariant — they remain in the blueprint as
    `video/quicktime` image nodes).
  * Build (`import.meta.env.DEV === false`, i.e. `npm run build`
    output): replace the action with a sub-modal showing the exact
    CLI command (`node scripts/convert-w3d-mov-to-sequence.mjs
    "<absolute folder path>"`) plus a **Copy command** button. No
    POST is made; no fetch hits the network. The frontend has no
    knowledge of any disk paths in build mode, so the command shown
    contains a `<folder path>` placeholder the operator must edit.
* **Import Without Converting** — calls `onImportAnyway()` (existing
  VideoTexture path runs unchanged, with the Pass-3 diagnostics).
* **Cancel** — calls `onCancel()` and the import aborts.

Re-import after success:
* If `App.tsx` still holds the `FileSystemDirectoryHandle` (FSA path),
  re-walk it via `collectFilesFromDirectory(handle)` and re-run
  `importW3DFromFolder` automatically. **App.tsx must be extended to
  retain the handle on the FSA path (it currently discards it).**
* Otherwise (input[webkitdirectory], Firefox/Safari), show a toast
  "Conversion completed. Re-select the project folder to use the new
  PNG sequences." with a button that re-opens the folder picker.

### 6. Frontend — wiring (`src/editor/react/App.tsx`)

Minimal changes:
* `importW3DFromFolder` now (a) collects the FileList and (b) calls
  `classifyMovAssets`. If `withoutSequence.length > 0`, opens
  `MovConversionModal`. Otherwise proceeds straight to the existing
  `parseW3DFromFolder` call.
* New state for the modal + the directory handle (FSA path only).

## Data flow

```
1. User: File → Import → W3D Scene (Folder)
2. App: collect FileList (handle stored if FSA)
3. App: classifyMovAssets(files)
4. if withoutSequence.length === 0:
       parseW3DFromFolder(files) → done
5. else:
       MovConversionModal opens
       a. Convert and Import (dev) → POST endpoint
          → on success: re-walk handle / prompt re-pick
          → re-classify (now withoutSequence is empty)
          → parseW3DFromFolder(files)
       b. Import Without Converting → parseW3DFromFolder(files) [unchanged]
       c. Cancel → abort
```

## Invariant — `.mov` / ImageSequence MUST NEVER disappear

A non-negotiable contract enforced by tests and a dedicated commit:

> Every `.mov` referenced by the source W3D — and every
> `<ImageSequence>` resource — produces **exactly one** ImageNode in
> the imported blueprint. The mime type tells the rest of the system
> how to render it:
>
> * `video/quicktime` → existing VideoTexture path (Pass-3
>   diagnostics still apply).
> * `application/x-image-sequence` → new PNG-sequence player.
>
> Both surface in the asset library AND in `__r3Dump`. The
> illegal state is "asset present in the source W3D, missing from
> blueprint or runtime". A regression that drops one is treated as
> a P0 bug.

This invariant exists because the user's live `__r3Dump` showed
`videos: 0, images: 18` for `GameName_FS` even though the parser dump
(offline test) shows `imageNodes: 22, videoImageNodes: 4` — i.e. 4
video-mime image nodes appear to be vanishing somewhere downstream.
The first commit of this round is dedicated to:

1. **Reproduce** the live discrepancy with a vitest test that builds
   the blueprint from `GameName_FS` and asserts `videoImageNodes ===
   4` AND that those four show up in whatever asset-library/Media
   surface drives the user-visible counter.
2. **Fix** whatever drops them (likely either `App.tsx`
   `resolveImageAssetLibrary` filters by `image.id` and the four
   video assets share/lack an id, OR the asset library never receives
   the video assets at all).
3. **Lock it** with a regression test so the invariant cannot decay.

This work happens *before* any `sequence.json` code lands so we don't
build new pipes on top of broken plumbing.

## Renderer guard — `texture.needsUpdate` only when data is ready

Adjacent rule the player and any future texture-swap code must obey:

> Never set `texture.needsUpdate = true` when the underlying
> `texture.image` is null, undefined, or has no decoded data
> (`HTMLImageElement` with `complete === false`, `HTMLVideoElement`
> with `readyState < 2`). Doing so produces black/transparent frames
> in WebGL and has caused real visual regressions before.

Encoded as a small helper:
```ts
function setTextureUpdateIfReady(t: Texture): void {
  const img = t.image;
  if (!img) return;
  if (img instanceof HTMLImageElement && !img.complete) return;
  if (img instanceof HTMLVideoElement && img.readyState < 2) return;
  t.needsUpdate = true;
}
```

The player calls this every tick instead of `t.needsUpdate = true`
directly.

## Error handling

| Where | Error | Behaviour |
|-------|-------|-----------|
| CLI | ffmpeg not on PATH | exit 2, prints install instructions for Windows / macOS / Linux |
| CLI | one .mov failed (others ok) | continues, prints summary, exits 1 |
| CLI | no .mov found in `Resources/Textures` | exit 0, prints "no .mov assets to convert" |
| Endpoint | invalid `projectName` (path traversal) | 400 `INVALID_PROJECT_NAME` |
| Endpoint | path not found | 400 `PROJECT_PATH_NOT_FOUND` (frontend opens manual fallback) |
| Endpoint | ffmpeg not installed | 500 `FFMPEG_NOT_INSTALLED` |
| Endpoint | conversion partial fail | 200 with `failed[]` populated; modal shows red rows |
| Frontend | endpoint unreachable in dev | "Couldn't reach dev conversion endpoint — see CLI command below" |
| Frontend | re-pick after webkitdirectory yields a different folder | classify again; if still has .mov without sequence, re-open modal |

## Security

* `projectName` is regex-validated `/^[A-Za-z0-9_.\- ]+$/` — no slashes,
  no `..`, no whitespace tricks. Anything else returns 400
  `INVALID_PROJECT_NAME`.
* Manual `folderPath` is allowed ONLY through the dev plugin and ONLY
  in dev mode; the plugin is registered behind `config.command ===
  "serve"`.
* `folderPath` is required to be absolute and to contain
  `Resources/Textures` before any spawn happens.
* `path.resolve(R3_PROJECTS_ROOT, projectName)` is checked to still
  start with `R3_PROJECTS_ROOT` after normalisation (defence against
  unicode-normalisation tricks even though the regex already strips
  separators).
* **`ffmpeg` is invoked exclusively via `spawn("ffmpeg", argsArray,
  options)` — never `exec` of a concatenated string.** This makes
  paths-with-spaces / quoting trivially safe and removes the entire
  shell-injection surface. Same rule for `ffprobe`.
* No frontend code attempts to `spawn` ffmpeg or use `ffmpeg.wasm`.
* Production bundles do not ship the endpoint or any `child_process`
  dependency. The plugin's body is gated by `if (config.command !==
  "serve") return;` and is otherwise a no-op object.

## `__r3Dump` — extended for image sequence

Per-node block when `mimeType === "application/x-image-sequence"`:
```ts
imageSequence: {
  frameCount: number;
  currentFrame: number;
  loadedFrames: number;
  fps: number;
  loop: boolean;
  paused: boolean;
  firstFrameSrc: string;       // first 64 chars of frame 1's URL
  error: string | null;
} | null
```
Per-node block for video unchanged (Pass-3 already added it):
`video: { src, readyState, networkState, errorCode, paused, muted,
loop, playsInline, currentTime, duration } | null`.

Plus per-node common fields (always present, used by the regression
tests for the non-disappearance invariant):
`textureMime`, `hasMap` (bool — mesh's material has a `.map`),
`mapHasImage` (bool — `texture.image` is not null), `textureSrc`
(first 64 chars or null).

## Testing

| Layer | Test | File |
|-------|------|------|
| **Invariant** | `GameName_FS` blueprint has exactly 4 video-mime image nodes (regression for the live `videos: 0` report) | `src/editor/import/w3d.test.ts` (extension) |
| **Invariant** | App's image-asset library reports the 4 video assets too | `src/editor/react/App.test.tsx` (extension) |
| **Invariant** | `__r3Dump` per-node `textureMime` matches `node.image.mimeType` | `src/editor/scene.test.ts` (extension) |
| Pure   | `classifyMovAssets` returns withSequence + withoutSequence | `src/editor/import/w3dFolder.test.ts` (new) |
| Pure   | `parseW3DFromFolder` resolves `application/x-image-sequence` mime when sequence.json present | same |
| Pure   | `parseW3DFromFolder` writes a `result.warnings` entry and falls back to `.mov` when sequence.json is invalid (missing framePattern, parse error, missing PNG file) | same |
| Pure   | `parseW3DFromFolder` falls back to `.mov` when no sequence | same |
| Core   | `runMovConversion` skips when sequence.json exists and `!force` | `scripts/movConversion.test.mjs` (new) |
| Core   | `runMovConversion` returns `FFMPEG_NOT_INSTALLED` sentinel when spawn fails with ENOENT | same |
| Core   | `runMovConversion` validates folderPath structure (rejects when no `Resources/Textures`) | same |
| Core   | `runMovConversion` writes a sequence.json with `alpha: true, type: "image-sequence"` | same |
| Endpoint | `projectName` with `..` rejected as `INVALID_PROJECT_NAME` | `scripts/movConvertPlugin.test.mjs` (new) |
| Endpoint | unknown `projectName` returns `PROJECT_PATH_NOT_FOUND` with `manualPathAllowed: true` | same |
| Endpoint | `folderPath` works in dev for paths outside `R3_PROJECTS_ROOT` | same |
| Endpoint | endpoint not registered when `command !== "serve"` | same |
| Modal | renders only when `withoutSequence.length > 0` | `src/editor/react/components/MovConversionModal.test.tsx` (new) |
| Modal | dev mode: Convert and Import calls fetch with `{ projectName }` | same |
| Modal | partial success: shows converted/skipped/failed groups + reason per file | same |
| Modal | build mode: shows CLI command + Copy button (no fetch) | same |
| Modal | Cancel calls `onCancel` and does not POST | same |
| Wiring | App: `classifyMovAssets` short-circuits when no `.mov` (modal does not open) | App test |
| Wiring | App: `Import Without Converting` reaches existing VideoTexture path | App test |
| Renderer | `setTextureUpdateIfReady` no-ops on incomplete image / low-readyState video | scene.test.ts |
| Renderer | `ImageSequencePlayer.tick` advances frames at fps; loop wraps; non-loop clamps | scene.test.ts |
| Renderer | player issues a single console.warn once when memory estimate > 200 MB | scene.test.ts |
| Renderer | `dispose()` releases all cached `Texture` instances | scene.test.ts |
| Renderer | existing VideoTexture path is not regressed (Pass-3 tests stay green) | scene.test.ts |

`runMovConversion` integration with real ffmpeg is **not** tested in
CI (no ffmpeg in sandbox); the spawn is mocked at the
`child_process.spawn` boundary so the lib's argument shape, exit-code
handling, and sequence.json writing are all asserted. The CLI is
exercised locally via `node scripts/convert-w3d-mov-to-sequence.mjs
"<dir>"`.

## File-by-file change list

New files:
* `scripts/movConversion.mjs` — shared Node lib (CLI + plugin both consume)
* `scripts/movConversion.test.mjs`
* `scripts/convert-w3d-mov-to-sequence.mjs` — CLI wrapper
* `scripts/movConvertPlugin.mjs` — Vite dev plugin
* `scripts/movConvertPlugin.test.mjs`
* `src/editor/react/components/MovConversionModal.tsx`
* `src/editor/react/components/MovConversionModal.test.tsx`
* `src/editor/import/w3dFolder.test.ts`
* `docs/w3d-mov-conversion.md` — operator-facing guide
  (why MOV fails, how PNG sequence helps, ffmpeg install per OS, manual
  command, validation steps)

Edited files:
* `vite.config.mjs` — add `movConvertPlugin()` to the plugin list
* `src/editor/import/w3dFolder.ts` — `classifyMovAssets` + sequence
  preference in parser bridge
* `src/editor/import/w3d.ts` — accept a `sequences` map alongside
  `textures` so `<ImageSequence>` resolution checks sequences first
* `src/editor/react/App.tsx` — modal state, directory-handle retention,
  re-import flow
* `package.json` — add a `convert:mov` script alias for convenience
* `docs/w3d-runtime-visual-debug.md` — small "see also" link

## Commit plan

Small commits, each green. Order picked so the non-disappearance
invariant is locked in BEFORE any new code touches the import path:

1. **`Lock non-disappearance invariant for .mov / ImageSequence`** —
   add the regression test surfacing the live `videos: 0` report;
   diagnose; minimal fix in whatever surface drops the assets
   (parser, asset-library resolver, or panel filter); `__r3Dump`
   carries the new common fields (`textureMime`, `hasMap`,
   `mapHasImage`).
2. `Extract sequence.json shape + classifyMovAssets pure helper` —
   type + pure function + unit tests, no UI.
3. `Add scripts/movConversion.mjs core + CLI wrapper` — Node lib +
   CLI + tests with mocked spawn (asserts the `spawn(…, [args])` form).
4. `Importer prefers <name>_frames/sequence.json over .mov` — parser
   change, sequence.json validation, fallback-with-warning, tests.
5. `Add ImageSequencePlayer + setTextureUpdateIfReady to renderer` —
   bounded player with memory ceilings, dispose, tick; `__r3Dump`
   gains `imageSequence: {…}` block; tests for tick/loop/dispose/
   guard.
6. `Add Vite dev plugin POST /api/w3d/convert-mov` — plugin + tests.
7. `MovConversionModal component` — UI + tests, no app wiring yet.
8. `App: open MovConversionModal during W3D folder import` — wiring,
   FSA handle retention, re-import flow.
9. `Docs: w3d-mov-conversion.md operator guide`.

## What is explicitly NOT in this round

(Repeated for clarity; see "Non-goals" above.)

* Anything touching `.vert` / `.ind`, `Size.YProp`, the colour
  fallback for unresolved external materials, or the skewed-mask
  AABB over-clip.
* Sprite-sheet packing as an alternative animation strategy.
* `ffmpeg.wasm` or any in-browser conversion fallback.
* Pre-converting on import without asking — the modal is mandatory
  whenever there is at least one `.mov` without `sequence.json`.

## Acceptance criteria (final)

* `npm test` green, `npm run typecheck` green.
* For `GameName_FS`:
  * Without running conversion, `__r3Dump()` shows `videos: 4` for
    the four `.mov`-backed image nodes (PITCH_IN, PITCH_Out,
    CompLogo_In, CompLogo_In_shadow). Never `videos: 0`.
  * After running conversion (`Convert and Import` in dev),
    `__r3Dump()` shows `imageSequenceNodes: 4` for the same four
    nodes. Never `videos: 0` AND `imageSequenceNodes: 0` for those
    assets.
* Existing VideoTexture path remains visually unchanged for users who
  pick `Import Without Converting`.
* Modal appears only when at least one `.mov` is referenced AND has
  no sibling `sequence.json`.
* `node scripts/convert-w3d-mov-to-sequence.mjs "<absolute path>"`
  works standalone in a terminal that has ffmpeg on PATH.
* Production build never hits the dev endpoint.

## Revision 1 — 2026-05-06 (post first review)

Changes from the v1 spec:

* **Q2 reversal**: PNG sequence player IS in scope this round
  (§4b — bounded scope, hard memory ceiling, lazy preload).
* **`sequence.json` schema**: added `type: "image-sequence"`, `alpha:
  true`, `pixelFormat: "rgba"`. `frameCount` is sourced from PNG
  files written, not ffprobe.
* **Mime type** for sequence-backed image nodes is now
  `application/x-image-sequence` (was `image/png`). The existing
  `<ImageSequence>` resource path stays as `video/quicktime` when no
  sequence.json exists.
* **`ImageAsset.sequence`** field added (optional) carrying
  `frameUrls`, `framePattern`, `frameCount`, `fps`, `width`,
  `height`, `loop`, `alpha`.
* **Non-disappearance invariant** added as commit 1 + tests +
  `__r3Dump` common fields. Triggers a small fix to whatever surface
  is dropping the 4 video-mime image nodes from the user's live
  `__r3Dump`.
* **Renderer guard** `setTextureUpdateIfReady` documented as a rule
  the new player and any future texture-swap code must obey.
* **Modal partial-success** explicitly shows three groups
  (Converted/Skipped/Failed) with reason per failed file.
* **Security** clarifies `spawn(cmd, args[])` form (never shell), env
  var prefix-check after `path.resolve`.
* **`__r3Dump`** extended with `imageSequence: {…}` block per node.
* **Commit plan**: 9 commits (was 7), with commit 1 dedicated to the
  invariant.
* **Acceptance criteria** added explicitly, including the live
  `__r3Dump` shape.

— end of design (Revision 1) —
