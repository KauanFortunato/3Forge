# OpenUSD WASM pipeline — build, integration, and lessons learned

This document captures **how the USDZ import pipeline in 3Forge was built**: why we chose to compile our own OpenUSD WASM, how the build is wired, where the bugs were, and what each fix means. Future contributors should read this before touching `wrapper.cpp`, `src/lib/openusd/`, or the USDZ branch of `scene.ts`.

---

## 1. Background — why this exists

3Forge needs to import USDZ files (Apple/Pixar's distribution format for 3D scenes) and render them in a Three.js editor. USDZ wraps a USDC binary stage plus textures into a single ZIP archive.

We initially tried [`tinyusdz`](https://github.com/lighttransport/tinyusdz) — a lightweight WASM USD reader — but it failed on real-world models because tinyusdz does not propagate:

- **`materialBindingAPI` inheritance** — when a parent Xform binds a material that children inherit, tinyusdz reports `materialId=-1` on child meshes
- **`GeomSubset`-based bindings** — when a single mesh splits faces across multiple materials via `UsdGeomSubset`, tinyusdz only exposes the first material

The biplane worked partially; the seahorse rendered grey because **its material binding lived inside `GeomSubset` partitions** tinyusdz couldn't see. We concluded tinyusdz couldn't cover production USDZ assets without significant patching, **removed it from the project entirely**, and committed to OpenUSD WASM as the only USDZ parser.

### Alternatives considered

| Option | Verdict |
|---|---|
| [tinyusdz](https://github.com/lighttransport/tinyusdz) | Tried first; removed. See above. |
| [needle-tools/usd-viewer](https://github.com/needle-tools/usd-viewer) | Pre-built OpenUSD WASM with Hydra render delegate. Apache 2.0, would work, but ~30MB of artifacts and tight coupling to needle's own engine. |
| **Build OpenUSD ourselves** | What we ended up doing. Full control, minimal API surface, ~14MB total artifacts. |

We chose to **compile a custom OpenUSD WASM** with only the bindings we need. Three.js's bundled `USDLoader` is kept as a final last-resort fallback (it ships with three, no extra dependency).

---

## 2. The native build — Ubuntu / WSL

### Prerequisites

The build runs on **Linux (WSL Ubuntu)** because the Pixar OpenUSD build scripts are heavily Linux-tuned and emsdk is well-supported there.

Required:

- **emsdk** (Emscripten SDK) installed at `~/emsdk`. Activate with `source ~/emsdk/emsdk_env.sh`.
- A **pre-built OpenUSD WASM dist** at `~/wasm/openusd-wasm-official/`. This directory must contain:
  - `include/pxr/...` — USD C++ headers
  - `lib/libusd_*.a` — static libraries (compiled with emcc/em++)
  - `lib/usd/...` — USD plugin descriptors (`plugInfo.json`, schema files)
  - `lib/libtbb.a` — Intel TBB (USD's threading dependency)

> Compiling OpenUSD itself to WASM is a separate exercise — the user did this once using the upstream USD CMake build with emsdk as the toolchain. Future re-builds for newer USD versions follow the same recipe; this doc is about the **wrapper layer** above the libs.

### Wrapper project layout

**Canonical source** is versioned in this repo at [`scripts/openusd-wasm-build/`](../scripts/openusd-wasm-build/) (see its README for the sync workflow). The build itself runs inside WSL at `~/wasm/openusd-wrapper/`:

```
scripts/openusd-wasm-build/   — source of truth (versioned)
  wrapper.cpp                 — C++ bindings exposed to JS via Emscripten embind
  build.sh                    — em++ invocation that compiles wrapper.cpp + links USD libs
  test.mjs                    — standalone node smoke test
  README.md                   — sync + build instructions

~/wasm/openusd-wrapper/       — WSL build dir (synced from repo before each build)
  wrapper.cpp                 — copy of the above
  build.sh                    — copy of the above
  openusd.js                  — Emscripten JS loader (output)
  openusd.wasm                — compiled module (output, ~13 MB)
  openusd.data                — preloaded plugin descriptors (output, ~762 KB)

public/wasm/openusd/          — runtime artifacts (copied from WSL after build)
  openusd.{js,wasm,data}
```

The build script is:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ~/emsdk/emsdk_env.sh

rm -f openusd.js openusd.wasm openusd.data openusd.worker.js

LIBDIR=/home/kauanfortunato/wasm/openusd-wasm-official/lib
INCDIR=/home/kauanfortunato/wasm/openusd-wasm-official/include

em++ wrapper.cpp \
  -std=c++17 \
  -DPXR_STATIC \
  -I"$INCDIR" \
  -Wl,--whole-archive \
  "$LIBDIR/libusd_usd.a" \
  "$LIBDIR/libusd_usdGeom.a" \
  "$LIBDIR/libusd_usdShade.a" \
  "$LIBDIR/libusd_sdr.a" \
  "$LIBDIR/libusd_kind.a" \
  "$LIBDIR/libusd_sdf.a" \
  "$LIBDIR/libusd_pcp.a" \
  "$LIBDIR/libusd_plug.a" \
  "$LIBDIR/libusd_work.a" \
  "$LIBDIR/libusd_tf.a" \
  "$LIBDIR/libusd_arch.a" \
  "$LIBDIR/libusd_js.a" \
  "$LIBDIR/libusd_trace.a" \
  "$LIBDIR/libusd_vt.a" \
  "$LIBDIR/libusd_gf.a" \
  "$LIBDIR/libusd_ar.a" \
  "$LIBDIR/libusd_ts.a" \
  "$LIBDIR/libusd_pegtl.a" \
  -Wl,--no-whole-archive \
  "$LIBDIR/libtbb.a" \
  --bind \
  --preload-file "$LIBDIR/usd@/usd" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=64MB \
  -s MAXIMUM_MEMORY=2GB \
  -s ENVIRONMENT=web \
  -s FORCE_FILESYSTEM=1 \
  -s ASSERTIONS=1 \
  -s EXIT_RUNTIME=0 \
  -s EMULATE_FUNCTION_POINTER_CASTS=1 \
  -s EXPORTED_RUNTIME_METHODS='["FS","ccall","cwrap","UTF8ToString","stringToUTF8","HEAPU8","HEAP32","HEAPF32","writeArrayToMemory"]' \
  -o openusd.js
```

### Critical link-order / library notes

- **`--whole-archive` around the USD libs** is required because USD relies heavily on static-initialization registries (`TF_REGISTRY_FUNCTION`, etc). Without `--whole-archive` those static initializers get dead-stripped and the plugin system silently fails at runtime.
- **`libusd_sdr.a` MUST be present** alongside `libusd_usdShade.a` — `usdShade` depends on the Shader Definition Registry. Missing it produces `wasm-ld: undefined symbol: pxrInternal_...::SdrParserPlugin::...` errors.
- **`libtbb.a` goes after `--no-whole-archive`** — it doesn't need full extraction.
- **`--preload-file ".../usd@/usd"`** bakes the USD plugin manifests into the WASM data file, making them available at `/usd` in the in-memory filesystem. `registerPlugins("/usd")` from JS picks them up.
- **`EXIT_RUNTIME=0`** — we keep the module alive across calls (we cache stages in a `std::unordered_map` between calls).
- **`EMULATE_FUNCTION_POINTER_CASTS=1`** — required because USD does function-pointer casts that violate WASM's strict signature checking; without this, callbacks crash on invocation.

---

## 3. The wrapper.cpp design

`wrapper.cpp` (~21 KB) is a thin C++ layer over OpenUSD exposed via Emscripten embind. Two key design choices:

### Stateful stage cache

We cache opened stages in a module-level `std::unordered_map<int, UsdStageRefPtr>` keyed by an auto-incrementing `stageId`. JS opens a stage, gets an integer handle, and passes that handle to subsequent calls:

```cpp
static std::unordered_map<int, pxr::UsdStageRefPtr> g_stages;
static int g_nextStageId = 1;

int openStageFromBinary(em::val jsBytes, const std::string& filename) { ... }
void closeStage(int stageId);
em::val getMeshData(int stageId, const std::string& primPath);
em::val getMaterialParams(int stageId, const std::string& matPath);
// ...
```

This avoids re-parsing the USDZ for each query and keeps `UsdStageRefPtr` lifetimes clear (until the JS side calls `closeStage`).

### Typed-array marshalling

For mesh data we return Three.js-ready typed arrays (`Float32Array`, `Int32Array`, `Uint8Array`) using embind's `typed_memory_view` + `.slice()` trick. This is far faster than per-element `emscripten::val::array().set(i, v)`:

```cpp
static em::val makeFloat32Array(const float* data, size_t count) {
    em::val Float32 = em::val::global("Float32Array");
    if (count == 0) return Float32.new_(0);
    auto view = em::typed_memory_view(count, data);
    return Float32.new_(view).call<em::val>("slice");
}
```

The `.slice()` is essential — it copies the bytes into JS heap so the typed array survives after the C++ `VtArray` is destroyed.

### Exposed API surface

| Function | Purpose |
|---|---|
| `getUsdVersion()` | Version string (`"0.26.8"`) |
| `registerPlugins(path)` | Loads the USD plugin manifests from `path` (we use `"/usd"`) |
| `openStageFromBinary(bytes, filename)` | Writes bytes to `/tmp/<filename>` in MEMFS, opens with `UsdStage::Open`. Returns `stageId` or `-1`. |
| `closeStage(stageId)` | Drops the cached stage. |
| `listPrims(stageId)` | Flat array of all prims `{path, type, parent, isMesh, isXformable}`. |
| `getMeshData(stageId, primPath)` | Geometry: `points / normals / uvs / faceVertexCounts / faceVertexIndices / normalsInterpolation / uvsInterpolation / subsets`. |
| `getLocalTransform(stageId, primPath)` | 4×4 matrix as `Float32Array[16]` (column-major). |
| `getWorldTransform(stageId, primPath, t)` | World matrix at time `t` (`NaN` = default). |
| `getMaterialBinding(stageId, primPath)` | Resolved bound material path (handles `materialBindingAPI` inheritance — this was the tinyusdz showstopper that drove us to OpenUSD). |
| `getMaterialParams(stageId, matPath)` | All `UsdPreviewSurface` inputs as `{type: "value"|"texture", ...}`. |
| `getAssetBytes(stageId, assetPath)` | Raw bytes of an asset (texture). **Requires stage context binding** — see §5.1. |
| `getStageTimeInfo(stageId)` | `{startTime, endTime, framesPerSecond, timeCodesPerSecond}` for animation. |
| `getTimeSamples(stageId, attrPath)` | Time codes for animated attributes. |

The `EMSCRIPTEN_BINDINGS(openusd_module)` block at the bottom of `wrapper.cpp` exposes all of these by name.

---

## 4. JS integration

### Lazy WASM load — `src/lib/openusd/loadOpenUsd.ts`

```ts
const dynamicImport = new Function("url", "return import(url)") as (url: string) => Promise<...>;

export function loadOpenUSD() {
  if (!openUsdPromise) {
    openUsdPromise = (async () => {
      const mod = await dynamicImport("/wasm/openusd/openusd.js");
      const createOpenUSD = mod.default;
      return createOpenUSD({
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) return "/wasm/openusd/openusd.wasm";
          if (path.endsWith(".data")) return "/wasm/openusd/openusd.data";
          return `/wasm/openusd/${path}`;
        },
      });
    })();
  }
  return openUsdPromise;
}
```

**Why `new Function("url", "return import(url)")`?** Vite refuses to ESM-import any `.js` file from `public/` (`Cannot import non-asset file ... inside /public`). It also can't ignore a literal-path `import()` even with `@vite-ignore` (the public-folder check happens before annotation parsing). Constructing the dynamic import inside `new Function` hides the import statement from Vite's AST analyzer — the browser resolves it at runtime.

The artifacts live in `public/wasm/openusd/`. They are deployed verbatim by Vite.

### Parser — `src/lib/openusd/openusdParser.ts`

`parseUsdz(buffer, filename)` is the public entry point. It:

1. Opens the stage via `openStageFromBinary`
2. Lists prims and walks each mesh
3. Calls `getMeshData` → triangulates face-vertex topology → builds `BufferGeometry`
4. For each Mesh: resolves `getMaterialBinding` → `getMaterialParams` → builds `MeshPhysicalMaterial`
5. For each texture reference: `getAssetBytes(stageId, assetPath)` → `createImageBitmap` → `Three.js Texture`
6. Applies `getWorldTransform` to the wrapping Group
7. Returns a `THREE.Group`. **Always** calls `closeStage(stageId)` in a `finally` block.

### Scene integration — `src/editor/scene.ts`

The USDZ branch of `applyModelSceneNode`:

1. Checks `modelGroupCache` (`Map<assetId, Promise<Group>>`)
2. **Cache miss**: wraps the parse in `runTask({ blocking: true, estimatedDurationMs })`. The OpenUSD path is primary; on failure, falls back to Three.js's `USDLoader`.
3. **Cache hit**: skips the parse entirely
4. Clones the cached Group (`group.clone(true)`) so each scene instance can be tagged and lit independently without touching the cached template
5. Tags userData for picking and enables shadows

The same cache also serves GLB/GLTF loaded via `gltfLoader`.

### Loading overlay

`src/editor/react/components/LoadingOverlay.tsx` shows a blocking modal with:

- Spinner
- Task label (`Loading model.usdz`)
- Progress bar (**determinate** when `estimatedDurationMs` is provided, **indeterminate sliding** otherwise)
- Remaining time text (`Faltam ~8.3s`) capped at 95% / "Quase lá..." past the estimate

The system is driven by a tiny task registry in `src/editor/react/hooks/useAsyncTask.ts`:

```ts
runTask("Loading X", () => doWork(), { blocking: true, estimatedDurationMs: 12000 });
```

`blocking: true` triggers the overlay; without it the task only shows in the small footer chip (`StatusBarProgress`). The USDZ heuristic is `~1s per MB` (with a 2s minimum).

---

## 5. Bugs we hit and how we fixed them

Each of these wasted hours. Read this section before changing anything in the pipeline.

### 5.1. USDZ-internal asset paths returned NULL bytes

**Symptom**: `getMaterialParams` reported every texture correctly, but `getAssetBytes("0/diffuse.png")` returned NULL for every single one. Result: model rendered with default-grey materials.

**Root cause**: `ArResolver` is stateful. To resolve paths relative to an open stage (especially USDZ-internal paths like `"0/diffuse.png"` which expand to `"/tmp/model.usdz[0/diffuse.png]"`), the stage's resolver context must be **bound to the current thread**.

**Fix** (in `wrapper.cpp`):

```cpp
em::val getAssetBytes(int stageId, const std::string& assetPath) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();
    pxr::UsdStageRefPtr stage = it->second;

    pxr::ArResolver& resolver = pxr::ArGetResolver();
    pxr::ArResolverContextBinder binder(stage->GetPathResolverContext());

    pxr::SdfLayerHandle rootLayer = stage->GetRootLayer();
    std::string anchored = rootLayer
        ? rootLayer->ComputeAbsolutePath(assetPath)
        : assetPath;

    pxr::ArResolvedPath resolved = resolver.Resolve(anchored);
    if (resolved.empty()) resolved = resolver.Resolve(assetPath);
    if (resolved.empty()) return em::val::null();

    std::shared_ptr<pxr::ArAsset> asset = resolver.OpenAsset(resolved);
    if (!asset) return em::val::null();
    return makeUint8Array(reinterpret_cast<const uint8_t*>(asset->GetBuffer().get()), asset->GetSize());
}
```

The `ArResolverContextBinder` is the critical piece. The `ComputeAbsolutePath` anchors `"0/diffuse.png"` to the USDZ root layer, producing the bracketed form `/tmp/model.usdz[0/diffuse.png]` which the resolver knows how to crack.

Header: `#include <pxr/usd/ar/resolverContextBinder.h>`.

### 5.2. UV array was the wrong length — textures sampled with a moiré grid pattern

**Symptom**: model rendered as a dark surface with regularly-spaced bright spots — a "checker" aliasing pattern. Diagnostic log showed `uvs: 2734, faceVerts: 10884, uvsInterp: "faceVarying"`. A faceVarying UV primvar with only 2734 entries against 10884 face-vertices is mathematically impossible — unless the UVs are **indexed**.

**Root cause**: USD primvars can be stored in **indexed** form — a small `values` array plus a separate `indices` array that maps face-vertex → value. The interpolation is still reported as `"faceVarying"` even when storage is compact. Calling `primvar.Get(&uvs)` returns the compact values, not the expanded per-corner array.

**Fix**: use `ComputeFlattened` instead of `Get`. It applies indices for indexed primvars and returns the data unchanged for non-indexed primvars — works for both cases:

```cpp
if (st) {
    if (st.ComputeFlattened(&uvs)) {
        uvsInterp = st.GetInterpolation().GetString();
    }
}
```

Same logic should apply to any future primvar extraction (colors, custom attributes).

### 5.3. UV primvar names beyond `st` / `UVMap`

**Symptom**: some models exported from non-Apple tools had UVs stored under names like `uv`, `uv0`, `Texture_Coordinate`. The two-name lookup missed them.

**Fix**: fall through to a generic scan over all primvars and pick the first `TexCoord2fArray` or `Float2Array`:

```cpp
if (!st) {
    for (const auto& pv : primvars.GetPrimvars()) {
        const pxr::SdfValueTypeName type = pv.GetTypeName();
        if (type == pxr::SdfValueTypeNames->TexCoord2fArray
            || type == pxr::SdfValueTypeNames->Float2Array) {
            st = pv;
            break;
        }
    }
}
```

### 5.4. Texture orientation was flipped

**Symptom**: textures applied with bottom-half on top and top-half on bottom (V axis inverted).

**Root cause**: `Three.js` honors `Texture.flipY` for `HTMLImageElement` sources, but **ignores it for `ImageBitmap` sources**. The bitmap orientation must be set at creation time:

```ts
const bitmap = await createImageBitmap(blob, { imageOrientation: "flipY" });
```

`"flipY"` matches USD's UV convention (V=0 at bottom).

### 5.5. Diffuse/emissive textures looked desaturated and dark

**Root cause**: Three.js textures default to `NoColorSpace`. For PBR materials, the diffuse and emissive maps need `SRGBColorSpace`; metallic, roughness, normal, AO stay linear.

**Fix** (in `openusdParser.ts`):

```ts
case "diffuseColor":
    tex.colorSpace = SRGBColorSpace;
    mat.map = tex;
    break;
case "emissiveColor":
    tex.colorSpace = SRGBColorSpace;
    mat.emissiveMap = tex;
    ...
```

### 5.6. Metallic / roughness textures had no effect

**Root cause**: `MeshPhysicalMaterial.metalness` defaults to 0 and acts as a **multiplier** for `metalnessMap`. With scalar=0 and a texture, the effective metalness is always 0×texture = 0.

**Fix**: when a `metalnessMap` is assigned, force scalar to 1 so the texture drives the value fully. Same for `roughnessMap` (its scalar defaults to 1 already — but we set it explicitly for clarity):

```ts
case "metallic":
    mat.metalnessMap = tex;
    mat.metalness = 1;
    break;
case "roughness":
    mat.roughnessMap = tex;
    mat.roughness = 1;
    break;
```

### 5.7. Re-parsing on every scene update

**Symptom**: dragging any unrelated node in the scene triggered a fresh USDZ parse (10–15s of overlay). The parse was firing inside `applyModelSceneNode`, which is called whenever the scene rebuilds.

**Fix**: add a per-`SceneEditor` instance cache keyed by `asset.id`:

```ts
private readonly modelGroupCache = new Map<string, Promise<Group>>();

let parsePromise = this.modelGroupCache.get(asset.id);
if (!parsePromise) {
    parsePromise = runTask(taskLabel, ..., { blocking: true });
    this.modelGroupCache.set(asset.id, parsePromise);
    parsePromise.catch(() => this.modelGroupCache.delete(asset.id));
}
parsePromise.then((cached) => {
    const clone = cached.clone(true);
    tagForNode(clone);
    wrapper.clear();
    wrapper.add(clone);
});
```

`clone(true)` is essential — multiple instances of the same model in the scene must not share an `Object3D` tree.

### 5.8. `__syscall_madvise` warnings in console

**Not actually a bug.** Emscripten doesn't implement `madvise` (a memory-hint syscall on Linux). USD uses it only as an optimization hint and degrades gracefully. The warnings are noise — ignore them.

### 5.9. `Plugin info file /usd/plugInfo.json couldn't be read (line 2, col 9): Invalid value` on Windows

**Symptom**: Right after `parseUsdz` is first called, the WASM crashes with the message above and the parser falls back to Three.js's `USDLoader`.

**Cause**: `openusd.data` is the Emscripten preload, packed with `--preload-file $LIBDIR/usd@/usd`. Most of its bytes are ASCII (it's a stream of `plugInfo.json` files), so Git on Windows treats it as text by default. With `core.autocrlf=true` (the Windows default), every `\n` becomes `\r\n` on checkout, inflating the file from 779 888 → 800 226 bytes and corrupting the embedded JSON so the OpenUSD plugin loader bails out.

**Fix**: the repo ships a `.gitattributes` that marks `*.data`, `*.wasm`, and the other binary asset extensions as `binary`. If you ever see this error after a fresh clone or branch switch, run:

```bash
rm public/wasm/openusd/openusd.data public/wasm/openusd/openusd.js
git checkout HEAD -- public/wasm/openusd/openusd.data public/wasm/openusd/openusd.js
```

If you add a new generated artifact extension to the repo, add it to `.gitattributes` too.

---

## 6. Failure modes and fallback paths

The pipeline degrades gracefully:

```
USDZ buffer
  │
  ├─► OpenUSD (parseUsdz)
  │       │
  │       └─► fails ─► Three.js USDLoader (last resort)
  │
  └─► success ─► Three.js Group
```

Three.js's bundled `USDLoader` is the last-resort fallback for pathological files OpenUSD WASM throws on (e.g. composition arcs not covered by our build). It ships with Three so there's no extra dependency cost.

The fallback chain lives in `scene.ts` (`buildModelObject` → `runTask`) and in `gltfExport.ts` (`loadModelAssetGroup`).

---

## 7. Open questions / future work

- **Animation**: `getTimeSamples` and `getStageTimeInfo` are exposed but unused. The parser currently calls `getWorldTransform(stageId, primPath, NaN)` (default time) once. To support animation, the parse must produce time-varying meshes/transforms, and the editor's timeline must drive a "sample at t" callback that re-extracts data from the stage.
- **Skinning (UsdSkel)**: not bound. Adding `libusd_usdSkel.a` and exposing `UsdSkelSkeletonQuery` + blend shapes would unlock skinned animation.
- **Lights (UsdLux)**: `libusd_usdLux.a` is available in the dist but not linked. Easy to add when we want to honor lights authored in USD.
- **Progress events from the parse**: currently we estimate duration heuristically (`~1s/MB`). A real progress callback would need C++ hooks at known parse milestones (header, points, normals, materials, …) reported back via `emscripten::val::global("postMessage")` or a JS callback passed in.
- **Cache eviction**: `modelGroupCache` grows unbounded for the lifetime of a `SceneEditor`. In long sessions with many imports this is a leak. An LRU or asset-removal hook would fix it.

---

## 8. Files to know

| Path | Purpose |
|---|---|
| `scripts/openusd-wasm-build/wrapper.cpp` | C++ bindings — **source of truth** for what's exposed (versioned) |
| `scripts/openusd-wasm-build/build.sh` | Build invocation (versioned) |
| `scripts/openusd-wasm-build/README.md` | Sync workflow + build steps |
| `~/wasm/openusd-wrapper/` (WSL) | Build workspace — synced from repo before each build |
| `public/wasm/openusd/openusd.{js,wasm,data}` | Runtime artifacts — copied from WSL after `./build.sh` |
| `src/lib/openusd/loadOpenUsd.ts` | Lazy WASM loader (Vite-friendly) |
| `src/lib/openusd/openusdParser.ts` | `parseUsdz(buffer, filename) → Promise<Group>` |
| `src/lib/openusd/testOpenUsd.ts` | Smoke test, callable as `window.testOpenUSD()` |
| `src/editor/scene.ts` (USDZ branch around `applyModelSceneNode`) | Cache + fallback chain + `runTask` wrapping |
| `src/editor/react/hooks/useAsyncTask.ts` | Task registry powering the overlay |
| `src/editor/react/components/LoadingOverlay.tsx` | Blocking overlay with bar + ETA |

When updating the wrapper:

1. Edit `scripts/openusd-wasm-build/wrapper.cpp` (canonical source in this repo)
2. Sync to WSL: `cp scripts/openusd-wasm-build/wrapper.cpp ~/wasm/openusd-wrapper/`
3. `./build.sh` in WSL
4. Copy `openusd.{js,wasm,data}` to `public/wasm/openusd/`
5. Update the `UsdModule` interface in `openusdParser.ts` if the signature changed
6. Hard refresh in the browser (Vite caches `public/` assets aggressively)
