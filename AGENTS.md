# Repository Guidelines

## Project Structure & Module Organization
`src/editor` contains the editor core: scene orchestration in `scene.ts`, serializable blueprint state in `state.ts`, shared data types in `types.ts`, and export logic in `exports.ts`. React UI lives in `src/editor/react`, with top-level screens in `App.tsx`, reusable panels in `components/`, and shared hooks in `hooks/`. Static assets belong in `public/assets` (`web/`, `fonts/`). Build and dev wrappers live in `scripts/`.

## Build, Test, and Development Commands
Use the Node version from `.nvmrc` (`nvm use` on supported shells) or Node `>=22.12.0`.

- `npm install`: install dependencies.
- `npm run dev`: start the Vite editor locally with host exposure and auto-open.
- `npm run build`: create a production bundle in `dist/`.
- `npm run preview`: serve the production build locally.

## Coding Style & Naming Conventions
This repo uses TypeScript with `strict` mode and React JSX. Follow the existing style: 2-space indentation, double quotes, semicolons, and trailing commas where the formatter would keep them. Use `PascalCase` for React components and editor classes, `camelCase` for functions and state helpers, and `useX` names for hooks. Keep CSS class names descriptive and component-scoped, as in `landing-page__title` and `panel__body`.

## Testing Guidelines
There is no automated test suite configured yet. Before opening a PR, run `npm run build` and manually smoke-test the affected editor flows in `npm run dev`, especially viewport interaction, scene graph edits, blueprint save/load, TypeScript export, and timeline changes. When adding tests later, place them near the feature they cover and name them after the behavior under test.

## Commit & Pull Request Guidelines
Recent commits use short, imperative subjects such as `Fix viewport right-click drag context menu` and `Add GSAP animation timeline and editor polish`. Keep commit titles concise, sentence case, and focused on one change. PRs should describe the user-visible impact, note any export or data-model changes, link related issues, and include screenshots or short recordings for UI changes.

## Architecture Overview
The editor's source of truth is a serializable `blueprint`: component name, node hierarchy, transforms, geometry, materials, fonts, and editable bindings. Changes made in the UI should update that model first, then flow into rendering and export. Preserve both export targets when changing the data model: blueprint JSON for persistence and generated TypeScript for runtime `three` integration.

## Configuration Notes
Do not commit generated `dist/` output. Keep large reusable assets in `public/assets` instead of scattering them through `src/`. Preserve `package-lock.json` updates whenever dependencies change.
