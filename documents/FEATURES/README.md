# Features

This folder contains the functional record of `3Forge`.

## Working rule

Whenever a new feature is added to the project:

- it must be recorded in this folder, not in `help/`
- the description must focus on the behavior delivered to the user
- when it makes sense, the entry should point to the main changed files
- if the feature requires new coverage, the related tests should be mentioned

## Structure

- `README.md`: defines the convention for this folder
- `HISTORY.md`: internal history of functional changes that were added, changed, or removed

## How to use

For new features, create or update a document in this folder with:

- feature name
- objective
- main behavior
- relevant limits or notes
- tests covering the delivery, when they exist

`HISTORY.md` is not a production changelog. It serves as an internal record of project evolution during development.
