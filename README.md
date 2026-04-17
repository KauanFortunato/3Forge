# 3Forge

3Forge is a desktop-first 3D authoring editor built with `Three.js`, `React`, and `TypeScript`.

It lets you compose 3D scenes visually, organize them as reusable components, and export the result as:

- a portable `blueprint` JSON file for saving and reopening projects
- a generated TypeScript class that rebuilds the same scene in a `three` runtime

## Why 3Forge

3Forge is designed for teams and developers who want a practical middle ground between a visual editor and code-driven 3D workflows.

Instead of hand-authoring every mesh, material, transform, and asset pipeline step, you can assemble the scene in the editor and then ship the output as structured runtime code.

## Current Capabilities

- Scene graph editing with hierarchical nodes
- Transform editing for position, rotation, and scale
- Geometry authoring for common primitives
- Material editing with runtime-editable bindings
- 3D text support with local font assets
- Image plane support with imported textures
- JSON import/export for project persistence
- TypeScript export for `three`
- GSAP-based animation timeline preview and code export
- Editable component options generated from blueprint bindings
- Desktop-style editor UI with viewport, hierarchy, inspector, export panel, and timeline

## How It Works

At the center of the project is a serializable data model called a `blueprint`.

A blueprint stores the component definition, including:

- component name
- fonts
- node hierarchy
- transforms
- geometry settings
- material settings
- editable runtime bindings
- animation timeline data

The editor operates on that blueprint in memory. From there, 3Forge can:

1. save the blueprint as JSON
2. reopen the same blueprint later
3. generate a TypeScript class that recreates the scene
4. generate GSAP animation code that mirrors the editor timeline

## Export Model

### Blueprint JSON

The JSON export is the project persistence format.

Use it to:

- save work in progress
- version scene definitions
- reload projects in the editor
- move assets and structures between environments

### Generated TypeScript

The TypeScript export is the runtime integration format.

The generated class rebuilds the component with `three` primitives and exposes a clean usage surface for application code. When animation data exists, the export also generates GSAP timeline methods so runtime playback matches the editor preview.

## Tech Stack

- `React 19`
- `Three.js`
- `TypeScript`
- `GSAP`
- `Vite`

## Project Structure

```text
.
├── public/
│   ├── assets/
│   │   └── web/
│   └── assets/fonts/
├── scripts/
│   └── vite-wrapper.mjs
├── src/
│   └── editor/
│       ├── animation.ts
│       ├── exports.ts
│       ├── scene.ts
│       ├── state.ts
│       ├── types.ts
│       └── react/
│           ├── App.tsx
│           ├── components/
│           └── hooks/
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.mjs
```

## Local Development

### Requirements

- `Node.js >= 22.12.0`
- `npm`

This repository includes an `.nvmrc` file, so if you use `nvm`:

```bash
nvm use
```

### Install

```bash
npm install
```

### Run the Editor

```bash
npm run dev
```

### Run the TypeScript Export Runner

```bash
npm run dev:export-runner
```

Save one or more generated TypeScript exports into:

```text
playgrounds/export-runner/src/generated/*.ts
```

Then choose the file in the runner, build it, and test runtime animation methods if they exist.

### Production Build

```bash
npm run build
```

To build the export runner separately:

```bash
npm run build:export-runner
```

### Preview the Production Build

```bash
npm run preview
```

### Run Tests

```bash
npm run test
```

For local iteration:

```bash
npm run test:watch
```

For validation before changes are merged:

```bash
npm run validate
```

## Editor Workflow

Typical usage looks like this:

1. Create or load a project
2. Build the scene in the viewport and scene graph
3. Adjust transforms, geometry, materials, text, and images
4. Mark selected properties as editable when runtime overrides are needed
5. Animate supported transform channels in the timeline
6. Export the result as JSON or TypeScript

## Animation System

3Forge uses a blueprint-driven animation model and previews it through `GSAP`.

That means the editor does not depend on opaque timeline state. Instead, animation data is stored as serializable tracks and keyframes, then:

- previewed inside the editor
- persisted in JSON
- exported as GSAP timeline code for runtime use

Current animation scope is focused on transform channels:

- `position.x/y/z`
- `rotation.x/y/z`
- `scale.x/y/z`

## Design Direction

3Forge is intentionally not a marketing-style web app.

The product direction is:

- dark
- technical
- desktop-first
- precise
- productivity-oriented

The viewport is treated as the primary workspace, while side panels act as operational tooling around it.

## State and Runtime Notes

- Autosave is stored locally in the browser
- Imported fonts and images are embedded into the project model
- Exported components are designed for reuse in `three` applications
- The editor and export pipeline share the same blueprint source of truth

## Status

3Forge is actively evolving as a code-oriented 3D editor. The current foundation already covers scene authoring, persistence, export, and timeline-based animation, but the project is still in active iteration.

## License

No license file is currently included in this repository. Add one before distributing the project publicly beyond internal or personal use.
