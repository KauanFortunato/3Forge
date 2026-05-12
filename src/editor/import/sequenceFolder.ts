/**
 * Reads and writes converted MOV image-sequences inside a user-picked
 * project folder via the File System Access API (FSA).
 *
 * Layout (rooted at the user-picked project handle):
 *
 *   Resources/Textures/<slug>_sequence_<hash8>/
 *     sequence.json
 *     frame_000001.png   (or .webp)
 *     frame_000002.png
 *     ...
 *
 * - `<slug>` is a sanitised version of the source `.mov` basename.
 * - `<hash8>` is the first 8 hex chars of `sha256(mov bytes)` so two
 *   videos with the same display name get disjoint folders.
 *
 * The full sha256 lives inside `sequence.json` as `sourceHash`, so
 * reuse on re-import is exact (not just a name match).
 *
 * Design notes
 * - This module never touches the dev server. The frames it writes come
 *   from `frameFetchUrls` that the backend converter exposes; we GET
 *   each frame and stream it through `createWritable()`. The dev temp
 *   dir then becomes an intermediate that the browser can drop.
 * - Every public function takes minimal structural interfaces
 *   (`FSADirectoryHandleLike`, `FSAFileHandleLike`, `FSAWritableLike`)
 *   so the unit tests can plug in an in-memory fake without spinning up
 *   a real browser FSA implementation.
 */

import {
  normaliseToV3,
  parseSequenceJson,
  serialiseSequenceJson,
  SequenceValidationError,
  validateSequenceJson,
  type SequenceJsonV3,
} from "./sequenceSchema";
import { shortHashFromSourceHash } from "./sequenceHash";

export const CONVERTER_VERSION = "1.0.0";
export const CONVERTER_CREATED_BY = "3forge";

const RESOURCES_DIR = "Resources";
const TEXTURES_DIR = "Textures";
const SEQUENCE_JSON_NAME = "sequence.json";

// ---------- Minimal FSA-ish interfaces (structural, test-friendly) ----------

export interface FSAWritableLike {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}

export interface FSAFileHandleLike {
  kind?: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FSAWritableLike>;
}

export interface FSADirectoryHandleLike {
  kind?: "directory";
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FSADirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FSAFileHandleLike>;
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
  values?(): AsyncIterableIterator<FSAFileHandleLike | FSADirectoryHandleLike>;
}

// ---------- Naming helpers ----------

/**
 * Strip the extension and turn anything that isn't `[A-Za-z0-9_.]` into
 * `_`. Keeps `.` so a video called `LKL_logo.LOOP_alt.mov` stays
 * recognisable (the trailing `.mov` is removed first).
 *
 * Folder/file-name safety: this slug feeds into a path segment we
 * create via FSA. FSA already forbids `/` and `\`, but Windows in
 * particular dislikes `:`, `*`, `?`, `"`, `<`, `>`, `|`. The character
 * class above leaves none of those through.
 */
export function slugifyVideoName(rawName: string): string {
  const trimmed = rawName.trim();
  const withoutExt = trimmed.replace(/\.[A-Za-z0-9]{1,8}$/u, "");
  const slug = withoutExt
    .replace(/[^A-Za-z0-9_.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 80);
  return slug || "sequence";
}

/**
 * Folder name we use under `Resources/Textures/`. Stable across runs
 * for a given (videoName, sourceHash) pair so re-imports are
 * idempotent.
 */
export function buildSequenceFolderName(videoName: string, sourceHash: string): string {
  return `${slugifyVideoName(videoName)}_sequence_${shortHashFromSourceHash(sourceHash)}`;
}

/**
 * Forward-slashed POSIX path used inside `manifestPath`. The exporter
 * (Phase 2) and the runtime resolver both treat this as the canonical
 * shape so cross-OS paths don't drift.
 */
export function buildSequenceManifestPath(folderName: string): string {
  return `${RESOURCES_DIR}/${TEXTURES_DIR}/${folderName}/${SEQUENCE_JSON_NAME}`;
}

// ---------- FSA helpers ----------

async function getOrCreateSubdirectory(
  root: FSADirectoryHandleLike,
  segments: string[],
  options: { create: boolean },
): Promise<FSADirectoryHandleLike | null> {
  let current = root;
  for (const segment of segments) {
    try {
      current = await current.getDirectoryHandle(segment, { create: options.create });
    } catch (err) {
      if (!options.create) return null;
      throw err;
    }
  }
  return current;
}

async function readFileHandleAsText(handle: FSAFileHandleLike): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

async function writeStringFile(
  dir: FSADirectoryHandleLike,
  name: string,
  contents: string,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(contents);
  } finally {
    await writable.close();
  }
}

async function writeBlobFile(
  dir: FSADirectoryHandleLike,
  name: string,
  blob: Blob,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

// ---------- Reuse: try to read an existing manifest ----------

export interface ExistingSequence {
  manifest: SequenceJsonV3;
  /** Same path that goes into `ImageSequenceMetadata.manifestPath`. */
  manifestPath: string;
  /** Per-frame file objects, already resolved against the folder. */
  frameFiles: File[];
}

export interface ReadExistingSequenceOptions {
  projectRoot: FSADirectoryHandleLike;
  videoName: string;
  sourceHash: string;
  /** Optional log sink for parse/validation failures so the UI can show
   * "the existing sequence is corrupt — reconverting" without us
   * silently throwing away a folder the user might want to inspect. */
  onWarning?: (message: string) => void;
}

/**
 * Look for `Resources/Textures/<slug>_sequence_<hash8>/sequence.json`.
 * Returns the parsed manifest + frame file handles if everything is
 * valid AND the manifest's `sourceHash` matches the requested one.
 *
 * - Missing folder → returns `null` (caller proceeds with conversion).
 * - Folder present but `sequence.json` missing → returns `null` and
 *   emits a warning so the user sees the half-baked folder will be
 *   overwritten.
 * - Folder present but hash mismatch → returns `null`. Caller should
 *   overwrite (the folder name encodes the hash, so this only happens
 *   if the manifest was hand-edited).
 * - Folder present but parse/validation fails → returns `null` and
 *   emits a warning. The caller will overwrite.
 */
export async function tryReadExistingSequence(
  opts: ReadExistingSequenceOptions,
): Promise<ExistingSequence | null> {
  const folderName = buildSequenceFolderName(opts.videoName, opts.sourceHash);
  const manifestPath = buildSequenceManifestPath(folderName);
  const folder = await getOrCreateSubdirectory(
    opts.projectRoot,
    [RESOURCES_DIR, TEXTURES_DIR, folderName],
    { create: false },
  );
  if (!folder) return null;

  let manifestText: string;
  try {
    const handle = await folder.getFileHandle(SEQUENCE_JSON_NAME);
    manifestText = await readFileHandleAsText(handle);
  } catch {
    opts.onWarning?.(`Sequence folder "${folderName}" exists but sequence.json is missing — will reconvert.`);
    return null;
  }

  let manifest: SequenceJsonV3;
  try {
    manifest = parseSequenceJson(manifestText);
    validateSequenceJson(manifest);
  } catch (err) {
    const detail = err instanceof SequenceValidationError ? err.message : String(err);
    opts.onWarning?.(`Existing sequence.json for "${folderName}" is invalid (${detail}) — will reconvert.`);
    return null;
  }

  if (manifest.sourceHash && manifest.sourceHash !== opts.sourceHash) {
    opts.onWarning?.(`Existing sequence.json for "${folderName}" has a different sourceHash — will reconvert.`);
    return null;
  }

  const frameFiles: File[] = [];
  for (let frameIndex = 1; frameIndex <= manifest.frameCount; frameIndex += 1) {
    const name = formatFrameName(manifest.framePattern, frameIndex);
    try {
      const fh = await folder.getFileHandle(name);
      const file = await fh.getFile();
      frameFiles.push(file);
    } catch {
      opts.onWarning?.(`Existing sequence folder "${folderName}" is missing frame "${name}" — will reconvert.`);
      return null;
    }
  }

  return { manifest, manifestPath, frameFiles };
}

// ---------- Write: convert temp → project folder ----------

export interface WriteSequenceToProjectFolderOptions {
  projectRoot: FSADirectoryHandleLike;
  videoName: string;
  sourceHash: string;
  /** Backend manifest (already normalised through sequence v3). */
  manifest: SequenceJsonV3;
  /** In-order GET URLs the browser will fetch to copy frames into the
   * project folder. Length must equal `manifest.frameCount`. */
  frameFetchUrls: string[];
  /** Override for tests / non-browser callers. */
  fetchFrame?: (url: string) => Promise<Blob>;
  /** Optional progress hook called once per frame after the file is
   * flushed to disk. */
  onProgress?: (frameIndex: number, total: number) => void;
}

export interface WriteSequenceToProjectFolderResult {
  /** Same path shape stored in `ImageSequenceMetadata.manifestPath`. */
  manifestPath: string;
  folderName: string;
  manifest: SequenceJsonV3;
  /** Files written to the project folder, ready to mint blob URLs from. */
  frameFiles: File[];
}

/**
 * Copy the converted frames into `Resources/Textures/<folder>/` and
 * write `sequence.json`. Idempotent: writing the same folder twice with
 * the same hash overwrites prior contents, so a re-conversion after a
 * cancelled run leaves a clean folder.
 *
 * The function does NOT mutate `manifest`. It stamps `sourceHash`,
 * `createdBy`, `converterVersion` itself before serialising so callers
 * never have to remember.
 */
export async function writeSequenceToProjectFolder(
  opts: WriteSequenceToProjectFolderOptions,
): Promise<WriteSequenceToProjectFolderResult> {
  if (opts.frameFetchUrls.length !== opts.manifest.frameCount) {
    throw new Error(
      `frameFetchUrls.length (${opts.frameFetchUrls.length}) does not match manifest.frameCount (${opts.manifest.frameCount}).`,
    );
  }

  const folderName = buildSequenceFolderName(opts.videoName, opts.sourceHash);
  const manifestPath = buildSequenceManifestPath(folderName);
  const folder = await getOrCreateSubdirectory(
    opts.projectRoot,
    [RESOURCES_DIR, TEXTURES_DIR, folderName],
    { create: true },
  );
  if (!folder) {
    // Defensive: `getOrCreateSubdirectory({create: true})` only returns
    // null in mocks where create is ignored. Real FSA throws on failure.
    throw new Error(`Could not create folder ${manifestPath}.`);
  }

  const stamped: SequenceJsonV3 = normaliseToV3({
    ...opts.manifest,
    version: 3,
    sourceHash: opts.sourceHash,
    createdBy: opts.manifest.createdBy ?? CONVERTER_CREATED_BY,
    converterVersion: opts.manifest.converterVersion ?? CONVERTER_VERSION,
  });
  validateSequenceJson(stamped);

  const fetchFrame = opts.fetchFrame ?? defaultFetchFrame;
  const frameFiles: File[] = [];
  for (let i = 0; i < opts.frameFetchUrls.length; i += 1) {
    const url = opts.frameFetchUrls[i];
    const blob = await fetchFrame(url);
    const frameName = formatFrameName(stamped.framePattern, i + 1);
    await writeBlobFile(folder, frameName, blob);
    const reread = await folder.getFileHandle(frameName);
    frameFiles.push(await reread.getFile());
    opts.onProgress?.(i + 1, opts.frameFetchUrls.length);
  }

  await writeStringFile(folder, SEQUENCE_JSON_NAME, serialiseSequenceJson(stamped));

  return { manifestPath, folderName, manifest: stamped, frameFiles };
}

// ---------- Frame-name pattern ----------

/**
 * Resolve a single frame filename from a `frame_%06d.png` style pattern.
 * We only need %0Nd (zero-padded decimal) — that's the only pattern the
 * converter emits. Anything else is treated as a literal and we suffix
 * the frame index, which keeps the resolver from throwing on hand-rolled
 * manifests.
 */
export function formatFrameName(pattern: string, frameIndex: number): string {
  const match = pattern.match(/%0(\d+)d/);
  if (match) {
    const width = Math.max(1, Number(match[1]));
    const padded = String(frameIndex).padStart(width, "0");
    return pattern.replace(match[0], padded);
  }
  return `${pattern}-${frameIndex}`;
}

// ---------- Default frame fetcher ----------

async function defaultFetchFrame(url: string): Promise<Blob> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch frame ${url}: HTTP ${resp.status}`);
  }
  return resp.blob();
}
