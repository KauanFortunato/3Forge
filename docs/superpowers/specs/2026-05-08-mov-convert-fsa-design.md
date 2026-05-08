# Convert and Import via File System Access (design)

**Date:** 2026-05-08
**Branch:** `feat/w3d-scene-support`
**Status:** approved by user (manifest + per-frame fetch transport, 4-subagent split)
**Supersedes the path-based flow in:** `2026-05-06-w3d-mov-conversion-design.md`

## Problem

The current "Convert and Import" flow requires the backend to know an absolute
project path on disk. It resolves that path from `R3_PROJECTS_ROOT`
(server-side env var) plus a `projectName`, with a hardcoded fallback to one
developer's machine. On any other PC the modal shows:

> "Folder path on disk C:\Users\you\R3\Projects\Qa R3_PROJECTS_ROOT did not resolve"

…and asks the user to paste a manual absolute path. This is acceptable for a
CLI script, not for an editor.

Goals:

1. On the happy path (Chromium + dev server), Convert and Import works without
   `R3_PROJECTS_ROOT`, without manual path input, without system-wide ffmpeg,
   and without a placeholder `C:\Users\you\…` string anywhere in the UI.
2. The browser's chosen directory handle (from `showDirectoryPicker`) is the
   single source of truth for *where* frames are written.
3. Memory stays bounded — a 5 s × 60 fps `.mov` (~300 PNGs at ~1 MB each)
   must not buffer the whole sequence in RAM at any layer.
4. The legacy path-based flow remains reachable as an explicit fallback (no
   FSA, no readwrite permission, or production build with no dev backend).

## Non-goals

* In-browser conversion (`ffmpeg.wasm`) — bundle weight + UI thread blocking.
* Streaming multipart transport — possible future optimisation; manifest +
  per-frame fetch wins on simplicity for this round.
* `.vert` / `.ind` / `Size.YProp` work — out of scope, untouched.
* Renderer changes beyond what existed after Revision 1 of the 2026-05-06 spec.
* Desktop / Electron packaging — only an aside note.

## Architecture overview

```
[showDirectoryPicker mode:"read"]
        │
        ▼
[importer scans] ──► .mov without sibling sequence.json ──► open MovConversionModal
        │                                                        │
        │                                          click "Convert and Import"
        │                                                        │
        │                                                        ▼
        │                              rootHandle.requestPermission({mode:"readwrite"})
        │                                                        │
        │                                       per .mov (concurrency = 1 mov at a time):
        │                                         ├─ POST /api/w3d/convert-mov  (multipart upload)
        │                                         │     backend: ffmpeg-static → temp dir
        │                                         │     returns manifest (see §Manifest)
        │                                         ├─ ensure <root>/Resources/Textures/<stem>_frames/
        │                                         ├─ write sequence.json via FSA
        │                                         ├─ for each frame in batches of N=4:
        │                                         │     fetch GET frame URL → write PNG via FSA
        │                                         │     onProgress("Writing frame K/total")
        │                                         └─ DELETE /api/w3d/convert-mov/jobs/<jobId>
        │                                                        │
        ▼                                                        ▼
[re-walk same directory handle, parseW3DFromFolder, instantiate ImageSequencePlayer]
```

Key invariant: **the backend never sees the user's project folder path.** It
operates entirely inside `os.tmpdir()/r3-mov/<jobId>/`. The frontend is the
only writer to the user's chosen folder, via FSA `createWritable()`.

## Backend (movConvertPlugin.mjs / movConversion.mjs)

### Endpoints

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `POST`   | `/api/w3d/convert-mov`                              | `multipart/form-data` with field `file` (the `.mov` blob) and `filename` | `Manifest` JSON (see below) |
| `GET`    | `/api/w3d/convert-mov/jobs/:jobId/frames/:name`     | —                          | `image/png` for one frame |
| `DELETE` | `/api/w3d/convert-mov/jobs/:jobId`                  | —                          | `{ ok: true }` |

### Manifest shape

```jsonc
{
  "jobId": "uuid-v4",
  "source": "intro.mov",
  "sequenceJson": {
    "version": 1,
    "type": "image-sequence",
    "source": "intro.mov",
    "framePattern": "frame_%06d.png",
    "frameCount": 120,
    "fps": 0,
    "width": 0,
    "height": 0,
    "durationSec": 0,
    "loop": true,
    "alpha": true,
    "pixelFormat": "rgba"
  },
  "frameCount": 120,
  "fps": 0,
  "alpha": true,
  "frames": [
    {
      "index": 1,
      "filename": "frame_000001.png",
      "url": "/api/w3d/convert-mov/jobs/<jobId>/frames/frame_000001.png",
      "sizeBytes": 184392
    }
    // …
  ],
  "ffmpegSource": "static" | "system" | "env"
}
```

`sequenceJson` is the *exact byte content* the frontend will write to disk
(the frontend can stringify it or pass it through as-is). `fps` / `width` /
`height` / `durationSec` stay 0 in this round — ffprobe wiring is still
intentionally minimal, matching the precursor spec.

### ffmpeg invocation (unchanged from current code)

```
ffmpeg -y -i <tmp>/source.mov -vsync 0 -pix_fmt rgba \
       -start_number 1 <tmp>/frames/frame_%06d.png
```

Probing priority: `FFMPEG_PATH` env → system `ffmpeg` on PATH → `ffmpeg-static`
package. If none, return HTTP 500 with `code: "FFMPEG_NOT_INSTALLED"` and an
`installHint` string ("run `npm install` from repo root"). With `ffmpeg-static`
promoted to runtime deps (§Packaging), this only triggers when `node_modules`
is missing.

### Temp dir lifecycle

* Root: `os.tmpdir()/r3-mov/`. Subdirs `<jobId>/source.mov` and
  `<jobId>/frames/frame_*.png`.
* DELETE handler deletes `<jobId>/` and removes the in-memory job entry.
* Boot-time sweep: on plugin init, `rm -rf` any `<jobId>/` whose mtime is
  older than 24 h — guards against page-closed-mid-conversion leaks.
* Job entries hold `{ jobId, framesDir, totalFrames, createdAt }` in a
  `Map` for the GET handler to validate URLs.

### Removed / quarantined

* `resolveFolder()` and the `R3_PROJECTS_ROOT` lookup are removed from the
  happy path. The legacy `POST { projectName | folderPath }` request shape
  is retained behind a `legacy=1` query param for the fallback flow (§Modal).
* The error code `PROJECT_PATH_NOT_FOUND` is no longer reachable from the
  new flow (still returned by the legacy code path).

### Errors

| Code                    | When                                              | UI handling |
|---|---|---|
| `FFMPEG_NOT_INSTALLED`  | No ffmpeg found in any of the 3 sources           | Modal shows installHint verbatim |
| `MOV_DECODE_FAILED`     | ffmpeg exited non-zero or produced 0 frames       | Per-mov failure entry |
| `UPLOAD_TOO_LARGE`      | Request body exceeded limit (default 2 GB)        | Per-mov failure entry |
| `JOB_NOT_FOUND`         | GET/DELETE for unknown jobId                      | 404, frontend marks frame failed |

## Frontend orchestrator (`src/editor/import/movConvertViaFSA.ts`, new)

```ts
type ConvertProgress =
  | { phase: "uploading";   movName: string; movIndex: number; movTotal: number }
  | { phase: "writing-frame"; movName: string; frame: number; total: number }
  | { phase: "writing-json"; movName: string }
  | { phase: "cleanup";     movName: string }
  | { phase: "done" }
  | { phase: "cancelled" };

export interface ConvertAndWriteOptions {
  rootHandle: FileSystemDirectoryHandle;
  movFiles: { file: File; relPath: string }[]; // from collectFilesFromDirectory
  signal: AbortSignal;
  onProgress: (p: ConvertProgress) => void;
  frameConcurrency?: number; // default 4
}

export interface ConvertAndWriteResult {
  converted: { mov: string; framesDir: string }[];
  skipped: { mov: string; reason: "already-has-sequence" }[];
  failed: { mov: string; error: string; failedFrames?: string[] }[];
}

export async function convertAndWriteFrames(
  opts: ConvertAndWriteOptions,
): Promise<ConvertAndWriteResult>;
```

### Algorithm

1. Verify `await rootHandle.requestPermission({ mode: "readwrite" })` is
   `"granted"`. If not, throw `PermissionDeniedError` (caught by modal which
   pivots to fallback).
2. For each .mov in `movFiles` (one at a time — sequential between movs):
   1. Determine target dir: descend `Resources/Textures/<stem>_frames/`
      starting from `rootHandle`, creating each segment with `{create:true}`.
   2. **Skip if already exists**: try `framesDir.getFileHandle("sequence.json")`
      — if it resolves and parse succeeds, push to `skipped` and continue
      to the next .mov. (Belt-and-braces: the modal already filters via
      `classifyMovAssets`, but a race between scan and convert is possible.)
   3. POST upload to `/api/w3d/convert-mov` with the File blob; get manifest.
      Honour `signal` — abort the fetch on cancel.
   4. Write `sequence.json`: stringify `manifest.sequenceJson`,
      `framesDir.getFileHandle("sequence.json", {create:true})
        .createWritable() → write → close`.
   5. Frame fetch loop with concurrency `N=4`:
      - Maintain a sliding window over `manifest.frames`.
      - For each slot: `fetch(frame.url, { signal })` → `.blob()` →
        `framesDir.getFileHandle(frame.filename, {create:true})
        .createWritable() → write(blob) → close`.
      - On each successful frame write, call
        `onProgress({ phase: "writing-frame", movName, frame: doneCount, total: frameCount })`.
      - Frame failures collect into a per-mov array; do not halt the .mov
        — finish the others, then emit one failure entry with `failedFrames`.
   6. `DELETE /api/w3d/convert-mov/jobs/<jobId>` (best-effort; failures
      logged but do not fail the .mov).
3. After the last .mov, return aggregate `ConvertAndWriteResult`.
4. The caller (App.tsx) then re-runs `collectFilesFromDirectory(rootHandle)`
   and calls `parseW3DFromFolder` again to refresh the imported scene.

### Cancellation

`signal.aborted` is checked at three boundaries: before each .mov, after
each frame batch, and inside the upload fetch (which forwards `signal` to
`fetch`). On cancel:
* In-flight uploads / GETs abort.
* Already-written files on disk are **not** rolled back (FSA writes are
  durable; rolling back would require knowing what we wrote, and partial
  state is acceptable — re-running Convert and Import is idempotent
  thanks to the skip-if-exists check).
* Best-effort DELETE on the current jobId.
* `onProgress({ phase: "cancelled" })` then a thrown `AbortError`.

## Modal & fallback (`MovConversionModal.tsx` + `App.tsx`)

### Default modal (FSA + dev backend reachable)

```
┌─ MOV videos detected ──────────────────────────┐
│ 3 video(s) need conversion to play in editor:  │
│   • intro.mov                                  │
│   • door_anim.mov                              │
│   • boss_loop.mov                              │
│                                                │
│  [ Convert and Import ]   [ Import Without     │
│                             Converting ]       │
│                                  [ Cancel ]    │
└────────────────────────────────────────────────┘
```

No path placeholder, no manual input, no `R3_PROJECTS_ROOT` mention.

### In-progress state (after Convert and Import is clicked)

```
┌─ Converting MOV videos ────────────────────────┐
│ intro.mov                                      │
│   Writing frame 25/120 …                       │
│   [████████░░░░░░░░░░░░] 21%                   │
│                                                │
│ Pending: door_anim.mov, boss_loop.mov          │
│                                                │
│  [ Cancel ]                                    │
└────────────────────────────────────────────────┘
```

* Progress text format is exactly `Writing frame K/total` (per success
  criterion #6).
* Cancel calls `controller.abort()`.
* The modal stays mounted until either all conversions complete or
  cancellation finishes.

### Fallback modal

Triggered when any of:
1. `window.showDirectoryPicker` is undefined (Firefox / Safari) — the user
   reached the modal via `<input webkitdirectory>` and we have no writeable
   handle.
2. `rootHandle.requestPermission({ mode: "readwrite" })` returned `"denied"`.
3. `POST /api/w3d/convert-mov` returned 404 (production build, no dev plugin).
4. `POST /api/w3d/convert-mov` returned `FFMPEG_NOT_INSTALLED`.

Shows:
* A short reason string (one of "Your browser can't write back to the
  picked folder.", "Permission to write was denied.", "No local converter
  is available in this build.", "ffmpeg is not installed — run `npm install`").
* The CLI command from the precursor spec:
  `npm run convert:mov -- --folder "<absolute path>"`.
* An optional manual path input (only when (3) — the legacy server flow).
* No `R3_PROJECTS_ROOT` mention; that env var is documented in the README,
  not surfaced as user-facing text.

## Packaging

* `ffmpeg-static@^5.2.0` moves from `devDependencies` to `dependencies`.
  Today it's already used by the dev plugin (which is dev-only), so dev
  is the only consumer; promotion gives idempotency for any contributor
  who skipped `--save-dev` or who runs `npm install --production`.
* `installHint` literal: `"run 'npm install' from repo root"` — shown
  verbatim by the modal on `FFMPEG_NOT_INSTALLED`.
* Aside (out of scope, document only): for any future desktop bundle
  (Electron / Tauri), `ffmpeg-static` must be unpacked from the asar
  archive for `spawn()` to find the binary. Not implemented here.

## Tests

### Unit / integration (Vitest)

| Test file | Focus |
|---|---|
| `scripts/movConvertPlugin.test.ts` (new)    | POST upload → manifest shape, GET frame returns PNG, DELETE removes temp dir, GET unknown jobId → 404, FFMPEG_NOT_INSTALLED path |
| `src/editor/import/movConvertViaFSA.test.ts` (new) | Mock `fetch` + mock `FileSystemDirectoryHandle`. Asserts: nested dir creation, sequence.json written first, frames written under `<stem>_frames/`, skip-if-exists, cancellation mid-frame leaves no in-flight writes, partial frame failures collected per-mov |
| `src/editor/react/components/MovConversionModal.test.tsx` (update) | New default UI has no path input; in-progress state shows "Writing frame K/N"; fallback variants render with the right reason string |
| `scripts/movConversion.test.ts` (existing) | Unchanged; still covers the underlying ffmpeg orchestration |
| `w3d.audit.test.ts`, `w3d.gameNameFs.dump.test.ts`, `w3d.realScenes.test.ts` | Unchanged; they read fixtures from disk and do not exercise the new HTTP flow |

### QA smoke (manual)

1. Fresh checkout, no `R3_PROJECTS_ROOT` env, no system ffmpeg, `npm install` done.
2. `npm run dev`, open editor.
3. Pick a W3D folder containing un-converted `.mov` files via showDirectoryPicker.
4. Modal shows new copy (no path placeholder).
5. Click Convert and Import. Permission prompt appears (read → readwrite upgrade).
6. Progress shows `Writing frame K/N` ticking up.
7. After completion, `Resources/Textures/<stem>_frames/sequence.json` and
   `frame_000001.png … frame_NNNNNN.png` exist on disk.
8. Re-import is automatic; `__r3Dump()` shows image-sequence nodes; Media
   panel shows `SEQUENCE` badges.
9. Re-run Convert and Import — already-converted files appear under
   "skipped: already has sequence".
10. Cancel mid-conversion — no crash, partial frames remain on disk, modal closes.
11. Deny readwrite permission — fallback variant renders.
12. `npm test` green.

## Out of scope (explicit non-changes)

* `.vert` / `.ind` mesh loader — untouched.
* `Size.YProp` animations — untouched.
* Renderer / `ImageSequencePlayer` internals — untouched (last touched in
  commits 1611bfb / 7ecacb5 / 63d4462; behaviour preserved).
* Persisting `frameUrls` in localStorage — the strip from commit 63d4462
  stays.
* ffprobe wiring for fps/width/height — still 0 placeholder, same as
  the precursor spec.

## Subagent split (for the implementation phase)

| Subagent | Scope (writes) | Depends on |
|---|---|---|
| **Backend Job API**         | `scripts/movConvertPlugin.mjs`, `scripts/movConversion.mjs`, new `scripts/movConvertPlugin.test.ts` | — |
| **Frontend FSA Writer**     | `src/editor/import/movConvertViaFSA.ts` (new), small helpers in `src/editor/import/w3dFolder.ts` (`getNestedHandle`), new `movConvertViaFSA.test.ts` | Manifest shape from §Backend |
| **Progress / Cancel UX**    | `src/editor/react/components/MovConversionModal.tsx`, call sites in `src/editor/react/App.tsx`, update `MovConversionModal.test.tsx` | Frontend FSA Writer's `ConvertProgress` type and `signal` contract |
| **QA / Regression**         | The QA smoke list above + `npm test` triage; no production-code writes | All three of the above |

Backend Job API and Frontend FSA Writer can run in parallel as long as both
honour the manifest schema in §Backend. Progress / Cancel UX serialises
after Frontend FSA Writer (same module owns the progress contract). QA is
last.

## Success criteria (from the brief, restated)

1. Convert and Import works without `R3_PROJECTS_ROOT`. ✓ Backend never reads it on the new path.
2. No manual path input on the happy path. ✓ Default modal has no path field.
3. No system-wide ffmpeg requirement. ✓ `ffmpeg-static` promoted to deps.
4. No giant ZIP. ✓ Manifest + per-frame fetch.
5. Frames never all in memory. ✓ Concurrency-4 sliding window.
6. Real progress. ✓ `Writing frame K/N` text per frame.
7. `*_frames/sequence.json` and PNGs land in the picked folder. ✓ FSA writes.
8. Auto re-import after conversion. ✓ `collectFilesFromDirectory` + `parseW3DFromFolder` re-run.
9. `npm test` green. ✓ Unit tests + QA smoke.
