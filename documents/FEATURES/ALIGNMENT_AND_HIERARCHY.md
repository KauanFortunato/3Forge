# Alignment and Hierarchy

## Objective

Add more predictable spatial alignment tools to the editor and fix the `Group` copy/paste flow so that the `Hierarchy` reflects the result immediately.

## Features

### 1. `Shift` snapping during 3D drag

- Snapping works only in `translate` mode
- The behavior becomes active when the user holds `Shift` during the drag
- The moved object tries to align its center and edges with sibling objects in the same parent `Group`
- Alignment uses bounding boxes in world space to preserve visual predictability
- The final result continues to be persisted as a local transform in the `blueprint`

### 2. `Group` copy/paste in the Hierarchy

- The original paste behavior was preserved: when pasting with a `Group` selected, insertion still happens inside it
- The `Hierarchy` now automatically expands the path and selected node after paste so that the new copy appears immediately
- This fixes the visual bug without changing the semantics of the paste command

## Main files

- `src/editor/alignment.ts`
- `src/editor/scene.ts`
- `src/editor/state.ts`
- `src/editor/react/App.tsx`
- `src/editor/react/components/SceneGraphPanel.tsx`
- `src/editor/react/components/SecondaryToolbar.tsx`

## Related tests

- `src/editor/alignment.test.ts`
- `src/editor/state.test.ts`
- `src/editor/react/components/SecondaryToolbar.test.tsx`
- `src/editor/react/components/SceneGraphPanel.test.tsx`
- `src/editor/react/App.test.tsx`
