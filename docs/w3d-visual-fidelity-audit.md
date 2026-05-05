# W3D Visual Fidelity Audit — FASE A (diagnóstico)

**Status:** observation only. NO code fixes in this round — they go in
FASE B once the priorities below are agreed.

**Data sources for this audit:**

* Smoke output captured in commits `9bba6e7` and prior on the dev box
  (`AR_GAMEINTRO`, `AR_PLAYER_V_PLAYER`, `AR_TACTIC`, `GameName_FS`).
* Static read of `src/editor/import/w3d.ts`, `src/editor/scene.ts`,
  `src/editor/animation.ts`.
* Direct inspection of the `<Position>` Z values in the
  `src/test/fixtures/w3d/GameName_FS.w3d` fixture.
* `src/editor/import/w3d.audit.test.ts` — opt-in audit dump created
  in this round. Re-run any time with:
  ```
  R3_AUDIT=1 R3_PROJECTS_ROOT="C:/Users/diogo.esteves/Documents/R3.Space.Projects/Projects" \
    npx vitest run src/editor/import/w3d.audit.test.ts --reporter=verbose
  ```
  It will print one structured JSON dump per scene covering everything
  itemised below — counts, asset resolution, opacity histograms,
  Z distribution by type, mask coverage, animated-track breakdown.

## 1. Per-scene snapshot (most recent smoke run)

| Scene                | mode  | bg          | nodes | byType (selected)                               | clips/kfs | warnings |
|----------------------|------|-------------|------:|--------------------------------------------------|----------:|---------:|
| `AR_GAMEINTRO`       | 3d   | transparent |  240  | group:137, image:2, plane:2, box:98, cylinder:1 |  2 / 9    | 5        |
| `AR_PLAYER_V_PLAYER` | 3d   | transparent |  297  | group:159, plane:31, box:98, text:8, cylinder:1 |  2 / 151  | 7        |
| `AR_TACTIC`          | 3d   | transparent |  380  | group:190, plane:71, box:98, text:20, cylinder:1|  24 / 1139| 6        |
| `GameName_FS`        | **2d** | `#000000` |   58  | group:21, image:22, plane:9, text:6             |  2 / 135  | 1        |

Camera authored pose is consumed once on first mount (perspective for
AR scenes, orthographic for `_FS`); subsequent navigation belongs to
the user.

### What the warnings still say

* All three AR scenes: `Skipped 98 <Mesh> primitives — no .vert/.ind asset`
  (FASE 4 of the prior round documents the binary loader plan; out of
  scope here).
* `AR_TACTIC` & `AR_PLAYER_V_PLAYER`: `Skipped N <AnimatedProperty>` for
  `Size.YProp` and `Transform.Skew.YProp` — geometry-level mutations
  with no Three.js direct equivalent. Not visual blockers but inform
  why some elements look static where they should breathe.
* `GameName_FS`: only the placeholder DirectionalLight warning remains
  (already preserved in `importMetadata.lights`, intentional).

## 2. ⚠ The big finding — 2D layering ignores authored Z

R3 broadcast 2D layouts encode draw order **on the Z axis** with very
small separations. Examples lifted directly from
`GameName_FS.w3d`:

```
Position Z="-0.001"   <-- foreground UI (text overlays, ticker)
Position Z="-0.002"
Position Z="-0.005"
Position Z="-0.01"
Position Z="-0.03"
Position Z="-0.16"
Position Z="-0.5"     <-- a deeper layer (likely a card/background)
```

The renderer's 2D path
(`scene.ts:917 applyPainterOrderingForLegacyLayout`) does:

```ts
this.store.blueprint.nodes.forEach((node, index) => {
  ...
  child.renderOrder = index;     // ← global DFS index
  m.depthWrite = false;
});
```

It **does not consult `node.transform.position.z`**. Order of draw is
the DFS walk order of the imported tree. R3's authoring convention is
"set Z to push something behind/in-front", and the XML's hierarchical
order does not always match that intent. When the two disagree the
result is exactly the symptom you described:

* a "background" Quad at Z=-0.5 declared *late* in the tree paints on
  top of foreground elements;
* a Text at Z=0 (default) authored *early* paints behind a background
  card declared after it;
* coplanar siblings at the same Z but different declaration positions
  flip arbitrarily.

This is the single highest-impact fix candidate.

**3D scenes are unaffected.** They go through
`applyCoplanarPolygonOffsetForLegacyLayout` which keeps the depth
buffer on and just nudges transparent overlays. Real geometry
occlusion is preserved — fixing 2D must not change the 3D path.

### Suggested fix (FASE B)

Replace the DFS-index sort key with a stable composite that puts
`worldZ` first (lower-Z = deeper = drawn first) and breaks ties using
the DFS index (so the existing convention still wins for siblings at
the same Z, including R3 templates with all-zero Z). Pseudocode:

```ts
const ordered = bp.nodes
  .map((n, i) => ({ n, i, z: worldZ(n) }))
  .sort((a, b) => a.z - b.z || a.i - b.i);
ordered.forEach((slot, k) => mesh.renderOrder = k);
```

`worldZ` accumulates ancestor Z values via the existing parent map.
One pass, no side effects on 3D, no zOffset hack.

## 3. Asset resolution

### What actually resolves

The combined lookup in `collectTextureLayerMap` covers:

* `<Texture Id="..." Filename="...">` → still images.
* `<ImageSequence Id="..." Name="...">` → video clips (FASE 2 of the
  prior round; `mimeType` already routes to `VideoTexture`).

Texture references in `<TextureMappingOption Texture="…">` resolve in
this priority:

1. Direct GUID match against the unified `textureById` map (Texture +
   ImageSequence).
2. Path form (`ProjectResource\X.png` / `Foo\Bar.jpg`) → basename hint.
3. Whatever the caller passed in `textures` (folder import).

### What can silently degrade

The `TextureLoader.load(src)` call at `scene.ts:1201` has **no error
callback**. If the URL 404s, CORS-blocks, or mime-mismatches, the
texture object is created but never gets pixel data — the mesh paints
the material's `color` (often `#ffffff`) until you reload. The user
sees "the image isn't there" without any console output beyond a
generic browser network error.

There is no equivalent issue for `<VideoTexture>` because the `<video>`
element fires its own DOM error event, but we don't listen to that
either.

### Fix candidate (FASE B, low risk)

Add `onError` to both loaders that:
1. logs `[scene] failed to load texture src=<path>: <error>`,
2. swaps the material's `map` to a 1×1 magenta debug texture so the
   broken layer is visually obvious instead of vanishing into white.

## 4. Visibility / opacity

The importer already routes three sources of "hidden":

| Reason                       | Where stored                                | Renderer respects? |
|------------------------------|---------------------------------------------|--------------------|
| `Enable="False"` (authored)  | `shadow.initialDisabledNodeIds` after promotion to visible=true | ✓ — design-view convenience, exporter restores |
| Texture missing              | `shadow.missingTextureNodeIds` (plane fallback) | ✓ — `isMissingTextureNode → object.visible=false` |
| `<Mesh>`/`<Model>` no buffer | `shadow.meshPlaceholderNodeIds`             | ✓ — same hidden path as missing-texture |
| `node.isMask`                | per-node flag                               | ✓ — wrapper invisible, mask used for clipping |

Per-scene counts (last smoke):

| Scene               | designView promoted | mesh placeholders (hidden) | mask declarators |
|---------------------|--------------------:|---------------------------:|-----------------:|
| `AR_GAMEINTRO`      | 2                   | 98                         | (audit pending)  |
| `AR_PLAYER_V_PLAYER`| 2                   | 98                         | (audit pending)  |
| `AR_TACTIC`         | 3                   | 98                         | (audit pending)  |
| `GameName_FS`       | 1                   | 0                          | (audit pending)  |

Mask totals will be filled in once the audit dump runs (the script is
ready, the test runner was unavailable during this write-up).

### Concern: design-view promotion may inflate the viewport

Broadcast templates park ~half their geometry under HELPERS / ESCONDER
groups marked `Enable="False"`. Promoting them to `visible=true` is the
right call for a designer who needs to see the whole tree, but may
worsen the layering symptoms by adding more competing quads. Worth
sanity-checking after the FASE B Z-sort fix — if the fix relies on Z
distribution, a flood of all-zero-Z helper geometry can dilute it.

## 5. Animation coverage

`tracksByProp` audit will land per-scene with the dump. Static read
from `w3d.ts`'s `W3D_PROPERTY_TO_PATHS` confirms current coverage:

* `Transform.Position.{X,Y,Z}Prop` ✓
* `Transform.Rotation.{X,Y,Z}Prop` ✓
* `Transform.Scale.{X,Y,Z}Prop` ✓ (and uniform `Transform.Scale` fan-out)
* `Enabled` → `visible` ✓
* `Alpha`, `Material.Alpha` → `material.opacity` ✓
* `TextureMappingOption.{Offset,Scale}.{X,Y}Prop` ✓ (FASE 3)

Still aggregated as "no track mapping":

* `Size.YProp` (90× in AR_TACTIC, 12× in AR_PLAYER_V_PLAYER) — animated
  primitive sizing.
* `Transform.Skew.{X,Y,Z}Prop` (90× in AR_TACTIC) — Three.js has no
  direct skew on Object3D; would require a custom shader or
  matrix-based wrapper.
* `Transform.Rotation.Y` (4× AR_GAMEINTRO, 6× AR_PLAYER_V_PLAYER, 12×
  AR_TACTIC) — note: legacy R3 spelling without the `.Prop` suffix.
  Should be a one-line alias in `W3D_PROPERTY_TO_PATHS`.
* `TextureMappingOption.Reflectivity` — environmental; safe to ignore.

## 6. Text-specific concerns (low confidence — audit dump pending)

`createTextNode` already reads `<TextBoxSize Y="...">` (FASE 6446ce3
of the prior rework) so the size pipeline isn't the cause of "text
glued onto background". Hypotheses, ranked:

1. **Same-Z collision** — both the text and its background sit at
   Z=-0.001 (or both at default Z=0), and the painter-by-DFS-index
   path picks the wrong order. The Z-sort fix in §2 dissolves this
   without any text-specific code change.
2. **Pivot/anchor mismatch** — possible but no concrete evidence yet.
   The audit dump's `byType.text` counts plus a spot-check of one
   text node's `transform` will tell.
3. **TextGeometry default depth** — broadcast 2D usually wants
   depth=0, but `geometry.depth` defaults to a non-zero value via the
   spec defaults. Worth confirming once §2 is fixed and we still see
   text "popping" through backgrounds.

I'm deliberately *not* adding text fixes to FASE B until §2 lands and
we re-audit — most "text glued" symptoms collapse once the layering
sort key is right.

## 7. Camera / projection

Verified by smoke output:

| Scene               | mode | cam.mode      | fovY | pos               |
|---------------------|------|---------------|-----:|-------------------|
| `AR_GAMEINTRO`      | 3d   | perspective   | 50   | (0, 7, 22)        |
| `AR_PLAYER_V_PLAYER`| 3d   | perspective   | 50   | (0, 7, 22)        |
| `AR_TACTIC`         | 3d   | perspective   | 50   | (0, 7, 22)        |
| `GameName_FS`       | 2d   | orthographic  | n/a  | (0, 0, 3.8)       |

`detectSceneMode` is doing its job (folder-name + heuristics outrank
`Is2DScene`), and `frameAllForCurrentMode` only auto-frames when the
asset doesn't pin a camera pose, so tracked broadcast cameras keep
their authored pose. No camera-side fix recommended in FASE B.

## 8. Static-analysis checks for non-regression in FASE B

Before any fix lands:

* The Z-sort change must keep the existing iteration over
  `bp.nodes` for every node — masks, mesh placeholders and design-view
  hidden nodes already participate in `objectMap` lookups by `node.id`,
  so swapping the iteration order doesn't change the mask resolver
  (`applyMasks`) or the visibility decision (`isMissingTextureNode`).
  Only the assigned `renderOrder` changes.
* `applyCoplanarPolygonOffsetForLegacyLayout` (3D path) stays
  untouched.
* No change to `MaterialSpec.depthWrite` defaults — only the per-mesh
  Three property is overwritten by the painter pass, same as today.

## 9. Prioritised fix proposals for FASE B

| # | Title                                         | Impact (visual)                              | Risk  | Effort |
|--:|-----------------------------------------------|----------------------------------------------|-------|--------|
| 1 | **Sort 2D `renderOrder` by world-Z, DFS as tiebreak** | High — directly addresses "everything looks glued / wrong layer". | Low — 2D-only branch. | S  |
| 2 | Add `onError` to texture & video loaders (debug magenta + console warn) | Medium — turns silent failures into visible diagnostics. | Very low. | XS |
| 3 | Alias `Transform.Rotation.Y` (no `.Prop`) in property table       | Medium for AR scenes — recovers ~22 dropped tracks. | None — additive map entry. | XS |
| 4 | Audit-script polish: persist last run as `docs/w3d-audit-snapshot.json` so PRs can show before/after counts | Process improvement only. | None. | S |
| 5 | Investigate `Transform.Skew` mapping (matrix-based wrapper) | Medium for AR_TACTIC — 90 dropped tracks. | Medium — touches transform pipeline. | M |

(`Size.YProp` and `Reflectivity` deliberately not listed — first
needs primitive-level work, second is environment-map territory we
don't render at all.)

## 10. Out-of-scope reminders

* **Mesh `.vert`/`.ind` parser** — covered separately in
  `docs/w3d-mesh-format-research.md`. No work here until the hex dump
  comes back.
* **Inspector UI label polish** for the new texture-options animation
  paths added in FASE 3 — visible in the timeline already, copy can
  improve later.

## 11. Acceptance for FASE B

A FASE B candidate is "done" when:

1. `npm test` and `npm run typecheck` are green.
2. The smoke summary for `GameName_FS` reports the same node counts
   and warning count as today (no regression).
3. A new unit test asserts that for a synthetic 2-node 2D scene with
   `[A.z=-0.5, B.z=-0.001]` declared in the order `[A, B]`, the
   resulting `renderOrder` puts A behind B regardless of array
   position.
4. Visual confirmation in-editor on the dev box for at least
   `GameName_FS` — backgrounds at the back, text at the front.

— end of FASE A —
