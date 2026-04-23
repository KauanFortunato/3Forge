# Editor UI/UX Refinement

## Objective

Raise the `3Forge` interface to a more professional level without replacing the existing visual identity. The focus of this revision was:

- strengthen the editor shell
- fix the structural bug between timeline and footer
- improve readability and hierarchy of the main chrome
- reduce inconsistencies between panels
- reinforce interface states and feedback

## What changed

### 1. Shell and lower dock

- The editor layout no longer depends on a flat grid with timeline and footer as fragile siblings.
- The timeline now lives in an explicit lower dock inside `app-shell__body`.
- The footer/status bar once again has a stable structural position separate from the timeline dock.
- Hiding the timeline now collapses the correct region without overlapping the footer.

### 2. Main toolbar

- The toolbar now separates more clearly:
  - project context
  - selection context
  - transformation tools
  - viewport modes
  - utilities and history
- The timeline toggle now communicates state directly: `Timeline On` / `Timeline Off`.
- Toolbar reading became less flattened and closer to professional authoring software.

### 3. Hierarchy

- Rows received clearer selection and ancestry states.
- Density became less cramped.
- Important actions no longer depend entirely on hover.
- Better keyboard and focus semantics were added to the tree.

### 4. Inspector and secondary panels

- The `Inspector` became more discoverable with visually labeled tabs, without depending only on icons.
- Empty states became more guided and less neutral.
- The `ExportPanel` gained an internal header with more context.
- `FieldsPanel` and `AnimationTimeline` now suggest the user's next step more clearly.

### 5. Visual system

- A small consistency system was reinforced with:
  - control heights
  - structural spacing
  - header heights
  - consistent focus ring
- `focus-visible` states were added for main controls.

## Root cause of the timeline/footer bug

The bug was not about `z-index`. The editor shell used an upper grid with conditional rows for timeline/splitter, but the footer did not have a structural contract isolated from the lower dock. When the timeline was hidden, track distribution became fragile and the footer could end up visually covered by editor content.

The fix was structural:

- footer kept as a fixed shell region
- timeline moved to its own lower dock
- separation between workspace layout and dock layout

## Expected result

- footer always readable and outside the timeline area
- predictable shell with panels visible or hidden
- more coherent toolbar, hierarchy, and inspector
- interface closer to professional 3D apps and creative tools
