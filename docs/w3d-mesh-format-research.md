# W3D `.vert` / `.ind` mesh format — research notes

**Status:** observation-only research; NO parser implementation in this round.
**Scope:** inform a future binary loader for R3 Space Designer mesh assets so
3D scenes (e.g. `AR_TACTIC`) can render real geometry instead of the current
hidden-placeholder boxes.

## 1. Why this exists

R3 broadcast scenes ship two mesh-buffer files per `<Mesh>` resource:

```
Resources/Meshes/<guid>.vert   ← vertex buffer
Resources/Meshes/<guid>.ind    ← index buffer
```

The `<guid>` matches the `Resources/Mesh Id="..."` reference in
`scene.w3d`. The current importer (`src/editor/import/w3d.ts`) creates a
hidden 0.5×0.5×0.5 placeholder box for each `<Mesh>` entry, tracked in
`shadow.meshPlaceholderNodeIds`, so the tree round-trips intact but the
viewport is empty in those slots. The smoke test reports this for the
broadcast scenes:

```
Skipped 98 <Mesh> primitives — no .vert/.ind asset in folder
                              — hidden placeholder kept for round-trip
```

(Same line on `AR_GAMEINTRO`, `AR_PLAYER_V_PLAYER`, `AR_TACTIC`. The
`98` is a per-scene count of `<Mesh>` references; the actual on-disk
asset count for AR_TACTIC alone is also ~100 GUID pairs.)

The folder importer (`src/editor/import/w3dFolder.ts:36`) already
indexes `.vert`/`.ind` GUIDs and passes the set to the parser as
`meshAssets: Set<string>`, but only *as a marker that the asset is on
disk* — there is no buffer reader yet.

## 2. Inventory (AR_TACTIC, dev-box snapshot)

| File class | Count    | Naming                                  |
|------------|----------|-----------------------------------------|
| `.vert`    | ≈ 100    | lowercase GUID, e.g. `0307aaaa-…-3d8d12bb4513.vert` |
| `.ind`     | ≈ 100    | matching GUIDs, 1:1 pair with `.vert`   |

The folder importer only reports a mesh as "present" when **both** files
exist (`completeMeshGuids` filter at `w3dFolder.ts:86`), so a missing
`.ind` causes the parser to fall back to the placeholder branch. That
matches the broader R3 contract: vertex + index buffer are both
required to draw.

## 3. Strong hypothesis: raw D3D11 buffers

R3 Space Designer ships these DLLs in its install dir:

```
SharpDX.Direct3D11.dll
SharpDX.Direct3D11.Effects.dll
sharpdx_direct3d11_effects_x64.dll
```

…and HLSL pixel/vertex shaders next to scenes
(`Shaders/Primitive_*.hlsl`). The renderer is Direct3D 11. A near-
universal practice for D3D11 asset pipelines is to serialise vertex /
index buffers in the exact memory layout that
`ID3D11Device::CreateBuffer` consumes:

* **`.vert`** — interleaved vertex stream of `float32` little-endian
  attributes, in the order the matching shader's `IA_INPUT_LAYOUT`
  declares. For broadcast assets that almost always means
  `POSITION (3 × float)` plus some subset of
  `NORMAL (3 × float)`, `TEXCOORD0 (2 × float)`, `COLOR (4 × float)`,
  `TANGENT (3 or 4 × float)`. Stride is implicit in the shader.

* **`.ind`** — flat array of `uint16` or `uint32` little-endian
  indices, no header, triangle-list topology. The choice of 16 vs 32
  bits per index is per-mesh in D3D11 (`DXGI_FORMAT_R16_UINT` /
  `DXGI_FORMAT_R32_UINT`); broadcast scenes often have meshes with
  >65 535 vertices, so 32-bit is more likely.

Confidence: **high for the data being float32/uint{16,32}**, **medium
for the absence of a header**. R3 may prefix a small header (vertex
count, attribute mask) — D3D11-style raw buffers don't strictly need
one because the stride is fixed by the input layout, but R3 may store
a count for convenience. The hex dump (next section) will settle this.

## 4. What the importer would need

Assume the strong hypothesis holds:

1. **Input-layout discovery.** The shader filename pattern
   (`Shaders/Primitive_<hash>_VS.hlsl`) suggests one or two canonical
   layouts shared across meshes — broadcast assets are usually rigid
   meshes with `POSITION + NORMAL + TEXCOORD0` (32 bytes per vertex)
   or `POSITION + NORMAL + TEXCOORD0 + TANGENT` (44 bytes). The
   shader source can be inspected to confirm, but the cheaper
   approach is to compute `bytesPerVertex = filesize / vertexCount`
   for several files and look for matching common values
   (`12 / 24 / 32 / 44 / 48 / 56`). Probe with a sentinel mesh whose
   vertex count is known (a unit cube would be 8 verts → 24 indices).

2. **Three.js mapping.** A `BufferGeometry` with
   `position` (`Float32Array`), optional `normal`, optional `uv`,
   plus `index` (`Uint16Array` or `Uint32Array`). One Mesh per pair.
   Materials already work — `<Mesh>` elements reference a `BaseMaterial`
   that the existing parser already converts.

3. **Risk mitigation.** Wrong stride yields an exploded "spaghetti"
   mesh. Best to validate against a known-shape mesh first: pick one
   mesh whose visual content we can identify (the `pitch_basket.jpg`
   reference in AR_TACTIC suggests a basketball court mesh exists),
   load it with a candidate stride, eyeball it in Three. If it looks
   plausible we keep that stride. If not we try the next candidate.

4. **Fallback contract.** Keep `meshPlaceholderNodeIds` for any mesh
   whose buffer fails sanity checks (NaN positions, zero indices,
   index ≥ vertex count). Behaviour matches today: round-trip safe,
   visually empty, no crash.

## 5. Open questions (need hex dump before answering)

* Does `.vert` start with a small header (vertex count u32 + flags)
  or jump straight into the float stream? — first 16 bytes will tell.
* Index width: 16-bit or 32-bit? — first 16 bytes of `.ind` plus the
  filesize divided by 2 vs 4 (one of those should be a "round" number
  consistent with triangle-list = `index_count % 3 === 0`).
* Single canonical vertex layout, or does R3 mix several? — sample
  three or four `.vert` filesizes and look at greatest-common-divisor.
* Is the data little-endian on Windows? — almost certainly yes, but a
  hex dump confirms (the first float should be a small finite value
  in `[-100, 100]` range for typical broadcast mesh coordinates).

## 6. Reproducible inspection commands

Run these on the dev box (Bash on Windows / Git Bash) and paste the
output back into this document:

```bash
# Pick the smallest .vert / .ind pair as a probe — fewer bytes to read.
ls -laS "C:/Users/diogo.esteves/Documents/R3.Space.Projects/Projects/AR_TACTIC/Resources/Meshes/" \
  | grep -E "\.vert|\.ind" | tail -20

# Hex dump the first 64 bytes of two arbitrary .vert files.
for f in 0307aaaa-8162-493e-aa95-3d8d12bb4513 03175c3c-96a8-44da-8038-72b684d98522; do
  echo "=== $f.vert ==="
  xxd -l 64 "C:/Users/diogo.esteves/Documents/R3.Space.Projects/Projects/AR_TACTIC/Resources/Meshes/$f.vert"
  echo "=== $f.ind ==="
  xxd -l 64 "C:/Users/diogo.esteves/Documents/R3.Space.Projects/Projects/AR_TACTIC/Resources/Meshes/$f.ind"
  echo
done

# Filesize histogram — clusters tell us about vertex strides.
ls -la "C:/Users/diogo.esteves/Documents/R3.Space.Projects/Projects/AR_TACTIC/Resources/Meshes/" \
  | awk '/\.vert$/ {print $5}' | sort -n | uniq -c | head -20
ls -la "C:/Users/diogo.esteves/Documents/R3.Space.Projects/Projects/AR_TACTIC/Resources/Meshes/" \
  | awk '/\.ind$/ {print $5}' | sort -n | uniq -c | head -20
```

What we are looking for in the dump:

* **Header byte pattern.** First 4 bytes look like a small integer
  (e.g. `08 00 00 00` = 8) instead of a float? → header.
  First 4 bytes parse as a finite small float (e.g. `00 00 80 BF` =
  -1.0, or values in `[-100, 100]`)? → no header, raw stream.
* **Index width.** All odd-positioned bytes near zero in `.ind`?
  → 32-bit indices on a 16-bit-sized count. Otherwise 16-bit.
* **Filesize divisibility.** `.vert` size divisible by 12 / 24 / 32
  → consistent with `pos` / `pos+norm` / `pos+norm+uv` strides.

## 7. Next steps (gated on hex dump)

1. **You** run the commands above and paste the output back to me.
2. **I** read the bytes, compute candidate strides, pick the most
   likely vertex layout, and write a tiny `parseR3Mesh(buffer): {
   positions, indices, normals?, uvs? }` helper — pure function,
   unit-tested with one fixture mesh checked into the repo.
3. **I** wire the parser into `parseW3DFromFolder` so `<Mesh>` entries
   produce a node that Scene‑Editor renders as a real `Mesh` with
   `BufferGeometry`. Placeholder fallback stays for any pair that
   fails the sanity check.
4. **Smoke test** updated to assert at least one mesh from `AR_TACTIC`
   round-trips with a non-zero positions array. Visual confirmation
   is on you in the editor.

Estimated effort once the hex dump answers questions 1–3: **half a
day**, plus a session for visual validation. Without those answers I
would be guessing, and a guess at a custom binary format almost always
ships a parser that "works" for one mesh and breaks at runtime on the
next one — which is why we are stopping at the report for now.
