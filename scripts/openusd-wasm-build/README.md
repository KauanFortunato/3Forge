# OpenUSD WASM wrapper — source

This folder is the **canonical source** for the OpenUSD WASM module used by 3Forge to import USDZ files. The compiled output lives in `public/wasm/openusd/` and is loaded at runtime by `src/lib/openusd/loadOpenUsd.ts`.

> For the full pipeline overview, design decisions, and a catalogue of bugs we already paid for, read [`docs/openusd-wasm-pipeline.md`](../../docs/openusd-wasm-pipeline.md). **Read that first** before changing anything here.

## Files

| File | Purpose |
|---|---|
| `wrapper.cpp` | C++ embind bindings over OpenUSD — defines the JS-facing API (`openStageFromBinary`, `getMeshData`, `getMaterialParams`, `getAssetBytes`, …). |
| `build.sh` | Linux-only `em++` invocation that compiles `wrapper.cpp`, links USD static libs, and emits `openusd.{js,wasm,data}`. |
| `test.mjs` | Standalone node smoke test — opens a stage from a USDA string and prints prim list. Useful to sanity-check the build outside the browser. |

## Prerequisites (one-time setup)

The build is **Linux-only** (WSL Ubuntu works fine). The Pixar OpenUSD source is brutal to cross-compile on Windows natively.

1. **emsdk** at `~/emsdk/` (Emscripten SDK). Activate:
   ```bash
   source ~/emsdk/emsdk_env.sh
   ```
2. **Pre-built OpenUSD WASM dist** at `~/wasm/openusd-wasm-official/`. Must contain:
   - `include/pxr/…` — USD headers
   - `lib/libusd_*.a` — static libs compiled with `emcc`
   - `lib/usd/…` — plugin manifests
   - `lib/libtbb.a` — Intel TBB

   Compiling those is a separate task (upstream USD CMake build with emsdk as toolchain). This wrapper is the **layer above** those libs — when you rebuild here you're not rebuilding USD itself, just the bindings.

## Build workflow

The build script and source are versioned in this repo. The actual `em++` invocation must run inside WSL where emsdk lives.

```bash
# In WSL (or a Linux box with emsdk + the USD dist):

# 1. Sync repo source → WSL working dir (one-off, or every time you edit wrapper.cpp here)
cp /mnt/c/.../3Forge/scripts/openusd-wasm-build/wrapper.cpp ~/wasm/openusd-wrapper/
cp /mnt/c/.../3Forge/scripts/openusd-wasm-build/build.sh   ~/wasm/openusd-wrapper/

# 2. Build
cd ~/wasm/openusd-wrapper
chmod +x build.sh
./build.sh

# 3. Copy artifacts back to public/
cp openusd.js   /mnt/c/.../3Forge/public/wasm/openusd/openusd.js
cp openusd.wasm /mnt/c/.../3Forge/public/wasm/openusd/openusd.wasm
cp openusd.data /mnt/c/.../3Forge/public/wasm/openusd/openusd.data
```

After that, hard refresh the editor in the browser (Vite caches `public/` aggressively — `Ctrl+Shift+R`).

> If you want a one-step rebuild on Windows you can wire a PowerShell script that does the WSL sync + `bash -c './build.sh'` + copy-back. We haven't done that yet — manual is fine for occasional rebuilds.

## When to rebuild

You only need to rebuild when:

- **You changed `wrapper.cpp`** — added/changed an embind function, fixed a bug in a getter, added a new USD feature.
- **The USD dist at `~/wasm/openusd-wasm-official/` was updated** — e.g. a newer USD version.
- **You added a new USD lib to `build.sh`** — e.g. linking `libusd_usdSkel.a` for skinning support.

You do **NOT** need to rebuild when changing JS in `src/lib/openusd/`, `src/editor/scene.ts`, or any TS — those are picked up by Vite's HMR.

## Verifying a build before shipping

After `./build.sh` succeeds, before copying to `public/`, you can sanity-check with node:

```bash
cd ~/wasm/openusd-wrapper
node test.mjs
```

It should print the USD version and a small prim list. If it crashes here, the browser will crash too — fix before copying.

You can also re-run the in-browser smoke test from DevTools after copying:

```js
window.testOpenUSD()
```

That checks all 17 exported functions are present and runs the USDA round-trip.

## Notes on `build.sh` paths

`build.sh` hardcodes:

```
LIBDIR=/home/kauanfortunato/wasm/openusd-wasm-official/lib
INCDIR=/home/kauanfortunato/wasm/openusd-wasm-official/include
```

Update those for your username. We didn't make them env-driven because the canonical machine for this is a single dev box; if multiple developers need to rebuild, parametrize via `${USER}` or pass them in.
