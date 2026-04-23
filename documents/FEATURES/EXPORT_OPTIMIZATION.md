# Export Optimization

## Objective
Improve the 3Forge TypeScript export pipeline with a focus on:

- more predictable structure for larger scenes
- more efficient runtime for timelines
- clearer animation control API
- less redundancy in exported code

## What changed

### Exported timelines
- Export no longer generates a `buildTimelineForClip` function with `switch` and imperative per-clip construction.
- Generated code now exports stable clip definitions (`animationClipDefinitions`) and an explicit clip order (`animationClipOrder`).
- The exported class now creates timelines on demand and reuses the same instance per clip through `timelineCache`.
- `createTimeline()` now behaves as a neutral accessor: it creates or returns the requested clip timeline without changing playback by itself.
- The animation API now exposes:
  - `getClipNames()`
  - `createTimeline()`
  - `playClip()`
  - `play()`
  - `pause()`
  - `restart()`
  - `reverse()`
  - `stop()`
  - `seek()`

### Reverse and replay
- Reverse no longer depends on an infinite looping timeline.
- Each exported clip is now finite and can be:
  - restarted with `restart()`
  - played again with `play()` after it ends
  - reversed predictably with `reverse()`
- When the clip is at the beginning and the user calls `reverse()`, the runtime moves the clip to the end before starting reverse playback.

### Overall export structure
- Collection of `bindings`, `fonts`, and `images` was consolidated into a single stage.
- Missing font failures are now detected before text node emission.
- Export no longer rebuilds the timeline just to read metadata in `seek()`.

## Adopted technical definition
- The blueprint remains the source of truth.
- Export transforms tracks and keyframes into a normalized per-clip representation:
  - `nodeId`
  - `target` (`position`, `rotation`, `scale`)
  - `key` (`x`, `y`, `z`)
  - initial value
  - segments with `at`, `duration`, `value`, and `ease`
- The initial value of each track is applied from time `0`, even when the first keyframe appears later, to preserve the initial state and predictable reverse behavior.
- The component instance resolves `nodeRefs` in `build()` and only then creates timelines for the clips that are actually used.
- Control methods (`play`, `restart`, `reverse`, `seek`, `stop`) follow this clip selection order:
  - explicitly requested clip
  - current active clip
  - first available clip in `animationClipOrder`

## Practical gains
- Less timeline recreation when switching between `play`, `seek`, `restart`, and `reverse`
- Lower coupling between animation definition and playback control
- Better foundation for scenes with more clips and more tracks
- Exported output that is easier to maintain and extend in the future
