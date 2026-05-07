# W3D `.mov` → PNG sequence conversion (operator guide)

## Why `.mov` may not play

Browsers ship a narrow set of video codecs. R3 broadcast templates
often use `.mov` containers carrying ProRes, DNxHR, or animation
codecs that Chrome and friends can't decode. Even when the codec is
H.264, autoplay can be blocked, and alpha-channel video formats are
rare on the web.

The Pass-3 diagnostics surface this: in devtools, run
`window.__r3Dump()` and look at any node with `textureMime`
starting with `video/`. If `video.errorCode === 4`
(`MEDIA_ERR_SRC_NOT_SUPPORTED`), the codec is the problem; if
`paused === true` and `errorCode === null`, autoplay is blocked
(click anywhere in the viewport).

## How PNG sequences fix it

A PNG sequence is `<basename>_frames/frame_NNNNNN.png` plus a
`<basename>_frames/sequence.json` manifest. PNG handles alpha
correctly, decodes everywhere, and the renderer's
`ImageSequencePlayer` swaps frames at the recorded fps.

Trade-off: PNG sequences are larger on disk than the source `.mov`
(no inter-frame compression) and use more RAM at peak (capped by the
player at the 60-frame sliding window). The `_frames/` directory sits
next to the original `.mov` so re-importing the same W3D folder picks
the sequence up automatically.

## Install ffmpeg

| OS | Command |
|----|---------|
| Windows | `winget install ffmpeg` (or unzip the build from <https://ffmpeg.org/download.html> and add `bin/` to PATH) |
| macOS   | `brew install ffmpeg` |
| Linux   | `apt-get install ffmpeg` (Debian/Ubuntu) / `dnf install ffmpeg` (Fedora) |

Verify: `ffmpeg -version` from a fresh terminal.

## In-app conversion (recommended, dev mode only)

1. `npm run dev`
2. File → Import → W3D Scene (Folder), pick the project.
3. If any `.mov` is missing a sibling `<basename>_frames/sequence.json`,
   the **MOV videos detected** modal opens.
4. Click **Convert and Import**. The dev plugin runs ffmpeg locally,
   writes the PNG sequences alongside the source, then re-imports
   the folder automatically (Chromium / FSA) or prompts you to
   re-pick the folder (Firefox / Safari).
5. After the re-import, `__r3Dump()` shows
   `imageSequence: { frameCount, currentFrame, ... }` for the
   converted assets.

If the dev plugin can't resolve your `projectName`
(`R3_PROJECTS_ROOT` env var doesn't point at a folder that contains
it), the modal shows a "Folder path on disk" input — paste the
absolute path manually.

## Manual conversion (works in any environment)

```
node scripts/convert-w3d-mov-to-sequence.mjs "C:/path/to/GameName_FS"
```

Add `--force` to overwrite existing sequences.

Or via npm:
```
npm run convert:mov -- "C:/path/to/GameName_FS"
```

Exit codes:
- `0` — no `.mov` to convert OR everything succeeded/skipped
- `1` — at least one file failed (see stderr)
- `2` — ffmpeg not on PATH (install hint printed)

## Validation with `GameName_FS`

Before conversion, `__r3Dump()` should show **4** image nodes with
`textureMime: "video/quicktime"` (PITCH_IN, PITCH_Out, CompLogo_In,
CompLogo_In_shadow). After conversion + re-import, the same 4 nodes
should show `textureMime: "application/x-image-sequence"` and a
populated `imageSequence: { ... }` block.

Either way, **the asset count never drops to `videos: 0` AND
`imageSequenceNodes: 0` for these four** — that's the contract
locked by the FASE D / Pass 4 commit 1 invariant test.

## Limitations in this round

* The player uses a 60-frame sliding window; very long sequences
  load lazily but past that horizon, frames are released between
  appearances. Smoothness depends on disk speed.
* `ffprobe` is not invoked; `fps`/`width`/`height` in `sequence.json`
  default to 0 and the player falls back to 25 fps. Set them by
  hand in the JSON if you need a different rate.
* In production builds the in-app **Convert and Import** button
  shows the CLI command instead of running it; the browser never
  shells out to ffmpeg.
