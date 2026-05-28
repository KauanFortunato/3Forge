# USDZ Skeletal Animation Import — Field Notes & Why It's Not Done

> **Status: paused / partially working.** This document captures everything we
> learned trying to import + play USDZ animations (xform + UsdSkel) so the next
> person doesn't re-discover it from scratch. It is a companion to
> [`usdz-animation-import-plan.md`](./usdz-animation-import-plan.md) (the
> original plan) and [`openusd-wasm-pipeline.md`](./openusd-wasm-pipeline.md)
> (the WASM binding contract).

---

## 1. What we were trying to do

Import animations from `.usdz` files and play them in the editor's existing
keyframe timeline, so a clip shows up in **Assets → Animations** and the user
can press play. Two animation styles exist in USD:

- **Rigid xform animation** — `xformOp:*` attributes with authored
  `timeSamples` (a propeller spinning via its transform, a door rotating).
  This is **Phase A** and it is the simpler case.
- **UsdSkel skeletal animation** — a `Skeleton` + `SkelAnimation` deform a
  `SkinnedMesh` via bones. This is **Phase B** and is where most of the
  difficulty lived. Both real test assets we had (Apple's
  `toy_biplane_realistic.usdz` and `seahorse_anim_mtl_variant.usdz`) are
  **UsdSkel**, *not* rigid-xform — so Phase A alone produced nothing visible.

---

## 2. TL;DR — current state

| Piece | State |
|---|---|
| Phase A: rigid xform + visibility tracks | Built, unit-tested. Untested against a real rigid-xform USDZ (we never had one — both samples are skel). |
| Phase A: GLB/GLTF root animation import | Built, unit-tested, works for whole-model root tracks only. |
| WASM UsdSkel bindings | Built and shipped (`getSkeleton`, `getSkinBinding`, `getSkelAnimation`, `getBlendShapes`, `getSkelRootInfo`). Verified present in the binary. |
| Phase B: SkinnedMesh construction | Built. Geometry + skin weights + skeleton are constructed. |
| Phase B: baked bone playback | Built (`scene.ts` drives bones per frame). A placeholder clip is created so playback can be triggered. |
| **Does the biplane actually animate correctly on screen?** | **Unverified.** The last bug fix (matrix transpose) was committed but never visually confirmed by a human. Before that fix the skin was visibly broken. |
| Per-bone keyframe *editing* in the timeline | **Not built.** The clip is a metadata placeholder. |
| Blend shapes / morph targets | **Not built.** Bindings exist; parser doesn't consume them. |
| Per-prim editing of skinned models | **Disabled on purpose** (see §5). |

So the honest summary: **the plumbing is all there and the known bugs were
fixed one by one, but the end-to-end result was never confirmed working by a
human, and several deliberate shortcuts (placeholder clip, no editing, no
morphs) mean it's not a finished feature.**

---

## 3. The data flow (so you know where to look)

```
.usdz bytes
  │
  ▼  openusdWorker.ts  (Web Worker, OpenUSD WASM)
  │    • listPrims, getMeshData, getMaterial*
  │    • getSkinBinding(mesh)  → jointIndices/weights, skel + anim paths
  │    • getSkeleton(skelPath) → joints, parents, rest + bind matrices
  │    • getSkelAnimation(animPath, t) sampled at every authored frame
  │    → ParsedUsdModelData { prims[], materials, skeletons, skeletalAnimations }
  │
  ▼  openusdParser.ts  (main thread)  buildGroupFromWorkerModel()
  │    • builds THREE.SkinnedMesh + THREE.Skeleton (buildThreeSkeleton)
  │    • tags prim Object3D with userData.skeletalPlayback
  │    • stashes baked animation on root.userData.skeletalAnimations
  │
  ▼  App.tsx  importModelFiles()
  │    • buildUsdImportPlanFromGroup() returns [] for skinned files
  │      → falls back to a single ModelNode (no per-prim explode)
  │    • discoverSkeletalPlaybacks() → addImportedAnimationClip() placeholder
  │
  ▼  scene.ts  buildModelObject()
  │    • cloneSkeletalGroup() (SkeletonUtils.clone) for skinned assets
  │    • registerSkeletalPlayback(nodeId, clone, cached)
  │
  ▼  scene.ts  applyAnimationFrame() → applySkeletalPlaybacks()
       • per frame: bracket baked samples, lerp T/S, slerp R, write bone TRS,
         skeleton.update()
```

---

## 4. The hard problems (and what each fix was)

These are the traps. Each one cost real debugging time.

### 4.1 The animation lives in `SkelAnimation`, not in `xformOp`

Our first instinct (Phase A) was to sample `xformOp:*` timeSamples. Both real
assets have **zero animated xformOps** — the propeller/wheels/wings all move
through skinning. Phase A correctly produced *nothing* because there was
nothing in its domain to find. Lesson: **inspect the file before assuming the
animation is where you expect.** Use `usdcat` or the Python `pxr` package
(`pip install usd-core`) to dump time-sampled attributes per prim.

### 4.2 `animationSource` is authored on the Skeleton, not the mesh

`UsdSkelBindingAPI(meshPrim).GetAnimationSource()` returned **nothing** for
both assets. The `skeleton` relationship *is* on each mesh, but the
`animationSource` relationship is authored on the **Skeleton prim** (Apple's
convention). The fix: when the mesh-local lookup misses, reach through to
`UsdSkelBindingAPI(skeleton.GetPrim()).GetAnimationSource()`.

> Symptom this caused: `prim.skinning.animationPath` was empty → no
> `skeletalPlayback` marker → the skinned-content check failed → the per-prim
> explode path ran instead of the single-ModelNode path → no clip appeared at
> all. One missing relationship cascaded into "no animation in the panel."

### 4.3 USD `GfMatrix4d` is row-major; Three.js `Matrix4` is column-major

**This was the big one.** USD stores matrices row-major with translation in the
**last row** (`m[3][0..2]`, Direct3D-style post-multiplied row vectors).
Three.js stores column-major with translation in the **last column**
(`elements[12..14]`, OpenGL-style pre-multiplied column vectors). They are
**transposes of each other.**

The original WASM helpers copied `usd m[r][c]` straight into Three.js's
`elements[c*4+r]`, which keeps the numbers in the same slots — so Three.js read
the translation as the bottom row of a projection matrix and rotations as their
inverses.

**Why it hid for so long:** every prim in the biplane has an
`xformOp:translate:pivot` immediately followed by its `!invert!` sibling, so
all the prim world matrices are identity — and identity is its own transpose,
so the bug had nothing to corrupt for static placement. The **Skeleton's bind
and rest matrices have real translations** (joints at y≈4.18, etc.), so
converting them wrong dumped every bone at the origin and the skin deformed
randomly. Fix: transpose during the copy (`m[c][r]` instead of `m[r][c]`) in
all four matrix-emitting bindings.

> If you ever see "static meshes are fine but the rig is scrambled," suspect a
> matrix-convention mismatch and test with a matrix that has a non-trivial
> translation *and* rotation.

### 4.4 Three.js needs exactly 4 influences per vertex; USD can author N

The seahorse authors **11 influences per vertex** (`elementSize=11`); the
biplane authors **1**. Three.js's `SkinnedMesh` shader is hard-wired to 4.
Truncating to the *first* 4 silently drops the strongest deformers. Fix: a tiny
top-4-by-weight selection with renormalization in the worker. Padding up to 4
(for the biplane's 1) is just zeros with zero weight — Three.js normalizes.

### 4.5 `SkinnedMesh.clone()` does not rebind the skeleton

The editor clones the cached parsed group for every ModelNode instance. A plain
`Object3D.clone(true)` shallow-copies the `.skeleton` reference, so the clone's
SkinnedMesh still points at the *original* bones (which aren't in the clone's
tree → no deformation, or deformation driven by an off-screen skeleton).
`three/examples/jsm/utils/SkeletonUtils.js` `clone()` does the parallel-traverse
+ rebind dance. We switched skinned assets to that path
(`cloneSkeletalGroup`).

### 4.6 `bindMode` and `geomBindTransform`

Three.js `SkinnedMesh` defaults to `AttachedBindMode`, which overwrites
`bindMatrixInverse` with `inverse(matrixWorld)` every frame. We set
`bindMatrix` from USD's `geomBindTransform` and let attached mode handle the
inverse. The math works out **only because** the mesh's own world matrix equals
the bind-time world matrix (no animation on the mesh itself — all motion is in
the bones). If a future asset animates an ancestor xform *and* skins, revisit
this; you may need `DetachedBindMode`.

---

## 5. Deliberate shortcuts (not bugs — scope cuts)

- **Per-prim explode is disabled for skinned USDZ.** A skinned asset becomes
  one `ModelNode`, not the per-prim editable tree. Reason: per-prim cloning
  would each need its own bone tree, and SkeletonUtils' rebind dance gets
  complicated across prim boundaries. `buildUsdImportPlanFromGroup` returns `[]`
  when it sees skeletal content, falling back to the legacy single-node path.
- **The AnimationClip is a placeholder.** It carries a no-op `visible`
  track (value 1 → 1) just so the clip is non-empty and shows up in the panel
  with the right fps/duration. The actual bone motion is driven by a *separate*
  subsystem (`applySkeletalPlaybacks`) keyed off the clip's current frame.
  **Editing the clip's keyframes does nothing to the skeleton.** This is the
  single biggest reason it's "not really done."
- **Animation is baked at import**, sampled at every authored frame. No
  re-sampling UI; changing the source means re-importing.
- **No blend shapes / morph targets.** `getBlendShapes` is exposed in WASM but
  the parser ignores it. None of our test assets needed it.

---

## 6. What a real "Phase C" would need

To make this an actual editable feature (the original B4–B5 vision):

1. **First-class bone tracks.** Either:
   - (a) loosen `AnimationPropertyPath` to accept opaque
     `bone.<jointName>.<rot|pos|scale>.<axis>` strings and teach
     `evaluateCompiledTrack` + `applyAnimationFrame` to route them to bones; or
   - (b) materialize each bone as a real `group` blueprint node mapped to the
     `THREE.Bone` in `objectMap`, so the existing track system drives them for
     free. (b) clutters the hierarchy for big rigs but reuses everything.
   The plan doc picked (a). Either way the *placeholder clip* goes away and the
   timeline drives the skeleton directly.
2. **Re-enable per-prim explode for skinned models** using shared bones (one
   skeleton instance, multiple ModelNodes referencing it) — needs a bones
   registry keyed by skelPath in `scene.ts` instead of per-node clones.
3. **Blend shapes** → `geometry.morphAttributes.position` +
   `mesh.morphTargetInfluences`, driven by `morph.<name>` tracks.
4. **Quaternion-correct editing.** We bake to per-channel and slerp on
   playback; an editing UI needs to keep quaternions intact or expose
   euler with documented gimbal caveats.

---

## 7. How to rebuild the WASM (you WILL need this)

The TypeScript changes are live on edit, but any `wrapper.cpp` change needs a
WASM rebuild in WSL. The libs (including `libusd_usdSkel.a`) live at
`~/wasm/openusd-wasm-official/lib`.

```bash
# from the repo, sync the source into the WSL build dir and build:
wsl -d Ubuntu -e bash -c "cp scripts/openusd-wasm-build/{wrapper.cpp,build.sh} ~/wasm/openusd-wrapper/ \
  && cd ~/wasm/openusd-wrapper && ./build.sh \
  && cp openusd.js openusd.wasm openusd.data /mnt/c/.../3Forge/public/wasm/openusd/"
```

Gotchas hit during this work:
- `UsdSkelBindingAPI::GetAnimationSource(UsdPrim*)` takes a `UsdPrim*`, **not**
  a `UsdSkelAnimation*` — a compile error if you pass the wrong type.
- The build emits harmless `__syscall_mprotect` / `__syscall_madvise`
  "unsupported syscall" warnings at runtime — ignore them, they're emscripten
  sandbox noise, not our bug.
- Verify bindings landed: `grep -a -o "getSkel[A-Za-z]*" public/wasm/openusd/openusd.wasm | sort -u`.

---

## 8. File pointers

| Concern | File |
|---|---|
| WASM C++ bindings (incl. UsdSkel) | `scripts/openusd-wasm-build/wrapper.cpp` |
| WASM build script | `scripts/openusd-wasm-build/build.sh` |
| Worker extraction (skin, skeleton, baked anim) | `src/lib/openusd/openusdWorker.ts` |
| Worker ↔ main payload types | `src/lib/openusd/openusdWorkerTypes.ts` |
| SkinnedMesh + skeleton build, plan builder | `src/lib/openusd/openusdParser.ts` (`buildThreeSkeleton`, `groupContainsSkeletalPlayback`, `discoverSkeletalPlaybacks`) |
| Rigid xform sampler | `src/lib/openusd/usdAnimation.ts` |
| GLB/GLTF root anim | `src/editor/gltfAnimationImport.ts` |
| Import orchestration + placeholder clip | `src/editor/react/App.tsx` (`importModelFiles`) |
| Bone playback at render time | `src/editor/scene.ts` (`SkeletalPlayback`, `registerSkeletalPlayback`, `applySkeletalPlaybacks`, `bracketSkeletalFrame`) |
| Clip storage / import API | `src/editor/state.ts` (`insertModelImportPlan`, `addImportedAnimationClip`, `createImportedAnimationTracks`) |
| Skeleton unit test | `src/lib/openusd/openusdSkeleton.test.ts` |

---

## 9. Test assets & how to inspect them

- `toy_biplane_realistic.usdz` — 4-joint rig, 1 influence/vertex, 60 frames @
  60fps, rest≈bind. Simplest possible skel case.
- `seahorse_anim_mtl_variant.usdz` — 1 mesh, 11 influences/vertex, **450 frames
  @ 30fps** (slow to bake), material variants.

Inspect any `.usdz` (it's a zip) with the Python USD package:

```bash
pip install usd-core
python -c "from pxr import Usd, UsdSkel; s=Usd.Stage.Open('file.usdc'); \
  print(s.GetStartTimeCode(), s.GetEndTimeCode(), s.GetFramesPerSecond()); \
  [print(p.GetPath(), [a.GetName() for a in p.GetAttributes() if a.GetNumTimeSamples()>0]) \
   for p in s.Traverse()]"
```

This one command would have told us on day one that the animation was in
`SkelAnimation`, not `xformOp` — worth running first on any new asset.

---

## 10. The one-paragraph version

We built the full xform + UsdSkel import pipeline (WASM bindings → worker
extraction → SkinnedMesh construction → baked per-frame bone playback) and
fixed three subtle, expensive bugs: the animation was authored on the Skeleton
not the mesh; USD matrices needed transposing into Three.js's column-major
convention (hidden because the biplane's pivot xforms cancel to identity); and
USD allows >4 skin influences while Three.js demands exactly 4. What remains
unfinished is **editability** — the timeline clip is a placeholder that triggers
a side-channel playback rather than driving real, editable bone keyframes — plus
blend shapes, per-prim editing of skinned models, and a human confirmation that
the final matrix-transpose fix actually renders the rig correctly. Pick it up at
Phase C in §6.
