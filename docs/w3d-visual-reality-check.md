# W3D Visual Reality Check — FASE D / Pass 1 (diagnóstico)

**Status:** observation only. NO code fixes in this round — they go in Pass 2
once the user confirms the root cause from this report (especially §1).

**Why this exists:** the user reports that after FASE C Pass 2 (static skew +
helper hiding) the imported `GameName_FS` still looks essentially the same
as before. Two screenshots compared:

* **App after fixes** (#1): orbit-perspective view, axis gizmo visible, floor
  grid lines, players + small logos, no big yellow plate, two large white
  diagonal slashes near the top.
* **R3 reference** (#2): flat 2D framing, dominant yellow/gold stage
  occupying the centre, players on top of it, sponsor logo, small white
  and pink rectangles between players, "LIETKABELIS BET" text stretched.

The visual delta is not consistent with FASE C having actually run. This
report walks through the most likely reasons.

## 1. Hypothesis #1 (highest confidence) — cached blueprint hides the fixes

3Forge persists three things to `localStorage` on every change
(`src/editor/workspace.ts:198–200`, `:319`):

| Key                                    | Contents                                    |
|----------------------------------------|---------------------------------------------|
| `3forge-editor-autosave`              | Full current blueprint (every store edit). |
| `3forge-workspace-context`            | Current project metadata.                   |
| `3forge-recent-snapshot:<projectId>`  | Last-known blueprint per recent-projects entry. |

When the editor mounts, `loadStoredWorkspace()` (`workspace.ts:171`) reads
`3forge-editor-autosave` and rehydrates it into the store before any of the
W3D import code runs. That is by design — autosave restores edits across
reloads. **But it also means any blueprint imported BEFORE FASE C is still
the one being shown after FASE C** unless the user re-imports the W3D
folder. None of:

* `node.transform.skew` (added in commit `927e4a9`),
* `shadow.helperNodeIds` (added in commit `3daf838`),
* the FASE 2 `<ImageSequence>` resolution (commit `9f05b85`),
* the FASE 3 UV-animation paths (commit `92bee5c`),

…retro-actively appear in a stored blueprint. They are produced by the
parser; on a cached blueprint, the new fields are simply absent.

Symptom check against screenshot #1 that supports this:

* The viewport shows an **angled perspective view with a floor grid and an
  XYZ gizmo** — yet `detectSceneMode` returns `"2d"` for `GameName_FS`
  (folder-name convention `*_FS`) and the smoke output for the same XML
  reports `cam=orthographic`. Either the user manually rotated an ortho
  camera (possible — orbit is enabled), or the cached blueprint's
  `sceneMode` is `"3d"` because it was imported before commit `6446ce3`
  which added the folder-name heuristic. Same root cause.
* No yellow stage = no `image` node carrying the
  `04_Game_Name_PITCH_IN.mov` video texture. That's expected on a
  pre-FASE-2 cached import (the four ImageSequence GUIDs would have
  fallen back to plane stubs and been hidden as missing-texture
  fallbacks).
* The "two big white diagonal slashes" near the top look like the
  `PITCH_IN`/`PITCH_Out` quads (Size 7.36×4.14) rendering as
  bright-white plane fallbacks because the video texture didn't bind —
  which is exactly what happened before FASE 2 made the resolver
  recognise `<ImageSequence>`.

Verification snippet — paste into the editor's devtools console with
`GameName_FS` open:

```js
const bp = JSON.parse(localStorage.getItem("3forge-editor-autosave") || "{}");
const w3d = bp?.metadata?.w3d ?? {};
console.table({
  componentName: bp?.componentName,
  sceneMode: bp?.sceneMode,
  totalNodes: bp?.nodes?.length,
  imageNodes: bp?.nodes?.filter(n => n.type === "image").length,
  videoImageNodes: bp?.nodes?.filter(
    n => n.type === "image" && n.image?.mimeType?.startsWith("video/")
  ).length,
  skewedNodes: bp?.nodes?.filter(n => n.transform?.skew).length,
  shadowHelperCount: w3d.helperNodeIds?.length ?? 0,
  shadowMissingCount: w3d.missingTextureNodeIds?.length ?? 0,
  shadowInitialDisabled: w3d.initialDisabledNodeIds?.length ?? 0,
});
```

Expected for a fresh re-import after all FASE A/B/C commits:

```
componentName:           GameName_FS
sceneMode:               2d
totalNodes:              ~58
imageNodes:              22       (was 18 pre-FASE 2)
videoImageNodes:         4        (the .mov clips)
skewedNodes:             14       (the lower-third bars + headers)
shadowHelperCount:       0        (this scene has no HELPERS-named groups)
shadowMissingCount:      0
shadowInitialDisabled:   1        (PITCH_Out quad)
```

If the actual values are noticeably lower (especially
`skewedNodes: 0`, `videoImageNodes: 0`, `imageNodes: 13`), the user is
looking at a cached blueprint and **needs to re-import**, not patch more
code. This single check disambiguates everything below.

How to force a clean re-import:

```js
// Devtools console, while the editor is open:
localStorage.removeItem("3forge-editor-autosave");
localStorage.removeItem("3forge-workspace-context");
// Optional: also nuke recent-project snapshots so File → Open Recent
// shows nothing stale.
Object.keys(localStorage)
  .filter(k => k.startsWith("3forge-recent-snapshot:"))
  .forEach(k => localStorage.removeItem(k));
location.reload();
// then File → Import → W3D Scene (Folder) → pick the GameName_FS folder
```

A non-console alternative would be a "Reset workspace" menu entry; not in
scope for this report.

## 2. Hypothesis #2 — `MaterialId="DE1A3E3C-…"` is referenced but not defined

`GameName_FS/scene.w3d` has only six `<BaseMaterial>` resources, all
lower-case GUIDs:

```
69cd9d3c-…  BaseMaterial      (white)
4ec0046c-…  IMG_SHADOW        (black emissive)
71d3104d-…  TEXT_SHADOW       (black emissive, alpha 0.5)
bb201ccd-…  WHITE             (white emissive)
2df8c5f1-…  vSponsorBaseColor (dark grey emissive — runtime overridden)
179d34e4-…  vCompetitionLogoBaseColor (orange #ff6600 emissive — runtime overridden)
```

But **eight `NamedBaseFaceMapping` entries reference
`MaterialId="DE1A3E3C-AE85-4B7B-BA86-056463611630"`**, including:

* `PITCH_IN` (Size 7.36×4.14) — the full-canvas stage video.
* `PITCH_Out` (same) — Enable=False today, animated visibility.
* `ORANGE_HOME_BIG` and the AWAY mirror (the lower-third bars).
* Four other `Standard` TextureLayer mappings on the team-name groups.

The GUID isn't anywhere in the XML. R3 Designer treats it as a shared
asset-library material — it lives in the user's R3 install, *outside* the
scene folder, and the Designer loads it transparently. We don't.

Today the parser at `applyMaterialFromPrimitive` (`w3d.ts:1100`) does:

```ts
const baseSpec = ctx.baseMaterials.get(materialId.toLowerCase());
if (!baseSpec) return;          // ← silent fall-through to default spec
node.material = { ...baseSpec };
```

The default spec from `createMaterialSpec()` is `#5ad3ff` (light blue),
`transparent: true`, `opacity: 1`, type `standard`. For an image quad we
then overwrite `material.color = "#ffffff"` and `material.type = "basic"`,
so the colour fall-through usually doesn't show — but for any
**plane fallback** (when the texture also isn't bound), the user would see
a light-blue plate, not yellow.

What this means for the symptom:

* The yellow/gold plate in the R3 reference is the *video texture*
  playing on `PITCH_IN`'s mesh — not a material colour. R3 fills that
  quad from `04_Game_Name_PITCH_IN.mov` whose first frames are the
  yellow stage. If the video isn't loading on our side, the same quad
  silently disappears (because `videos.has(filename)` keeps it out of
  `missingTextureNodeIds`, so it stays visible but with no `map` and a
  plain default material — and then ends up off-camera or behind in the
  current ortho framing).
* The shared `DE1A3E3C` material is most likely R3's "broadcast diffuse
  base" — a flat tinted colour the broadcast house standardised on. The
  exact tint matters less than the fact that we currently have *no
  signal at all* that 8 quads are using a material we don't know about.

Pass-2 fix candidate (small, safe):
emit a single aggregated warning when one or more `MaterialId` references
miss the resource table — `Skipped N <NamedBaseFaceMapping>: material id
not in <Resources>; using default spec`. The user gets a console line that
explains "8 quads referenced an external R3 base material I can't see;
their colour is the editor default until you bind a texture or replace
the material."

Optional: the parser could also remember the missing GUID + which nodes
referenced it under `shadow.unresolvedMaterialIds`, so a future "Project
materials library" feature can let the user paste the missing material
once and have all 8 quads pick it up.

## 3. Hypothesis #3 — video texture not actually playing

Even on a fresh re-import, `getVideoTexture` (`scene.ts:1196`) creates a
`<video>` element with `autoplay`, `muted`, `playsInline`, then immediately
calls `video.play()` and silently catches the rejection. We added an
`error` event listener in FASE B, but we don't surface a "video stalled
but didn't error" path.

Failure modes that look like a black/empty video on the dev box:

* **`file://` source URL.** When the smoke test imports from disk it
  builds `src: "file://${texturesDir}/${file}"`, but the *real* folder
  importer (`w3dFolder.ts:107`) uses `URL.createObjectURL(file)` which
  is a `blob:` URL. Both are first-party and play under jsdom-less
  Chrome, but if the user manually pointed the import at a path that
  Chrome treats as cross-origin, the video stays blank.
* **Codec mismatch.** `.mov` containers carrying H.264 + AAC are
  generally fine in Chrome on Windows; ProRes or DNxHR are not. Worth
  checking with `ffprobe` if the diagnostic console line in FASE B
  reported `code=4 (MEDIA_ERR_SRC_NOT_SUPPORTED)`.
* **Autoplay gate.** `video.play().catch(() => {})` swallows the
  rejection silently. If the page hasn't received a user gesture yet,
  the video stays paused on frame zero, which often reads as a flat
  black or transparent frame. The user clicking the viewport once
  unblocks autoplay for that page session.

Pass-2 fix candidate: add a one-time `console.info` when a VideoTexture
is created with a paused state, plus a hint to click anywhere if the
play() promise rejected. We have the wiring already.

## 4. Hypothesis #4 — helper detection did NOT cause the regression here

I want to rule this out explicitly because it would be the most dramatic
failure mode of FASE C #2.

The helper regex is
`^(helpers?|esconder|pitch[_ -]?reference|reference)$` (whole-name,
case-insensitive). Walking the dev-box `GameName_FS.w3d`:

* The only `Enable="False"` node in the entire scene is **`PITCH_Out`**
  (line 41) — and `PITCH_Out` does NOT match the regex (the regex
  requires "reference" to follow `pitch`, not `_Out`).
* No node anywhere is named exactly `helpers`, `helper`, `esconder`,
  `pitch_reference`, `pitch reference`, `pitch-reference`, or
  `reference`.
* No ancestor of `PITCH_Out` matches either (its chain is
  `TEMPLATE → VIDEOS → PITCH_Out`).

Therefore `helperNodeIds` for `GameName_FS` should be **empty**. The
helper hide path in `scene.ts:isMissingTextureNode` cannot be making
anything disappear here. (For the AR scenes the situation is the same —
they don't carry HELPERS / Pitch_Reference groups either.)

If hypothesis #1 confirms (cached blueprint), the user was never running
the helper hide pass anyway because the cached blueprint has no
`helperNodeIds` field at all.

## 5. Hypothesis #5 — scene mode mismatch

Screenshot #1 shows an angled view, not orthographic. Two ways this
happens:

* User orbited the ortho camera. OrbitControls has `enableRotate: true`
  even on the ortho path, and the framing helper at
  `frameAllForCurrentMode` only resets the camera once on first mount.
* Cached blueprint's `sceneMode === "3d"`. Pre-`6446ce3` the scene-mode
  detection was different (driven primarily by `Is2DScene`, which
  GameName_FS sets to "False"), so a stored blueprint from then would
  have `sceneMode: "3d"` and the renderer happily creates a
  `PerspectiveCamera`.

The verification snippet in §1 reports `sceneMode`. If it says `"3d"`
on a `GameName_FS` blueprint, that's the cached-import smoking gun.

## 6. Top-10 suspect nodes in `GameName_FS` (by area + visual impact)

Ordered by likely contribution to the perceived flatness vs. the R3
reference, given a fresh re-import will land all FASE A/B/C fixes:

| #  | Node                | What it is                                       | Likely visual cause if missing/wrong            |
|---:|---------------------|--------------------------------------------------|--------------------------------------------------|
| 1  | `PITCH_IN`          | 7.36×4.14 quad, plays `04_Game_Name_PITCH_IN.mov` (the gold stage) | Black centre / no stage if video doesn't bind |
| 2  | `PITCH_Out`         | 7.36×4.14, currently Enable=False                | Should stay hidden — only animates in on take-out |
| 3  | `ORANGE_HOME_BIG`   | 0.58×3.09 vertical card, **`Skew X="15"`**       | Upright if skew not applied (cache); parallelogram once skewLayer fires |
| 4  | `ORANGE_HOME_BIG1`  | Z-stacked variant of #3                          | Same as #3 |
| 5  | `ORANGE_HOME_BIG2`  | Z-stacked variant of #3                          | Same as #3 |
| 6  | AWAY mirrors        | Three more skewed bars on the away side          | Same as #3 |
| 7  | `Comp_Header_Bg`    | Header band, **`Skew X="15"`**                   | Upright if cached |
| 8  | `BottomLogos` group | Ribbon at the bottom, **`Skew X="15"`**          | Upright if cached |
| 9  | Player photo SHADOW quads | Texture is `shadow.png`                    | Should render but small; if shadow.png path 404s, console.warn fires (FASE B) |
| 10 | `tHomeTeamName` / `tAwayTeamName` text | TextureText with TEXT_SHADOW + WHITE | Look fine in screenshot; placement looks off, possibly down to skew on the parent group not propagating |

Most of these collapse into the same answer: re-import, and #3–#8 fix
themselves; #1 still needs the video to actually play.

## 7. Pass-2 fix priorities (gated on the §1 verification)

Run the §1 console snippet first. The result decides the path:

| Outcome of §1                                                     | Recommended Pass 2                                              |
|-------------------------------------------------------------------|------------------------------------------------------------------|
| `skewedNodes` = 0, `videoImageNodes` = 0, `sceneMode` ≠ `"2d"`    | **Cache eviction is the fix.** No code change. Document the steps + add a "Reset workspace" menu item later. |
| `skewedNodes` ≈ 14 but viewport still flat                        | The skew is in data but isn't reaching the renderer. Bisect: is the skewLayer Group actually being inserted? Add a one-shot dev log. |
| `videoImageNodes` ≈ 4 but the centre is still black               | Video isn't playing. Add the autoplay-stalled diagnostic + try `video.muted = true` (already set) + a click-anywhere prompt. |
| Anything else                                                     | Re-investigate; this report's hypotheses don't cover it. |

## 8. What this report does NOT do

* Touch any production code.
* Change the parser, renderer, or material pipeline.
* Add user-visible UI.
* Implement a `.vert`/`.ind` reader, `Size.YProp` animation, animated
  skew, or any larger refactor — all explicitly off the table.

## 9. Acceptance for FASE D / Pass 2

A Pass-2 candidate is "done" when:

1. The user pastes the §1 console output back; we have *evidence* of
   what their actual blueprint contains.
2. Whatever fix we apply targets the specific failure mode that
   evidence indicates — not an educated guess.
3. After the fix, a fresh re-import of `GameName_FS` shows: gold stage
   visible (video plays), the four `ORANGE_*` cards leaning right by
   15°, no upside-down rotation or perspective tilt for a layout
   declared `*_FS`.
4. AR scenes remain pixel-stable.

— end of FASE D / Pass 1 —
