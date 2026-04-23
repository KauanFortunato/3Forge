# Feature History

This file records functional changes to the project during development.

## Suggested format

Each entry should indicate:

- date
- change type: `added`, `changed`, or `removed`
- short feature name
- objective summary of what changed
- main impacted files
- added or updated tests, when applicable

## Entries

### 2026-04-16

- `added`: Initial test foundation
  Summary: configured the test infrastructure with `Vitest`, `jsdom`, and `React Testing Library`, with initial coverage for blueprint, TypeScript export, materials, fonts, images, animation, and critical React components.
  Main files: `package.json`, `vitest.config.mjs`, `src/test/setup.ts`, `src/test/fixtures.ts`
  Tests: `src/editor/state.test.ts`, `src/editor/exports.test.ts`, `src/editor/animation.test.ts`, `src/editor/materials.test.ts`, `src/editor/fonts.test.ts`, `src/editor/images.test.ts`, `src/editor/react/components/ExportPanel.test.tsx`, `src/editor/react/components/InspectorPanel.test.tsx`

- `added`: 3D alignment with `Shift`
  Summary: `translate` mode now offers center and edge snapping while holding `Shift`, comparing the dragged object with sibling objects in the same parent `Group`.
  Main files: `src/editor/alignment.ts`, `src/editor/scene.ts`
  Tests: `src/editor/alignment.test.ts`

- `added`: Center In Group
  Summary: an explicit action was added to align the rendered center of the selected object to the structural center of the parent `Group`.
  Main files: `src/editor/state.ts`, `src/editor/react/App.tsx`, `src/editor/react/components/SecondaryToolbar.tsx`
  Tests: `src/editor/state.test.ts`, `src/editor/react/components/SecondaryToolbar.test.tsx`

- `changed`: Default `Group` paste in the Hierarchy
  Summary: paste preserves the original insertion semantics and the `Hierarchy` now automatically reveals the newly pasted `Group`, expanding the relevant path without requiring additional manual action.
  Main files: `src/editor/react/App.tsx`, `src/editor/react/components/SceneGraphPanel.tsx`
  Tests: `src/editor/react/components/SceneGraphPanel.test.tsx`, `src/editor/react/App.test.tsx`

- `added`: Configurable pivot for `Group`
  Summary: `Group` now supports persisted pivot via `pivotOffset`, with explicit application of presets calculated from the current content bounds and mathematical compensation to preserve the visual world layout.
  Main files: `src/editor/types.ts`, `src/editor/state.ts`, `src/editor/spatial.ts`, `src/editor/scene.ts`, `src/editor/exports.ts`, `src/editor/react/components/InspectorPanel.tsx`
  Tests: `src/editor/state.test.ts`, `src/editor/exports.test.ts`, `src/editor/react/components/InspectorPanel.test.tsx`

- `removed`: Center In Group
  Summary: the action that aligned the object to the parent center was removed from the editor, store, and toolbar because it no longer made sense in the current pivot and groups flow.
  Main files: `src/editor/state.ts`, `src/editor/react/App.tsx`, `src/editor/react/components/SecondaryToolbar.tsx`
  Tests: `src/editor/state.test.ts`, `src/editor/react/components/SecondaryToolbar.test.tsx`

### 2026-04-17

- `changed`: Editor shell, footer, and timeline
  Summary: the timeline now lives in an explicit lower dock inside the editor shell, correctly separating workspace, timeline, and status bar. This fixes the structural bug where hiding the timeline caused the UI to overlap the footer.
  Main files: `src/editor/react/App.tsx`, `src/editor/editor.css`
  Tests: `src/editor/react/App.test.tsx`

- `changed`: Toolbar, hierarchy, inspector, and empty-state refinement
  Summary: the toolbar was reorganized to clarify context, selection, tools, and utilities; the hierarchy gained clearer states and better focus; inspector, fields, export, and timeline received discoverability and guidance improvements.
  Main files: `src/editor/react/components/SecondaryToolbar.tsx`, `src/editor/react/components/SceneGraphPanel.tsx`, `src/editor/react/components/InspectorPanel.tsx`, `src/editor/react/components/AnimationTimeline.tsx`, `src/editor/react/components/ExportPanel.tsx`, `src/editor/react/components/FieldsPanel.tsx`, `src/editor/editor.css`
  Tests: `src/editor/react/components/SecondaryToolbar.test.tsx`

- `changed`: 3Forge design guidelines
  Summary: the design skill was updated to reflect more specific rules about the editor shell, docks, interaction states, density, tabs, visible actions, and consistency between panels.
  Main files: `.agents/skills/DESIGN.md`, `documents/FEATURES/EDITOR_UI_UX_REFINEMENT.md`

- `added`: Export Runner for `.ts`
  Summary: a separate playground was created to validate components exported in TypeScript, with a simple viewport, real mounting of the exported class, options JSON, and animation controls when the API exists.
  Main files: `playgrounds/export-runner/`, `package.json`, `tsconfig.json`, `vitest.config.mjs`, `documents/FEATURES/TYPESCRIPT_EXPORT_RUNNER.md`
  Tests: `playgrounds/export-runner/src/runtime.test.ts`

### 2026-04-18

- `changed`: TypeScript export pipeline
  Summary: export now separates clip definition, timeline instantiation, and playback control, replacing imperative per-clip generation with stable definitions and timeline caching per clip.
  Main files: `src/editor/exports.ts`, `src/editor/exports.test.ts`, `src/editor/exports.runtime.test.ts`, `documents/FEATURES/EXPORT_OPTIMIZATION.md`
  Tests: `src/editor/exports.test.ts`, `src/editor/exports.runtime.test.ts`

- `changed`: Exported animation API
  Summary: exported components now expose `restart()`, `reverse()`, and `getClipNames()`, with `seek()` and `createTimeline()` reusing timelines per clip instead of rebuilding the structure on every call.
  Main files: `src/editor/exports.ts`, `playgrounds/export-runner/src/runtime.ts`, `playgrounds/export-runner/src/ExportRunnerApp.tsx`
  Tests: `src/editor/exports.runtime.test.ts`, `playgrounds/export-runner/src/runtime.test.ts`

- `added`: PWA foundation
  Summary: the editor now generates `manifest.webmanifest`, a `service worker` for the app shell, and mobile/iOS meta tags for installation, without assuming full offline support at this stage.
  Main files: `vite.config.mjs`, `scripts/pwa-config.mjs`, `src/editor/pwa.ts`, `src/editor/main.tsx`, `index.html`
  Tests: `src/editor/pwa.test.ts`, `src/editor/pwa-config.test.ts`

- `changed`: Entry flow, local persistence, and recents
  Summary: the welcome screen now distinguishes reload from re-entry, local workspace was separated from the external file, `Exit` preserves the local snapshot, and `Save` / `Save As` now respect handles, fallback, and recents.
  Main files: `src/editor/react/App.tsx`, `src/editor/workspace.ts`, `src/editor/fileAccess.ts`, `src/editor/recentFileHandles.ts`, `src/editor/clipboard.ts`
  Tests: `src/editor/react/App.test.tsx`, `src/editor/workspace.test.ts`, `src/editor/fileAccess.test.ts`, `src/editor/clipboard.test.ts`

- `changed`: Responsive UI for phone viewer and tablet editor
  Summary: the editor now distinguishes `phone`, `tablet`, and `desktop`; phone uses launcher + viewport + mobile playback, while tablet keeps the editor in compact mode with a reorganized toolbar and better panel stacking.
  Main files: `src/editor/react/App.tsx`, `src/editor/react/components/PhoneViewerChrome.tsx`, `src/editor/editor.css`
  Tests: `src/editor/react/App.test.tsx`
