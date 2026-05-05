# W3D Transform Fidelity Audit — FASE C / Pass 1 (diagnóstico)

**Status:** observation only. NO code fixes in this round — they go in
FASE C / Pass 2 once the priorities below are agreed.

**Why this report:** FASE B (Z-aware paint, loader errors,
Rotation.Y alias) addressed layering and resilience. The user's
side-by-side with the original R3 still shows GameName_FS too flat
("big yellow block, scoreboard rectangles upright instead of
parallelogram-shaped, broadcast staging missing"). Symptom no longer
fits "wrong order" — fits "wrong shape". This pass investigates the
transform pipeline for what we are dropping silently.

## 1. Top finding — `<Skew>` is silently ignored by the parser

`src/editor/import/w3d.ts:998` `applyTransform` reads `<Position>`,
`<Scale>`, and `<Rotation>` off `<NodeTransform>` and **stops there**.
The same comment block (`w3d.ts:6` and `w3d.ts:11`) admits "Skew/Pivot
ignored with warning" — but in practice no warning is emitted for
*static* skew, only the animated `Transform.Skew.YProp` path is
counted. Static skew is dropped completely without trace.

What R3 actually authors:

| Scene                | static `<Skew>` count | distinct authored values |
|----------------------|----------------------:|---------------------------|
| `GameName_FS`        | 14                    | `Skew X="15"` (14×)       |
| `AR_PLAYER_V_PLAYER` | 6                     | `Skew X="15"`, `Skew Y="6"` |
| `AR_TACTIC`          | 5                     | `Skew X="15"`             |
| `AR_GAMEINTRO`       | 0                     | —                         |

A 15° X-skew is the canonical broadcast lower-third / scoreboard
shape — vertical bars become parallelograms leaning right, giving the
"perspective stage" look. Importing them as upright rectangles is
exactly the symptom you described.

The 14 skewed nodes in GameName_FS map to (read directly from the
fixture lines):

* line 77 — `CompetitionLogo_In` group's outer transform
* lines 142/157/172 — `ORANGE_HOME_BIG`, `ORANGE_HOME_BIG1`,
  `ORANGE_HOME_BIG2` (the home-team coloured bars — Y height 3.09,
  X width 0.58, the vertical "cards" that flank the player photo)
* lines 272/287 — additional HOME variants
* lines 391/406/421 — AWAY-team mirrors of the same cards
* lines 446/461 — AWAY shadow / inner layers
* lines 636/701/716 — bottom-band logos

Every "tall block" the user remembers seeing parallelogram-shaped
in the original is one of these 14 nodes. None of them is currently
skewed in the imported blueprint.

## 2. Animated `Transform.Skew.YProp` — present but secondary

`AR_PLAYER_V_PLAYER` and `AR_TACTIC` also drive Skew via
`KeyFrameAnimationController AnimatedProperty="Transform.Skew.YProp"`
(90× in AR_TACTIC, ~12× in AR_PLAYER_V_PLAYER from the smoke run).

These tracks **depend on the static-skew slot existing** — there is no
`material.skew` to animate today. So this is a Pass-2-step-2 follow-up,
not a parallel concern. Implement static skew first; animation hooks
land on the same data path.

## 3. `PivotType` — confirmed *not* a regression source

Distinct values across all dev-box scenes (484 occurrences total):

```
PivotType="Absolute"
```

That's the only spelling. R3 only ever emits `Absolute`, so the
parser's silent ignore is equivalent to "honour the default". No fix
needed, no further investigation required.

## 4. `AlignmentX` / `AlignmentY` — already wired correctly

`applyAlignment` (`w3d.ts:965`) maps R3's
`GeometryOptions AlignmentX/AlignmentY` to 3Forge's `node.origin.x/y`
(left/center/right ↔ top/center/bottom). The renderer
`applyNodeOrigin` (`scene.ts:1135`) repositions the inner mesh inside
its wrapper based on the bounding box so the wrapper's
`transform.position` lands on the correct anchor.

Verified end-to-end: spot-checked `ORANGE_HOME_BIG` (lines 132–143):
authored `AlignmentY="Top"`, `Size Y="3.09"`. After import the wrapper
sits at the authored Y=2.08, and the mesh inside it is shifted down by
half its bounding-box height — matching R3's "position is the top of
the bar" convention. **No fix needed.**

## 5. `Size.YProp` animation — affects AR scenes only

Smoke shows aggregated `Skipped <AnimatedProperty> "Size.YProp"`
warnings only on `AR_TACTIC` (90×) and `AR_PLAYER_V_PLAYER` (12×).
Zero in `GameName_FS`. So this is **not a candidate for the
GameName_FS visual fix**; it stays on the longer-term list.

When we do tackle it: `Size.YProp` mutates the geometry's Y dimension
at runtime (animates a Quad's height). The cleanest mapping in
3Forge would be a new animation path
`geometry.height` (and `geometry.width`) that the renderer rebuilds
the BufferGeometry against — non-trivial because `BufferGeometry`
isn't reactive on attribute changes. Use scale.y instead, or rebuild.
Defer to Pass 2 step 3 with its own design note.

## 6. Per-node spot-check on GameName_FS (top 10 most suspect)

Pulled directly from the fixture XML (annotated). The "current import
result" column is what 3Forge reports today; "delta vs R3" is the
visual gap.

| #  | Node                       | Authored XML                                 | Current import        | Delta                  |
|---:|----------------------------|----------------------------------------------|-----------------------|-------------------------|
| 1  | `ORANGE_HOME_BIG`          | Pos(-0.68, 2.08), AlignTop, Size 0.58×3.09, **Skew X=15** | upright 0.58×3.09 bar | leans right 15° in R3 |
| 2  | `ORANGE_HOME_BIG1`         | Pos(-0.68, 2.08, -0.001), Skew X=15, Size 0.58×3.09 | upright bar      | parallelogram in R3 |
| 3  | `ORANGE_HOME_BIG2`         | (mirrors of #1)                              | upright bar           | parallelogram in R3 |
| 4  | `ORANGE_AWAY_BIG`          | Pos(0.62, -2.08), AlignBottom, Size 0.58×3.09, **Skew X=15** | upright bar | parallelogram in R3 |
| 5  | `ORANGE_AWAY_BIG1/2`       | (Z-stacked variants)                          | upright bar           | parallelogram in R3 |
| 6  | `Comp_Header_Bg` group     | Pos(0.14, 1.39), **Skew X=15**                | unskewed group        | header band leans right |
| 7  | `vSponsor_*` band          | Pos(*, *, *), **Skew X=15**                   | unskewed              | sponsor strip leans right |
| 8  | `BottomLogos` group        | Pos(0.275, -1.69, -0.01), **Skew X=15**       | unskewed              | logo strip leans right |
| 9  | `BottomLogos` *.1 sibling  | (mirror of #8)                                | unskewed              | as #8 |
| 10 | `Pitch_Reference` placeholder (Enable=False, design-view promoted) | Pos(2.765, -1.425, -0.5), Scale, plain Quad | flat plate behind | likely the "big yellow block" you see — design-view promotion shows it; in R3 it's hidden at runtime |

Quick note on #10 — the *yellow block* the user sees is almost
certainly the design-view-promoted `Pitch_Reference` /
`pitch_reference` quad (R3 broadcast templates park huge solid-colour
helper plates behind everything to assist authoring). The promotion
in FASE 2 was correct *for the design role* but visually it competes
with the actual scoreboard. Two different fixes are possible:

* leave it visible (current behaviour, helps the designer) and rely
  on the FASE B Z sort to push it back — ✓ works for ordering, but
  the plate is still visible behind the layout because R3 hides it
  via `Enable="False"`, not by Z;
* respect `initialDisabledNodeIds` at render time (visible=false in
  the viewport, still selectable in the tree) — matches the live R3
  output more closely.

I lean toward the second, controlled by a simple
`viewport.showAuthoringHelpers` toggle so the design-view convenience
doesn't disappear entirely. Listed as Pass-2 candidate #4.

## 7. Pipeline shape proposal for static skew (Pass 2 design note)

Three.js `Object3D` does not have a skew slot. Two clean options:

**Option A — extra group in the wrapper hierarchy.** Today every
non-group node is wrapped:

```
wrapper(Group, position/rotation/scale)
  └─ mesh
```

Add an optional middle group when `node.transform.skew` is non-zero:

```
wrapper(Group, position/rotation/scale, animated)
  └─ skewLayer(Group, applies the skew matrix once, no animation)
       └─ mesh
```

Compose the skew matrix in code (it's a 4×4 with `tan(angle)` in
exactly two off-diagonal slots), assign it on `skewLayer.matrix`,
flip `matrixAutoUpdate=false` on the skewLayer only. Animations on
position/rotation/scale touch the wrapper and stay clean; skew lives
in the static layer. When `Transform.Skew.YProp` animation arrives,
the runtime targets `skewLayer.matrix` directly.

**Option B — composite matrix on the wrapper itself.** Override
`updateMatrix()` on the wrapper to multiply in the skew. Less code,
more risk: any code path that calls `wrapper.position.set(...)`
between frames also needs to call `wrapper.updateMatrix()` afterwards.
Three.js's animation loop does this, but our manual editor controls
may not.

Option A is the safer bet — minimal blast radius, no changes to
animation routing, and the inserted group is cheap.

`TransformSpec` extension would be:

```ts
export interface TransformSpec {
  position: Vec3Like;
  rotation: Vec3Like;
  scale: Vec3Like;
  /** R3 NodeTransform Skew, in degrees. Optional — absent on legacy
   *  blueprints; renderer skips the extra group when undefined or
   *  all zero. */
  skew?: Vec3Like;
}
```

Optional + zero-default keeps every existing test green; the renderer
short-circuits when the skew is identity.

## 8. Pass-2 fix priorities (recommended order)

| # | Fix                                                | Visual impact         | Risk    | Effort |
|---|----------------------------------------------------|-----------------------|---------|--------|
| 1 | **Static `<Skew>` in parser + renderer (Option A)** | High — recovers all the parallelogram cards | Low — opt-in matrix | M |
| 2 | `Transform.Skew.{X,Y,Z}Prop` animation (re-targets skewLayer.matrix) | Medium for AR scenes | Low | S |
| 3 | `Pitch_Reference`-class authoring helpers hidden at runtime, toggle to re-show | Medium for GameName_FS — removes the yellow plate | Low — gate on `initialDisabledNodeIds` | S |
| 4 | `Size.YProp` animation → geometry rebuild | Medium for AR_TACTIC | Medium — touches geometry pipeline | M |

#1 is the biggest delta-per-effort. It alone recovers the broadcast
silhouette of GameName_FS. #3 clears the foreground plate that's
competing with the scoreboard. Neither of those four involves
`.vert`/`.ind` parsing — that stays on the long-term list, gated on
the hex-dump research from `docs/w3d-mesh-format-research.md`.

## 9. Out-of-scope reminders

* **Mesh `.vert`/`.ind` parser** — covered separately. No work here.
* **Larger refactor of the transform pipeline** — explicitly off the
  table. Option A above is additive: a new optional field, a new
  group inserted only when needed. Existing scenes import unchanged.

## 10. Acceptance for FASE C / Pass 2

A Pass-2 candidate is "done" when:

1. `npm test` and `npm run typecheck` are green.
2. Smoke summary for `GameName_FS` keeps node counts and warning
   count stable (only the "Skipped Skew" warning, if it ever existed,
   should disappear).
3. New unit test asserts a Quad with `<NodeTransform><Skew X="15"/>
   </NodeTransform>` produces a non-identity transform on the rendered
   wrapper hierarchy (e.g. mesh world position of a vertex offset
   matches `tan(15°) × Y`).
4. Visual confirmation in-editor on the dev box: the four ORANGE_*
   bars lean right by ~15°. AR scenes with no skew are pixel-identical
   to before.

— end of FASE C / Pass 1 —
