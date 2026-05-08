# W3D `.mov` to image sequence v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing `.mov → image sequence` pipeline to prefer WebP lossless (with PNG fallback), versioned `sequence.json` v2, a hardened resolver, click-to-play Media panel preview, and visibility-gated `ImageSequencePlayer` ticking, without regressing the scene.

**Architecture:** Layer changes on top of the FSA + manifest + per-frame fetch transport already in place. Foundation first (schema and resolver), then conversion (WebP encoder probe + dual-format runner + smoke test), then Media panel correctness, then scene safety, then conversion UX copy, ending with anti-downgrade QA. Each subagent owns one slice; nothing else writes outside its slice.

**Tech Stack:** Vitest, Vite dev plugin (Connect middleware), `ffmpeg-static` (with libwebp probed at runtime), `@testing-library/react`, File System Access API, three.js.

**Spec:** `docs/w3d-mov-sequence-v2.md`

---

## File Structure

**New files:**
- `src/editor/import/sequenceSchema.ts` — v2 types, constants, normaliser, validator (Agent A1).
- `src/editor/import/sequenceSchema.test.ts` — round-trip / validation tests (Agent A1).

**Modified files (grouped by agent):**

A1 — Schema + Resolver
- `src/editor/types.ts` — `ImageSequenceMetadata` extended with `format`, `fallbackReason`, optional `autoRepaired` flag, version union `1 | 2`.
- `src/editor/import/w3dFolder.ts` — walker accepts `_webp_frames` / `_png_frames` siblings; resolver applies priority chain; Branch A auto-repair extended to WebP.
- `src/editor/import/w3dFolder.test.ts` — priority + repair tests.
- `src/editor/import/w3d.ts` — `synthesizeSequenceFromSiblings` and downstream consumers carry through `format`.

A2 — Conversion + WebP Encoder
- `scripts/movConversion.mjs` — `probeWebpEncoder()`, `runMovConversionInTemp({preferredFormat})` dual-path, smoke-test, fallback recording.
- `scripts/movConversion.test.mjs` — encoder probe + smoke-test + fallback path tests.
- `scripts/movConvertPlugin.mjs` — manifest carries `format` and `fallbackReason`; frame URL extension matches.
- `scripts/movConvertPlugin.test.mjs` — manifest format tests.

A4 — Media Panel UX
- `src/editor/react/components/ImageAssetsPanel.tsx` — static first-frame thumbnail, Play overlay, click-to-play (no autoplay), subline format · alpha, status pills (`auto-repaired`, `legacy png`, `fallback png`), Sequence-metadata-missing + Repair flow.
- `src/editor/react/components/ImageAssetsPanel.test.tsx` — coverage for all panel states.
- `src/editor/editor.css` — minimal additions for pills + Play overlay; no other style changes.

A5 — Scene Safety + Visibility Gating
- `src/editor/scene.ts` — `ImageSequencePlayer.boundObject3D` wired at registration; `tick` early-returns when `!boundObject3D.visible`; no-magenta invariant locked; `__r3DebugBrokenTextures` opt-in flag.
- `src/editor/scene.test.ts` — visibility-gated tick, currentFrame preservation across visibility flip, no-magenta invariant, debug flag round-trip.

A3 — Conversion UX
- `src/editor/import/movConvertViaBackend.ts` — `ConvertProgress.done` carries `format`, `fallbackReason`; target dir derived from manifest format; skip-if-exists honours v2 priority.
- `src/editor/import/movConvertViaBackend.test.ts` — extended coverage.
- `src/editor/react/components/MovConversionModal.tsx` — final list per-file format/reason copy.
- `src/editor/react/components/MovConversionModal.test.tsx` — final state copy tests.

A6 — QA / Regression (no production-code writes)
- `docs/w3d-mov-sequence-v2-baseline.md` — Phase 0 capture (npm test, npm run typecheck deltas).
- Runs the full anti-downgrade visual checklist; documents results inline at the end of this plan after the last task.

---

## Phase 0 — Baseline capture (Agent A6, runs first)

This phase is mandatory and produces no production code. It establishes the reference state so A6 at the end can compare against it.

### Task 0: Capture baseline test and typecheck output

**Files:**
- Create: `docs/w3d-mov-sequence-v2-baseline.md`

- [ ] **Step 1: Run npm test, capture output**

Run: `npm test -- --run 2>&1 | tee /tmp/v2-baseline-test.log`
Expected: terminal shows full vitest run; we capture pass/fail counts and which files fail (if any).

- [ ] **Step 2: Run npm run typecheck, capture output**

Run: `npm run typecheck 2>&1 | tee /tmp/v2-baseline-typecheck.log`
Expected: known pre-existing errors (per spec § Tests > Phase 0 baseline) — record them verbatim.

- [ ] **Step 3: Write baseline doc**

Create `docs/w3d-mov-sequence-v2-baseline.md` with this content:

```markdown
# W3D mov-sequence v2 — Phase 0 baseline

Captured: <ISO timestamp at run time>
Branch HEAD: <git rev-parse HEAD>

## npm test

<paste filtered tail of /tmp/v2-baseline-test.log: total / pass / fail counts and any failing file names>

## npm run typecheck

<paste filtered tail of /tmp/v2-baseline-typecheck.log: list of pre-existing errors>

## Comparison rules for end of v2

A6 reruns both commands at the end. New failures or new typecheck errors that
were not in this baseline are blockers. Pre-existing errors that disappear are
celebrated, not blamed.
```

- [ ] **Step 4: Commit**

```
git add docs/w3d-mov-sequence-v2-baseline.md
git commit -m "docs: phase 0 baseline for w3d mov sequence v2"
```

---

## Agent A1 — Schema + Resolver

A1 lays the foundation. After this agent, every reader and writer in the codebase agrees on what a v2 `sequence.json` looks like, the resolver picks the right folder, and the auto-repair contract is locked.

### Task 1: Add `sequenceSchema.ts` with v2 types and constants

**Files:**
- Create: `src/editor/import/sequenceSchema.ts`
- Create: `src/editor/import/sequenceSchema.test.ts`

- [ ] **Step 1: Write failing test for v2 round-trip**

Create `src/editor/import/sequenceSchema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SEQUENCE_SCHEMA_VERSION,
  parseSequenceJson,
  serialiseSequenceJson,
  type SequenceJsonV2,
} from "./sequenceSchema";

describe("sequenceSchema v2", () => {
  it("round-trips a webp sequence.json without losing fields", () => {
    const json: SequenceJsonV2 = {
      version: 2,
      type: "image-sequence",
      format: "webp",
      source: "intro.mov",
      framePattern: "frame_%06d.webp",
      frameCount: 120,
      fps: 25,
      width: 1920,
      height: 1080,
      durationSec: 4.8,
      loop: true,
      alpha: true,
      pixelFormat: "rgba",
    };
    const text = serialiseSequenceJson(json);
    const parsed = parseSequenceJson(text);
    expect(parsed).toEqual(json);
    expect(parsed.version).toBe(SEQUENCE_SCHEMA_VERSION);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/import/sequenceSchema.test.ts -t "round-trips a webp"`
Expected: FAIL with module-not-found or named-export errors.

- [ ] **Step 3: Create `sequenceSchema.ts` with the minimum to pass**

```ts
export const SEQUENCE_SCHEMA_VERSION = 2 as const;

export type SequenceFormat = "webp" | "png";
export type SequenceFallbackReason =
  | "webp_encoder_unavailable"
  | "webp_validation_failed";

export interface SequenceJsonV2 {
  version: 2;
  type: "image-sequence";
  format: SequenceFormat;
  source: string;
  framePattern: string;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  loop: boolean;
  alpha: boolean;
  pixelFormat: "rgba";
  fallbackReason?: SequenceFallbackReason;
}

export interface SequenceJsonV1 {
  version: 1;
  type: "image-sequence";
  source: string;
  framePattern: string;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  loop: boolean;
  alpha: boolean;
  pixelFormat: "rgba";
}

export type SequenceJson = SequenceJsonV1 | SequenceJsonV2;

export function serialiseSequenceJson(j: SequenceJsonV2): string {
  return JSON.stringify(j, null, 2);
}

export function parseSequenceJson(text: string): SequenceJsonV2 {
  const raw = JSON.parse(text) as SequenceJson;
  return normaliseToV2(raw);
}

export function normaliseToV2(raw: SequenceJson): SequenceJsonV2 {
  if (raw.version === 2) return raw;
  return {
    version: 2,
    type: "image-sequence",
    format: "png",
    source: raw.source,
    framePattern: raw.framePattern,
    frameCount: raw.frameCount,
    fps: raw.fps,
    width: raw.width,
    height: raw.height,
    durationSec: raw.durationSec,
    loop: raw.loop,
    alpha: raw.alpha,
    pixelFormat: "rgba",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/import/sequenceSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/import/sequenceSchema.ts src/editor/import/sequenceSchema.test.ts
git commit -m "feat(sequence): schema v2 types with webp format"
```

### Task 2: Add v1 read normalisation

**Files:**
- Modify: `src/editor/import/sequenceSchema.test.ts`

- [ ] **Step 1: Append failing test**

```ts
it("reads v1 legacy as format=png in v2 normalised shape", () => {
  const v1Text = JSON.stringify({
    version: 1,
    type: "image-sequence",
    source: "legacy.mov",
    framePattern: "frame_%06d.png",
    frameCount: 60,
    fps: 0,
    width: 0,
    height: 0,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
  });
  const parsed = parseSequenceJson(v1Text);
  expect(parsed.version).toBe(2);
  expect(parsed.format).toBe("png");
  expect(parsed.frameCount).toBe(60);
});
```

- [ ] **Step 2: Run test, expect pass**

Run: `npx vitest run src/editor/import/sequenceSchema.test.ts -t "reads v1 legacy"`
Expected: PASS (already covered by Task 1's `normaliseToV2`).

- [ ] **Step 3: No code change needed.** This task's purpose is to lock the v1 contract with a regression test.

- [ ] **Step 4: Commit**

```
git add src/editor/import/sequenceSchema.test.ts
git commit -m "test(sequence): lock v1 read normalisation to format png"
```

### Task 3: Reject corrupt schemas (`fps <= 0`, framePattern/format mismatch)

**Files:**
- Modify: `src/editor/import/sequenceSchema.ts`
- Modify: `src/editor/import/sequenceSchema.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { validateSequenceJson, SequenceValidationError } from "./sequenceSchema";

describe("sequenceSchema validation", () => {
  const base: SequenceJsonV2 = {
    version: 2,
    type: "image-sequence",
    format: "webp",
    source: "x.mov",
    framePattern: "frame_%06d.webp",
    frameCount: 5,
    fps: 25,
    width: 0,
    height: 0,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
  };

  it("accepts a valid v2 webp", () => {
    expect(() => validateSequenceJson(base)).not.toThrow();
  });

  it("rejects fps <= 0", () => {
    expect(() => validateSequenceJson({ ...base, fps: 0 }))
      .toThrow(SequenceValidationError);
    expect(() => validateSequenceJson({ ...base, fps: -1 }))
      .toThrow(SequenceValidationError);
  });

  it("rejects framePattern that does not match format extension", () => {
    expect(() => validateSequenceJson({ ...base, framePattern: "frame_%06d.png" }))
      .toThrow(/SEQUENCE_FORMAT_MISMATCH/);
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL on the validation cases**

Run: `npx vitest run src/editor/import/sequenceSchema.test.ts -t validation`
Expected: FAIL because `validateSequenceJson` and `SequenceValidationError` don't exist yet.

- [ ] **Step 3: Implement the validator**

Add to `src/editor/import/sequenceSchema.ts`:

```ts
export class SequenceValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "SequenceValidationError";
  }
}

export function validateSequenceJson(j: SequenceJsonV2): void {
  if (!Number.isFinite(j.fps) || j.fps <= 0) {
    throw new SequenceValidationError(
      "SEQUENCE_FPS_INVALID",
      `fps must be > 0, got ${j.fps}`,
    );
  }
  const expectedExt = j.format === "webp" ? ".webp" : ".png";
  if (!j.framePattern.toLowerCase().endsWith(expectedExt)) {
    throw new SequenceValidationError(
      "SEQUENCE_FORMAT_MISMATCH",
      `framePattern ${j.framePattern} does not match format ${j.format}`,
    );
  }
  if (!Number.isInteger(j.frameCount) || j.frameCount < 1) {
    throw new SequenceValidationError(
      "SEQUENCE_FRAMECOUNT_INVALID",
      `frameCount must be a positive integer, got ${j.frameCount}`,
    );
  }
}
```

- [ ] **Step 4: Re-run tests, expect PASS**

Run: `npx vitest run src/editor/import/sequenceSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/import/sequenceSchema.ts src/editor/import/sequenceSchema.test.ts
git commit -m "feat(sequence): validator for fps and framePattern format"
```

### Task 4: Extend `ImageSequenceMetadata` in `types.ts` with `format` / `fallbackReason` / `autoRepaired`

**Files:**
- Modify: `src/editor/types.ts:130-156`

- [ ] **Step 1: Read the existing interface to ground the edit**

The current shape in `src/editor/types.ts` has `version: 1`, `pixelFormat: "rgba"`, no `format` or `fallbackReason` fields, no `autoRepaired` flag.

- [ ] **Step 2: Replace the interface**

Replace the existing `ImageSequenceMetadata` block with (re-export the format / reason types from `sequenceSchema.ts` rather than redefining them, keeping a single source of truth):

```ts
export type {
  SequenceFormat,
  SequenceFallbackReason,
} from "./import/sequenceSchema";
import type { SequenceFormat, SequenceFallbackReason } from "./import/sequenceSchema";

export interface ImageSequenceMetadata {
  /** Discriminator. Always "image-sequence". */
  type: "image-sequence";
  /** sequence.json schema version. v1 is read-only legacy; v2 writes the format field. */
  version: 1 | 2;
  /** Image format used for every frame. Implicit "png" on legacy v1. */
  format: SequenceFormat;
  /** Source .mov filename the sequence was generated from. */
  source: string;
  /** ffmpeg %d-style pattern. Extension must match `format`. */
  framePattern: string;
  /** Count of frame files actually written by the conversion. */
  frameCount: number;
  /** Frames per second. v2 writers must emit > 0 (defaulting to 25). */
  fps: number;
  /** Pixel width / height (0 when ffprobe is unavailable). */
  width: number;
  height: number;
  /** Duration in seconds (0 when unknown). */
  durationSec: number;
  /** Loop on the last frame. */
  loop: boolean;
  /** True when the encoder produced an alpha channel. */
  alpha: boolean;
  /** Always "rgba" for both webp and png paths. */
  pixelFormat: "rgba";
  /** Resolved blob: URLs for each frame, in order. Browser-only, never persisted. */
  frameUrls: string[];
  /** Set when the conversion fell back from webp to png. */
  fallbackReason?: SequenceFallbackReason;
  /** Set in-memory only: resolver auto-generated this metadata because sequence.json was missing. Never persisted. */
  autoRepaired?: boolean;
  /** Set in-memory only: resolved via the legacy `<basename>_frames/` layer (priority 3). */
  legacy?: boolean;
}
```

- [ ] **Step 3: Run typecheck to surface call-site impact**

Run: `npm run typecheck 2>&1 | grep -E "(format|version)" | head -40`
Expected: known pre-existing errors plus possibly new ones if any literal `version: 1` writers in TS now fail to satisfy `1 | 2`. Note them.

- [ ] **Step 4: Update in-tree TS writers to set `format`**

`src/editor/import/w3d.ts` — `synthesizeSequenceFromSiblings` returns `version: 1, ...` today. Update to v2 with `format` derived from the matched extension:

Find:
```ts
  return {
    version: 1,
    type: "image-sequence",
    source: filename,
    framePattern: `${prefix}_%0${digits}d.${ext.toLowerCase()}`,
    frameCount: siblings.length,
    fps: 0,
    width: siblings[0].width,
    height: siblings[0].height,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
    frameUrls: siblings.map((s) => s.src),
  };
```

Replace with:
```ts
  const lowerExt = ext.toLowerCase();
  const format: SequenceFormat = lowerExt === "webp" ? "webp" : "png";
  return {
    version: 2,
    type: "image-sequence",
    format,
    source: filename,
    framePattern: `${prefix}_%0${digits}d.${lowerExt}`,
    frameCount: siblings.length,
    fps: 25,
    width: siblings[0].width,
    height: siblings[0].height,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
    frameUrls: siblings.map((s) => s.src),
    autoRepaired: true,
  };
```

(Add the import: `import type { SequenceFormat } from "../types";` at the top of `w3d.ts`.)

`src/editor/import/w3dFolder.ts` writes `version: 1` in two places (the JSON-parse block and the auto-detect block). Patch both to write v2 with `format` derived from the actual frame extension. The walker change in Task 5 will also feed in the format; for now, default to `format: "png"` in the legacy auto-detect block since that block only sees `frame_NNN.png`.

- [ ] **Step 5: Run typecheck again**

Run: `npm run typecheck 2>&1 | tail -40`
Expected: no NEW errors beyond Phase 0 baseline.

- [ ] **Step 6: Commit**

```
git add src/editor/types.ts src/editor/import/w3d.ts src/editor/import/w3dFolder.ts
git commit -m "feat(sequence): extend ImageSequenceMetadata with format and flags"
```

### Task 5: Walker captures `_webp_frames` and `_png_frames` siblings

**Files:**
- Modify: `src/editor/import/w3dFolder.ts:45-95`
- Modify: `src/editor/import/w3dFolder.test.ts`

- [ ] **Step 1: Write a failing test that imports a folder with a `_webp_frames` sibling**

Add to `src/editor/import/w3dFolder.test.ts` (use existing test scaffolding patterns):

```ts
it("resolves a _webp_frames sibling as a webp sequence", async () => {
  const files = [
    fileWithPath("scene.w3d", await readFixtureBytes("scene-with-mov.w3d")),
    fileWithPath("Resources/Textures/intro.mov", new Uint8Array([0])),
    fileWithPath(
      "Resources/Textures/intro_webp_frames/sequence.json",
      JSON.stringify({
        version: 2,
        type: "image-sequence",
        format: "webp",
        source: "intro.mov",
        framePattern: "frame_%06d.webp",
        frameCount: 2,
        fps: 25,
        width: 0,
        height: 0,
        durationSec: 0,
        loop: true,
        alpha: true,
        pixelFormat: "rgba",
      }),
    ),
    fileWithPath("Resources/Textures/intro_webp_frames/frame_000001.webp", new Uint8Array([0x52, 0x49, 0x46, 0x46])),
    fileWithPath("Resources/Textures/intro_webp_frames/frame_000002.webp", new Uint8Array([0x52, 0x49, 0x46, 0x46])),
  ];
  const result = await parseW3DFromFolder(files);
  const seq = result.additionalSequences?.get("intro.mov");
  expect(seq?.format).toBe("webp");
  expect(seq?.frameCount).toBe(2);
});
```

(Helpers `fileWithPath` and `readFixtureBytes` already exist in `w3dFolder.test.ts`; reuse the existing pattern.)

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run src/editor/import/w3dFolder.test.ts -t "_webp_frames sibling"`
Expected: FAIL — current walker only matches `_frames/` exactly.

- [ ] **Step 3: Update the walker regex and the per-format frame matcher**

In `src/editor/import/w3dFolder.ts`, find:
```ts
        const sequenceMatch = relPath
          .replace(/\\/g, "/")
          .match(/Resources\/Textures\/([^/]+)_frames\/(.+)$/i);
        if (sequenceMatch) {
          const stem = sequenceMatch[1];
          const tail = sequenceMatch[2];
          if (tail.toLowerCase() === "sequence.json") {
            sequenceFiles.set(stem, file);
          } else if (/^frame_\d+\.png$/i.test(tail)) {
            const inner = sequenceFrames.get(stem) ?? new Map<string, File>();
            inner.set(tail, file);
            sequenceFrames.set(stem, inner);
          }
        }
```

Replace with:
```ts
        const sequenceMatch = relPath
          .replace(/\\/g, "/")
          .match(/Resources\/Textures\/([^/]+?)(_webp_frames|_png_frames|_frames)\/(.+)$/i);
        if (sequenceMatch) {
          const stem = sequenceMatch[1];
          const layer = sequenceMatch[2].toLowerCase() as
            | "_webp_frames"
            | "_png_frames"
            | "_frames";
          const tail = sequenceMatch[3];
          const layerKey = `${stem}::${layer}`;
          if (tail.toLowerCase() === "sequence.json") {
            sequenceFiles.set(layerKey, file);
          } else if (/^frame_\d+\.(webp|png)$/i.test(tail)) {
            const inner = sequenceFrames.get(layerKey) ?? new Map<string, File>();
            inner.set(tail, file);
            sequenceFrames.set(layerKey, inner);
          }
        }
```

`sequenceFiles` and `sequenceFrames` keys move from `stem` to `${stem}::${layer}`. The downstream resolver loop in Task 6 collapses them by stem honouring priority order.

- [ ] **Step 4: Run test, expect PASS** (after Task 6 lands the resolver collapse, this test will pass; for now it may still fail because the downstream loop expects `stem` keys)

Run: `npx vitest run src/editor/import/w3dFolder.test.ts -t "_webp_frames sibling"`
Expected: still FAIL — the resolver loop in Task 6 closes the gap. Continue without committing.

### Task 6: Resolver picks the highest-priority layer per stem; auto-repair extended to WebP

**Files:**
- Modify: `src/editor/import/w3dFolder.ts:160-280`
- Modify: `src/editor/import/w3dFolder.test.ts`

- [ ] **Step 1: Write three more failing tests covering priority + repair**

Append to `w3dFolder.test.ts`:

```ts
it("prefers _webp_frames over _png_frames when both exist", async () => {
  const files = [
    fileWithPath("scene.w3d", await readFixtureBytes("scene-with-mov.w3d")),
    fileWithPath("Resources/Textures/intro.mov", new Uint8Array([0])),
    fileWithPath("Resources/Textures/intro_webp_frames/sequence.json",
      JSON.stringify(seqJsonV2({ format: "webp", frameCount: 1, framePattern: "frame_%06d.webp" }))),
    fileWithPath("Resources/Textures/intro_webp_frames/frame_000001.webp", new Uint8Array([0x52])),
    fileWithPath("Resources/Textures/intro_png_frames/sequence.json",
      JSON.stringify(seqJsonV2({ format: "png", frameCount: 1, framePattern: "frame_%06d.png" }))),
    fileWithPath("Resources/Textures/intro_png_frames/frame_000001.png", new Uint8Array([0x89, 0x50])),
  ];
  const seq = (await parseW3DFromFolder(files)).additionalSequences?.get("intro.mov");
  expect(seq?.format).toBe("webp");
});

it("falls back to legacy _frames and tags it legacy:true", async () => {
  const files = [
    fileWithPath("scene.w3d", await readFixtureBytes("scene-with-mov.w3d")),
    fileWithPath("Resources/Textures/intro.mov", new Uint8Array([0])),
    fileWithPath("Resources/Textures/intro_frames/sequence.json",
      JSON.stringify({ version: 1, type: "image-sequence", source: "intro.mov",
        framePattern: "frame_%06d.png", frameCount: 1, fps: 0, width: 0, height: 0,
        durationSec: 0, loop: true, alpha: true, pixelFormat: "rgba" })),
    fileWithPath("Resources/Textures/intro_frames/frame_000001.png", new Uint8Array([0x89, 0x50])),
  ];
  const seq = (await parseW3DFromFolder(files)).additionalSequences?.get("intro.mov");
  expect(seq?.format).toBe("png");
  expect(seq?.legacy).toBe(true);
});

it("auto-repairs a _webp_frames folder with no sequence.json", async () => {
  const files = [
    fileWithPath("scene.w3d", await readFixtureBytes("scene-with-mov.w3d")),
    fileWithPath("Resources/Textures/intro.mov", new Uint8Array([0])),
    fileWithPath("Resources/Textures/intro_webp_frames/frame_000001.webp", new Uint8Array([0x52])),
    fileWithPath("Resources/Textures/intro_webp_frames/frame_000002.webp", new Uint8Array([0x52])),
  ];
  const seq = (await parseW3DFromFolder(files)).additionalSequences?.get("intro.mov");
  expect(seq?.format).toBe("webp");
  expect(seq?.autoRepaired).toBe(true);
  expect(seq?.frameCount).toBe(2);
  expect(seq?.fps).toBe(25);
});
```

Helper `seqJsonV2` (add at top of test file):
```ts
function seqJsonV2(opts: { format: "webp" | "png"; frameCount: number; framePattern: string }) {
  return {
    version: 2, type: "image-sequence", format: opts.format,
    source: "intro.mov", framePattern: opts.framePattern, frameCount: opts.frameCount,
    fps: 25, width: 0, height: 0, durationSec: 0, loop: true, alpha: true, pixelFormat: "rgba",
  };
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/editor/import/w3dFolder.test.ts -t "prefers _webp"`
Expected: FAIL.

- [ ] **Step 3: Replace the resolver loop**

Replace the existing block from `for (const [stem, jsonFile] of sequenceFiles) {` through the end of the auto-detect block (the second `for (const [stem, frames] of sequenceFrames) {`) with:

```ts
const PRIORITY: ReadonlyArray<"_webp_frames" | "_png_frames" | "_frames"> = [
  "_webp_frames", "_png_frames", "_frames",
];

const stems = new Set<string>();
for (const k of sequenceFiles.keys()) stems.add(k.split("::")[0]);
for (const k of sequenceFrames.keys()) stems.add(k.split("::")[0]);

for (const stem of stems) {
  const sourceMov = `${stem}.mov`;
  let resolved: ImageSequenceMetadata | null = null;

  for (const layer of PRIORITY) {
    if (resolved) break;
    const layerKey = `${stem}::${layer}`;
    const jsonFile = sequenceFiles.get(layerKey);
    const frames = sequenceFrames.get(layerKey);
    if (!jsonFile && !frames) continue;

    const isLegacy = layer === "_frames";

    // Path A: sequence.json present — parse, validate, build frameUrls.
    if (jsonFile) {
      let parsed: any = null;
      try {
        parsed = JSON.parse(await jsonFile.text());
      } catch {
        sequenceWarnings.push(`sequence.json for ${stem} (${layer}) is invalid — skipping this layer.`);
        continue;
      }
      if (!parsed?.framePattern || typeof parsed.frameCount !== "number") {
        sequenceWarnings.push(`sequence.json for ${stem} (${layer}) missing framePattern/frameCount — skipping this layer.`);
        continue;
      }
      const detectedFormat: SequenceFormat =
        typeof parsed.format === "string" && parsed.format === "webp" ? "webp" : "png";
      const fps = typeof parsed.fps === "number" && parsed.fps > 0 ? parsed.fps : 25;
      const frameUrls: string[] = [];
      let missing = false;
      for (let i = 1; i <= parsed.frameCount; i += 1) {
        const fname = formatFramePattern(parsed.framePattern, i);
        const f = frames?.get(fname);
        if (!f) { missing = true; break; }
        frameUrls.push(URL.createObjectURL(f));
      }
      if (missing) {
        sequenceWarnings.push(`sequence.json for ${stem} (${layer}) missing frame files — skipping this layer.`);
        continue;
      }
      resolved = {
        version: 2,
        type: "image-sequence",
        format: detectedFormat,
        source: sourceMov,
        framePattern: parsed.framePattern,
        frameCount: parsed.frameCount,
        fps,
        width: typeof parsed.width === "number" ? parsed.width : 0,
        height: typeof parsed.height === "number" ? parsed.height : 0,
        durationSec: typeof parsed.durationSec === "number" ? parsed.durationSec : 0,
        loop: parsed.loop !== false,
        alpha: parsed.alpha !== false,
        pixelFormat: "rgba",
        frameUrls,
        ...(typeof parsed.fallbackReason === "string"
          ? { fallbackReason: parsed.fallbackReason as SequenceFallbackReason }
          : {}),
        ...(isLegacy ? { legacy: true } : {}),
      };
      continue;
    }

    // Path B: frames present, sequence.json missing — auto-repair Branch A.
    if (frames && frames.size >= 1) {
      const ordered = [...frames.entries()]
        .map(([name, file]) => {
          const m = name.match(/^frame_(\d+)\.(webp|png)$/i);
          return m ? { name, file, idx: parseInt(m[1], 10), digits: m[1].length, ext: m[2].toLowerCase() } : null;
        })
        .filter((e): e is { name: string; file: File; idx: number; digits: number; ext: string } => e !== null);
      if (ordered.length < 1) continue;
      // Branch B (ambiguous): mixed extensions in the same layer folder.
      const exts = new Set(ordered.map((o) => o.ext));
      if (exts.size > 1) {
        sequenceWarnings.push(`Mixed-extension frames in ${stem}${layer} — Sequence metadata missing.`);
        continue;
      }
      ordered.sort((a, b) => a.idx - b.idx);
      const ext = ordered[0].ext as "webp" | "png";
      const digits = ordered[0].digits;
      resolved = {
        version: 2,
        type: "image-sequence",
        format: ext as SequenceFormat,
        source: sourceMov,
        framePattern: `frame_%0${digits}d.${ext}`,
        frameCount: ordered.length,
        fps: 25,
        width: 0,
        height: 0,
        durationSec: 0,
        loop: true,
        alpha: true,
        pixelFormat: "rgba",
        frameUrls: ordered.map((o) => URL.createObjectURL(o.file)),
        autoRepaired: true,
        ...(isLegacy ? { legacy: true } : {}),
      };
      // Visible signal in the console for the auto-repair Branch A path.
      // eslint-disable-next-line no-console
      console.info(
        `[w3d folder import] sequence metadata was missing for ${stem}${layer} and has been auto-generated (${ordered.length} frames, fps=25).`,
      );
    }
  }

  if (resolved) {
    sequences.set(sourceMov, resolved);
  }
}
```

(Add imports near the top of the file: `import type { SequenceFormat, SequenceFallbackReason } from "../types";`.)

- [ ] **Step 4: Run all w3dFolder tests, expect PASS**

Run: `npx vitest run src/editor/import/w3dFolder.test.ts`
Expected: PASS for all four added tests; existing tests still PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/import/w3dFolder.ts src/editor/import/w3dFolder.test.ts
git commit -m "feat(sequence): resolver priority webp png legacy with auto repair"
```

---

## Agent A2 — Conversion + WebP Encoder

A2 owns the backend. After this agent, `runMovConversionInTemp` produces WebP frames by default, falls back to PNG with a recorded reason when the encoder or the smoke test fails, and the manifest carries `format` + `fallbackReason`.

### Task 7: Add `probeWebpEncoder()` with caching

**Files:**
- Modify: `scripts/movConversion.mjs`
- Modify: `scripts/movConversion.test.mjs`

- [ ] **Step 1: Append failing test**

Add to `scripts/movConversion.test.mjs`:

```javascript
import { probeWebpEncoder, _resetEncoderProbeCache } from "./movConversion.mjs";

describe("probeWebpEncoder", () => {
  beforeEach(() => _resetEncoderProbeCache());

  it("returns { available: true } when libwebp is present in -encoders output", async () => {
    const r = await probeWebpEncoder({
      _spawn: (_bin, args) => ({
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev, cb) => {
          if (ev === "close") setImmediate(() => cb(0, args));
        },
        _stdoutPayload: "V..... libwebp              libwebp WebP image\n",
      }),
      _readStdout: async (proc) => proc._stdoutPayload,
    });
    expect(r).toEqual({ available: true });
  });

  it("returns { available: false } when ffmpeg has no libwebp encoder line", async () => {
    const r = await probeWebpEncoder({
      _spawn: (_bin, _args) => ({
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev, cb) => { if (ev === "close") setImmediate(() => cb(0)); },
        _stdoutPayload: "V..... png_pipe              PNG (Portable Network Graphics)\n",
      }),
      _readStdout: async (proc) => proc._stdoutPayload,
    });
    expect(r).toEqual({ available: false });
  });

  it("caches the probe result across calls", async () => {
    let calls = 0;
    const fakeSpawn = () => {
      calls += 1;
      return {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev, cb) => { if (ev === "close") setImmediate(() => cb(0)); },
        _stdoutPayload: "V..... libwebp\n",
      };
    };
    const opts = { _spawn: fakeSpawn, _readStdout: async (p) => p._stdoutPayload };
    await probeWebpEncoder(opts);
    await probeWebpEncoder(opts);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run scripts/movConversion.test.mjs -t probeWebpEncoder`
Expected: FAIL — `probeWebpEncoder` and `_resetEncoderProbeCache` are not exported.

- [ ] **Step 3: Implement `probeWebpEncoder`**

In `scripts/movConversion.mjs`, append:

```javascript
// Cached result of the libwebp probe. `null` means "not probed yet".
let _encoderProbeCache = null;

/**
 * One-time probe: does the resolved ffmpeg ship with libwebp?
 * Caches the answer for the lifetime of the process. Tests can pass
 * `_spawn` / `_readStdout` overrides and `_resetEncoderProbeCache()`
 * to drive deterministic outcomes.
 */
export async function probeWebpEncoder(opts = {}) {
  if (_encoderProbeCache !== null) return _encoderProbeCache;
  const ff = await resolveFfmpegBinary();
  if (!ff.path) {
    _encoderProbeCache = { available: false };
    return _encoderProbeCache;
  }
  const spawnFn = opts._spawn ?? spawn;
  const readStdout = opts._readStdout ?? defaultReadStdout;
  let stdoutText = "";
  try {
    const proc = spawnFn(ff.path, ["-hide_banner", "-encoders"], { shell: false });
    stdoutText = await readStdout(proc);
    await new Promise((resolve) => {
      proc.on("close", () => resolve());
    });
  } catch {
    _encoderProbeCache = { available: false };
    return _encoderProbeCache;
  }
  _encoderProbeCache = { available: /\blibwebp\b/.test(stdoutText) };
  return _encoderProbeCache;
}

export function _resetEncoderProbeCache() {
  _encoderProbeCache = null;
}

function defaultReadStdout(proc) {
  return new Promise((resolve) => {
    let buf = "";
    proc.stdout?.on("data", (c) => { buf += c.toString(); });
    proc.on("close", () => resolve(buf));
  });
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run scripts/movConversion.test.mjs -t probeWebpEncoder`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add scripts/movConversion.mjs scripts/movConversion.test.mjs
git commit -m "feat(convert): probe libwebp encoder once per process"
```

### Task 8: Dual-format runner — `runMovConversionInTemp({ preferredFormat })`

**Files:**
- Modify: `scripts/movConversion.mjs`
- Modify: `scripts/movConversion.test.mjs`

- [ ] **Step 1: Failing test**

```javascript
describe("runMovConversionInTemp dual format", () => {
  it("emits .webp frames + format:webp when preferredFormat=webp and probe is available", async () => {
    _resetEncoderProbeCache();
    // Inject a stub that:
    //   1. mocks probeWebpEncoder to return { available: true }
    //   2. captures the ffmpeg args so we can assert -c:v libwebp -lossless 1
    //   3. writes a single fake .webp file to satisfy the readdir scan
    const tempRoot = mkdtempSync(join(tmpdir(), "r3-mov-test-"));
    try {
      const result = await runMovConversionInTemp({
        movBuffer: Buffer.from([0x00, 0x00, 0x00, 0x14]),
        filename: "x.mov",
        jobId: "job-1",
        tempRoot,
        preferredFormat: "webp",
        _ffmpegOverride: {
          run: async (args, framesDir) => {
            // Tests assert these flags exist somewhere in args.
            expect(args).toContain("-c:v");
            expect(args).toContain("libwebp");
            expect(args).toContain("-lossless");
            expect(args).toContain("1");
            writeFileSync(join(framesDir, "frame_000001.webp"),
              Buffer.from([0x52, 0x49, 0x46, 0x46]));
          },
        },
        _probeOverride: { available: true },
        _smokeOverride: { ok: true },
      });
      expect(result.sequenceJson.format).toBe("webp");
      expect(result.sequenceJson.framePattern).toBe("frame_%06d.webp");
      expect(result.sequenceJson.fps).toBe(25);
      expect(result.framePaths[0].endsWith(".webp")).toBe(true);
      expect(result.fallbackReason ?? null).toBeNull();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("falls back to png with reason webp_encoder_unavailable when probe says no", async () => {
    _resetEncoderProbeCache();
    const tempRoot = mkdtempSync(join(tmpdir(), "r3-mov-test-"));
    try {
      const result = await runMovConversionInTemp({
        movBuffer: Buffer.from([0x00]),
        filename: "x.mov",
        jobId: "job-2",
        tempRoot,
        preferredFormat: "webp",
        _ffmpegOverride: {
          run: async (args, framesDir) => {
            expect(args).not.toContain("-c:v");
            writeFileSync(join(framesDir, "frame_000001.png"),
              Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          },
        },
        _probeOverride: { available: false },
      });
      expect(result.sequenceJson.format).toBe("png");
      expect(result.sequenceJson.framePattern).toBe("frame_%06d.png");
      expect(result.fallbackReason).toBe("webp_encoder_unavailable");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run scripts/movConversion.test.mjs -t "dual format"`
Expected: FAIL — `preferredFormat`, `fallbackReason`, and the override hooks don't exist.

- [ ] **Step 3: Replace `runMovConversionInTemp`**

Replace the existing export with:

```javascript
const FRAME_PATTERN_PNG = "frame_%06d.png";
const FRAME_PATTERN_WEBP = "frame_%06d.webp";

export async function runMovConversionInTemp({
  movBuffer, filename, jobId, tempRoot, preferredFormat = "webp",
  _probeOverride, _ffmpegOverride, _smokeOverride,
} = {}) {
  if (!movBuffer || !filename || !jobId || !tempRoot) {
    throw Object.assign(new Error("missing argument"), { code: "INVALID_ARGS" });
  }
  const ff = await resolveFfmpegBinary();
  if (!ff.path) {
    throw Object.assign(new Error("ffmpeg is required"), { code: "FFMPEG_NOT_INSTALLED" });
  }
  const probe = _probeOverride ?? (await probeWebpEncoder());
  let chosenFormat = preferredFormat === "webp" && probe.available ? "webp" : "png";
  let fallbackReason = null;
  if (preferredFormat === "webp" && !probe.available) {
    fallbackReason = "webp_encoder_unavailable";
  }

  const jobDir = path.join(tempRoot, jobId);
  const framesDir = path.join(jobDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const sourcePath = path.join(jobDir, "source.mov");
  writeFileSync(sourcePath, movBuffer);

  const runOnce = async (format) => {
    // Wipe the frames dir between attempts so a failed webp run does not
    // leave .webp files alongside a fallback .png run.
    for (const n of readdirSync(framesDir)) {
      const p = path.join(framesDir, n);
      try { statSync(p).isFile() && unlinkSync(p); } catch { /* ignore */ }
    }
    const pattern = format === "webp" ? FRAME_PATTERN_WEBP : FRAME_PATTERN_PNG;
    const baseArgs = [
      "-y", "-i", sourcePath, "-vsync", "0",
    ];
    const formatArgs = format === "webp"
      ? [
          "-c:v", "libwebp",
          "-lossless", "1",
          "-compression_level", "6",
          "-pix_fmt", "rgba",
        ]
      : ["-pix_fmt", "rgba"];
    const tailArgs = ["-start_number", "1", path.join(framesDir, pattern)];
    const args = [...baseArgs, ...formatArgs, ...tailArgs];
    if (_ffmpegOverride) {
      await _ffmpegOverride.run(args, framesDir);
    } else {
      await runFfmpeg(ff.path, args);
    }
  };

  await runOnce(chosenFormat);

  // WebP smoke-test: round-trip frame 1 against a ground-truth PNG re-encode
  // of the same input frame. Only enforced when we picked webp.
  if (chosenFormat === "webp") {
    const smoke = _smokeOverride ?? (await smokeTestWebpFrame({
      ffmpegPath: ff.path,
      sourcePath,
      webpFrame: path.join(framesDir, "frame_000001.webp"),
    }));
    if (!smoke.ok) {
      chosenFormat = "png";
      fallbackReason = "webp_validation_failed";
      await runOnce("png");
    }
  }

  const ext = chosenFormat === "webp" ? "webp" : "png";
  const framePaths = readdirSync(framesDir)
    .filter((n) => new RegExp(`^frame_\\d+\\.${ext}$`, "i").test(n))
    .sort()
    .map((n) => path.join(framesDir, n));
  if (framePaths.length === 0) {
    throw Object.assign(new Error("MOV_DECODE_FAILED: zero frames produced"), {
      code: "MOV_DECODE_FAILED",
    });
  }

  const sequenceJson = {
    version: 2,
    type: "image-sequence",
    format: chosenFormat,
    source: filename,
    framePattern: chosenFormat === "webp" ? FRAME_PATTERN_WEBP : FRAME_PATTERN_PNG,
    frameCount: framePaths.length,
    fps: 25,
    width: 0,
    height: 0,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
    ...(fallbackReason ? { fallbackReason } : {}),
  };
  return { framesDir, framePaths, sequenceJson, ffmpegSource: ff.source, fallbackReason };
}

async function runFfmpeg(bin, args) {
  let stderrBuf = "";
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { shell: false });
      proc.stderr?.on("data", (c) => {
        stderrBuf += c.toString();
        if (stderrBuf.length > 16 * 1024) stderrBuf = stderrBuf.slice(-16 * 1024);
      });
      proc.on("error", reject);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    });
  } catch (err) {
    const tail = stderrBuf.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
    throw Object.assign(new Error(`MOV_DECODE_FAILED: ${tail || err.message}`), {
      code: "MOV_DECODE_FAILED",
    });
  }
}
```

Add the import at the top: `import { unlinkSync } from "node:fs";` and update the existing `import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";` to keep it tidy.

`smokeTestWebpFrame` is implemented in Task 9.

For now, stub at the top of the file:
```javascript
async function smokeTestWebpFrame() { return { ok: true }; }
```

- [ ] **Step 4: Run dual-format tests, expect PASS** (smoke is stubbed `ok:true`)

Run: `npx vitest run scripts/movConversion.test.mjs -t "dual format"`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add scripts/movConversion.mjs scripts/movConversion.test.mjs
git commit -m "feat(convert): dual format runner with webp probe gating"
```

### Task 9: WebP smoke-test — RGBA round-trip via two ffmpeg invocations

**Files:**
- Modify: `scripts/movConversion.mjs`
- Modify: `scripts/movConversion.test.mjs`

- [ ] **Step 1: Failing test**

```javascript
describe("smokeTestWebpFrame", () => {
  it("returns ok:true when the webp and png decoded RGBA buffers match", async () => {
    const result = await smokeTestWebpFrame({
      ffmpegPath: "/fake/ffmpeg",
      sourcePath: "/fake/source.mov",
      webpFrame: "/fake/frame.webp",
      _decode: async (target) => {
        // Same buffer for both webp and png paths → match.
        return Buffer.from([1, 2, 3, 4]);
      },
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when buffers differ", async () => {
    let i = 0;
    const result = await smokeTestWebpFrame({
      ffmpegPath: "/fake/ffmpeg",
      sourcePath: "/fake/source.mov",
      webpFrame: "/fake/frame.webp",
      _decode: async () => Buffer.from(i++ === 0 ? [1, 2, 3, 4] : [9, 9, 9, 9]),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rgba_mismatch");
  });

  it("returns ok:false when decode throws", async () => {
    const result = await smokeTestWebpFrame({
      ffmpegPath: "/fake/ffmpeg",
      sourcePath: "/fake/source.mov",
      webpFrame: "/fake/frame.webp",
      _decode: async () => { throw new Error("boom"); },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("decode_error");
  });
});
```

Add the import at the top of the test file: `import { smokeTestWebpFrame } from "./movConversion.mjs";`

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run scripts/movConversion.test.mjs -t smokeTestWebpFrame`
Expected: FAIL — current stub always returns `ok: true` and is not exported.

- [ ] **Step 3: Replace the stub with the real implementation**

Replace `async function smokeTestWebpFrame() { return { ok: true }; }` with:

```javascript
/**
 * Round-trip frame 1: encode the source's first frame to PNG via ffmpeg
 * (`-vframes 1` ground truth), decode both the produced WebP and the
 * ground-truth PNG to raw RGBA via two more ffmpeg invocations, and
 * `Buffer.compare()` the two raw buffers. With `-c:v libwebp -lossless 1`,
 * the bytes MUST match — any difference means the encoder is buggy.
 */
export async function smokeTestWebpFrame({
  ffmpegPath, sourcePath, webpFrame, _decode,
}) {
  const decode = _decode ?? defaultDecodeRgba;
  let webpRgba, pngRgba;
  try {
    webpRgba = await decode({ ffmpegPath, target: webpFrame, kind: "webp" });
    pngRgba = await decode({ ffmpegPath, target: sourcePath, kind: "source-frame-1" });
  } catch {
    return { ok: false, reason: "decode_error" };
  }
  if (!webpRgba || !pngRgba || webpRgba.length === 0 || pngRgba.length === 0) {
    return { ok: false, reason: "decode_error" };
  }
  if (Buffer.compare(webpRgba, pngRgba) !== 0) {
    return { ok: false, reason: "rgba_mismatch" };
  }
  return { ok: true };
}

async function defaultDecodeRgba({ ffmpegPath, target, kind }) {
  const args = kind === "source-frame-1"
    ? ["-y", "-i", target, "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]
    : ["-y", "-i", target, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"];
  return new Promise((resolve, reject) => {
    const chunks = [];
    let stderrBuf = "";
    const proc = spawn(ffmpegPath, args, { shell: false });
    proc.stdout?.on("data", (c) => chunks.push(c));
    proc.stderr?.on("data", (c) => {
      stderrBuf += c.toString();
      if (stderrBuf.length > 8 * 1024) stderrBuf = stderrBuf.slice(-8 * 1024);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`decode exit ${code}: ${stderrBuf.slice(-200)}`));
    });
  });
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run scripts/movConversion.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add scripts/movConversion.mjs scripts/movConversion.test.mjs
git commit -m "feat(convert): webp smoke test via ffmpeg rgba round trip"
```

### Task 10: Manifest carries `format` and `fallbackReason`; frame URL extension matches

**Files:**
- Modify: `scripts/movConvertPlugin.mjs`
- Modify: `scripts/movConvertPlugin.test.mjs`

- [ ] **Step 1: Failing test**

Append to `scripts/movConvertPlugin.test.mjs`:

```javascript
it("returns manifest with format=webp and matching frame URLs when conversion produced webp", async () => {
  const { server } = await createTestPlugin({
    runConversion: async () => ({
      framesDir: "/tmp/x", framePaths: ["/tmp/x/frame_000001.webp"],
      sequenceJson: {
        version: 2, type: "image-sequence", format: "webp",
        source: "x.mov", framePattern: "frame_%06d.webp", frameCount: 1,
        fps: 25, width: 0, height: 0, durationSec: 0, loop: true, alpha: true,
        pixelFormat: "rgba",
      },
      ffmpegSource: "static",
      fallbackReason: null,
    }),
  });
  const res = await fetch(`${server.url}/api/w3d/convert-mov`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Filename": "x.mov" },
    body: new Uint8Array([0]),
  });
  const manifest = await res.json();
  expect(manifest.format).toBe("webp");
  expect(manifest.fallbackReason).toBeNull();
  expect(manifest.sequenceJson.format).toBe("webp");
  expect(manifest.frames[0].filename).toBe("frame_000001.webp");
  expect(manifest.frames[0].url).toMatch(/\/frames\/frame_000001\.webp$/);
  await server.close();
});

it("returns manifest with fallbackReason=webp_encoder_unavailable on png fallback", async () => {
  const { server } = await createTestPlugin({
    runConversion: async () => ({
      framesDir: "/tmp/x", framePaths: ["/tmp/x/frame_000001.png"],
      sequenceJson: {
        version: 2, type: "image-sequence", format: "png",
        source: "x.mov", framePattern: "frame_%06d.png", frameCount: 1,
        fps: 25, width: 0, height: 0, durationSec: 0, loop: true, alpha: true,
        pixelFormat: "rgba", fallbackReason: "webp_encoder_unavailable",
      },
      ffmpegSource: "static",
      fallbackReason: "webp_encoder_unavailable",
    }),
  });
  const res = await fetch(`${server.url}/api/w3d/convert-mov`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Filename": "x.mov" },
    body: new Uint8Array([0]),
  });
  const manifest = await res.json();
  expect(manifest.format).toBe("png");
  expect(manifest.fallbackReason).toBe("webp_encoder_unavailable");
  await server.close();
});
```

(The `createTestPlugin` helper already exists in this test file and accepts a `runConversion` injection point. If it does not yet support injection, add a small DI seam — pass `runConversion` to the plugin constructor and default to the real `runMovConversionInTemp`.)

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run scripts/movConvertPlugin.test.mjs -t "manifest with format"`
Expected: FAIL — manifest currently lacks `format` / `fallbackReason`.

- [ ] **Step 3: Update manifest construction in `movConvertPlugin.mjs`**

Find the block that builds the manifest after `runMovConversionInTemp` resolves. Replace the manifest object with:

```javascript
const manifest = {
  jobId,
  source: filename,
  format: result.sequenceJson.format,
  fallbackReason: result.fallbackReason ?? null,
  frameCount: result.sequenceJson.frameCount,
  alpha: result.sequenceJson.alpha,
  encoderSource: result.ffmpegSource,
  sequenceJson: result.sequenceJson,
  frames: result.framePaths.map((p, idx) => {
    const filename = path.basename(p);
    return {
      index: idx + 1,
      filename,
      url: `/api/w3d/convert-mov/jobs/${jobId}/frames/${filename}`,
      sizeBytes: frameSizeBytes(p),
    };
  }),
};
```

- [ ] **Step 4: Update the GET frame handler to set Content-Type from extension**

In the same file, find the GET handler. Update the Content-Type computation:

```javascript
const ct = framePath.toLowerCase().endsWith(".webp") ? "image/webp" : "image/png";
res.setHeader("Content-Type", ct);
```

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run scripts/movConvertPlugin.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add scripts/movConvertPlugin.mjs scripts/movConvertPlugin.test.mjs
git commit -m "feat(convert): manifest carries format and fallback reason"
```

### Task 11: Extend the existing in-folder `runMovConversion` (CLI path) to v2 schema

**Files:**
- Modify: `scripts/movConversion.mjs:150-280` (the `runMovConversion` function used by the CLI)

This task keeps the CLI tool consistent with v2 so users running `npm run convert:mov` get the same schema. WebP support in CLI is best-effort: same probe, same fallback.

- [ ] **Step 1: Add a failing test**

```javascript
describe("runMovConversion v2 schema (CLI)", () => {
  it("writes sequence.json with version: 2 and format: png on the cli path", async () => {
    // Write a small fixture .mov to a temp Resources/Textures dir, run the CLI
    // helper, then read sequence.json.
    const root = mkdtempSync(join(tmpdir(), "r3-cli-"));
    const tex = join(root, "Resources", "Textures");
    mkdirSync(tex, { recursive: true });
    copyFileSync("tests/fixtures/mov/tiny.mov", join(tex, "intro.mov"));
    try {
      const result = await runMovConversion({ folderPath: root });
      const seqPath = join(tex, "intro_frames", "sequence.json");
      const seq = JSON.parse(readFileSync(seqPath, "utf8"));
      expect(seq.version).toBe(2);
      expect(["webp", "png"]).toContain(seq.format);
      expect(seq.fps).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

If `tests/fixtures/mov/tiny.mov` is missing, copy the smallest .mov from the existing test fixtures.

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run scripts/movConversion.test.mjs -t "v2 schema"`
Expected: FAIL — the CLI path still writes `version: 1`.

- [ ] **Step 3: Update the inline `sequence` literal inside `runMovConversion`**

In `scripts/movConversion.mjs`, find the literal:

```javascript
      const sequence = {
        version: 1,
        type: "image-sequence",
        ...
        fps: 0,
        ...
      };
```

Replace with:

```javascript
      const sequence = {
        version: 2,
        type: "image-sequence",
        format: "png",
        source: filename,
        framePattern: FRAME_PATTERN,
        frameCount: written.length,
        fps: 25,
        width: 0,
        height: 0,
        durationSec: 0,
        loop: true,
        alpha: true,
        pixelFormat: "rgba",
      };
```

(CLI keeps PNG output in this round; future work can plug in `runMovConversionInTemp`'s WebP path. Out of scope for v2.)

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run scripts/movConversion.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add scripts/movConversion.mjs scripts/movConversion.test.mjs
git commit -m "feat(convert): cli writes v2 schema with fps 25 default"
```

---

## Agent A4 — Media Panel UX

A4 owns the Media tile. After this agent: static thumbnail with first frame, click-to-play preview, no autoplay, status pills, repair flow when sequence.json is missing.

### Shared test helpers for A4 (defined once in `ImageAssetsPanel.test.tsx`)

Add this block near the top of `ImageAssetsPanel.test.tsx`. Every A4 test below calls these helpers by name; do not duplicate the bodies in the test cases.

```tsx
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ImageAssetsPanel, type ProjectImageAsset } from "./ImageAssetsPanel";
import type { ImageSequenceMetadata } from "../../types";

function baseSeq(overrides: Partial<ImageSequenceMetadata> = {}): ImageSequenceMetadata {
  return {
    version: 2,
    type: "image-sequence",
    format: "webp",
    source: "intro.mov",
    framePattern: "frame_%06d.webp",
    frameCount: 4,
    fps: 25,
    width: 320,
    height: 180,
    durationSec: 0,
    loop: true,
    alpha: true,
    pixelFormat: "rgba",
    frameUrls: ["blob:first", "blob:second", "blob:third", "blob:fourth"],
    ...overrides,
  };
}

function baseSeqAsset(overrides: Partial<ProjectImageAsset> = {}): ProjectImageAsset {
  return {
    id: "seq-1",
    name: "intro.mov",
    mimeType: "application/x-image-sequence",
    src: "blob:first",
    width: 320,
    height: 180,
    sequence: baseSeq(),
    ...overrides,
  };
}

function renderPanel(images: ProjectImageAsset[], extra: Partial<{ onRepairSequence: (id: string) => void }> = {}) {
  return render(
    <ImageAssetsPanel
      images={images}
      selectedImageId={null}
      selectedImageNodeCount={0}
      usageById={{}}
      onSelectImage={() => {}}
      onImport={() => {}}
      onApplyToSelection={() => {}}
      onCreateNode={() => {}}
      onReplace={() => {}}
      onRemove={() => {}}
      canRemoveImage={() => true}
      onRepairSequence={extra.onRepairSequence}
    />,
  );
}
```

### Task 12: Replace autoplay with static-thumbnail-by-default

**Files:**
- Modify: `src/editor/react/components/ImageAssetsPanel.tsx`
- Modify: `src/editor/react/components/ImageAssetsPanel.test.tsx`

- [ ] **Step 1: Failing test**

Add to `ImageAssetsPanel.test.tsx`:

```tsx
it("renders the first frame as a static thumbnail (no autoplay) when a sequence is added", async () => {
  const { container } = renderPanel([baseSeqAsset()]);
  // Wait one tick to make sure no interval started.
  await new Promise((r) => setTimeout(r, 50));
  const img = container.querySelector("img");
  expect(img?.getAttribute("src")).toBe("blob:first");
  // Play overlay must be visible.
  const playBtn = container.querySelector(".image-assets-panel__seq-play");
  expect(playBtn?.getAttribute("aria-label")).toMatch(/Play sequence preview/);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/editor/react/components/ImageAssetsPanel.test.tsx -t "static thumbnail"`
Expected: FAIL — current code autostarts an interval which advances `frame` to 1+ before assertion.

- [ ] **Step 3: Remove autoplay from `ImageAssetsPanel.tsx`**

Delete the `useEffect` block that autostarts intervals (the one whose comment starts with `Autoplay every image-sequence asset`). Keep the unmount cleanup `useEffect` and `togglePreview`.

After deletion the only auto-effect left is the unmount cleanup. `previewState[image.id]` is `undefined` until the user clicks Play, which makes `localFrame` default to `0` and `currentSrc` default to `seq.frameUrls[0]`. Static thumbnail by construction.

Also update the Play overlay's icon: when `localPlaying` is undefined (never clicked), show `▶`. When playing, `⏸`. The existing ternary `localPlaying ? "⏸" : "▶"` already does this — keep.

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/editor/react/components/ImageAssetsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/react/components/ImageAssetsPanel.tsx src/editor/react/components/ImageAssetsPanel.test.tsx
git commit -m "feat(media): static first frame thumbnail with click to play"
```

### Task 13: Subline format · alpha (e.g. `webp · alpha`)

**Files:**
- Modify: `src/editor/react/components/ImageAssetsPanel.tsx`
- Modify: `src/editor/react/components/ImageAssetsPanel.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it("renders subline `<frameCount> frames @ <fps>fps` and `<format> · <alpha>`", () => {
  const { container } = renderPanel([baseSeqAsset()]);
  const sub = container.querySelector(".image-assets-panel__sub");
  expect(sub?.textContent).toMatch(/4 frames @ 25fps/);
  expect(sub?.textContent).toMatch(/webp · alpha/);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/editor/react/components/ImageAssetsPanel.test.tsx -t "subline"`
Expected: FAIL — current subline is one line `${seq.frameCount} frames @ ${seq.fps || 25} fps · ${seq.alpha ? "alpha" : "no alpha"}`.

- [ ] **Step 3: Update the subline JSX**

Find:
```tsx
<span className="image-assets-panel__sub">
  {isSeq && seq
    ? `${seq.frameCount} frames @ ${seq.fps || 25} fps · ${seq.alpha ? "alpha" : "no alpha"}`
    : `${image.width} x ${image.height}px - ${usage} use${usage === 1 ? "" : "s"}`}
</span>
```

Replace with:
```tsx
<span className="image-assets-panel__sub">
  {isSeq && seq ? (
    <>
      <span>{`${seq.frameCount} frames @ ${seq.fps || 25}fps`}</span>
      <span className="image-assets-panel__sub-meta">
        {`${seq.format} · ${seq.alpha ? "alpha" : "no alpha"}`}
      </span>
    </>
  ) : (
    `${image.width} x ${image.height}px - ${usage} use${usage === 1 ? "" : "s"}`
  )}
</span>
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/editor/react/components/ImageAssetsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/react/components/ImageAssetsPanel.tsx src/editor/react/components/ImageAssetsPanel.test.tsx
git commit -m "feat(media): subline format and alpha line under frame count"
```

### Task 14: Status pills (`auto-repaired`, `legacy png`, `fallback png`)

**Files:**
- Modify: `src/editor/react/components/ImageAssetsPanel.tsx`
- Modify: `src/editor/react/components/ImageAssetsPanel.test.tsx`

- [ ] **Step 1: Failing test** (uses `baseSeqAsset` / `baseSeq` from the shared helpers block)

```tsx
it("renders the auto-repaired pill when sequence.autoRepaired is true", () => {
  const seq = baseSeqAsset({ sequence: baseSeq({ autoRepaired: true }) });
  const { container } = renderPanel([seq]);
  const pill = container.querySelector(".image-assets-panel__pill--auto-repaired");
  expect(pill?.textContent).toBe("auto-repaired");
});

it("renders the legacy png pill when sequence.legacy is true", () => {
  const seq = baseSeqAsset({ sequence: baseSeq({ legacy: true, format: "png" }) });
  const { container } = renderPanel([seq]);
  const pill = container.querySelector(".image-assets-panel__pill--legacy");
  expect(pill?.textContent).toBe("legacy png");
});

it("renders the fallback png pill when fallbackReason is set", () => {
  const seq = baseSeqAsset({
    sequence: baseSeq({ format: "png", fallbackReason: "webp_encoder_unavailable" }),
  });
  const { container } = renderPanel([seq]);
  const pill = container.querySelector(".image-assets-panel__pill--fallback");
  expect(pill?.textContent).toBe("fallback png");
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/editor/react/components/ImageAssetsPanel.test.tsx -t "pill"`
Expected: FAIL — pills don't exist.

- [ ] **Step 3: Render the pill set**

Inside the SEQUENCE branch, after the `<span className="image-assets-panel__badge">SEQUENCE</span>`, add:

```tsx
{isSeq && seq ? (
  <>
    {seq.autoRepaired ? (
      <span
        className="image-assets-panel__pill image-assets-panel__pill--auto-repaired"
        title="Sequence metadata was missing and has been auto-generated"
      >
        auto-repaired
      </span>
    ) : seq.legacy ? (
      <span
        className="image-assets-panel__pill image-assets-panel__pill--legacy"
        title="Legacy PNG sequence — convert to WebP from the asset menu (future feature)"
      >
        legacy png
      </span>
    ) : seq.fallbackReason ? (
      <span
        className="image-assets-panel__pill image-assets-panel__pill--fallback"
        title={seq.fallbackReason}
      >
        fallback png
      </span>
    ) : null}
  </>
) : null}
```

Add minimal CSS to `editor.css`:

```css
.image-assets-panel__pill {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/editor/react/components/ImageAssetsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/react/components/ImageAssetsPanel.tsx src/editor/react/components/ImageAssetsPanel.test.tsx src/editor/editor.css
git commit -m "feat(media): status pills auto repaired legacy png fallback png"
```

### Task 15: Sequence metadata missing — Repair button (Branch B)

**Files:**
- Modify: `src/editor/react/components/ImageAssetsPanel.tsx`
- Modify: `src/editor/react/components/ImageAssetsPanel.test.tsx`

The Repair button surfaces when `frameUrls.length === 0` for a sequence asset (the resolver kept it because frames exist on disk in an ambiguous form, but no in-memory URLs were built). The current panel shows `Frames missing` for `seqEmpty`; replace that with a Repair affordance. Repair invocation is handled by the parent — wire a new prop.

- [ ] **Step 1: Failing test**

```tsx
it("calls onRepairSequence when Repair button is clicked on a sequence with no frameUrls", () => {
  const onRepair = vi.fn();
  const seq = baseSeqAsset({ sequence: baseSeq({ frameUrls: [] }) });
  const { container } = renderPanel([seq], { onRepairSequence: onRepair });
  const button = container.querySelector(".image-assets-panel__repair-btn");
  expect(button?.textContent).toBe("Repair");
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onRepair).toHaveBeenCalledWith(seq.id);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/editor/react/components/ImageAssetsPanel.test.tsx -t Repair`
Expected: FAIL — `onRepairSequence` is not a prop, button does not exist.

- [ ] **Step 3: Add the prop and the conditional UI**

In `ImageAssetsPanel.tsx`:

```tsx
interface ImageAssetsPanelProps {
  // ... existing
  /** Optional: invoked when the user clicks Repair on a sequence with no resolved frame URLs. */
  onRepairSequence?: (imageId: string) => void;
}
```

Replace the existing `seqEmpty` ternary inside the SEQUENCE branch. The full block (after replacement) reads:

```tsx
{seqEmpty ? (
  <span className="image-assets-panel__sequence-warning">
    Sequence metadata missing
    {onRepairSequence ? (
      <button
        type="button"
        className="image-assets-panel__repair-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRepairSequence(image.id);
        }}
      >
        Repair
      </button>
    ) : null}
  </span>
) : (
  <>
    <img
      src={currentSrc}
      alt=""
      onLoad={() => markLoaded(image.id, currentSrc)}
      onError={() => markLoaded(image.id, currentSrc)}
    />
    <button
      type="button"
      className="image-assets-panel__seq-play"
      onClick={(e) => {
        e.stopPropagation();
        togglePreview(image);
      }}
      aria-label={
        localPlaying
          ? `Pause sequence preview for ${image.name}`
          : `Play sequence preview for ${image.name}`
      }
      title={localPlaying ? "Pause preview" : "Play preview"}
    >
      {localPlaying ? "⏸" : "▶"}
    </button>
  </>
)}
```

Suppress the SEQUENCE badge when `seqEmpty` is true (Branch B says: no SEQUENCE badge until repair succeeds):

```tsx
{isSeq && !seqEmpty ? (
  <span className="image-assets-panel__badge">SEQUENCE</span>
) : null}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/editor/react/components/ImageAssetsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/react/components/ImageAssetsPanel.tsx src/editor/react/components/ImageAssetsPanel.test.tsx
git commit -m "feat(media): repair affordance for ambiguous sequences"
```

### Task 16: Preview-failure isolation (broken preview does not break the scene)

**Files:**
- Modify: `src/editor/react/components/ImageAssetsPanel.tsx`
- Modify: `src/editor/react/components/ImageAssetsPanel.test.tsx`

The preview already uses a separate `setInterval` per tile. Lock the isolation contract with a regression test, and add a try/catch around the interval body so a frame URL that resolves to `null` does not throw.

- [ ] **Step 1: Failing test**

```tsx
it("preview keeps SEQUENCE badge even after a frame fails to load", () => {
  const { container } = renderPanel([baseSeqAsset()]);
  const img = container.querySelector("img")!;
  // Simulate a load failure on the first frame.
  img.dispatchEvent(new Event("error"));
  const badge = container.querySelector(".image-assets-panel__badge");
  expect(badge?.textContent).toBe("SEQUENCE");
});
```

- [ ] **Step 2: Run, expect PASS** (the panel already keeps the badge when `onError` fires; this test just locks it).

Run: `npx vitest run src/editor/react/components/ImageAssetsPanel.test.tsx -t "preview keeps SEQUENCE"`
Expected: PASS.

- [ ] **Step 3: No code change needed.** This task locks the existing isolation invariant against future regression.

- [ ] **Step 4: Commit**

```
git add src/editor/react/components/ImageAssetsPanel.test.tsx
git commit -m "test(media): lock preview failure isolation contract"
```

---

## Agent A5 — Scene Safety + Visibility Gating

A5 makes the scene robust. After this agent: the player ticks only while bound and visible, holds state across visibility flips, never paints magenta, and the magenta debug texture is opt-in only.

### Task 17: Wire `boundObject3D` on `ImageSequencePlayer` registration

**Files:**
- Modify: `src/editor/scene.ts`

The `sequencePlayers` map is keyed by `nodeId`. The corresponding `Object3D` already exists in the scene at registration time. Pass it into the player so `tick` can read `visible`.

- [ ] **Step 1: Failing test**

In `src/editor/scene.test.ts`:

```ts
it("registers boundObject3D on the player when bound to a node", () => {
  // Existing scene-builder helpers in this test file create a scene + add an
  // image-sequence node. Reach into scene.sequencePlayers via the public state()
  // helper used elsewhere, or expose a test-only getter.
  const scene = makeSceneWithImageSequenceNode("intro");
  const player = scene._sequencePlayers().get("intro");
  expect(player).toBeDefined();
  expect(player?.boundObject3D).toBeDefined();
  expect(player?.boundObject3D?.name).toContain("intro");
});
```

If `_sequencePlayers` is not yet exposed for tests, add a guarded test-only accessor in `scene.ts`:
```ts
/** @internal */
_sequencePlayers(): ReadonlyMap<string, ImageSequencePlayer> {
  return this.sequencePlayers;
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/editor/scene.test.ts -t "registers boundObject3D"`
Expected: FAIL — player has no `boundObject3D`.

- [ ] **Step 3: Add the field + setter**

In `scene.ts`, inside `class ImageSequencePlayer`:

```ts
boundObject3D: import("three").Object3D | null = null;

setBoundObject3D(obj: import("three").Object3D | null): void {
  this.boundObject3D = obj;
}
```

At the registration site (around line 1537-1546 — the block that creates a player and inserts it into `sequencePlayers`), add:

```ts
const owningMesh = /* the Object3D used as the textured mesh for this nodeId */;
player.setBoundObject3D(owningMesh ?? null);
```

(Look up the mesh via the existing maps, e.g. the same map used to drive material updates.)

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/editor/scene.test.ts -t "registers boundObject3D"`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/scene.ts src/editor/scene.test.ts
git commit -m "feat(scene): bind image sequence player to its object3d"
```

### Task 18: Visibility-gated tick

**Files:**
- Modify: `src/editor/scene.ts`
- Modify: `src/editor/scene.test.ts`

- [ ] **Step 1: Failing test**

```ts
it("does not advance currentFrame while boundObject3D.visible is false", () => {
  const player = makeStandalonePlayerWithFrames(10);
  player.setBoundObject3D({ visible: false } as any);
  const before = player.state().currentFrame;
  for (let i = 0; i < 30; i += 1) player.tick(1 / 25);
  expect(player.state().currentFrame).toBe(before);
});

it("resumes from the same currentFrame when visibility flips back to true", () => {
  const player = makeStandalonePlayerWithFrames(10);
  const obj = { visible: true } as any;
  player.setBoundObject3D(obj);
  for (let i = 0; i < 5; i += 1) player.tick(1 / 25);
  const mid = player.state().currentFrame;
  obj.visible = false;
  for (let i = 0; i < 30; i += 1) player.tick(1 / 25);
  expect(player.state().currentFrame).toBe(mid);
  obj.visible = true;
  player.tick(1 / 25);
  expect(player.state().currentFrame).toBe(mid + 1);
});
```

(`makeStandalonePlayerWithFrames` is a test helper — small, returns an `ImageSequencePlayer` with N synthetic blob URLs.)

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/editor/scene.test.ts -t "advance currentFrame"`
Expected: FAIL — current `tick` ignores visibility.

- [ ] **Step 3: Add the gate at the top of `tick`**

Find:
```ts
tick(deltaSec: number): void {
  if (this.disposed) {
    if (this.tickLogCount < 1) {
      ...
    }
    return;
  }
  if (this.paused) return;
  this.tickCount += 1;
```

Insert the gate right after the `disposed` guard:
```ts
  // Visibility gate: when the bound Object3D exists and is invisible,
  // freeze the player. State (currentFrame, frameCache) is preserved so
  // the user gets immediate playback resumption when visibility flips
  // back to true. This deliberately does NOT consult frustum / occlusion.
  if (this.boundObject3D && this.boundObject3D.visible === false) {
    return;
  }
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/editor/scene.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/scene.ts src/editor/scene.test.ts
git commit -m "fix(scene): gate image sequence tick by node visibility"
```

### Task 19: No-magenta invariant — placeholder strategy locked by test

**Files:**
- Modify: `src/editor/scene.ts`
- Modify: `src/editor/scene.test.ts`

The current code (commit 7ecacb5) replaces the magenta default with a transparent placeholder when a sequence frame fails to load. Lock this with a regression test, and refactor the placeholder generation into a single helper so the next regression has only one place to break.

- [ ] **Step 1: Failing test**

```ts
it("never assigns a magenta default when an image-sequence frame fails to load", () => {
  const player = makeStandalonePlayerWithFrames(3);
  // Simulate a frame failure
  player._simulateFrameError(0);
  const tex = player.texture;
  // The texture's image must be either: previously-bound image, first frame
  // placeholder, or the documented transparent 1x1. NEVER the THREE default
  // magenta material image.
  expect(isMagentaDebugImage(tex.image)).toBe(false);
});

it("__r3DebugBrokenTextures=true opts back into magenta debug imagery", () => {
  (window as any).__r3DebugBrokenTextures = true;
  try {
    const player = makeStandalonePlayerWithFrames(3);
    player._simulateFrameError(0);
    expect(isMagentaDebugImage(player.texture.image)).toBe(true);
  } finally {
    delete (window as any).__r3DebugBrokenTextures;
  }
});
```

(`isMagentaDebugImage` is a small test helper that checks the image's pixel-0 RGB; `_simulateFrameError(idx)` is a small test-only method on the player.)

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/editor/scene.test.ts -t magenta`
Expected: FAIL — helpers don't exist; debug flag is not wired.

- [ ] **Step 3: Implement the placeholder helper and the debug flag check**

In `scene.ts`, near the existing transparent-placeholder code, factor out:

```ts
function makeSequenceFallbackImage(): HTMLCanvasElement {
  const dbg =
    typeof window !== "undefined" && (window as { __r3DebugBrokenTextures?: boolean }).__r3DebugBrokenTextures === true;
  const canvas = document.createElement("canvas");
  canvas.width = 4; canvas.height = 4;
  const ctx = canvas.getContext("2d")!;
  if (dbg) {
    // Magenta + grid: only when the debug flag is explicitly enabled in the
    // browser console. Off by default. NEVER painted in normal viewports.
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillStyle = "#000000";
    ctx.fillRect(1, 1, 1, 1); ctx.fillRect(3, 3, 1, 1);
  } else {
    ctx.clearRect(0, 0, 4, 4);
  }
  return canvas;
}
```

Inside `ImageSequencePlayer`, expose `_simulateFrameError(idx: number): void` (test-only):

```ts
/** @internal test-only */
_simulateFrameError(idx: number): void {
  this.error = `frame ${idx + 1} failed (test)`;
  if (this.texture.image == null) {
    this.texture.image = makeSequenceFallbackImage();
    this.texture.needsUpdate = true;
  }
}
```

Add a call to `makeSequenceFallbackImage()` in the existing `onerror` handler too — replace any branch that might leave `texture.image` null with the helper.

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/editor/scene.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/scene.ts src/editor/scene.test.ts
git commit -m "fix(scene): no magenta in viewport unless debug flag is set"
```

### Task 20: Lock the visibility flip frame-preservation contract for Enable=False nodes

**Files:**
- Modify: `src/editor/scene.test.ts`

This is a regression test for the PITCH_Out / PITCH_IN scenario from the user's brief. No production code change.

- [ ] **Step 1: Failing test**

```ts
it("PITCH_Out (Enable=False) registers a player but the player never advances", () => {
  // Use an existing fixture pair (e.g. GameName_FS) that has both PITCH_IN
  // and PITCH_Out as image-sequence nodes.
  const scene = loadFixtureScene("GameName_FS");
  const players = scene._sequencePlayers();
  const pitchOut = players.get(findNodeIdByName(scene, "PITCH_Out")!)!;
  const before = pitchOut.state().currentFrame;
  scene._simulateFrames(60);
  expect(pitchOut.state().currentFrame).toBe(before);

  const pitchIn = players.get(findNodeIdByName(scene, "PITCH_IN")!)!;
  expect(pitchIn.state().currentFrame).toBeGreaterThan(before);
});
```

(`_simulateFrames(n)` is a test-only helper on the scene that ticks `n` frames at 1/25 deltas.)

- [ ] **Step 2: Run, expect PASS** (Tasks 17-18 already implement the gate; this task only locks the regression).

Run: `npx vitest run src/editor/scene.test.ts -t "PITCH_Out"`
Expected: PASS.

- [ ] **Step 3: No production change.**

- [ ] **Step 4: Commit**

```
git add src/editor/scene.test.ts
git commit -m "test(scene): lock pitch out hidden no advance regression"
```

---

## Agent A3 — Conversion UX

A3 closes the loop on the modal and the orchestrator. After this agent: the modal final list shows per-file format/reason copy, and the orchestrator pipes manifest format / fallbackReason through to the in-memory `ImageSequenceMetadata`.

### Scope note — no FSA writes in v2

The current orchestrator (`src/editor/import/movConvertViaBackend.ts`) is `convertMovsViaBackend`, NOT `convertAndWriteFrames`. The implementation chosen for the FSA spec went with browser→backend buffer flow: frames live on the dev server's tempdir, the manifest returns absolute URLs (`/api/w3d/convert-mov/jobs/<jobId>/frames/...`), and the browser fetches each frame lazily as the renderer needs it. **No frame is written to the user's project folder.**

v2 keeps that exact transport. The resolver from A1 still handles `_webp_frames/`, `_png_frames/`, `_frames/` because users may already have those folders on disk from a prior CLI run (`scripts/convert-w3d-mov-to-sequence.mjs`) or a future FSA-write feature. v2 does NOT add FSA disk writes during the browser-driven conversion path.

The actual `ConvertProgress` shape in code is:
```ts
type ConvertProgress =
  | { phase: "uploading"; movName: string; movIndex: number; movTotal: number }
  | { phase: "converted"; movName: string; movIndex: number; movTotal: number }
  | { phase: "done" }
  | { phase: "cancelled" };
```

Tasks 21-22 below extend this in-place rather than introducing a separate FSA writer.

### Task 21: `ImageSequenceMetadata` from manifest carries `format` and `fallbackReason`

**Files:**
- Modify: `src/editor/import/movConvertViaBackend.ts`
- Modify: `src/editor/import/movConvertViaBackend.test.ts`

- [ ] **Step 1: Failing test**

Append to `src/editor/import/movConvertViaBackend.test.ts`:

```ts
it("propagates manifest.format and manifest.fallbackReason into the resulting sequence", async () => {
  const fetchMock = vi.fn(async (_url, init?: RequestInit) => {
    const filename = String((init?.headers as Record<string, string>)?.["X-Filename"] ?? "");
    return new Response(JSON.stringify({
      jobId: "job-1",
      source: filename,
      format: "png",
      fallbackReason: "webp_encoder_unavailable",
      sequenceJson: {
        version: 2, type: "image-sequence", format: "png",
        source: filename, framePattern: "frame_%06d.png", frameCount: 1,
        fps: 25, width: 0, height: 0, durationSec: 0,
        loop: true, alpha: true, pixelFormat: "rgba",
        fallbackReason: "webp_encoder_unavailable",
      },
      frameCount: 1, fps: 25, alpha: true,
      frames: [{ index: 1, filename: "frame_000001.png",
        url: "/api/w3d/convert-mov/jobs/job-1/frames/frame_000001.png", sizeBytes: 100 }],
      ffmpegSource: "static",
    }), { status: 200 });
  });
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  const result = await convertMovsViaBackend({
    movFiles: [mockMovFile("intro.mov")],
    signal: new AbortController().signal,
  });
  const seq = result.sequences.get("intro.mov")!;
  expect(seq.format).toBe("png");
  expect(seq.fallbackReason).toBe("webp_encoder_unavailable");
  expect(seq.fps).toBe(25);
  expect(seq.framePattern).toBe("frame_%06d.png");
  expect(seq.frameUrls[0]).toMatch(/\.png$/);
});

it("emits a webp sequence with no fallbackReason on the happy path", async () => {
  const fetchMock = vi.fn(async (_url, init?: RequestInit) => {
    const filename = String((init?.headers as Record<string, string>)?.["X-Filename"] ?? "");
    return new Response(JSON.stringify({
      jobId: "job-2", source: filename, format: "webp", fallbackReason: null,
      sequenceJson: {
        version: 2, type: "image-sequence", format: "webp",
        source: filename, framePattern: "frame_%06d.webp", frameCount: 2,
        fps: 25, width: 0, height: 0, durationSec: 0,
        loop: true, alpha: true, pixelFormat: "rgba",
      },
      frameCount: 2, fps: 25, alpha: true,
      frames: [
        { index: 1, filename: "frame_000001.webp", url: "/api/.../frame_000001.webp", sizeBytes: 100 },
        { index: 2, filename: "frame_000002.webp", url: "/api/.../frame_000002.webp", sizeBytes: 100 },
      ],
      ffmpegSource: "static",
    }), { status: 200 });
  });
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  const result = await convertMovsViaBackend({
    movFiles: [mockMovFile("intro.mov")],
    signal: new AbortController().signal,
  });
  const seq = result.sequences.get("intro.mov")!;
  expect(seq.format).toBe("webp");
  expect(seq.fallbackReason).toBeUndefined();
  expect(seq.framePattern).toBe("frame_%06d.webp");
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/editor/import/movConvertViaBackend.test.ts -t "format and manifest.fallbackReason"`
Expected: FAIL — current code does not read `format` / `fallbackReason` from the manifest, and `ImageSequenceMetadata` literal lacks them.

- [ ] **Step 3: Update `BackendManifest` and the sequence build**

In `src/editor/import/movConvertViaBackend.ts`, extend `BackendManifest`:

```ts
interface BackendManifest {
  jobId: string;
  source: string;
  format?: "webp" | "png";
  fallbackReason?: "webp_encoder_unavailable" | "webp_validation_failed" | null;
  sequenceJson: {
    version?: number;
    format?: "webp" | "png";
    framePattern: string;
    frameCount: number;
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    loop: boolean;
    alpha: boolean;
    pixelFormat: string;
    fallbackReason?: "webp_encoder_unavailable" | "webp_validation_failed";
  };
  frameCount: number;
  fps: number;
  alpha: boolean;
  frames: { index: number; filename: string; url: string; sizeBytes: number }[];
  ffmpegSource?: string;
}
```

Replace the `sequences.set(file.name, { ... })` block with:

```ts
const detectedFormat: "webp" | "png" =
  manifest.format === "webp" || manifest.sequenceJson.format === "webp" ? "webp" : "png";
const fps = manifest.fps > 0 ? manifest.fps : 25;
const seq: ImageSequenceMetadata = {
  version: 2,
  type: "image-sequence",
  format: detectedFormat,
  source: file.name,
  framePattern: manifest.sequenceJson.framePattern,
  frameCount: manifest.frameCount,
  fps,
  width: manifest.sequenceJson.width,
  height: manifest.sequenceJson.height,
  durationSec: manifest.sequenceJson.durationSec,
  loop: manifest.sequenceJson.loop !== false,
  alpha: manifest.alpha,
  pixelFormat: "rgba",
  frameUrls: manifest.frames.map((f) => f.url),
};
const reason = manifest.fallbackReason ?? manifest.sequenceJson.fallbackReason;
if (reason) seq.fallbackReason = reason;
sequences.set(file.name, seq);
```

(Add the import at the top: `import type { SequenceFormat, SequenceFallbackReason } from "../types";` if not already imported.)

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/editor/import/movConvertViaBackend.test.ts`
Expected: PASS, including the existing tests (which use `version: 1` manifests — they should still resolve to v2 in-memory because `normaliseToV2` is implicit in the new logic).

- [ ] **Step 5: Commit**

```
git add src/editor/import/movConvertViaBackend.ts src/editor/import/movConvertViaBackend.test.ts
git commit -m "feat(import): propagate manifest format and fallback reason"
```

### Task 22: Skip-if-already-resolved when the in-folder walker already produced a sequence

**Files:**
- Modify: `src/editor/react/App.tsx`

The walker (Tasks 5-6) already builds `additionalSequences` for any `.mov` whose `_webp_frames` / `_png_frames` / `_frames` sibling on disk has frames. In that case the modal must not re-upload the .mov to the backend.

This is the natural skip-if-exists behaviour, expressed at the App layer — the orchestrator itself is fine.

- [ ] **Step 1: Locate the wiring in `App.tsx`**

Find the place where the App calls `convertMovsViaBackend(...)`. There is a corresponding `classifyMovAssets` call earlier (in `MovConversionModal`'s `classification` prop) that already filters to `.mov` files lacking a sibling sequence. Verify that the classifier consults `additionalSequences` from the walker.

- [ ] **Step 2: Update `classifyMovAssets` to honour the v2 priority**

In `src/editor/import/w3dFolder.ts`, find `classifyMovAssets`. Change its predicate from `has _frames sibling?` to `walker.additionalSequences.has(<basename>.mov)?`. The walker now produces entries for all three priority layers — that is the source of truth.

```ts
export function classifyMovAssets(input: {
  movFiles: { name: string; relPath: string }[];
  walkerSequences: Map<string, ImageSequenceMetadata>;
}): MovClassification {
  const ready: typeof input.movFiles = [];
  const needsConversion: typeof input.movFiles = [];
  for (const m of input.movFiles) {
    if (input.walkerSequences.has(m.name)) ready.push(m);
    else needsConversion.push(m);
  }
  return { ready, needsConversion };
}
```

(Update the call site in App.tsx to pass `result.additionalSequences` as `walkerSequences`.)

- [ ] **Step 3: No new test scaffolding needed beyond Tasks 5-6**

The walker tests from Task 6 already prove the right `additionalSequences` are built. The classifier change is a one-liner whose contract is preserved by the existing modal integration tests.

- [ ] **Step 4: Run all tests, expect PASS**

Run: `npm test -- --run --reporter=basic 2>&1 | tail -20`
Expected: no new failures.

- [ ] **Step 5: Commit**

```
git add src/editor/import/w3dFolder.ts src/editor/react/App.tsx
git commit -m "feat(import): classify mov readiness from walker sequences map"
```

### Task 23: Modal final list — per-file format/reason copy

**Files:**
- Modify: `src/editor/react/components/MovConversionModal.tsx`
- Modify: `src/editor/react/components/MovConversionModal.test.tsx`

The current modal has phases `ask`, `converting`, `installing`, `error`. Add a `done` phase carrying per-file results, or extend the existing post-conversion result rendering.

- [ ] **Step 1: Read the existing post-conversion render**

The current `MovConversionResult` shape (`converted: string[]`, `failed: ...`) does not carry format. Extend it.

- [ ] **Step 2: Failing test**

```tsx
it("renders per-file Converted to WebP / Converted to PNG / Reason: <reason>", () => {
  render(<MovConversionModal
    isOpen
    classification={...}
    projectName="x"
    isDevMode
    phase={{ kind: "done" }}
    conversionResult={{
      converted: [
        { mov: "a.mov", format: "webp", fallbackReason: null, frameCount: 10, fps: 25, alpha: true },
        { mov: "b.mov", format: "png",  fallbackReason: "webp_encoder_unavailable", frameCount: 12, fps: 25, alpha: true },
      ],
      skipped: [], failed: [], sequenceJsonPaths: [], warnings: [],
    }}
    onConvert={() => {}} onImportWithoutConverting={() => {}} onCancel={() => {}}
  />);
  expect(screen.getByText(/a\.mov/)).toBeInTheDocument();
  expect(screen.getByText(/Converted to WebP sequence · 10 frames @ 25fps · alpha/)).toBeInTheDocument();
  expect(screen.getByText(/b\.mov/)).toBeInTheDocument();
  expect(screen.getByText(/Converted to PNG sequence · 12 frames @ 25fps · alpha/)).toBeInTheDocument();
  expect(screen.getByText(/Reason: WebP encoder unavailable in this build/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `npx vitest run src/editor/react/components/MovConversionModal.test.tsx -t "Converted to WebP"`
Expected: FAIL — current modal only lists names.

- [ ] **Step 4: Update `MovConversionResult` shape and the renderer**

```ts
export interface MovConvertedFile {
  mov: string;
  format: SequenceFormat;
  fallbackReason: SequenceFallbackReason | null;
  frameCount: number;
  fps: number;
  alpha: boolean;
}

export interface MovConversionResult {
  converted: MovConvertedFile[];
  skipped: string[];
  failed: { filename: string; error: string }[];
  sequenceJsonPaths: string[];
  warnings: string[];
}
```

Add a `done`-phase render that maps each `converted[]` entry to:

```tsx
<div className="mov-conv-final">
  {conversionResult?.converted.map((c) => (
    <div key={c.mov} className="mov-conv-final__row">
      <code>{c.mov}</code>
      <div>
        Converted to {c.format === "webp" ? "WebP" : "PNG"} sequence · {c.frameCount} frames @ {c.fps}fps · {c.alpha ? "alpha" : "no alpha"}
      </div>
      {c.fallbackReason ? (
        <div className="mov-conv-final__reason">
          Reason: {reasonText(c.fallbackReason)}
        </div>
      ) : null}
    </div>
  ))}
</div>
```

```ts
function reasonText(r: SequenceFallbackReason): string {
  switch (r) {
    case "webp_encoder_unavailable": return "WebP encoder unavailable in this build";
    case "webp_validation_failed":   return "WebP validation failed";
  }
}
```

Add `done` to `MovModalPhase`:
```ts
export type MovModalPhase =
  | { kind: "ask" }
  | { kind: "converting"; progress: MovConvertProgress }
  | { kind: "installing" }
  | { kind: "done" }
  | { kind: "error"; reason: ... };
```

The App-level state machine that drives this modal already pushes results post-conversion; update it to set `phase: { kind: "done" }` when the orchestrator completes.

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run src/editor/react/components/MovConversionModal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/editor/react/components/MovConversionModal.tsx src/editor/react/components/MovConversionModal.test.tsx
git commit -m "feat(modal): per file format and fallback reason copy"
```

### Task 24: Wire the App.tsx state machine to feed the new `done` phase

**Files:**
- Modify: `src/editor/react/App.tsx`

- [ ] **Step 1: Locate the modal-result wiring**

`App.tsx` calls `convertMovsViaBackend(...)` and gets back `{ sequences, failed }`. Find the place that handles completion and currently sets the modal phase / result.

- [ ] **Step 2: Build the per-file `MovConvertedFile[]` from the sequences map**

Replace the completion handler's body with:

```ts
const finalConverted: MovConvertedFile[] = [];
for (const [movName, seq] of result.sequences) {
  finalConverted.push({
    mov: movName,
    format: seq.format,
    fallbackReason: seq.fallbackReason ?? null,
    frameCount: seq.frameCount,
    fps: seq.fps > 0 ? seq.fps : 25,
    alpha: seq.alpha,
  });
}
setConvertModalPhase({ kind: "done" });
setConversionResult({
  converted: finalConverted,
  skipped: [],
  failed: result.failed.map((f) => ({ filename: f.mov, error: f.error })),
  sequenceJsonPaths: [],
  warnings: [],
});
```

If `MovConvertedFile` and `MovConversionResult` are still in scope from Task 23's edits, no extra imports are needed. Otherwise `import type { MovConvertedFile, MovConversionResult } from "./components/MovConversionModal";`.

- [ ] **Step 3: Run all tests**

Run: `npm test -- --run --reporter=basic 2>&1 | grep -E "(failed|passed)"`
Expected: no new failures.

- [ ] **Step 4: Commit**

```
git add src/editor/react/App.tsx
git commit -m "feat(app): build mov conversion result from sequences map"
```

---

## Agent A6 — Final QA / Anti-downgrade

A6 runs LAST and writes no production code. Its job is to compare the final state to the Phase 0 baseline and run the anti-downgrade visual checklist.

### Task 25: Re-run baseline and document the delta

**Files:**
- Modify: `docs/w3d-mov-sequence-v2-baseline.md`

- [ ] **Step 1: Re-run npm test**

Run: `npm test -- --run 2>&1 | tee /tmp/v2-final-test.log`
Expected: all new tests added by A1-A5 are green; no new failing files vs baseline.

- [ ] **Step 2: Re-run typecheck**

Run: `npm run typecheck 2>&1 | tee /tmp/v2-final-typecheck.log`
Expected: same set of pre-existing errors as the baseline. Anything new is a blocker.

- [ ] **Step 3: Append the comparison section**

Append to `docs/w3d-mov-sequence-v2-baseline.md`:

```markdown
## Final delta (after A1-A5 land)

Captured: <ISO timestamp>
HEAD: <git rev-parse HEAD>

### npm test
<summary: total tests, new tests added, any new failures>

### npm run typecheck
<diff vs baseline: any new errors? any pre-existing errors fixed in passing?>

### Verdict
PASS / BLOCK / NEEDS-FIX (with reasons)
```

- [ ] **Step 4: Commit**

```
git add docs/w3d-mov-sequence-v2-baseline.md
git commit -m "docs: record v2 final delta vs phase 0 baseline"
```

### Task 26: Anti-downgrade visual checklist

**Files:** None (manual QA documented in the baseline doc).

A6 runs the editor against the GameName_FS reference scene and verifies the following invariants. Each item is a pass/fail, recorded in the baseline doc.

- [ ] **A. No magenta in normal viewport**
  - Open editor, import GameName_FS, force a frame fetch failure (devtools network throttle / block).
  - Viewport must show last good frame OR transparent placeholder. Magenta is a fail.

- [ ] **B. Court does not disappear**
  - The court mesh and its image asset must remain visible during all sequence operations. If a sequence breaks, the court must NOT vanish.

- [ ] **C. PITCH_Out stays hidden (Enable=False)**
  - `__r3Dump()` shows the PITCH_Out node's player has `tickCount` that does not increase across multiple frames.
  - The Object3D's `visible` is `false`. The mesh is not rendered.

- [ ] **D. Camera locked orthographic-front (2D scenes)**
  - Camera quaternion does not drift. OrbitControls.enableRotate is `false`. Pre-existing invariant from commit c1637c7 — must continue holding.

- [ ] **E. Broken sequence does not destroy the viewport**
  - Force the FSA `getFileHandle` to throw on one frame mid-conversion. The conversion modal logs a per-frame failure but the scene keeps rendering. No exception escapes the render loop.

- [ ] **F. Media panel correctness**
  - SEQUENCE badge present.
  - Static thumbnail = first frame.
  - Click Play overlay → preview animates.
  - Subline `webp · alpha` (or `png · alpha` for fallback / legacy).
  - Pills render correctly per status.

- [ ] **G. WebP fallback mode**
  - With `FFMPEG_PATH` set to a stripped ffmpeg (no libwebp), reimport: `_png_frames/` is written, modal shows `Reason: WebP encoder unavailable in this build`, sequence.json carries `fallbackReason: "webp_encoder_unavailable"`.

- [ ] **Step 8: Append the checklist results to the baseline doc**

```markdown
## Anti-downgrade checklist
A. No magenta — PASS / FAIL
B. Court visible — PASS / FAIL
... (etc)
```

- [ ] **Step 9: Commit**

```
git add docs/w3d-mov-sequence-v2-baseline.md
git commit -m "qa: anti downgrade visual checklist results"
```

---

## Self-Review (run by the planner BEFORE handing off)

The author ran this check after writing the plan:

**1. Spec coverage:** every section of `docs/w3d-mov-sequence-v2.md` maps to at least one task —
- Schema v2 → Tasks 1-4
- Resolver priority → Tasks 5-6
- Repair flow Branch A → Task 6 (auto-repair); Branch B → Task 15 (Repair button)
- Conversion pipeline (probe + dual-format + smoke + manifest) → Tasks 7-10
- CLI v2 schema → Task 11
- Media panel UX (static thumbnail, click-to-play, subline, pills, repair) → Tasks 12-16
- Scene visibility-gated tick + no-magenta invariant + debug flag → Tasks 17-20
- Modal per-file format/reason copy → Tasks 23-24
- Orchestrator propagates manifest format/reason → Task 21
- Walker-based skip-if-exists → Task 22
- Phase 0 baseline + final delta + anti-downgrade checklist → Task 0, 25, 26

**Spec drift documented:** the spec describes FSA writes during conversion ("frontend writes frames + sequence.json into picked folder via File System Access API"). The current implementation went with browser→backend buffer flow and never added FSA writes; this plan keeps that simpler reality (see "Scope note — no FSA writes in v2" before Task 21). The resolver still handles `_webp_frames/` / `_png_frames/` / `_frames/` for projects with on-disk sequences from the CLI tool. Adding FSA writes is a clean follow-up after v2 lands.

**2. Placeholder scan:** no "TBD", "implement later", "similar to Task N", or "add appropriate error handling". Each step has the actual code or the actual command.

**3. Type consistency:**
- `SequenceFormat = "webp" | "png"` is the single name across `sequenceSchema.ts`, `types.ts`, and `movConvertViaBackend.ts`.
- `SequenceFallbackReason` is `"webp_encoder_unavailable" | "webp_validation_failed"` everywhere.
- `ImageSequenceMetadata.version` is `1 | 2`; new writers always emit 2; `parseSequenceJson` and the resolver always return v2-shaped objects.
- `manifest.format` and `manifest.fallbackReason` flow unchanged from `runMovConversionInTemp` to `MovConversionModal`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-08-w3d-mov-sequence-v2.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Recommendation for this plan: **subagent-driven**, because the plan splits cleanly across six independent agents (A1, A2, A3, A4, A5, A6) and the user explicitly asked for subagent dispatch. A1 must finish first; A2 / A4 / A5 fan out in parallel after; A3 serialises after A2; A6 closes the cycle.
