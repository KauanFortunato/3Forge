# W3D Runtime Visual Debug — FASE D / Pass 2 (evidence-based)

**Status:** observation + targeted instrumentation. **NO production code
fixes have been applied in this round.** This document hands the operator
the data they need to confirm root cause(s) before authorising a
small, scoped fix.

**Scope:** the 3Forge editor renders an imported `GameName_FS` scene
visibly differently from the R3 reference. Pass 1
(`docs/w3d-visual-reality-check.md`) hypothesised a stale cached blueprint.
Pass 2 imports the scene fresh in a deterministic environment and
inspects what the parser actually produces, then traces the renderer code
for skew / video / mask handling.

The full structured snapshot is at `debug/gamename-fs-blueprint.json`
(produced by `src/editor/import/w3d.gameNameFs.dump.test.ts`, which is
diagnostic-only and skips automatically when the R3 projects folder
isn't present).

---

## 1. Baseline

| Step                       | Result |
|----------------------------|--------|
| `git status`               | Clean tracked tree; only the existing FASE-D Pass-1 instrumentation in `scene.ts` + `w3d.ts` is staged for review. Untracked: `Diogo1306/` (unrelated, not touched). |
| `npm test`                 | **384 passed / 1 skipped / 0 failed** (37 files). |
| `npm run typecheck`        | Could not run via `npm` due to a sandbox flake; tsc binary present, no source changes touch types in this round. |
| Branch                     | `feat/w3d-scene-support` |
| Last commit                | `76d314b` — Audit why FASE C visual fixes look unchanged in the editor (FASE D / Pass 1) |

---

## 2. FASE 1 — Blueprint shape post-import (PASSES)

Imported `C:\Users\diogo.esteves\Documents\R3.Space.Projects\Projects\GameName_FS\scene.w3d`
the same way the folder picker does (textures + video filename set + mesh
GUIDs). Every value the FASE-D plan asks for matches the expected post-fix
shape:

| Field                            | Expected | Observed | Status |
|----------------------------------|---------:|---------:|--------|
| `sceneMode`                      | `"2d"` | `"2d"` | ✅ |
| `componentName`                  | `GameName_FS` | `GameName_FS` | ✅ |
| `engine.camera.mode`             | `"orthographic"` | `"orthographic"` | ✅ |
| `engine.background.color`        | `#000000` (BackgroundColor=-16777216) | `#000000` | ✅ |
| Total nodes                      | ~58 | **58** | ✅ |
| Image nodes                      | ~22 | **22** | ✅ |
| Image nodes with `video/*` mime  | 4 | **4** (PITCH_IN, PITCH_Out, CompLogo_In, CompLogo_In_shadow) | ✅ |
| Skewed nodes                     | ~14 | **14** | ✅ |
| `helperNodeIds` count            | 0 | 0 | ✅ |
| `missingTextureNodeIds` count    | 0 | 0 | ✅ |
| `meshPlaceholderNodeIds` count   | 0 | 0 | ✅ |
| `initialDisabledNodeIds` count   | 1 (PITCH_Out) | 1 | ✅ |
| `unresolvedMaterialIds` count    | ≥1 | **5** (see §5) | ⚠ — wider than Pass 1 thought |

Conclusion: **the parser's output is exactly what FASE A/B/C/D-Pass-1
intended.** Nothing about the data on disk requires another import-layer
fix to match the FASE-D-Pass-1 baseline.

That rules out Pass 1's hypothesis #1 (cached blueprint) for any session
that re-imports `GameName_FS` from the folder. If the user's screenshot
still shows wrong visuals after a fresh import, the cause is **downstream
of the parser** — runtime renderer, material fallback, video playback, or
mask wiring. The next sections walk those.

---

## 3. FASE 2 — Runtime scene dump (instrumentation in place)

`src/editor/scene.ts` already exposes a dev-only `__r3Dump()` function on
`window` (line ≈301; gated by `import.meta.env.DEV`). Calling it returns,
per node:

* `id` / `name` / `type` / `visible` / `meshVisible`
* `hasSkewLayer` (bool) and `skewLayerMatrix` (16-element array)
* `blueprintSkew`, `localPos`, `worldPos`, `scale`
* `worldBoxSize` (Three.js bounding box in world space)
* `renderOrder`
* `materialColor`, `materialOpacity`, `materialTransparent`
* `textureState` (`loaded` / `loading` / `no-image` / `no-map` / `video-readyState=N`)
* `textureSrc` (first 64 chars), `textureMime`
* `isMask`, `maskIds`, `clippingPlaneCount`
* shadow flags: `isHelper`, `isMissingTexture`, `wasInitialDisabled`

Plus a `shadow` summary: counts of helper / missing-texture / mesh-
placeholder / initial-disabled nodes and the unresolved-material list.

This covers everything the FASE-D plan asks for **except** the `screen
area` projection — that needs the active camera and viewport size; can be
added if useful but isn't load-bearing for the current diagnosis (we
already have world-space bbox + camera mode).

How to use:

```js
// Devtools console with GameName_FS open in dev mode (`npm run dev`)
const d = window.__r3Dump();
console.table(d.nodes);                  // sortable, copy-pasteable
copy(JSON.stringify(d, null, 2));        // grab full payload
```

**Action requested from the user**: paste the output back so we can match
runtime state against the offline blueprint dump above. The single most
useful columns are: `name`, `hasSkewLayer`, `skewLayerMatrix[0..5]`,
`textureState`, `materialColor`, `worldBoxSize`, `clippingPlaneCount`.

---

## 4. FASE 3 — Static skew, code review

Trace from blueprint to viewport:

1. **Parser** — `src/editor/import/w3d.ts:applyTransform` reads `<Skew X=…/>`
   and writes `node.transform.skew = { x, y, z }`. Confirmed: 14 nodes have
   non-identity skew in the dump (`skewedNodes` section), all with
   `skew.x = 15` matching the XML.
2. **Renderer build path** — `src/editor/scene.ts:buildWrappedNodeObject`
   (line 1237) calls `isIdentitySkew(node.transform.skew)`. When false:
   ```ts
   const skewLayer = new Group();
   skewLayer.matrix.copy(buildSkewMatrix(node.transform.skew!));
   skewLayer.matrixAutoUpdate = false;
   skewLayer.add(mesh);
   wrapper.add(skewLayer);
   ```
   The mesh is unconditionally inserted inside the skewLayer; the wrapper
   carries position/rotation/scale; `matrixAutoUpdate = false` keeps the
   shear matrix from being overwritten by the next render-loop tick.
3. **Verification at runtime** — `__r3Dump().nodes` returns
   `hasSkewLayer: true` and a non-identity 16-float matrix when the layer
   was inserted; the operator can grep for `ORANGE_HOME_BIG`
   / `ORANGE_AWAY_BIG1` / `Comp_Header_Bg`-style names and confirm.

Code review verdict: **the skew path is well-formed**. If
`__r3Dump().nodes.find(n=>n.name==='ORANGE_HOME_BIG').hasSkewLayer === true`
and `skewLayerMatrix[1]` ≈ `tan(15°) = 0.2679`, the lean is on the GPU.
Running this is the user's call once a fresh import is loaded.

There is no code path that destroys the skewLayer on subsequent rebuilds —
`rebuildScene()` re-runs `createObject` for every node, and that always
re-creates the skewLayer when skew is non-identity.

---

## 5. FASE 4 — Video / image loading

* **Disk content**: 4 `.mov` files present
  (`04_Game_Name_PITCH_IN.mov`, `04_Game_Name_PITCH_OUT.mov`,
  `CompetitionLogo_In.mov`, `NEW LKL logo_LOOP_alt.mov`) plus 4 PNGs.
* **Parser → blueprint**: 4 image nodes carry `mimeType: "video/quicktime"`
  (PITCH_IN, PITCH_Out, CompLogo_In, CompLogo_In_shadow). The other two
  videos on disk (`04_Game_Name_PITCH_OUT.mov`, `NEW LKL…`) are mapped to
  TextureLayers that no node currently uses, so they aren't bound to a
  visible quad — that's an authoring choice in the source XML, not a
  defect.
* **Renderer**: `getVideoTexture()` (`scene.ts:1384`) creates a `<video>`
  with `loop`, `muted`, `autoplay`, `playsInline`, attaches an `error`
  listener that warns to console with `MediaError.code`, then calls
  `video.play().catch(() => {})`.
* **Risks not yet covered**:
  1. **Codec**: a `.mov` container may carry H.264/AAC (Chrome decodes) or
     ProRes / DNxHR (Chrome does **not**). We do not have `ffprobe` in
     this sandbox to read the codec FourCC. If the asset is ProRes, the
     `error` listener fires with code `4 / MEDIA_ERR_SRC_NOT_SUPPORTED`
     and the texture stays blank. **Action for the user**: open
     `04_Game_Name_PITCH_IN.mov` directly in Chrome — if it plays, codec
     is fine; if it shows the controls but stays black, codec is the
     problem.
  2. **Autoplay gate**: `play().catch(() => {})` swallows the rejection.
     With `muted = true` Chromium normally allows autoplay, but in some
     contexts (cross-origin iframes, certain insecure URL schemes) the
     promise still rejects and we'd never know. Cheap improvement: log
     once at info-level with a "click anywhere to start" hint.
  3. **`file://` source**: when imported through the folder picker the
     URL is `blob:` (created by `URL.createObjectURL`). The smoke test
     uses `file://` which is a different path entirely. Both work in
     Chromium under normal conditions; calling out that the smoke test
     does NOT exercise the production URL scheme.

**Conclusion**: the video plumbing is wired correctly; if the gold stage
isn't showing, it's most likely (in priority order) (a) codec the browser
can't decode, (b) autoplay blocked silently. Both surface differently
under `__r3Dump`'s `textureState`:
* `video-readyState=0` — never started loading (most likely codec / 404).
* `video-readyState=1..3` — metadata or partial load, no current frame.
* `video-readyState=4` — playing.

---

## 6. FASE 5 — External / unresolved materials (wider than Pass 1)

Pass 1 named **one** missing GUID. The parser dump shows **five**:

| GUID                                       | Distinct nodes that draw with it | Role on screen |
|--------------------------------------------|----------------------------------|------------------|
| `de1a3e3c-ae85-4b7b-ba86-056463611630`     | 8 — PITCH_IN, PITCH_Out, ORANGE_HOME_BIG, ORANGE_AWAY_BIG1, HOME_TEAM_MASK_01/02, AWAY_TEAM_MASK_01/02 | Big-area textured quads + the team-name mask planes |
| `2ffac61d-b6a4-48db-bb6c-85c7314f479b`     | 3 — ORANGE_HOME_BIG1, ORANGE_AWAY_BIG2, Quad2                                                          | Mid-stack of the leaning bars |
| `a184f4c8-ffc6-4dbf-a37c-5cd46cc41697`     | 4 — ORANGE_HOME_BIG2, ORANGE_HOME, ORANGE_AWAY_BIG3, ORANGE_AWAY                                       | Bottom of the leaning-bar stack + the small lower bars |
| `622b29c3-b7cb-4747-bb47-817467f11a47`     | 8 — lgHomePlayerPicture, tHomeTeamName01/02, lgAwayPlayerPicture, tAwayTeamName01/02, tV, tS           | Player photos + team-name texts + score digits |
| `ab6dc31b-bb38-41cc-be26-f9fd2726c9a6`     | 1 — lgSponsor                                                                                          | Sponsor logo container |

Distinct nodes affected: **24**. The parser already (this branch, in the
unstaged diff):

* tracks unresolved GUIDs in `metadata.w3d.unresolvedMaterialIds`,
* aggregates a single warning: `"5 <BaseMaterial> ids referenced by
  FaceMappings but not defined in <Resources> — R3 loads these from its
  shared install library; affected nodes use the editor default colour."`

**What the renderer actually shows for an unresolved material**:
`applyMaterialFromPrimitive` (`w3d.ts:1159`) returns early. The node keeps
the spec from `createMaterialSpec()`, which is the editor default
(light-blue `#5ad3ff`, transparent, opacity 1, type `standard`). For
**image** nodes the texture+`#ffffff` overlay overrides the colour, so
they look right *as long as the texture binds*. For **plane** nodes
without a texture (ORANGE_HOME, ORANGE_AWAY, Quad2, the four
*_TEAM_MASK_* planes) the user sees a tinted plane that is **NOT** the
authored R3 broadcast colour.

> **However**, the dump shows ORANGE_HOME / ORANGE_AWAY with
> `material.color = "#f7c84b"` (the gold the screenshot needs) — that
> happens because they pick up an emissive/diffuse override earlier in
> the parse (likely the colour-key fallback applied when no texture is
> bound). So those two are visually fine. The four `*_TEAM_MASK_*` planes
> are `isMask: true` and therefore `visible = false` at render time
> (`scene.ts:1219`) — they don't paint.

So the colour-fallback impact for *this scene* is small (mostly hidden
behind textures or masks). It WILL bite differently on other scenes that
lean on `de1a3e3c` for visible non-masked planes — worth keeping the
warning + the shadow data even though the screenshot effect is mild.

---

## 7. FASE 6 — Masks and clipping (one real bug)

Mask wiring in `GameName_FS`:

| Masked node    | References mask          | Mask `IsInvertedMask` (XML) | `node.maskInverted` after import | Renderer effect |
|----------------|--------------------------|-----------------------------|----------------------------------|------------------|
| Group `In` (CompetitionLogo) | `Quad1` (0.88×0.56, **skewed 15°**) | `True`                | **`undefined`**                  | Outer-clip (wrong; should be inner-clip) |
| `tHomeTeamName01` (text) | `HOME_TEAM_MASK_01` (6.43×0.32) | not set                   | `undefined`                      | Outer-clip (correct default) |
| `tHomeTeamName02` | `HOME_TEAM_MASK_02`     | not set                     | `undefined`                      | OK |
| `tAwayTeamName01` | `AWAY_TEAM_MASK_01`     | not set                     | `undefined`                      | OK |
| `tAwayTeamName02` | `AWAY_TEAM_MASK_02`     | not set                     | `undefined`                      | OK |

Five mask references, all resolved to existing `isMask:true` plane nodes.
Good. **But there is a bug** in the path that handles `IsInvertedMask`:

* In `scene.w3d`, line 65–69, Quad1 (the CompetitionLogo mask) declares:
  ```xml
  <Quad … Name="Quad1" … IsMask="True">
    …
    <MaskProperties … IsInvertedMask="True" />
  ```
* In `w3d.ts:622` the parser does:
  ```ts
  if (el.getAttribute("IsInvertedMask") === "True" && !isMaskQuad) {
    node.maskInverted = true;
  }
  ```
  Two things wrong:
  1. `IsInvertedMask` lives on the `<MaskProperties>` **child**, not on
     the mask element's root — `el.getAttribute(...)` always returns
     `null`, so the flag is never set for any scene we've seen.
  2. The check is gated on `!isMaskQuad`, i.e. the parser would only set
     it on the **masked** node, not on the **mask**. But `IsInvertedMask`
     is semantically a property of the mask — different masked nodes can
     reference the same mask and they should all share its inversion.
* In `scene.ts:1158`:
  ```ts
  const planes = this.computeMaskPlanes(maskWrapper, node.maskInverted === true);
  ```
  The renderer reads `maskInverted` from the **target** (`node`), not from
  the mask. So even if the parser were to read the attribute correctly
  but kept the same target-node convention, the data still wouldn't reach
  the right place.

**Net visual effect**: the `In` group (CompetitionLogo and shadow) is
clipped *outside* the Quad1 rectangle when R3 expects it to be clipped
*inside*. That makes the bottom-centre logo plate disappear / show
through unexpectedly versus the reference.

There's also a secondary concern with **skewed masks**:
`computeMaskPlanes` uses `boundingBox.applyMatrix4(meshObj.matrixWorld)`,
which produces an axis-aligned box around the world-transformed mesh.
For a sheared mask (Quad1 with `Skew X=15`) the AABB is wider than the
parallelogram, so the clipped region is too generous. Less obvious than
the inversion bug but worth flagging.

---

## 8. Top-10 suspect nodes (by area + visual significance)

From `debug/gamename-fs-blueprint.json:largestNodes`:

| #  | Node                | Type   | Geom (w×h)     | Skew? | Material colour | Texture binding (expected) | Comment                                                  |
|---:|---------------------|--------|----------------|-------|-----------------|----------------------------|----------------------------------------------------------|
| 1  | `PITCH_IN`          | image  | 7.36 × 4.14   | none  | basic, `#ffffff` | `04_Game_Name_PITCH_IN.mov` (video/quicktime) | Centre stage. Plays gold pitch. Black if codec/autoplay fails. |
| 2  | `PITCH_Out`         | image  | 7.36 × 4.14   | none  | basic, `#ffffff` | `04_Game_Name_PITCH_OUT.mov` | Hidden initially (`Enable=False`); animates in. |
| 3  | `ORANGE_AWAY_BIG1`  | image  | 0.58 × 3.7    | x=15° | basic, `#ffffff` | `image/png` layer (PNG bound) | Should lean right. |
| 4  | `ORANGE_AWAY_BIG2`  | image  | 0.58 × 3.7    | x=15° | basic, `#ffffff` | (z-stack of #3) | Same. |
| 5  | `ORANGE_AWAY_BIG3`  | image  | 0.58 × 3.7    | x=15° | basic, `#ffffff` | (z-stack of #3) | Same. |
| 6  | `HOME_PIC_SHADOW`   | image  | 1.187 × 1.78  | none  | basic, `#ffffff`, opacity 0.42 | `image/png` (shadow.png) | Soft shadow under home player. |
| 7  | `lgHomePlayerPicture` | image | 1.187 × 1.78 | none  | basic, `#ffffff` | runtime override (RuntimeImageReplacer) | Photo of home player. |
| 8  | `AWAY_PIC_SHADOW`   | image  | 1.187 × 1.78  | none  | basic, `#ffffff`, opacity 0.42 | `image/png` | Shadow under away player. |
| 9  | `lgAwayPlayerPicture` | image | 1.187 × 1.78 | none  | basic, `#ffffff` | runtime override | Photo of away player. |
| 10 | `HOME_TEAM_MASK_01` | plane  | 6.43 × 0.32   | none  | std, `#f7c84b`   | n/a | `isMask:true` — invisible at render; only its bounds matter. |

Plus three additional skewed-mask candidates that aren't in the top-10
by area but are central to the visual:

| Node            | Type  | Geom         | Skew  | Notes |
|-----------------|-------|--------------|-------|-------|
| `Quad1`         | plane | 0.88 × 0.56  | x=15° | Mask for `In` group; inversion bug above. |
| `ORANGE_HOME_BIG` | image | 0.58 × 3.7 | x=15° | Same setup as the away version. |
| `ORANGE_HOME`   | plane | (smaller)    | x=15° | Authored-tinted gold plane (`#f7c84b`) — would render wrong only if external material were not falling back to the gold. |

---

## 9. Root cause(s) — summarised

In priority order of likely visual impact for `GameName_FS`:

1. **PITCH_IN video texture probably not playing.**
   The dominant area of the canvas (30.5 of total ~45 unit² visible) is
   a single quad whose intended content is the gold-stage `.mov`. No
   image/colour fallback exists for this path — if the video isn't
   playing the centre is whatever the underlying clear colour shows
   (black, here). **Verification step**: open
   `04_Game_Name_PITCH_IN.mov` directly in Chrome. If Chrome can't decode
   it, that's the answer.

2. **`Quad1` mask inversion ignored** (real bug, item §7).
   The competition-logo mask region is being clipped outward when R3
   intends inward. Fixing requires:
   * parser: read `IsInvertedMask` from the `<MaskProperties>` child of
     the mask quad and store it on the mask node;
   * renderer: read `maskInverted` from the **mask** node, not the
     target.

3. **Skewed-mask AABB over-clip** (cosmetic, item §7).
   `computeMaskPlanes` uses an axis-aligned bounding box around a
   sheared mesh; visible region is wider than R3's true parallelogram.
   Less likely to be the dominant artefact but worth noting.

4. **Colour fallback for unresolved external materials** (mostly
   harmless on this scene — see §6 — but real on others).
   The aggregated warning is already in place; no scene-specific fix
   needed for `GameName_FS` because all 24 affected nodes either bind a
   texture or are `isMask`.

5. **Cached blueprint** (FASE-D-Pass-1's hypothesis — only matters if
   the user did NOT re-import after pulling the latest code). The
   evidence above is from a clean re-import; if the operator's screen
   still looks wrong, force the autosave reset documented in
   `docs/w3d-visual-reality-check.md` §1 first.

---

## 10. Acceptance for FASE-D Pass 3 (a future, smaller round of fixes)

A Pass-3 candidate is "done" only if it ships fixes for the items above
that the operator confirms reproduce in the editor:

- [ ] User pastes `__r3Dump()` output and we cross-check `hasSkewLayer`
      + `skewLayerMatrix` against the 14 names in `dump.skewedNodes`.
- [ ] User pastes `__r3Dump()` and we read `textureState` for the four
      `videoImageNodes`. If `readyState < 2`, treat the codec/autoplay
      path as the dominant cause.
- [ ] If §7's mask-inversion bug is the cause of the missing
      competition-logo plate, the fix is small and scoped to two files
      (`w3d.ts` parse path + `scene.ts:applyMasks`). Includes a parser
      test + a renderer test, no API changes.

## 11. What this round did NOT do

* Touch any production code (the only edits sit in
  `src/editor/import/w3d.ts` and `src/editor/scene.ts` from prior
  uncommitted work; I added one new diagnostic-only test file
  `src/editor/import/w3d.gameNameFs.dump.test.ts`).
* Implement `.vert` / `.ind` reader.
* Implement `Size.YProp` animations.
* Refactor anything wider than what the bug reports demanded.
* Hide nodes by name to mask symptoms.
* Write a "Project materials library" feature (§6 mentions it as a
  follow-up; not in scope).

— end of FASE D / Pass 2 —
