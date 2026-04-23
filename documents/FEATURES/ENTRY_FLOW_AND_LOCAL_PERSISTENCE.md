# Entry Flow, Local Persistence, and Recents

## Objective

Restructure the 3Forge startup flow to separate:

- the current tab session
- the project persisted locally in the browser
- the user's external file
- the recents list
- relevant system permissions

## Main decisions

- `reload` is not treated as a new app entry.
- normal re-entry always shows the welcome screen.
- the current project remains saved locally in the browser until it is replaced or explicitly deleted.
- `Exit` leaves the current project, but does not erase local persistence.
- opening an external file creates an item in `Recents`.
- recents store a local snapshot and, when possible, a persisted `FileSystemFileHandle`.
- `Save` tries to overwrite the current file when a valid handle exists.
- without a handle or without useful permission, the flow falls back to `Save As`.
- when the File System Access API does not exist, the fallback is downloading the blueprint JSON.

## Persistence

- `localStorage`
  - current project snapshot
  - workspace context
  - recents list
  - recent snapshots
- `sessionStorage`
  - active session marker to distinguish `reload` from re-entry
- `IndexedDB`
  - persistence of `FileSystemFileHandle` values to reopen recents and keep overwrite when supported

## Clipboard

- the editor's internal clipboard remains separate from the browser's native clipboard
- the clipboard permission handled in this feature only affects copying exported text

## UX

- the welcome screen now offers:
  - Continue where you left off
  - Open file
  - New project
  - Open recent
- the `File` menu now concentrates:
  - New Project
  - Open File
  - Open Recent
  - Save
  - Save As
  - existing imports
  - existing exports
  - Exit
