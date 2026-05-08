# W3D `.mov` → image sequence v2 (design)

**Date:** 2026-05-08
**Branch:** `feat/w3d-scene-support`
**Status:** awaiting user review
**Supersedes:** the PNG-only schema established by `docs/superpowers/specs/2026-05-08-mov-convert-fsa-design.md`. Pipeline transport (FSA + manifest + per-frame fetch) is preserved; this v2 layers a WebP-first encoder, a versioned schema, a hardened resolver, click-to-play media UX, and visibility-gated scene playback on top.

## Problem

The existing `.mov` conversion pipeline writes PNG frames into `<basename>_frames/sequence.json` v1. It works, but four classes of regression have shown up across the recent commits on this branch:

1. PNG sequences sometimes appeared as a static photo in the Media panel rather than a SEQUENCE.
2. Sequences sometimes failed to surface in the Media panel at all when registration races happened (commits 1611bfb, 510b1bb, 3842b85 patched specific symptoms).
3. The viewport occasionally rendered a magenta debug texture at full size when a sequence frame failed to load (commit 7ecacb5 introduced the discrete fallback; this spec locks the rule).
4. PNG sequences are 25 to 50% bigger than necessary; storage and IO cost compounds when scenes have multiple `.mov` sources.

Goals:

1. Convert `.mov` to **WebP lossless** per-frame by default; alpha and RGB are bit-perfect, files are smaller than PNG.
2. Keep PNG as an **automatic fallback** when the WebP encoder is unavailable or fails a per-job smoke test, with a recorded `fallbackReason` and inline modal copy.
3. Resolve sequences in a deterministic priority order, reading both v2 (`format` field) and v1 (legacy PNG) without renaming or reconverting legacy folders.
4. Render the Media panel asset as a real SEQUENCE (badge, format/alpha subline, static first-frame thumbnail with click-to-play overlay, repair flow when metadata is missing).
5. Tick `ImageSequencePlayer` only while its bound `Object3D.visible === true`. Player stays registered during invisibility and resumes from the same frame when it flips back. No magenta in the normal viewport ever.
6. None of the goals require `R3_PROJECTS_ROOT`, manual paths, or system-installed `ffmpeg`. The `ffmpeg-static` runtime dep already covers it; this spec adds a runtime probe for libwebp.

## Non-goals

- Bind sequence playback to `AnimationTimeline.currentFrame`. Deferred to v3, called out in the docstring.
- Any global play/pause toggle in the editor. Deferred to v3.
- ffprobe wiring for `width` / `height` / `durationSec`. Stays at `0` placeholder where unknown, **except `fps`** which always lands at a safe positive value (see schema).
- Migrating legacy `<basename>_frames/` PNG folders to WebP. Future feature: an explicit `Convert legacy PNG sequence to WebP` button. Not in this spec.
- Animated `.webp` (single-file animation). We stay on per-frame WebP — scrubbable, fixable, drop-in for the existing per-frame loader.
- `.vert` / `.ind` mesh loader. Untouched.
- `Size.YProp` animations. Untouched.

## Background — what already exists

| Layer | Today | v2 changes |
|---|---|---|
| Backend conversion | `runMovConversionInTemp` writes PNG frames to `tmpdir/<jobId>/frames` | Add encoder probe + dual-format runner + smoke test |
| HTTP transport | POST upload → manifest → GET per frame → DELETE | Manifest carries `format`, `fallbackReason`, frame URLs match format extension |
| FSA writer | `movConvertViaBackend.ts` writes `sequence.json` + frames into picked folder | Reads `format` from manifest, writes target folder name accordingly |
| Modal | Three-action UI + per-mov progress | Per-file final state shows `format · frameCount · fps · alpha` and `fallbackReason` if any |
| Resolver in `w3d.ts` | Detects `<basename>_frames/sequence.json`, auto-repairs missing JSON | Extended priority chain + format-aware repair |
| ImageAssetsPanel | Sequence-aware rendering, autoplay thumbnail (commit 899c8b7) | Static first-frame thumbnail + Play overlay, click-to-play, format/alpha subline, repair badge |
| `ImageSequencePlayer` | Ticks every frame via `playerClock.getDelta()`, regardless of visibility | Visibility-gated tick: skip when `boundObject3D.visible === false`, preserve state |
| Discrete fallback | Commit 7ecacb5 already replaced magenta with a transparent placeholder for missing frames | Codify as invariant + a single debug opt-in flag |

## Schema v2 — `sequence.json`

```jsonc
{
  "version": 2,
  "type": "image-sequence",
  "format": "webp",
  "source": "intro.mov",
  "framePattern": "frame_%06d.webp",
  "frameCount": 120,
  "fps": 25,
  "width": 1920,
  "height": 1080,
  "durationSec": 4.8,
  "loop": true,
  "alpha": true,
  "pixelFormat": "rgba",
  "fallbackReason": "webp_encoder_unavailable"
}
```

Field rules:

- `version` — `2` for new writes. `1` accepted on read (treated as `format: "png"`).
- `format` — `"webp"` or `"png"`. Mandatory in v2. v1 reads default to `"png"`.
- `framePattern` — extension MUST match `format`. Mismatch is a hard error: resolver rejects the file with code `SEQUENCE_FORMAT_MISMATCH` and the Media panel shows `"Sequence metadata mismatch"` + Repair button.
- `fps` — **always `> 0`**. If ffprobe unavailable or returns 0, the writer substitutes `25`. The reader treats `fps <= 0` as corrupt and triggers Repair.
- `width`, `height`, `durationSec` — `0` allowed when unknown (no behaviour depends on them).
- `alpha` — `true` for both WebP lossless (`pix_fmt rgba`) and PNG (`pix_fmt rgba`). Recorded for the Media panel subline.
- `fallbackReason` — present only when the writer fell back from WebP to PNG. Values: `"webp_encoder_unavailable"`, `"webp_validation_failed"`. Surfaced verbatim in the modal final-state list and stripped before any export.

### Constants and types

A new `src/editor/import/sequenceSchema.ts` (or extension of `w3d.ts`) defines:

```ts
export const SEQUENCE_SCHEMA_VERSION = 2;
export type SequenceFormat = "webp" | "png";
export interface SequenceJsonV2 { /* matches the JSON above */ }
export interface SequenceJsonV1 { /* legacy, format implicit "png" */ }
export type SequenceJson = SequenceJsonV1 | SequenceJsonV2;
```

Reader returns a normalised v2 shape, defaulting `format: "png"` for v1.

## Resolver priority

For each `<basename>.mov` referenced by the W3D scene (`Resources/Textures/<basename>.mov`):

1. `<basename>_webp_frames/sequence.json` — use it.
2. `<basename>_png_frames/sequence.json` — use it.
3. `<basename>_frames/sequence.json` (v1 legacy or v2 unsuffixed) — use it; if v1, normalise format to `"png"` in memory; if no JSON exists but `frame_NNNNNN.png|webp` files do, auto-repair (see Repair flow).
4. `<basename>.mov` itself, if the browser supports decoding it as a `VideoTexture` — use the existing video path. Existing behaviour, unchanged.
5. Safe placeholder: a 1×1 transparent texture, plus a `console.warn` with the resolution chain that was tried. **Never** magenta in the normal viewport.

`<basename>_frames/` legacy folders are read but never renamed, never reconverted, never deleted by this v2.

### Repair flow (frames present, JSON missing or corrupt)

Detection: walking the folder finds N matching `frame_NNNNNN.{webp|png}` files but no readable `sequence.json`, or the JSON has `fps <= 0` or `framePattern` mismatch.

Branch A — pattern is unambiguous:
- All filenames match a single 6-digit pattern, count > 1, single extension.
- → auto-generate `sequence.json` with detected `format`, `framePattern`, `frameCount`, `fps: 25`, `loop: true`, `alpha: true`.
- → `console.info("Sequence metadata was missing and has been auto-generated for <basename>")`.
- → Media panel shows a small `auto-repaired` badge next to SEQUENCE; no error styling.

Branch B — pattern is ambiguous:
- Mixed extensions in the folder, gaps in numbering, or `frameCount === 1`.
- → no auto-write.
- → Media panel shows `Sequence metadata missing` with a `Repair` button. Clicking opens a small dialog (extension picker if mixed, fps input pre-filled with 25). Confirm writes `sequence.json` and re-runs the resolver.

## Conversion pipeline

### Encoder probe

`scripts/movConversion.mjs` exposes `probeWebpEncoder()` which runs `ffmpeg -encoders` once per plugin process, scanning for `libwebp`. Result is cached on the plugin instance (`movConvertPlugin.mjs`). No I/O cost on subsequent jobs.

| Probe outcome | Behaviour |
|---|---|
| `libwebp` present | WebP path enabled |
| `libwebp` absent  | All jobs skip directly to PNG with `fallbackReason: "webp_encoder_unavailable"` |
| Probe failed (ffmpeg crash) | Treated as `libwebp` absent, logged with `code: "ENCODER_PROBE_FAILED"` |

### Per-job pipeline

```
runMovConversionInTemp({ movBuffer, filename, jobId, tempRoot, preferredFormat: "webp" })
  ├─ probe (cached)
  ├─ if encoder == "webp":
  │    ├─ ffmpeg ... -c:v libwebp -lossless 1 -compression_level 6 \
  │    │           -vsync 0 -pix_fmt rgba <jobDir>/frames/frame_%06d.webp
  │    ├─ smoke-test frame_000001.webp:
  │    │    extract one ground-truth PNG of frame 1 (`ffmpeg -i source.mov -vframes 1 ... frame_gt.png`)
  │    │    decode both to raw RGBA via two single-frame ffmpeg invocations
  │    │    (`-f rawvideo -pix_fmt rgba -` to stdout)
  │    │    Buffer.compare(rawWebp, rawPng) must be 0 (lossless contract)
  │    │    on mismatch or decode error: discard webp frames, set
  │    │    fallbackReason="webp_validation_failed", fall through to PNG
  │    └─ on success: write sequence.json with format="webp"
  └─ else (PNG path):
       ffmpeg -y -i source.mov -vsync 0 -pix_fmt rgba \
              -start_number 1 <jobDir>/frames/frame_%06d.png
       write sequence.json with format="png" (+ fallbackReason if applicable)
```

ffprobe wiring for fps/width/height stays out of scope. The writer always sets `fps: 25` when ffprobe is not available. If ffprobe IS wired in a follow-up, it must clamp returned `fps` to `Math.max(1, Math.round(detected))` before writing.

Smoke-test cost: ~30-80 ms for a single 1080p frame round-trip. Acceptable per .mov.

### Manifest shape

```jsonc
{
  "jobId": "uuid-v4",
  "source": "intro.mov",
  "format": "webp",
  "fallbackReason": null,
  "frameCount": 120,
  "alpha": true,
  "encoderSource": "static",
  "sequenceJson": { /* exact byte content per Schema v2 */ },
  "frames": [
    { "index": 1, "filename": "frame_000001.webp",
      "url": "/api/w3d/convert-mov/jobs/<jobId>/frames/frame_000001.webp",
      "sizeBytes": 14823 }
  ]
}
```

`fallbackReason` is `null` on the WebP success path, otherwise one of the two strings. The frontend displays it verbatim in the modal final list.

### Endpoints (unchanged from existing fsa spec)

| Method | Path | Body / Params | Response |
|---|---|---|---|
| POST | `/api/w3d/convert-mov` | raw body, `Content-Type: application/octet-stream`, `X-Filename` header | Manifest |
| GET  | `/api/w3d/convert-mov/jobs/:jobId/frames/:filename` | — | `image/webp` or `image/png` matching `format` |
| DELETE | `/api/w3d/convert-mov/jobs/:jobId` | — | `{ ok: true }` |

Errors keep the existing codes (`FFMPEG_NOT_INSTALLED`, `MOV_DECODE_FAILED`, `UPLOAD_TOO_LARGE`, `JOB_NOT_FOUND`). New: `ENCODER_PROBE_FAILED` (logged, not user-facing — falls back silently to PNG).

## Frontend orchestrator (`src/editor/import/movConvertViaBackend.ts`)

Existing module is extended, not replaced. Changes:

- `ConvertProgress` discriminated union gains a `format` field on `done` events.
- `ConvertAndWriteResult.converted[]` entries carry `{ mov, framesDir, format, fallbackReason? }`.
- `getNestedHandle` target dir uses `<stem>_<format>_frames/` naming derived from the manifest.
- The skip-if-exists guard checks the v2 priority chain, not just `<stem>_frames/`. If a sibling `<stem>_webp_frames/sequence.json` already exists, the .mov is skipped.

Cancellation, frame concurrency (4), and idempotency rules from the existing spec stay.

## Modal UX (`MovConversionModal.tsx`)

Default modal copy stays `"Convert and Import" / "Import Without Converting" / "Cancel"`. Two updates:

1. **In-progress per-mov line** — unchanged: `Writing frame K/N`.
2. **Final list, per .mov**:

```
intro.mov
  Converted to WebP sequence · 120 frames @ 25fps · alpha

door_anim.mov
  Converted to PNG sequence · 96 frames @ 25fps · alpha
  Reason: WebP encoder unavailable in this build

boss_loop.mov
  Converted to PNG sequence · 240 frames @ 25fps · alpha
  Reason: WebP validation failed
```

Tone: never red, never blocking, never a separate toast. Failures (decode error, frame count zero) keep the existing red-text per-mov pattern.

Fallback variants (no FSA, no readwrite, no dev backend) are unchanged — they predate v2.

## Media panel UX (`ImageAssetsPanel.tsx`)

### Tile layout

```
┌──────────────────────┐
│ [first frame  ]      │  intro.mov
│   ▶ (overlay)        │  SEQUENCE · 120 frames @ 25fps
│ [             ]      │  webp · alpha
└──────────────────────┘
```

- Thumbnail: static first frame (`frameUrls[0]`). No autoplay.
- Play overlay: small triangle, centred, visible on hover, on focus, and always when `frameCount > 1`.
- Click on thumbnail or overlay: toggle preview playback for this tile.
- Subline: `SEQUENCE · <frameCount> frames @ <fps>fps` on line 1, `<format> · <alpha|opaque>` on line 2.
- 1-frame edge case: subline reads `1 frame only`, no Play overlay.

### Discreet status badges

Three small grey pills sit next to the SEQUENCE badge, mutually exclusive (most-specific wins):

- `auto-repaired` — resolver auto-generated `sequence.json` (Branch A). Tooltip: `Sequence metadata was missing and has been auto-generated`.
- `legacy png` — resolved via priority layer 3 (`<basename>_frames/sequence.json`, v1). Tooltip: `Legacy PNG sequence — convert to WebP from the asset menu (future feature)`. The future migration button referenced in Non-goals attaches here.
- `fallback png` — resolved via `<basename>_png_frames/` whose `sequence.json` carries a non-null `fallbackReason`. Tooltip surfaces the reason verbatim.

When `Sequence metadata missing` (Branch B of repair flow), the tile shows the message in red and a `Repair` button. Clicking opens the small repair dialog. No SEQUENCE badge is shown until repair succeeds.

### Independent preview

The Media panel maintains its own `ImageSequencePlayer` instance per tile. Lifecycle:

- Created on first click-to-play, not on import.
- Disposed when the tile unmounts or when the user clicks Pause.
- Failures inside the preview player log a single warning and do not affect the scene player. The preview tile shows `Preview failed` in muted text; SEQUENCE badge stays.

This isolation is the explicit invariant: **the scene must never break because the preview broke**.

## Scene safety + visibility gating

### Visibility-gated tick

Change in `scene.ts`:

```ts
tick(deltaSec: number): void {
  if (!this.boundObject3D || !this.boundObject3D.visible) {
    return;
  }
  // ... existing tick logic, unchanged
}
```

`boundObject3D` is set when the player is registered against a scene `Object3D`. Player retains `currentFrame` and the loaded frame cache while invisible; resumes from `currentFrame` when visibility flips back to `true`. No timer reset; the tick gap is treated like dropped frames.

Edge cases:
- Enable=False (XML) → `node.visible` already `false` (commit a671d90) → no tick. PITCH_Out stays hidden, no frame loads.
- Enable=True, normal flow → ticks. PITCH_IN plays.
- frustum/occlusion-based invisibility → not part of the gate by design; only the explicit visibility flag counts.

### No magenta invariant

In normal viewport rendering:
- Missing texture data on the active frame → use the previous successfully bound frame, or the first frame of the sequence, or a 1×1 transparent placeholder. Order: previous > first > transparent.
- Never substitute the THREE.js default magenta material. The discrete-fallback material from commit 7ecacb5 is the canonical implementation; this spec freezes it as an invariant covered by a regression test.

### Debug opt-in

`window.__r3DebugBrokenTextures = true` (browser console only) re-enables a magenta+grid debug texture for missing frames. Off by default. Not a setting, not in CLAUDE.md, not in the editor UI.

## Subagent split

| Agent | Owns (writes) | Depends on |
|---|---|---|
| **A1 — Schema + Resolver** | `src/editor/import/sequenceSchema.ts` (new types/constants), resolver changes in `w3d.ts`, repair helper, version-1 compat reads | none |
| **A2 — Conversion + WebP encoder** | `scripts/movConversion.mjs` (probe, dual-format runner, smoke test), `scripts/movConvertPlugin.mjs` (manifest fields) | A1 schema |
| **A3 — Conversion UX** | `MovConversionModal.tsx` per-file format/reason rendering, ConvertProgress.done shape | A2 manifest |
| **A4 — Media Panel UX** | `ImageAssetsPanel.tsx` static thumbnail + Play overlay + click-to-play + subline format · alpha + auto-repaired badge + Repair dialog | A1 schema |
| **A5 — Scene Safety + Visibility Gating** | `scene.ts` `ImageSequencePlayer.tick` visibility gate, no-magenta invariant test, debug flag wiring | A1 schema |
| **A6 — QA / Regression** | New tests across all areas + baseline triage; no production-code writes | A1 to A5 |

A1 lands first. A2, A4, A5 fan out in parallel after A1. A3 serialises after A2's manifest contract. A6 closes the cycle.

## Tests

### Unit / integration (Vitest)

| File | Focus |
|---|---|
| `src/editor/import/sequenceSchema.test.ts` (new) | Schema v2 round-trip, v1 read normalisation, `fps <= 0` rejection, framePattern/format mismatch rejection |
| `src/editor/import/w3d.test.ts` (extend) | Resolver priority order across all 5 layers, legacy `_frames/` still read, auto-repair Branch A and Branch B detection |
| `scripts/movConversion.test.mjs` (extend) | `probeWebpEncoder()` returns deterministic flag, dual-format runner writes correct extension, smoke test fails → falls back to PNG with reason, libwebp absent → falls back with `webp_encoder_unavailable` |
| `scripts/movConvertPlugin.test.mjs` (extend) | Manifest carries `format` and `fallbackReason`, frame URL extension matches |
| `src/editor/import/movConvertViaBackend.test.ts` (extend) | Format-derived target dir naming, skip-if-exists honours v2 priority chain |
| `src/editor/react/components/MovConversionModal.test.tsx` (extend) | Per-file final state copy: WebP vs PNG vs PNG-with-reason |
| `src/editor/react/components/ImageAssetsPanel.test.tsx` (extend) | Static thumbnail (no autoplay), Play overlay click toggles preview, subline format · alpha rendering, auto-repaired badge, Repair button for ambiguous case, preview failure does not break scene |
| `src/editor/scene.test.ts` (extend) | Tick skipped when `visible === false`, currentFrame preserved across visibility flip, no-magenta invariant on missing frame, debug flag re-enables magenta |

### Phase 0 baseline (Agent A6 captures before any production writes)

- `npm test` — record green/red, file failures into the spec or a baseline file.
- `npm run typecheck` — known pre-existing errors at the time of writing:
  - `MovConversionModal.test.tsx` — `toBeInTheDocument` not on Assertion (jest-dom types missing).
  - `scene.test.ts` — type narrowing failures around `addNode({name, parentId})` argument shape.
  - `scene.ts` lines 1007-1101 — `never` typing around scene mesh helpers.
  - `scene.ts` lines 1653-1657 — HTMLImageElement vs HTMLCanvasElement assignment, error event signature mismatch.
- A6 separates **pre-existing** errors from **new** errors introduced by v2. Only new errors block the merge.

### Manual QA smoke

1. Fresh clone, no `R3_PROJECTS_ROOT`, no system ffmpeg, `npm install` done, `npm run dev`.
2. Pick a W3D folder via showDirectoryPicker. Click `Convert and Import`.
3. WebP encoder available: `_webp_frames/` written, modal shows `Converted to WebP sequence`, Media panel SEQUENCE badge shows `webp · alpha`.
4. Force WebP off (set `FFMPEG_DISABLE_WEBP=1` env): `_png_frames/` written, modal shows `Converted to PNG sequence — WebP encoder unavailable in this build`.
5. Force smoke-test failure (test-only env hook): `_png_frames/` written, modal shows `Reason: WebP validation failed`.
6. Project containing legacy `<basename>_frames/` PNG: resolver picks it, Media panel shows `legacy png` discreet badge, no rename, no reconvert.
7. Folder where `sequence.json` was deleted but PNG frames remain: tile shows `auto-repaired` badge, scene plays normally.
8. Folder with mixed-extension frames and no JSON: tile shows `Sequence metadata missing` + Repair button, clicking writes JSON.
9. Toggle a node visibility off in the scene (Enable=False or programmatic): the corresponding ImageSequencePlayer freezes on `currentFrame`. Toggle back: resumes.
10. Force a frame fetch failure (devtools network throttle/block): viewport shows previous frame or transparent placeholder, **never magenta**. Set `__r3DebugBrokenTextures = true` in console: now shows magenta. Reset.
11. `npm test` and `npm run typecheck` show no new errors vs the Phase 0 baseline.

## Success criteria (restated)

1. WebP lossless is the default conversion output when libwebp is available. ✓ encoder probe + per-job WebP path.
2. PNG is the automatic fallback. ✓ `webp_encoder_unavailable` and `webp_validation_failed` paths.
3. Modal explains the format outcome inline per .mov. ✓ Modal final list copy.
4. `sequence.json` v2 with `format` and optional `fallbackReason`. ✓ Schema section.
5. `fps` is never `0` on disk; reader rejects/repairs `fps <= 0`. ✓ Schema fps rule + Repair flow.
6. Resolver priority: webp → png → legacy → mov → safe placeholder. ✓ Resolver section.
7. Legacy `<basename>_frames/` is read, never renamed or reconverted. ✓ Resolver layer 3 + Non-goals.
8. Media panel shows SEQUENCE badge, format/alpha subline, static thumbnail with click-to-play. ✓ Tile layout.
9. Auto-repair sequence.json when pattern is unambiguous; explicit Repair UI when ambiguous. ✓ Repair flow A/B.
10. ImageSequencePlayer ticks only while `boundObject3D.visible === true`; state preserved across flips. ✓ Visibility gating.
11. No magenta in normal viewport. Debug flag opt-in only. ✓ No-magenta invariant.
12. Preview failure does not affect the scene. ✓ Independent preview player invariant.
13. Convert and Import works on a fresh PC without `R3_PROJECTS_ROOT`, manual paths, or system ffmpeg. ✓ Inherited from existing FSA spec.
14. `npm test` no new failures vs baseline. `npm run typecheck` no new errors vs documented pre-existing list.

## Out of scope (explicit non-changes)

- `.vert` / `.ind` / `Size.YProp` work.
- `AnimationTimeline.currentFrame` sync (deferred to v3).
- Global play/pause toggle (deferred to v3).
- Animated `.webp` (single-file).
- ffprobe wiring (placeholder zeros allowed for everything except fps).
- Migrating legacy `<basename>_frames/` to WebP.
- Persisting `frameUrls` in localStorage (the strip from commit 63d4462 stays).

## Implementation note for the planner

Phase 2 commits (per the user's brief):

1. `feat(sequence): schema v2 with format and resolver priority`
2. `feat(convert): webp encoder probe and dual-format runner with png fallback`
3. `feat(import): zero-config webp conversion via fsa`
4. `feat(media): sequence tile with click-to-play preview and repair flow`
5. `fix(scene): visibility-gated tick and no-magenta invariant`
6. `test: regression coverage for v2 schema, fallback, visibility, repair`

Commit subject style: lowercase scope, no em-dash, simple punctuation. (Per the user's guidance on this branch.)
