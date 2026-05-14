/**
 * Glue layer between the browser MOV import flow and the project-folder
 * sequence storage. Combines `sequenceHash.computeSequenceSourceHash`,
 * `sequenceFolder.tryReadExistingSequence` and
 * `sequenceFolder.writeSequenceToProjectFolder` so the React layer can
 * call a single function and get back per-MOV `ImageSequenceMetadata`
 * pointing at on-disk frames.
 *
 * Caller is responsible for:
 *   - obtaining a writable `FSADirectoryHandleLike` (via
 *     `ensureWritableProjectRoot` below or a fresh `showDirectoryPicker`
 *     call) — when no handle is available, fall back to the existing
 *     dev-cache conversion path explicitly. This module never silently
 *     uses the dev-cache.
 *   - mapping back to `ImageSequenceMetadata.frameUrls` blob URLs;
 *     `mintFrameUrlsFromFiles` is provided so the caller doesn't have
 *     to import `URL.createObjectURL` in scattered places.
 */

import {
  buildSequenceFolderName,
  buildSequenceManifestPath,
  tryReadExistingSequence,
  writeSequenceToProjectFolder,
  type FSADirectoryHandleLike,
} from "./sequenceFolder";
import { computeSequenceSourceHash } from "./sequenceHash";
import type { SequenceJsonV3 } from "./sequenceSchema";
import type { ImageSequenceMetadata } from "../types";

// ---------- Project-root permission gate ----------

export type ProjectRootAvailability =
  | { kind: "ready"; root: FSADirectoryHandleLike }
  | { kind: "denied"; reason: "no-handle" | "permission-denied" | "unsupported" };

interface PermissionedDirectoryHandle extends FSADirectoryHandleLike {
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
}

/**
 * Make sure we have readwrite access on the given handle before we try
 * to write frames into it. Returns:
 *   - `{ kind: "ready", root }` — caller may proceed.
 *   - `{ kind: "denied" }` — caller should show the
 *     "needs project folder write access" message and fall back to
 *     dev-cache (or cancel).
 *
 * Browsers without the `query/requestPermission` API (e.g. Safari,
 * Firefox FSA polyfills) are reported as `"unsupported"` so the UI can
 * tailor the message.
 */
export async function ensureWritableProjectRoot(
  handle: FSADirectoryHandleLike | null,
): Promise<ProjectRootAvailability> {
  if (!handle) {
    return { kind: "denied", reason: "no-handle" };
  }
  const permissioned = handle as PermissionedDirectoryHandle;
  if (typeof permissioned.queryPermission !== "function" || typeof permissioned.requestPermission !== "function") {
    // Some hosts (older Chromium, polyfills) treat absence of the
    // permission API as "always granted" — but we can't verify, so we
    // try a noop write next and let it surface the real error.
    return { kind: "denied", reason: "unsupported" };
  }
  let state: PermissionState;
  try {
    state = await permissioned.queryPermission({ mode: "readwrite" });
  } catch {
    return { kind: "denied", reason: "unsupported" };
  }
  if (state === "granted") return { kind: "ready", root: handle };
  if (state === "denied") return { kind: "denied", reason: "permission-denied" };
  try {
    const requested = await permissioned.requestPermission({ mode: "readwrite" });
    if (requested === "granted") return { kind: "ready", root: handle };
    return { kind: "denied", reason: "permission-denied" };
  } catch {
    return { kind: "denied", reason: "permission-denied" };
  }
}

// ---------- Frame URL minter ----------

interface UrlFactoryLike {
  createObjectURL(blob: Blob): string;
}

export function mintFrameUrlsFromFiles(
  frameFiles: File[],
  urlFactory: UrlFactoryLike = URL,
): string[] {
  return frameFiles.map((file) => urlFactory.createObjectURL(file));
}

// ---------- Top-level orchestrator ----------

export interface PersistMovInput {
  /** The original .mov filename. Used as the storage key, the slug
   * input, and the `ImageSequenceMetadata.source` field. */
  movName: string;
  /** Bytes of the .mov, used to compute `sourceHash` for dedupe. */
  movBytes: ArrayBuffer | Uint8Array;
  /** Backend manifest for this MOV (the v3-shaped sequence JSON the
   * dev plugin produced). Pass `null` to signal "dedupe-only", e.g.
   * when the caller wants to avoid uploading until we've checked the
   * project folder. */
  backendManifest: SequenceJsonV3 | null;
  /** GET URLs (one per frame) pointing at the temp dev-cache, in
   * frame order. Required when `backendManifest !== null`. Ignored
   * when reuse hits. */
  frameFetchUrls?: string[];
}

export interface PersistMovOutcome {
  movName: string;
  status: "reused" | "written" | "missing-backend" | "failed";
  /** Present on `"reused"` and `"written"`. */
  metadata?: ImageSequenceMetadata;
  /** Files on disk corresponding to `metadata.frameUrls`. The caller
   * may need to hold onto these to extend the blob URL lifetime. */
  frameFiles?: File[];
  error?: string;
}

export interface PersistSequencesToProjectFolderOptions {
  projectRoot: FSADirectoryHandleLike;
  movs: PersistMovInput[];
  onWarning?: (message: string) => void;
  onProgress?: (movName: string, frameIndex: number, total: number) => void;
  fetchFrame?: (url: string) => Promise<Blob>;
  urlFactory?: UrlFactoryLike;
}

/**
 * Process a batch of MOVs:
 *   1. Compute sha256 for each.
 *   2. Look for an existing `Resources/Textures/<slug>_sequence_<hash8>/`
 *      that matches — if valid, reuse without touching the backend.
 *   3. Otherwise consume the supplied backend manifest + URLs,
 *      copying frames into the project folder and stamping the
 *      manifest with sourceHash/createdBy/converterVersion.
 *
 * Returns per-MOV outcomes. The caller decides what to do with each
 * (e.g. inserting into the editor's image library).
 */
export async function persistSequencesToProjectFolder(
  opts: PersistSequencesToProjectFolderOptions,
): Promise<PersistMovOutcome[]> {
  const outcomes: PersistMovOutcome[] = [];
  for (const input of opts.movs) {
    try {
      const sourceHash = await computeSequenceSourceHash(input.movBytes);

      const existing = await tryReadExistingSequence({
        projectRoot: opts.projectRoot,
        videoName: input.movName,
        sourceHash,
        onWarning: opts.onWarning,
      });
      if (existing) {
        const meta = toMetadataFromManifest({
          manifest: existing.manifest,
          manifestPath: existing.manifestPath,
          frameUrls: mintFrameUrlsFromFiles(existing.frameFiles, opts.urlFactory),
          movName: input.movName,
        });
        outcomes.push({ movName: input.movName, status: "reused", metadata: meta, frameFiles: existing.frameFiles });
        continue;
      }

      if (!input.backendManifest || !input.frameFetchUrls) {
        outcomes.push({ movName: input.movName, status: "missing-backend" });
        continue;
      }
      const written = await writeSequenceToProjectFolder({
        projectRoot: opts.projectRoot,
        videoName: input.movName,
        sourceHash,
        manifest: input.backendManifest,
        frameFetchUrls: input.frameFetchUrls,
        fetchFrame: opts.fetchFrame,
        onProgress: opts.onProgress ? (i, t) => opts.onProgress!(input.movName, i, t) : undefined,
      });
      const meta = toMetadataFromManifest({
        manifest: written.manifest,
        manifestPath: written.manifestPath,
        frameUrls: mintFrameUrlsFromFiles(written.frameFiles, opts.urlFactory),
        movName: input.movName,
      });
      outcomes.push({
        movName: input.movName,
        status: "written",
        metadata: meta,
        frameFiles: written.frameFiles,
      });
    } catch (err) {
      outcomes.push({
        movName: input.movName,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

function toMetadataFromManifest(args: {
  manifest: SequenceJsonV3;
  manifestPath: string;
  frameUrls: string[];
  movName: string;
}): ImageSequenceMetadata {
  const { manifest, manifestPath, frameUrls } = args;
  const meta: ImageSequenceMetadata = {
    type: "image-sequence",
    version: 3,
    format: manifest.format,
    source: manifest.source || args.movName,
    framePattern: manifest.framePattern,
    frameCount: manifest.frameCount,
    fps: manifest.fps,
    width: manifest.width,
    height: manifest.height,
    durationSec: manifest.durationSec,
    loop: manifest.loop,
    alpha: manifest.alpha,
    pixelFormat: "rgba",
    frameUrls,
    storageType: "project-folder",
    manifestPath,
  };
  if (manifest.fallbackReason) meta.fallbackReason = manifest.fallbackReason;
  if (manifest.sourceHash) meta.sourceHash = manifest.sourceHash;
  // The folder-name builder rebuilds the path deterministically — no
  // need to also persist `folderName`. Anything that needs it can call
  // `buildSequenceFolderName(meta.source, meta.sourceHash)`.
  void buildSequenceFolderName;
  void buildSequenceManifestPath;
  return meta;
}
