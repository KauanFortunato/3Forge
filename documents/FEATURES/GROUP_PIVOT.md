# Group Pivot

## Objective

Allow a `Group` to have a configurable pivot based on its current content, without changing the final visual result of the subtree in world space.

## Adopted definition

- The `Group` pivot is persisted as `pivotOffset`
- That value represents the displacement of the internal content container of the `Group`
- Preset calculation uses aggregated bounds from the current `Group` content in that content's local space
- The chosen preset is applied as an explicit operation, not as a dynamic behavior that recalculates itself whenever children change

## Supported presets

- `center`
- `bottom-center`
- `top-center`
- `left-center`
- `right-center`
- `front-center`
- `back-center`

## Main behavior

- When applying a preset, the editor calculates the new `pivotOffset` from the current bounds of the `Group` content
- The `Group`'s `transform.position` is mathematically compensated together with `rotation` and `scale`
- Direct and indirect children preserve the same visual positions in world space
- The subtree remains visually identical after the pivot change
- Empty `Group` is handled safely: without bounds, the calculated pivot falls back to `0,0,0`

## UI

- The `Inspector` now shows the `Pivot From Content` action for `Group`
- The user chooses a preset and explicitly applies the new pivot
- The interface makes it clear that the visible layout should not change

## Compatibility

- Old blueprints remain compatible
- Missing `pivotOffset` is normalized to `0,0,0`
- TypeScript export now reproduces the same `Group` structure with an internal content container

## Main files

- `src/editor/types.ts`
- `src/editor/state.ts`
- `src/editor/spatial.ts`
- `src/editor/scene.ts`
- `src/editor/exports.ts`
- `src/editor/react/App.tsx`
- `src/editor/react/components/InspectorPanel.tsx`

## Related tests

- `src/editor/state.test.ts`
- `src/editor/exports.test.ts`
- `src/editor/react/components/InspectorPanel.test.tsx`
