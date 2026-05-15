# Repository Guidelines

## Project Structure & Module Organization

**Editor core** (`src/editor/`):
- `scene.ts` — Three.js scene orchestration, raycasting, transform gizmo, model parse cache, selection helpers
- `state.ts` — `EditorStore` class (the source of truth): blueprint nodes, undo/redo, selection (`selectedNodeId`, `selectedNodeIds`, `selectedPartId`), assets (models, materials, images, fonts), animation tracks, scene settings
- `types.ts` — all serializable shapes (`EditorNode` union, `ModelAsset`, `ModelAssetStructure`, `MaterialSpec`, `ComponentBlueprint`, etc)
- `exports.ts` — generated TypeScript runtime emit (`generateTypeScriptComponent`)
- `gltfExport.ts` — GLB/GLTF/USDZ binary export pipeline
- `exportPackage.ts` — full project ZIP export
- `aiBlueprint.ts` — AI-driven scene/animation generation (Anthropic + OpenAI providers)
- `animation.ts` — keyframe interpolation, easing, track sampling
- `materials.ts`, `materialsRegistry.ts`, `sharedProperties.ts` — material slot system
- `modelStructure.ts` — `buildStructureFromGroup` + `findObjectByIndexPath` for hierarchy parts
- `hdr.ts` — HDR environment loading
- `pwa.ts`, `pwa-register.ts`, `recentFileHandles.ts`, `workspace.ts`, `fileAccess.ts` — workspace persistence + File System Access API integration

**React UI** (`src/editor/react/`):
- `App.tsx` — top-level shell, all panels wired here
- `components/` — panels and dialogs:
  - `SceneGraphPanel.tsx` — hierarchy with model parts + per-part visibility/selection
  - `InspectorPanel.tsx`, `MaterialsPanel.tsx`, `MaterialAssetEditor.tsx`, `FieldsPanel.tsx`
  - `AnimationTimeline.tsx` — keyframe timeline
  - `LoadingOverlay.tsx` — blocking overlay + status bar progress chip (for heavy imports)
  - `ImageAssetsPanel.tsx`, `ModelAssetsPanel.tsx`
  - `ExportPanel.tsx`, `SettingsDialog.tsx`, `AIGenerateDialog.tsx`, `ShortcutDialog.tsx`
  - `HdrEnvironmentPreview.tsx`, `PhoneViewerChrome.tsx`, `ViewportHost.tsx`
- `hooks/` — `useEditorStoreSnapshot`, `useAsyncTask` (the task registry), `useGlobalHotkeys`, `useTheme`
- `ui-types.ts` — `EditorStoreView`, `TreeBranch`, `TreeDropTarget`, etc

**WASM modules** (`src/lib/openusd/`, `public/wasm/openusd/`):
- `openusd/` — USD parser (TS in `src/lib/openusd/`, WASM in `public/wasm/openusd/`). This is the **only** USDZ parser in the project — Three.js's `USDLoader` is kept solely as a last-resort fallback for files OpenUSD throws on.

**OpenUSD wrapper source** (`scripts/openusd-wasm-build/`):
- `wrapper.cpp` — C++ embind bindings over OpenUSD (built into `public/wasm/openusd/openusd.{js,wasm,data}`)
- `build.sh` — Linux/WSL `em++` invocation
- `test.mjs` — standalone node smoke test
- `README.md` — sync + build workflow

**Documentation** (`docs/`):
- `openusd-wasm-pipeline.md` — full design + bug catalog of the OpenUSD pipeline. **Read this before touching `wrapper.cpp`, `src/lib/openusd/`, or the USDZ branch in `scene.ts`.**
- `plans/` — historical design docs
- `superpowers/specs/` — UI design specs

**Other**:
- `playgrounds/export-runner/` — standalone preview app for exported components
- `public/assets/` — fonts, web assets, default materials
- `scripts/` — Vite wrapper, PWA config

## Build, Test, and Development Commands

Use the Node version from `.nvmrc` (`nvm use` on supported shells) or Node `>=22.12.0`.

- `npm install` — install dependencies
- `npm run dev` — start the Vite editor locally with host exposure and auto-open
- `npm run build` — create a production bundle in `dist/`
- `npm run preview` — serve the production build locally
- `npm run test` — run the automated test suite with Vitest
- `npm run typecheck` — run TypeScript compiler to check for type errors
- `npm run validate` — run full validation (types, tests, and build). **ALWAYS run this command before committing changes.**

**OpenUSD WASM rebuild** (only when `scripts/openusd-wasm-build/wrapper.cpp` changes — see `docs/openusd-wasm-pipeline.md` for the workflow):
1. Sync repo source to WSL: `cp scripts/openusd-wasm-build/{wrapper.cpp,build.sh} ~/wasm/openusd-wrapper/`
2. In WSL: `cd ~/wasm/openusd-wrapper && ./build.sh`
3. Copy artifacts back: `cp ~/wasm/openusd-wrapper/openusd.{js,wasm,data} <repo>/public/wasm/openusd/`
4. Hard refresh in browser

## Coding Style & Naming Conventions

This repo uses TypeScript with `strict` mode and React JSX. Follow the existing style: 2-space indentation, double quotes, semicolons, and trailing commas where the formatter would keep them. Use `PascalCase` for React components and editor classes, `camelCase` for functions and state helpers, and `useX` names for hooks. Keep CSS class names descriptive and component-scoped, as in `landing-page__title` and `panel__body`.

Avoid speculative comments and dead code. Don't add backwards-compatibility shims when you can change the code directly. The `EditorStore` mutates blueprint nodes in place after `recordHistorySnapshot()` — follow that pattern instead of inventing new immutable update helpers.

## Testing Guidelines

The project uses **Vitest** for unit and integration testing, and **React Testing Library** for UI components. Tests are located alongside the files they cover (e.g., `state.test.ts` next to `state.ts`).

- When adding new features, include corresponding test files.
- Ensure that `npm run test` passes without failures.
- Use `jsdom` environment for tests involving the DOM or React components.
- Mock external dependencies where necessary to maintain isolation.
- For tests of components that take many props (e.g. `SceneGraphPanel`), prefer making new optional props with safe defaults to avoid touching every existing test.

## Commit & Pull Request Guidelines

Recent commits use short, imperative subjects such as `Fix viewport right-click drag context menu` and `Add GSAP animation timeline and editor polish`. Keep commit titles concise, sentence case, and focused on one change. PRs should describe the user-visible impact, note any export or data-model changes, link related issues, and include screenshots or short recordings for UI changes.

Co-Authored-By trailers go on commits made on the user's behalf by Claude. Don't skip pre-commit hooks (`--no-verify`) unless the user explicitly asks.

## Architecture Overview

### Source of truth: the blueprint
The editor's source of truth is a serializable `ComponentBlueprint`: component name, node hierarchy (`EditorNode[]` with `parentId` chains rooted at `ROOT_NODE_ID`), transforms, geometry, materials (`MaterialAsset[]`), models (`ModelAsset[]`), images, fonts, animation tracks, editable bindings, and scene settings. Changes made in the UI should update that model first via `EditorStore`, then flow into rendering and export. Preserve both export targets when changing the data model: blueprint JSON for persistence and generated TypeScript for runtime `three` integration.

### USDZ / 3D model pipeline
USDZ imports go through **OpenUSD WASM** (primary) with Three.js's `USDLoader` as a last-resort fallback. The pipeline lives in `src/lib/openusd/openusdParser.ts` and the integration in `scene.ts → buildModelObject`.

Key invariants you must preserve:
- **Per-asset parse cache** (`SceneEditor.modelGroupCache`) — without it, every scene update re-parses the WASM. Always clone the cached `Group` (`group.clone(true)`) before adding it to a wrapper.
- **Index-path part IDs** — `ModelAssetStructureNode.id` is `"0.1.2"` (child indices), stable across `clone(true)`. Do NOT use UUIDs because clones produce new ones.
- **partId tagging** — `tagForNode` in `scene.ts` writes `userData.partId` on each part using its index path. The picker's `findPartId` and the selection helper's `collectSelectionPartObjects` rely on this.
- **Resolver context binding** — when reading USDZ-internal asset paths from C++, always wrap in `pxr::ArResolverContextBinder(stage->GetPathResolverContext())`. Without this, `getAssetBytes` returns NULL.

See `docs/openusd-wasm-pipeline.md` for the full bug catalog (resolver binding, indexed primvar `ComputeFlattened`, image flipY, sRGB color space, metalness multiplier, etc).

### Hierarchy panel + model parts
Model nodes appear in `SceneGraphPanel` with their imported tree (parts) as expandable children. Parts come from `asset.structure.roots` (lazily populated by `scene.ts` after the parse). Selecting a part:
- Sets `EditorStore.selectedPartId` (transient — cleared on node selection change)
- Narrows the purple `Box3Helper` selection box to that part's Object3D
- The picker walks `userData.partId` from the raycast hit
- Eye toggle on the part row writes to `ModelNode.partVisibility[partId]` (persisted)

### Loading overlay
The task registry in `src/editor/react/hooks/useAsyncTask.ts` exposes `runTask(label, fn, options)`. Tasks with `{ blocking: true }` show the centered `LoadingOverlay` (with progress bar + ETA when `estimatedDurationMs` is provided). Non-blocking tasks show only the small `StatusBarProgress` chip in the footer.

Wrap heavy work (model parses, blueprint open, exports) with `{ blocking: true }`. Image and font imports stay non-blocking.

### Animation
Per-node animation tracks live in `EditorStore.animation`. The timeline UI is `AnimationTimeline.tsx`. USDZ-embedded animation is **not yet imported** into the timeline (the WASM exposes `getStageTimeInfo` and `getTimeSamples` but the parser doesn't yet build tracks from them).

## Configuration Notes

- Do not commit generated `dist/` output.
- Keep large reusable assets in `public/assets` instead of scattering them through `src/`.
- Preserve `package-lock.json` updates whenever dependencies change.
- The WASM artifacts in `public/wasm/openusd/` are generated — when they change, the binary diff is unavoidable but the canonical source in `scripts/openusd-wasm-build/` must be updated in the same commit.
- Vite serves `public/` files at the root URL but **refuses ESM `import` of `.js` files inside it**. The OpenUSD loader uses `new Function("url", "return import(url)")` to bypass Vite's import analyzer at runtime — keep this pattern when adding new public-folder JS.
- **Line endings on Windows**: `.gitattributes` declares `*.data`, `*.wasm` and other binary extensions as `binary`. Without this, `core.autocrlf=true` (Windows default) inflates `\n → \r\n` inside `openusd.data`, corrupting the embedded `plugInfo.json` that the OpenUSD WASM reads at startup (symptom: `Plugin info file /usd/plugInfo.json couldn't be read (line 2, col 9): Invalid value`). If you ever add a new generated artifact extension, list it in `.gitattributes` too.
