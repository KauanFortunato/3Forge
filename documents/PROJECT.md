# 3Forge

## What the project is

`3Forge` is a 3D editor built with `Three.js`, `React`, and `TypeScript`. The goal of the project is to allow the creation, editing, organization, and export of 3D scenes and components visually, inside an editor interface.

Instead of assembling everything manually in code, the user can compose the scene inside the editor and then export that result to be reused in other projects based on `three`.

## What the editor does

The editor allows you to:

- create and organize 3D nodes in a hierarchical structure
- edit transforms such as position, rotation, and scale
- configure geometries and materials
- work with 3D text
- import images
- use fonts
- mark properties as editable at runtime
- preview everything inside a 3D viewport

## How the project represents the scene

`3Forge` uses an internal format called `blueprint`.

This `blueprint` represents the complete structure of the component or scene, including:

- component name
- list of used fonts
- list of nodes
- hierarchical relationship between nodes
- transform properties
- geometry settings
- material settings
- editable bindings

In practice, the `blueprint` is the project's data format inside the editor.

## Project exports

The editor supports two main output formats:

### 1. Blueprint as JSON

The `blueprint` can be exported as `.json`.

This file is used to:

- save the project
- reopen the project later
- move the scene between environments
- keep the full structure editable inside the editor

This is the work persistence format.

### 2. TypeScript class for Three.js

The editor also generates a `TypeScript` class for use with `three`.

This class:

- creates a `Group`
- rebuilds the scene hierarchy
- instantiates geometries, materials, images, and text
- applies transforms
- exposes editable runtime options
- provides a `build()` and `dispose()` lifecycle

In practice, the result is a code component that can be integrated directly into `Three.js` projects.

## Main 3Forge flow

The expected project flow is:

1. The user builds the scene visually inside the editor.
2. The editor stores the structure in `blueprint` format.
3. The project can be saved as `.json`.
4. The same `blueprint` can be converted into a TypeScript class.
5. That class can be used in applications that work with `three`.

## Summary

`3Forge` is a visual editor for 3D scenes and components that turns visual composition into two main assets:

- a JSON `blueprint` for saving and reopening projects
- a `Three.js`-based TypeScript class for using the scene in code

In other words, it works both as a visual authoring tool and as a generator of reusable 3D components.

## Functional documentation

The functional record of the project is kept in `documents/FEATURES`.

- `documents/FEATURES/README.md`: convention for documenting new features
- `documents/FEATURES/HISTORY.md`: internal history of what was added, changed, or removed
