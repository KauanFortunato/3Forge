# USDZ Animation Import — Implementation Plan

Two-phase plan to bring USDZ animation support into the editor. Phase A is a single-session scope; Phase B is its own branch.

Branch: `usdz-import-improvements` (built on top of commits up to `a22d9a7`).

---

## Current state (read first)

The editor has a **complete custom keyframe system** independent of Three.js:

- Types — `src/editor/types.ts:230-256`
  - `AnimationClip { id, name, fps, durationFrames, tracks[] }`
  - `AnimationTrack { id, nodeId, property, keyframes[] }`
  - `AnimationKeyframe { id, frame, value, ease }`
  - `AnimationPropertyPath` — limited to `transform.{position|rotation|scale}.{x|y|z}` and `visible`
- Playback — `src/editor/scene.ts:1862` `updateAnimationPlayback()` samples the active clip every render frame and applies values to blueprint nodes via `applyAnimationFrame()`. Evaluation in `evaluateCompiledTrack()` (scene.ts:2050) with linear interpolation + 6 ease presets.
- UI — `src/editor/react/components/AnimationTimeline.tsx` — full timeline (clips, tracks, keyframes, scrub, copy/paste, FPS).
- GLTF export — `src/editor/gltfExport.ts:329-400` converts editor clips to `THREE.AnimationClip` + `KeyframeTrack`.

**Gaps:**
- GLTF import discards `gltf.animations` entirely (`src/editor/scene.ts` around `gltfLoader.load`).
- USDZ parser (`src/lib/openusd/openusdParser.ts:539`) calls `getWorldTransform(stageId, primPath, NaN)` — never samples time.
- Zero `SkinnedMesh` / `Skeleton` / `Bone` references in the codebase. UsdSkel data is dropped.
- WASM build (`scripts/openusd-wasm-build/build.sh`) does **not** link `libusd_usdSkel.a`.

**WASM bindings that ARE already exposed** (see `docs/openusd-wasm-pipeline.md` §3):
- `getWorldTransform(stageId, primPath, t: number)` — accepts time `t` for sampling
- `getStageTimeInfo(stageId): { startTime, endTime, framesPerSecond, timeCodesPerSecond }`
- `getTimeSamples(stageId, attrPath): number[]`

These are the building blocks for Phase A.

---

## Phase A — Xform timeSamples + visibility + GLTF animation import

**Scope:** import rigid-body animations (props, wheels, propellers, doors) plus visibility toggling. Reuse the existing editor track system unchanged. Single session.

### A1 — Sample USDZ xform timeSamples at import

**File:** `src/lib/openusd/openusdParser.ts`

- Extend `UsdImportPlanNode` with optional `animation?: { fps: number; durationFrames: number; tracks: UsdAnimationTrack[] }`.
- Define `UsdAnimationTrack` mirroring the editor's `AnimationTrack` shape but typed for the parser layer (property path string + keyframes).
- In `parseUsdz`, after building each prim's Object3D:
  1. Call `getStageTimeInfo(stageId)` once, cache fps + frame range.
  2. For each kept prim, call `getTimeSamples(stageId, primPath + ".xformOp:transform")` (or the specific xformOp attributes — check what the WASM build exposes). If non-empty:
     - For each sample time, call `getWorldTransform(stageId, primPath, t)`, derive **local** via `inverse(parentWorld(t)) × primWorld(t)`, decompose to TRS.
     - Emit one track per non-constant channel (`transform.position.x/y/z`, `transform.rotation.x/y/z`, `transform.scale.x/y/z`).
- Visibility (`visibility` attribute timeSamples) → emit a `visible` track.
- Add `buildUsdAnimationFromGroup` or fold into `buildUsdImportPlanFromGroup`.

**Gotcha:** sampling is per-prim per-frame. If a USDZ has 60fps × 5s × 100 prims = 30k getWorldTransform calls. Budget perf; consider stride/decimation if it's slow. WASM call overhead matters here.

### A2 — Create AnimationClip on import

**File:** `src/editor/state.ts` (extend `insertModelImportPlan`) and `src/editor/react/App.tsx` (`importModelFiles`).

- Collect all `UsdAnimationTrack`s from the plan tree, remap their `nodeId`s from primPath to the freshly-created blueprint node IDs.
- Call `store.createAnimationClip({ name, fps, durationFrames, tracks })` (or whatever the existing API is — check `state.ts` for clip creation).
- Auto-select the clip in the timeline so the user sees the animation right after import.

### A3 — Import GLTF animations

**File:** `src/editor/scene.ts` near the `gltfLoader.load(asset.src, (gltf) => resolve(gltf.scene), ...)` call (~line 1176).

- After resolving `gltf`, walk `gltf.animations: AnimationClip[]`. For each clip, walk its `KeyframeTrack`s, parse the property path (`.position`, `.quaternion`, `.scale`, `.morphTargetInfluences[i]`), convert to editor's `AnimationPropertyPath`.
- For quaternion tracks → either convert to Euler XYZ or extend `AnimationPropertyPath` to support quaternion (decide; current `transform.rotation` is Euler `x/y/z`, so converting is the path of least resistance for Phase A).
- Inject into the editor's clip system the same way A2 does.
- This needs the GLTF parts of the model to be addressable by node id. The current GLTF flow uses a single ModelNode for the whole GLB — sub-part animation won't map cleanly without an "explode GLB" path analogous to USDZ. For Phase A, **start by only importing animations whose target is the model's root** (translate/rotate/scale of the whole GLB). Document the limitation.

### A4 — Visibility property already supported

Editor already has `visible` track. Just confirm that USDZ `visibility` attribute time-samples convert correctly. No new code beyond A1.

### A5 — Tests

- Unit test in `src/lib/openusd/openusdParser.test.ts` (create if missing) — feed a tiny synthetic USDZ or mock the WASM module to verify track extraction.
- Integration test in `src/editor/state.test.ts` — verify `insertModelImportPlan` with `animation` payload creates an `AnimationClip`.
- Re-verify the existing 76 state.test.ts tests still pass.

### A6 — Verify

- `npx tsc --noEmit`
- `vitest run`
- Manual: import a USDZ with a known animation (e.g., a propeller-spinning biplane) and a GLB with an animation. Play in timeline.

**Deliverable:** rigid-body USDZ animations + GLB animations both replay correctly in the editor's existing timeline UI.

---

## Phase B — UsdSkel skinning + blendshapes

**Scope:** characters, deforming wings, anything with a rig. Big — likely 3-5 sessions. Separate branch (`usdz-skel-import` or similar) on top of `usdz-import-improvements`.

### B1 — Rebuild WASM with UsdSkel

**File:** `scripts/openusd-wasm-build/build.sh` and `docs/openusd-wasm-pipeline.md`.

- Add `libusd_usdSkel.a` to the `EMCC_LIBS` list (or whatever the build script's link var is).
- Verify the OpenUSD repo's `pxr/usd/usdSkel/` builds against the emscripten toolchain — may need patches similar to existing ones (`scripts/openusd-wasm-build/patches/`).
- Update the WASM size budget in `docs/openusd-wasm-pipeline.md` if it grows materially.
- Smoke test: `parseUsdz` of an existing non-skel USDZ should not regress.

### B2 — Expose skeleton / skin data via JS bindings

**File:** WASM C++ bindings (typically in `scripts/openusd-wasm-build/src/` — find the file that exports `getMeshData`, `getMaterialBinding`, etc.).

Add (and re-export in `UsdModule` interface at `openusdParser.ts:107`):
- `getSkeleton(stageId, skelPath): { joints: string[]; restTransforms: Float32Array; bindTransforms: Float32Array; topology: Int32Array }`
- `getSkinBinding(stageId, meshPath): { skelPath: string; jointIndices: Int32Array; jointWeights: Float32Array; geomBindTransform: Float32Array } | null`
- `getSkelAnimation(stageId, animPath, t): { translations: Float32Array; rotations: Float32Array; scales: Float32Array; blendShapeWeights: Float32Array }`
- `getBlendShapes(stageId, meshPath): { name: string; offsets: Float32Array; pointIndices: Int32Array }[]`

Re-run the WASM build, ship `public/wasm/openusd/openusd.{js,wasm}`.

### B3 — Render skinned meshes

**File:** `src/lib/openusd/openusdParser.ts` (extend the mesh-building branch in `parseUsdz`).

- When a mesh has a `SkelBindingAPI`, build a `THREE.SkinnedMesh` instead of `THREE.Mesh`.
- Build `THREE.Skeleton` from `getSkeleton` + `getSkinBinding`. Apply `geomBindTransform` to the geometry. Set `skinIndex` / `skinWeight` BufferAttributes.
- Attach the skeleton's root `Bone` to the prim's Object3D so transforms propagate correctly.
- Morph targets: convert blend shapes to `geometry.morphAttributes.position`, set `mesh.morphTargetInfluences` to zeros at bind time.

### B4 — Extend AnimationPropertyPath

**File:** `src/editor/types.ts:230-256`.

Add new property path variants:
- `bone.<jointName>.transform.position.{x|y|z}` — per-bone position keyframe
- `bone.<jointName>.transform.rotation.{x|y|z|w}` — per-bone rotation (quaternion components, since bones are typically authored as quaternions)
- `morph.<targetName>` — scalar weight per blendshape

Update `evaluateCompiledTrack` (`scene.ts:2050`) to apply these.

**Decision point:** the existing `AnimationPropertyPath` is a discriminated union of strings. Per-bone/per-morph paths are dynamic (the joint names come from the USD). Either:
- (a) Keep paths as opaque strings with a `bone:<name>:rotation:x` convention and parse at apply time. Less type-safe but no schema explosion.
- (b) Pre-generate union members per imported skeleton (won't work — `type` is a static type).

Pick (a). Document it.

### B5 — Sample UsdSkel animation at import

Like A1 but for skeleton animations:
- For each frame in `[startTimeCode, endTimeCode]` at `framesPerSecond`, call `getSkelAnimation(stageId, animPath, t)`.
- Emit one track per joint per channel (translation/rotation × {x,y,z}+w), plus one track per blendshape weight.
- Insert into editor clip via the same path as A2.

### B6 — Render-time skinning

**File:** `src/editor/scene.ts`.

- When playback updates a `bone.<j>.rotation.<c>` track, find the bone in the SkinnedMesh's skeleton by `joints[j].name` and apply.
- When playback updates a `morph.<t>` track, set `mesh.morphTargetInfluences[index]`.

### B7 — Tests + docs

- `parseUsdz.skel.test.ts` — extract skeleton + skin from a sample USDZ.
- Document the new property path string format in `docs/openusd-wasm-pipeline.md`.
- Add a section to `docs/usdz-animation-import-plan.md` (this file) on what was actually shipped.

### B8 — Limitations to call out

- Editing skeletal animations in the timeline is the user's job — Phase B only imports them. UI for editing per-bone keyframes inline would be Phase C.
- Cross-axis interpolation on quaternions (linear per-component slerp) will drift. May need to special-case quaternion tracks to use `Quaternion.slerp`. Plan for it.

---

## Glossary / pointers

- `src/editor/types.ts` — all editor data shapes
- `src/editor/state.ts` — `EditorStore` (history, clips, materials, nodes)
- `src/editor/scene.ts` — Three.js renderer + playback evaluator
- `src/editor/react/App.tsx` — top-level component; import flows live here
- `src/editor/react/components/AnimationTimeline.tsx` — timeline UI
- `src/lib/openusd/openusdParser.ts` — WASM-backed USDZ parser
- `public/wasm/openusd/openusd.{js,wasm}` — emscripten build output (do not hand-edit)
- `scripts/openusd-wasm-build/` — build inputs
- `docs/openusd-wasm-pipeline.md` — WASM binding contract

---

## Done so far on `usdz-import-improvements`

| Commit | Description |
|---|---|
| `56293b7` | Explode USDZ into editable per-prim blueprint nodes |
| `5ed4d9a` | Unit tests for `insertModelImportPlan` |
| `8adb485` | Stabilize USDZ explosion (world-derived locals) |
| `1ad4ca6` | Fix field name mismatch in plan → state (usdPath vs primPath) |
| `6bca7bf` | Remove debug logs |
| `cb5a55f` | Extract materials → shared MaterialAssets + link parts |
| `a22d9a7` | Split multi-material subsets into per-subset model nodes |

Animations are the next addition. **Start Phase A.** Don't open Phase B until A ships and you have a real USDZ-with-skin to test against.
