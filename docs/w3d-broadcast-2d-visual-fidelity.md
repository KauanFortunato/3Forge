# W3D broadcast 2D visual fidelity (FASE H)

Operator-facing notes covering the visual gap between the imported
GameName_FS scene and the R3 reference thumbnail, and the two parser /
editor fixes that close it.

## Symptom

Side-by-side comparison (FASE H spec):

* **R3 reference (thumbnail)** — clean broadcast 2D layout: court,
  players, two team logos, "VS" text. Camera dead-on overhead.
* **App actual (before this pass)** — same scene, but with TWO huge
  white diagonal/skewed bars dominating the canvas (one upper-right,
  one lower-left), and the entire scene visibly tilted as if the
  camera had been orbited a few degrees off-axis.

The diagonals are the most jarring difference; the tilt is the
secondary one. Both regress the "preview must look like the broadcast
output" promise of the editor.

## Root cause #1 — design-view promotion was too aggressive (this commit)

The W3D parser carries a deliberate "design-view" rule (FASE C /
Pass 2): every node imported from the XML is forced to `visible = true`,
regardless of its source `Enable` attribute. This exists because R3
broadcast templates park scaffolding (HELPERS, ESCONDER, Pitch_Reference)
under parent groups with `Enable="False"`; respecting those flags
literally would hide >50% of what the operator needs to *see and edit*
in the editor. The original `Enable="False"` is preserved in the
shadow data so round-trip export is non-destructive.

That rule is correct for *scaffolding*. It's wrong for *content*.

`GameName_FS/scene.w3d` has a node `PITCH_Out` (Enable="False") wired
to the take-out animation `04_Game_Name_PITCH_OUT.mov`. The runtime
triggers it only when the segment ends; until then it should be
invisible. After FASE G's sequence-first resolution lands, that node
binds to a PNG sequence whose **frame 1 is the very start of the sweep
animation — a thin white diagonal bar**. With the design-view rule
overriding the XML, the editor renders frame 1 as a static rectangle.
Result: a giant white diagonal painted across the canvas.

The fix: after the image asset binds (so we know the mime type), if
the source XML had `Enable="False"` AND the mime is `video/*` or
`application/x-image-sequence`, leave `node.visible = false`. Static
plane / text / group nodes still get the design-view promotion, so
the FASE C contract for non-content nodes is preserved.

The companion `initialDisabledNodeIds` shadow set still records the
original disabled state — exporters and any future "show hidden in
editor" toggle keep working unchanged.

## Root cause #2 — camera not locked for 2D scenes (Agent B's commit)

The scene loads with `sceneMode = "2d"` (the W3D root has
`Is2DScene="True"`), but the editor camera was free-orbit by default.
A small mouse drag during inspection was enough to leave the camera
at a slightly tilted angle, which the next render captured as the
"3D-ish broadcast" look. The fix locks the camera to a fixed
orthographic dead-on view whenever `sceneMode === "2d"`. See the
sibling commit on `src/editor/scene.ts` for details.

## Out of scope (acknowledged, not fixed here)

* **Identical team logos on both sides** — the static fixture wires
  the same `LogoLKL.png` to both `HOME` and `AWAY` slots. Real
  broadcasts swap one of them at runtime via R3's data binding
  (ExportProperty + segment metadata). That's a runtime feature, not
  an importer concern.
* **Background grid lines visible** — the editor's helper grid is
  always on. A future "preview mode" UI toggle should hide it (along
  with axes, gizmos, selection rings) for screenshot fidelity.
* **Text z-order quirks** — likely resolve themselves once `PITCH_Out`
  hides; a hidden full-screen rectangle was effectively yanking other
  layers out of plane via the depth tie-break. If anything still
  looks off after both fixes land, file a follow-up.

## Validation

After this commit + Agent B's commit are both on `feat/w3d-scene-support`:

```js
// In the editor devtools, with GameName_FS loaded:
const d = window.__r3Dump();
const pitchOut = d.nodes.find(n => n.name === "PITCH_Out");
console.log("PITCH_Out visible:", pitchOut.visible);  // → false

const pitchIn = d.nodes.find(n => n.name === "PITCH_IN");
console.log("PITCH_IN visible:", pitchIn.visible);    // → true (Enable=True)
```

Visually, the canvas should now match the R3 reference: no white
diagonals, court dead-on, players + logos + VS text on top.

Test invariants locked in `src/editor/import/w3d.test.ts`:

* `invariant: initially-disabled video/image-sequence nodes stay hidden …`
* `invariant: image-sequence nodes also respect Enable=False (consistency with video)`

Both exercise the GameName_FS fixture; the second one explicitly
covers the `application/x-image-sequence` mime path so the rule
doesn't drift away from sequences when only `video/*` is touched.

## Future passes

* **Strict broadcast preview mode** — UI toggle that hides the grid,
  axes, helpers, selection chrome, and any node still tagged as
  scaffolding. Useful for screenshots and for QA against the R3
  reference without taking the editor offline.
* **Runtime data binding** — wiring `HOME`/`AWAY` text + logo slots
  to a segment metadata payload, so the editor can preview a
  populated broadcast (e.g. live game state) instead of the static
  template. This is a much larger feature; track it separately.
* **"Show hidden in editor" toggle** — surface the
  `initialDisabledNodeIds` set in the inspector so authors can
  optionally see / select nodes whose `Enable="False"` we now respect
  (videos, sequences) without losing the round-trip guarantee.
