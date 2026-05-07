# W3D Image-Sequence Runtime Debug — FASE F / Pass A

## Symptom

After the FASE D / Pass 5 ffmpeg conversion produced PNG frames on disk
(`<basename>_frames/{frame_NNNNNN.png, sequence.json}`), the four `.mov`
assets in `GameName_FS` re-imported successfully. The blueprint contained
four `image` nodes with mime `application/x-image-sequence`, an
`ImageSequencePlayer` was constructed for each, and the render loop was
ticking them. **But the textures rendered as empty/white quads** — the
first frame never appeared on screen, the sequence never animated.

## Investigation

I traced the wiring end-to-end. Suspects considered, in order:

1. **Texture upload guard** — `setTextureUpdateIfReady` at `scene.ts:2443`
   refuses to bump `texture.version` when an `HTMLImageElement` reports
   `complete === false`. This is the right rule for callers that don't own
   the image's lifecycle (e.g. `getTexture` reusing a cached element). But
   `ImageSequencePlayer.bind()` is invoked **only** from `img.onload`
   (`scene.ts:2517`). At that point the decoded data is, by contract,
   already in memory. So the guard is over-cautious for the player. **CONFIRMED ROOT CAUSE.**

2. **Render loop not ticking** — Ruled out. `startLoop` is called from the
   constructor (`scene.ts:307`); the tick iterates `sequencePlayers`
   correctly (`scene.ts:1911`).

3. **rebuildScene timing** — Ruled out. The dispose+clear of the
   `sequencePlayers` map (`scene.ts:826-827`) runs **before**
   `createObject` (and therefore `getOrCreateSequencePlayer`) is called for
   the new blueprint, so a stale player reference is impossible.

4. **Stale `blob:` URLs across re-imports** — Possible second-order issue,
   but the texture-upload bug above would mask it; addressing the upload
   bug exposes whether this manifests separately. Re-import flow regenerates
   blob URLs in `parseW3DFromFolder`, so the new player gets fresh URLs.

5. **`colorSpace` mismatch** — Ruled out. `ImageSequencePlayer` constructor
   already sets `texture.colorSpace = SRGBColorSpace` (`scene.ts:2486`).

6. **Material defaults conflicting** — Ruled out. `createBaseMaterialOptions`
   reads from the node's authored material spec (color/opacity/transparent),
   no hidden zeroing.

### Why the guard fires for the player

`setTextureUpdateIfReady` returns early when:

```ts
if (img instanceof HTMLImageElement && !img.complete) return;
```

In jsdom (under our test suite) `complete` defaults to `false` until
explicitly forced — that's why the existing
`setTextureUpdateIfReady` tests had to `Object.defineProperty(img, "complete", { value: true })`
to assert the success path.

In Chromium, the documented behaviour is that `complete` becomes `true` on
or before the `load` event fires. But there are well-documented races with
`blob:` URLs and decoded image cache invalidation — see e.g.
crbug.com/1245725 and the Three.js issue tracker (search `texture
needsUpdate complete`) for prior art. The guard *can* misfire in
production with blob-backed images.

The player has a stronger guarantee than the helper assumes: by the time
`bind()` runs, the browser has fired `onload`, which only happens after
the image is decoded. So the player can — and should — bypass the guard.

## Fix

`scene.ts:2536` (`ImageSequencePlayer.bind`) — set `needsUpdate = true`
directly instead of going through `setTextureUpdateIfReady`. The helper
remains in place for other callers that lack the lifecycle guarantee.

```ts
private bind(img: HTMLImageElement): void {
  this.texture.image = img;
  this.texture.needsUpdate = true;  // bypass complete-flag guard; we own the lifecycle
  if (!this.firstBindLogged) {
    this.firstBindLogged = true;
    console.info(`[seq] first frame bound for sequence (${this.frameUrls.length} frames)`);
  }
}
```

A single console line per player gives operators a one-shot confirmation in
devtools that the wiring fired end-to-end without spamming the console on
every frame.

## Validation

1. Re-import a `GameName_FS`-style folder with `.mov` assets that have been
   converted to PNG sequences.
2. Open devtools. Expect exactly one `[seq] first frame bound for sequence
   (N frames)` line per `.mov` asset (4 in the user's case).
3. Inspect the runtime state:

```js
window.__r3Dump().nodes
  .filter(n => n.imageSequence)
  .map(n => ({
    name: n.name,
    frame: n.imageSequence.currentFrame,
    loadedFrames: n.imageSequence.loadedFrames,
    error: n.imageSequence.error,
    mapHasImage: n.mapHasImage,
    textureState: n.textureState,
  }));
```

After the fix, every row should show `mapHasImage: true` once the first
frame's `<img>.onload` resolves (typically within one or two animation
frames of the import). Before the fix, `mapHasImage` was true (texture
had the image bound) but the GPU upload never happened, so the visual
remained blank.

## Test coverage

`src/editor/scene.test.ts` — two new specs in the
`ImageSequencePlayer` block:

* `bind() sets needsUpdate even when the image's complete flag would make
  the guard no-op` — locks the contract by forcing `complete = false` on
  the bound image and asserting `texture.version` bumps anyway. Without
  the fix, this test would fail.
* `bind() logs '[seq] first frame bound' exactly once per player` —
  confirms the diagnostic doesn't spam the console.

Both reach into `bind()` directly via the `as any` backdoor because jsdom
doesn't decode `Image#src`, so the natural path (`loadFrame` →
`onload` → `bind`) doesn't fire under tests.

## Related

* **Agent B / Pass F-B** — `src/editor/import/w3d.ts` parser fix for
  image-sequence mime detection (alpha schema). Independent of this fix;
  both are required for the user's full flow to work.
* **Agent C / Pass F-C** — `src/editor/react/components/ImageAssetsPanel.tsx`
  Media panel UX surfacing of the new sequence asset type.

## Files changed

* `src/editor/scene.ts` — bind() unconditional needsUpdate + first-bind log
* `src/editor/scene.test.ts` — two regression specs
* `docs/w3d-image-sequence-runtime-debug.md` — this file
