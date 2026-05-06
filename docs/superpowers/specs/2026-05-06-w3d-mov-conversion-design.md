# W3D `.mov` → PNG-sequence conversion (design)

**Date:** 2026-05-06
**Topic:** `feat/w3d-scene-support` follow-up after FASE D / Pass 3
**Status:** approved by user across three brainstorming Q&A turns
(see Q1=C hybrid, Q2=B still-image-only, Q3=A+B fallback).

## Problem

When importing a W3D folder, `.mov` videos may not play in the browser
(ProRes/DNxHR codecs, autoplay gates, alpha channel issues). The Pass-3
diagnostics surface this *after* the import; this round adds a
proactive UX so the operator can convert `.mov` → PNG sequence
**before** finalising the import, with the conversion running locally
via ffmpeg (never inside the browser).

## Non-goals

* In-browser conversion (no `ffmpeg.wasm`).
* PNG-sequence playback animator in `scene.ts` — sequences imported in
  this round resolve to **frame 1 as a still image**. The animator is
  a follow-up commit.
* `.vert` / `.ind` mesh loader.
* `Size.YProp` animations.
* Refactoring the scene renderer beyond the minimum needed.

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
  "source": "04_Game_Name_PITCH_IN.mov",
  "framePattern": "frame_%06d.png",
  "frameCount": 240,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "durationSec": 8.0,
  "loop": true
}
```
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
present**: if the folder contains a `<basename>_frames/sequence.json`
for a referenced video, the parser pulls
`<basename>_frames/frame_000001.png` as a still image asset and binds
that to the image node instead of the `.mov`. The `<ImageSequence>`
mimeType becomes `image/png`. (PNG-sequence playback is the deferred
follow-up; this round just makes the still work end-to-end.)

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
    0`) shows red rows but still enables the re-import button so the
    operator can proceed with the videos that did convert.
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
  no `..`, no whitespace tricks.
* Manual `folderPath` is allowed ONLY through the dev plugin and ONLY
  in dev mode; the plugin is registered behind `config.command ===
  "serve"`.
* `folderPath` is required to be absolute and to contain
  `Resources/Textures` before any spawn happens.
* No frontend code attempts to `spawn` ffmpeg or use `ffmpeg.wasm`.
* Production bundles do not ship the endpoint or any `child_process`
  dependency.

## Testing

| Layer | Test | File |
|-------|------|------|
| Pure   | `classifyMovAssets` returns withSequence + withoutSequence | `src/editor/import/w3dFolder.test.ts` (new) |
| Pure   | `parseW3DFromFolder` resolves `<name>_frames/frame_000001.png` when sequence.json present | same |
| Pure   | `parseW3DFromFolder` falls back to `.mov` when no sequence | same |
| Core   | `runMovConversion` skips when sequence.json exists and !force | `scripts/movConversion.test.mjs` (new) |
| Core   | `runMovConversion` returns FFMPEG_NOT_INSTALLED sentinel when spawn fails with ENOENT | same |
| Core   | `runMovConversion` validates folderPath structure | same |
| Endpoint | `projectName` with `..` rejected as INVALID_PROJECT_NAME | `src/server/movConvertPlugin.test.mjs` (new) |
| Endpoint | unknown `projectName` returns PROJECT_PATH_NOT_FOUND with `manualPathAllowed: true` | same |
| Endpoint | `folderPath` outside any safe root still works in dev | same |
| Modal | renders only when withoutSequence.length > 0 | `src/editor/react/components/MovConversionModal.test.tsx` (new) |
| Modal | dev mode: Convert and Import calls fetch with projectName | same |
| Modal | build mode: shows CLI command + Copy button | same |
| Modal | Cancel calls onCancel and does not POST | same |
| Wiring | App: classifyMovAssets short-circuits when no .mov | new App test or extension of existing |

`runMovConversion` integration with real ffmpeg is **not** tested in
CI (no ffmpeg in sandbox); the spawn is mocked. The CLI is exercised
locally via `node scripts/convert-w3d-mov-to-sequence.mjs "<dir>"`.

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

Small commits, each green:

1. `Extract sequence.json shape + classifyMovAssets pure helper` — type
   + pure function + unit tests, no UI.
2. `Add scripts/movConversion.mjs core + CLI wrapper` — Node lib + CLI
   + tests with mocked spawn.
3. `Importer prefers <name>_frames/sequence.json over .mov` — parser
   change + tests, behaviour-only.
4. `Add Vite dev plugin POST /api/w3d/convert-mov` — plugin + tests.
5. `MovConversionModal component` — UI + tests, no app wiring yet.
6. `App: open MovConversionModal during W3D folder import` — wiring +
   handle retention.
7. `Docs: w3d-mov-conversion.md operator guide`.

## What is explicitly NOT in this round

(Repeated for clarity; see "Non-goals" above.)

* PNG-sequence playback animator in `scene.ts`. The "Convert and
  Import" path produces a still image (first frame) for now. Animation
  is a follow-up plan.
* Anything touching `.vert` / `.ind`, `Size.YProp`, the colour
  fallback for unresolved external materials, or the skewed-mask
  AABB over-clip.

— end of design —
