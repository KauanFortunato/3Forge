# Blender-Like Keyframing Workflow — Design

Date: 2026-05-02
Branch: `feature/blender-keyframing-workflow`

## Goal

Let users keyframe animatable properties directly from the property inspector — Blender-style — by clicking a diamond next to the field. Keep the existing runtime/code-exposed-field toggle, but make it visually distinct (`<>` icon). The two systems are completely independent.

```
[Property Label] [Input Field] [Keyframe Diamond] [<> Runtime Code Field]

Position X    [ 0.00 ]   ◇   <>
Rotation Y    [ 1.57 ]   ◆   <>
```

## Non-Goals

- No blueprint schema change.
- No new animation features (auto-key, multi-property record, ghost keys, etc.).
- No redesign of the timeline UI itself.
- No change to runtime-field storage or codegen.

## Architecture

### Data model — unchanged

The existing types in `src/editor/types.ts` are reused as-is:

```ts
AnimationKeyframe { id; frame; value; ease }
AnimationTrack    { id; nodeId; property; muted?; keyframes }
AnimationClip     { id; name; fps; durationFrames; tracks }
ComponentAnimation{ activeClipId; clips }
```

`AnimationPropertyPath` already enumerates the animatable paths: `visible | transform.{position,rotation,scale}.{x,y,z}`. The diamond renders only for these paths.

`ComponentBlueprint.version` stays `1`. Existing saved projects load unchanged.

### State

- `currentFrame` stays as React state in `App.tsx` and is passed into `InspectorPanel` as a prop.
- New `EditorStore` methods take `frame` as an explicit parameter rather than reading global playhead state — keeps the store stateless about the playhead and matches existing patterns.
- Active clip = `animation.clips.find(c => c.id === animation.activeClipId)`.

### Derived flags per row

Computed in `PropertyRow` from `(activeClip, selectedNode.id, propertyPath, currentFrame)`:

- `isAnimated` — track exists with ≥ 1 keyframe.
- `hasKeyAtFrame` — track has a keyframe whose `frame === currentFrame`.

These two booleans drive both the diamond visual and the edit-routing decision.

## Helpers (`src/editor/animation.ts`)

Pure functions, easy to unit-test:

```ts
findTrack(clip, nodeId, path): AnimationTrack | undefined
findKeyframeAtFrame(track, frame): AnimationKeyframe | undefined
isPropertyAnimated(clip, nodeId, path): boolean
hasKeyframeAtFrame(clip, nodeId, path, frame): boolean
getEvaluatedPropertyValue(node, path): number | boolean
```

## EditorStore methods (`src/editor/state.ts`)

All push to the undo stack and emit a change event.

- `insertOrUpdateKeyframe(nodeId, path, frame, value)` — ensures active clip; creates the track if missing; inserts a keyframe at `frame` or updates the existing one. Never duplicates a keyframe at the same frame. Sorts keyframes by frame.
- `removeKeyframeAtFrame(nodeId, path, frame)` — used by Alt+click. If it removes the last keyframe, the track is left in place (empty track is harmless and lets the user keep the channel).
- `commitPropertyEdit(nodeId, path, value, frame)` — the routing hub:
  - Animatable path AND track exists AND keyframe at `frame` → update keyframe value. Base transform untouched.
  - Otherwise → existing `setNodeProperty` / `setNodesProperty` writes the base value.

## UI

### Icons (`src/editor/react/components/icons.tsx`)

- `KeyframeDiamondIcon({ filled, animated })` — three visual states:
  - `animated=false` → outlined neutral grey diamond
  - `animated=true, filled=false` → outlined orange/amber diamond
  - `filled=true` → filled orange diamond
- `CodeBracketsIcon({ active })` — `<>` glyph; outlined when inactive, filled when active.

The original `CircleIcon`/`CircleFilledIcon` exports are preserved (used elsewhere); only the runtime-editable label inside `PropertyRow` swaps to `CodeBracketsIcon`.

### `PropertyRow` (`InspectorPanel.tsx`) layout

```
[Label] [Input] [Diamond ◇/◆] [<> Toggle]
```

- The `<>` toggle keeps its existing data path, handler and storage (`node.editable[path]`). Only the icon changes.
- The diamond is a new `<button class="row__keyframe">` rendered only when `propertyDef.path` ∈ `AnimationPropertyPath`. It has:
  - `aria-pressed={hasKeyAtFrame}`
  - tooltip switches between "Insert keyframe" / "Update keyframe" / "Property is animated"
  - onClick → insert/update at `currentFrame`
  - Alt+click → remove keyframe at `currentFrame`

Plumbed into `InspectorPanel`: `currentFrame`, `activeClip`, `onInsertOrUpdateKeyframe`, `onRemoveKeyframe`.

## Edit transaction routing

`NumberDragInput` already exposes `onPreview` and `onCommit`. We reuse them:

1. **Focus / drag start** — `NumberDragInput` snapshots the previous value internally.
2. **`onPreview(value)`** — written directly onto the live Three.js node for viewport feedback. **No blueprint mutation, no store event.**
3. **`onCommit(value)`** — App.tsx calls `store.commitPropertyEdit(nodeId, path, value, currentFrame)`. Routing as above.
4. **Cancel (Escape / blur-without-change)** — `NumberDragInput` swallows the edit. Since previews never touched persistent data, calling `applyAnimationFrame(currentFrame)` once snaps the live node back to the evaluated value (or re-reads the base if not animated).

Subtle but important: when on a keyframe, the inspector reads `node.transform.position.x`, which `applyAnimationFrame` has already overwritten with the keyframe value — so the displayed value IS the keyframe value. After commit-to-keyframe, the next evaluation re-writes that same value. The base/blueprint value is never read or written during this interaction. This is the fix for the "editing a keyframe overwrote the base transform" bug.

When the playhead is between two keyframes, the displayed value is interpolated. Per spec, we route to base only when **not** keyed at the current frame, and we explicitly do **not** auto-key — so editing in that state writes to the base, the documented contract.

## Tests

### Helper unit tests (`animation.test.ts`)

- `findTrack` returns track / undefined.
- `findKeyframeAtFrame` exact frame match / undefined otherwise.
- `isPropertyAnimated` true only with ≥ 1 keyframe.
- `hasKeyframeAtFrame` combines correctly.

### Store tests (`state.test.ts`)

- `insertOrUpdateKeyframe` creates the track on first call.
- Two inserts at the same frame → one keyframe, value updated.
- Inserts at different frames → keyframes sorted.
- `commitPropertyEdit` on a keyed-at-frame property → keyframe updated, base unchanged.
- `commitPropertyEdit` on a non-keyed property → base updated, no track created.
- `removeKeyframeAtFrame` removes only that keyframe.
- Undo/redo round-trips for insert/update/remove.

### Component tests (`InspectorPanel.test.tsx`)

- Diamond renders only on animatable rows.
- Tooltip text matches state.
- Clicking diamond fires the keyframe callback with `currentFrame`.
- Clicking `<>` fires the editable handler and does NOT call the keyframe callback.

### Backwards compatibility

Existing tests (`state.test.ts`, `animation.test.ts`, `AnimationTimeline.test.tsx`) keep passing — proves loading old blueprints, normalization, and timeline UI are untouched.

## Acceptance Criteria (from request)

All criteria from the original request are satisfied by this design:

- Diamond next to animatable transform fields creates / updates keyframes at `currentFrame`.
- Channel auto-creates if missing.
- Diamond is filled when on a keyframe, outlined-animated when track exists but no key at current frame, plain when not animated.
- Editing while on a keyframe updates the keyframe (not the base).
- Cancelling an edit reverts via re-evaluation; nothing persistent is touched on preview.
- No duplicate keyframes at the same frame.
- `<>` button toggles only the existing runtime-editable binding; never touches keyframes.
- A field can be both animated and runtime-editable simultaneously.
- Existing blueprints, animation export, and runtime-field export keep working — schema and codegen are unchanged.
- TypeScript stays strict.
