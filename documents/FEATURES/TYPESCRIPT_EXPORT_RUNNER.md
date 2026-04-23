# TypeScript Export Runner

## Objective

Create a separate app, but inside the same repository, to validate `.ts` files exported by `3Forge` without mixing that responsibility into the main editor UI.

## Architectural decision

A separate playground was chosen in:

```text
playgrounds/export-runner
```

This was preferred over integrating the runner into the main shell because:

- the editor and the validation runtime have different responsibilities
- export testing needs a simple and predictable environment
- the export debug flow becomes faster
- it avoids polluting the main product with sandbox UI

## Usage flow

1. Export the component as `.ts` in the editor.
2. Paste or save one or more files into:

```text
playgrounds/export-runner/src/generated/*.ts
```

3. Run:

```bash
npm run dev:export-runner
```

4. Choose the file in the `Generated File` selector.
5. Click `Build export` and validate:
   - whether the scene mounts correctly
   - whether runtime options work
   - whether `play`, `pause`, `stop`, `seek`, and `playClip` work when available

## What the runner provides

- automatic detection of the exported class
- real construction through `build()`
- simple `Three.js` viewport
- `OrbitControls`
- automatic content framing
- JSON field for testing `options`
- animation controls activated according to the available API

## Important note

The runner does not try to compile arbitrary `.ts` files chosen at runtime in the browser. Instead, it uses a known and typed entry point inside the repository. This keeps the flow simpler, more reliable, and compatible with the project's current setup.
