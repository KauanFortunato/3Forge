import type {
  AnimationClip,
  AnimationEasePreset,
  AnimationKeyframe,
  AnimationPropertyPath,
  AnimationTrack,
  ComponentAnimation,
  EditorNode,
} from "./types";

export const DEFAULT_ANIMATION_FPS = 24;
export const DEFAULT_ANIMATION_DURATION_FRAMES = 120;
export const DEFAULT_ANIMATION_EASE: AnimationEasePreset = "easeInOut";
export const DEFAULT_ANIMATION_CLIP_NAME = "main";

export const ANIMATION_PROPERTIES: Array<{ path: AnimationPropertyPath; label: string }> = [
  { path: "visible", label: "Visible" },
  { path: "transform.position.x", label: "Position X" },
  { path: "transform.position.y", label: "Position Y" },
  { path: "transform.position.z", label: "Position Z" },
  { path: "transform.rotation.x", label: "Rotation X" },
  { path: "transform.rotation.y", label: "Rotation Y" },
  { path: "transform.rotation.z", label: "Rotation Z" },
  { path: "transform.scale.x", label: "Scale X" },
  { path: "transform.scale.y", label: "Scale Y" },
  { path: "transform.scale.z", label: "Scale Z" },
  { path: "transform.skew.x", label: "Skew X" },
  { path: "transform.skew.y", label: "Skew Y" },
  { path: "transform.skew.z", label: "Skew Z" },
  { path: "material.opacity", label: "Opacity" },
  { path: "material.textureOptions.offsetU", label: "Texture Offset U" },
  { path: "material.textureOptions.offsetV", label: "Texture Offset V" },
  { path: "material.textureOptions.repeatU", label: "Texture Repeat U" },
  { path: "material.textureOptions.repeatV", label: "Texture Repeat V" },
];

export const ANIMATION_EASE_OPTIONS: Array<{ value: AnimationEasePreset; label: string; gsap: string }> = [
  { value: "linear", label: "Linear", gsap: "none" },
  { value: "easeIn", label: "Ease In", gsap: "power2.in" },
  { value: "easeOut", label: "Ease Out", gsap: "power2.out" },
  { value: "easeInOut", label: "Ease In Out", gsap: "power2.inOut" },
  { value: "backOut", label: "Back Out", gsap: "back.out(1.4)" },
  { value: "bounceOut", label: "Bounce Out", gsap: "bounce.out" },
];

export function createDefaultAnimation(): ComponentAnimation {
  return {
    activeClipId: "",
    clips: [],
  };
}

export function createAnimationClip(
  name: string,
  overrides: Partial<Pick<AnimationClip, "fps" | "durationFrames" | "tracks">> = {},
): AnimationClip {
  return {
    id: generateAnimationId("clip"),
    name: name.trim() || "clip",
    fps: overrides.fps ?? DEFAULT_ANIMATION_FPS,
    durationFrames: overrides.durationFrames ?? DEFAULT_ANIMATION_DURATION_FRAMES,
    tracks: overrides.tracks ? [...overrides.tracks] : [],
  };
}

export function isAnimationPropertyPath(value: string): value is AnimationPropertyPath {
  return ANIMATION_PROPERTIES.some((entry) => entry.path === value);
}

export function isAnimationEasePreset(value: string): value is AnimationEasePreset {
  return ANIMATION_EASE_OPTIONS.some((entry) => entry.value === value);
}

export function getAnimationPropertyLabel(path: AnimationPropertyPath): string {
  return ANIMATION_PROPERTIES.find((entry) => entry.path === path)?.label ?? path;
}

export function isDiscreteAnimationProperty(property: AnimationPropertyPath): boolean {
  return property === "visible";
}

export function normalizeAnimationValueForProperty(property: AnimationPropertyPath, value: number): number {
  if (!Number.isFinite(value)) {
    return isDiscreteAnimationProperty(property) ? 0 : value;
  }

  if (isDiscreteAnimationProperty(property)) {
    return value >= 0.5 ? 1 : 0;
  }

  return value;
}

export function animationValueToBoolean(property: AnimationPropertyPath, value: number): boolean {
  return isDiscreteAnimationProperty(property) ? normalizeAnimationValueForProperty(property, value) >= 0.5 : Boolean(value);
}

export function mapAnimationEaseToGsap(ease: AnimationEasePreset): string {
  return ANIMATION_EASE_OPTIONS.find((entry) => entry.value === ease)?.gsap ?? "power2.inOut";
}

export function frameToSeconds(frame: number, fps: number): number {
  return Number((frame / Math.max(fps, 1)).toFixed(6));
}

export function secondsToFrame(seconds: number, fps: number): number {
  return Math.round(seconds * Math.max(fps, 1));
}

export function clampFrame(frame: number, durationFrames: number): number {
  return Math.max(0, Math.min(Math.round(frame), Math.max(durationFrames, 0)));
}

/**
 * Maximum `clip.previewFrame` across an animation clip array. Returns -1
 * when no clip declares a non-negative preview frame (W3D-side semantics
 * for `<Timeline PreviewMarker>` use -1 to mean "no preview chosen"; the
 * parser drops negatives, so the absence is represented here by -1
 * rather than `undefined` so callers can compare numerically without
 * type-narrowing acrobatics).
 *
 * Used by:
 *   - `applyWorkspaceBlueprint` to pick the initial editor frame.
 *   - The defensive resync `useEffect` to re-sync on workspace restore /
 *     undo / viewport remount.
 *   - `__r3Dump().timelineRuntime.previewFrame` for forensic dumps.
 */
export function maxPreviewFrameFromClips(clips: readonly AnimationClip[]): number {
  let max = -1;
  for (const clip of clips) {
    if (typeof clip.previewFrame === "number" && clip.previewFrame > max) {
      max = clip.previewFrame;
    }
  }
  return max;
}

/**
 * Single source of truth for "should the editor disable / snap-back live
 * playback and scrub for the active blueprint?".
 *
 * Active when BOTH:
 *   1. the blueprint metadata carries a W3D origin marker, AND
 *   2. the animation declares a non-negative PreviewMarker frame.
 *
 * Rationale: 3Forge can faithfully reproduce W3D's PreviewMarker snapshot
 * (via the flatten pre-pass + FlowChildren + TextureText fit). Live
 * playback / scrubbing currently bypasses those systems — FlowChildren
 * offsets, mask clipping planes and TextureText fit-to-box are only
 * applied at flatten time, so animating Position/Scale/Alpha/Enabled
 * during runtime produces a visibly-broken composition. Until those
 * runtime refresh paths land, the safe surface is "show the static
 * preview and refuse to leave it". The guard is intentionally narrow:
 * blueprints without a W3D origin (legacy 3Forge scenes, hand-authored
 * timelines) keep full playback + scrub.
 */
export function isW3DPlaybackGuarded(opts: {
  blueprintMetadata: unknown;
  clips: readonly AnimationClip[];
}): boolean {
  const md = opts.blueprintMetadata as { w3d?: unknown } | null | undefined;
  if (!md || !md.w3d) return false;
  return maxPreviewFrameFromClips(opts.clips) >= 0;
}

export const W3D_PLAYBACK_GUARD_WARNING =
  "Live W3D playback is not fully supported yet. This import is shown as a PreviewMarker snapshot.";

/** Non-blocking advisory shown when a W3D-origin scene is playing. The runtime
 * applies all supported animation tracks (Position/Scale/Rotation/Alpha/Visible
 * + texture UV), but W3D-only systems (FlowChildren layout, mask clipping
 * planes, TextureText fit-to-box) only refresh at flatten/import time, so the
 * playing/scrubbing image is approximate compared to R³ Designer. */
export const W3D_PLAYBACK_ADVISORY =
  "W3D playback approximation: position/scale/alpha animate, but FlowChildren, masks and TextureText fit only refresh at import.";

/** Reasons playback cannot start. `null` when playback is supported.
 *
 * Note: the W3D preview-marker guard is intentionally NOT a blocked reason.
 * W3D imports remain playable when they have valid tracks; the guard is
 * surfaced separately as `playbackGuarded` + `playbackAdvisoryMessage` so
 * the UI can show a non-blocking advisory without disabling Play. */
export type PlaybackBlockedReason =
  | "no-clips"
  | "duration-zero"
  | "zero-tracks"
  | "missing-targets"
  | "unsupported-properties"
  | "render-loop-inactive"
  | null;

export interface PlaybackDiagnostics {
  /** Total clips on the active blueprint. */
  clipCount: number;
  /** Sum of authored tracks across every clip. */
  trackCount: number;
  /** Tracks that compiled successfully (have a resolvable target node and a
   * supported property path). May be lower than `trackCount` when nodes were
   * deleted or when the blueprint authored a property the runtime can't drive. */
  compiledTrackCount: number;
  /** Tracks dropped during compile because of missing target / unsupported property. */
  invalidTrackCount: number;
  /** Distinct node ids referenced by tracks that don't exist in the blueprint. */
  missingTargetNodeIds: string[];
  /** Distinct property paths referenced by tracks the runtime can't drive. */
  unsupportedAnimatedProperties: string[];
  /** First reason — in order of severity — why Play cannot proceed. `null` ⇒ ok. */
  playbackBlockedReason: PlaybackBlockedReason;
  /** Operator-facing message paired with `playbackBlockedReason`. Empty when
   * playback is supported. */
  playbackBlockedMessage: string;
  /** True when playback can run end-to-end. Equivalent to `playbackBlockedReason === null`. */
  playbackSupported: boolean;
  /** True when the blueprint originates from a W3D import with a PreviewMarker.
   * Advisory only — does NOT block playback. The UI uses this to show the
   * `playbackAdvisoryMessage` banner alongside an *enabled* Play button. */
  playbackGuarded: boolean;
  /** Operator-facing advisory shown when `playbackGuarded` is true and playback
   * is still supported. Empty when not applicable. */
  playbackAdvisoryMessage: string;
}

/** Property paths the runtime can drive end-to-end. Mirrors what
 * `getAnimationValue` / `applyAnimationValueToNode` actually handle today. */
const SUPPORTED_ANIMATED_PROPERTIES: ReadonlySet<string> = new Set<AnimationPropertyPath>([
  "visible",
  "transform.position.x",
  "transform.position.y",
  "transform.position.z",
  "transform.rotation.x",
  "transform.rotation.y",
  "transform.rotation.z",
  "transform.scale.x",
  "transform.scale.y",
  "transform.scale.z",
  "transform.skew.x",
  "transform.skew.y",
  "transform.skew.z",
  "material.opacity",
  "material.textureOptions.offsetU",
  "material.textureOptions.offsetV",
  "material.textureOptions.repeatU",
  "material.textureOptions.repeatV",
]);

export interface PlaybackDiagnosticsInput {
  blueprintMetadata: unknown;
  clips: readonly AnimationClip[];
  /** All node ids present in the blueprint. Used to detect missing track targets. */
  nodeIds: ReadonlySet<string>;
  /** Optional override of the "what is supported" set. Tests pass this; the
   * default mirrors the runtime evaluator. */
  supportedProperties?: ReadonlySet<string>;
}

/**
 * Pure helper: classifies playback readiness so the App can disable the Play
 * button AND surface a visible reason.
 *
 * Blocking cascade (only the first match fires — the rest are still computed
 * into the diagnostic object):
 *   1. No clips           → `no-clips`
 *   2. Duration zero      → `duration-zero`
 *   3. Zero tracks        → `zero-tracks`
 *   4. Missing targets    → `missing-targets`     (only when ALL tracks invalid)
 *   5. Unsupported props  → `unsupported-properties` (only when ALL tracks invalid)
 *
 * The W3D PreviewMarker guard is *not* in the cascade. W3D imports always
 * remain playable; `playbackGuarded` + `playbackAdvisoryMessage` carry the
 * "runtime preview is approximate" hint without disabling Play.
 *
 * Partial-validity rule: when SOME tracks compile and others don't, playback
 * is supported and the bad ones are reported via `invalidTrackCount` /
 * `unsupportedAnimatedProperties` — the runtime simply doesn't drive them.
 *
 * `render-loop-inactive` is a runtime symptom (raf cancelled / scene unmounted);
 * scene.ts layers that on top of this output when it knows the runtime state.
 */
export function getPlaybackDiagnostics(input: PlaybackDiagnosticsInput): PlaybackDiagnostics {
  const supported = input.supportedProperties ?? SUPPORTED_ANIMATED_PROPERTIES;
  const guarded = isW3DPlaybackGuarded({
    blueprintMetadata: input.blueprintMetadata,
    clips: input.clips,
  });
  const clipCount = input.clips.length;
  let trackCount = 0;
  let compiledTrackCount = 0;
  let invalidTrackCount = 0;
  const missingTargets = new Set<string>();
  const unsupported = new Set<string>();
  let totalDuration = 0;
  for (const clip of input.clips) {
    totalDuration += clip.durationFrames ?? 0;
    for (const track of clip.tracks) {
      trackCount += 1;
      const targetMissing = !input.nodeIds.has(track.nodeId);
      const propertyUnsupported = !supported.has(track.property);
      if (targetMissing) missingTargets.add(track.nodeId);
      if (propertyUnsupported) unsupported.add(track.property);
      if (targetMissing || propertyUnsupported) {
        invalidTrackCount += 1;
      } else {
        compiledTrackCount += 1;
      }
    }
  }

  let reason: PlaybackBlockedReason = null;
  let message = "";
  if (clipCount === 0) {
    reason = "no-clips";
    message = "Playback failed: no animation clips.";
  } else if (totalDuration <= 0) {
    reason = "duration-zero";
    message = "Playback failed: duration is 0.";
  } else if (compiledTrackCount === 0 && trackCount === 0) {
    reason = "zero-tracks";
    message = "Playback failed: no valid animation tracks.";
  } else if (compiledTrackCount === 0 && missingTargets.size > 0) {
    reason = "missing-targets";
    message = `Playback failed: missing target nodes (${missingTargets.size}).`;
  } else if (compiledTrackCount === 0 && unsupported.size > 0) {
    reason = "unsupported-properties";
    message = `Playback failed: unsupported animated properties (${unsupported.size}).`;
  }

  return {
    clipCount,
    trackCount,
    compiledTrackCount,
    invalidTrackCount,
    missingTargetNodeIds: Array.from(missingTargets),
    unsupportedAnimatedProperties: Array.from(unsupported),
    playbackBlockedReason: reason,
    playbackBlockedMessage: message,
    playbackSupported: reason === null,
    playbackGuarded: guarded,
    playbackAdvisoryMessage: guarded && reason === null ? W3D_PLAYBACK_ADVISORY : "",
  };
}

export function createAnimationTrack(nodeId: string, property: AnimationPropertyPath): AnimationTrack {
  return {
    id: generateAnimationId("track"),
    nodeId,
    property,
    keyframes: [],
  };
}

export function createAnimationKeyframe(frame: number, value: number, ease: AnimationEasePreset = DEFAULT_ANIMATION_EASE): AnimationKeyframe {
  return {
    id: generateAnimationId("key"),
    frame: Math.max(0, Math.round(frame)),
    value,
    ease,
  };
}

export function normalizeAnimation(rawAnimation: unknown, validNodeIds: Set<string>): ComponentAnimation {
  const fallback = createDefaultAnimation();
  if (!rawAnimation || typeof rawAnimation !== "object") {
    return fallback;
  }

  const source = rawAnimation as Record<string, unknown>;
  const clipsSource = Array.isArray(source.clips) ? source.clips : null;
  if (clipsSource) {
    const clips = normalizeAnimationClips(clipsSource, validNodeIds, fallback.clips);
    if (clips.length === 0) {
      return fallback;
    }

    const activeClipId = typeof source.activeClipId === "string" && clips.some((clip) => clip.id === source.activeClipId)
      ? source.activeClipId
      : clips[0].id;

    return {
      activeClipId,
      clips,
    };
  }

  const enterClip = normalizeLegacyAnimationClip(source, validNodeIds);
  return {
    activeClipId: enterClip.id,
    clips: [enterClip],
  };
}

export function sortTrackKeyframes(keyframes: AnimationKeyframe[]): AnimationKeyframe[] {
  return [...keyframes].sort((a, b) => {
    if (a.frame === b.frame) {
      return a.id.localeCompare(b.id);
    }
    return a.frame - b.frame;
  });
}

export function isTrackMuted(track: AnimationTrack): boolean {
  return track.muted === true;
}

export function assertKeyframesSorted(track: AnimationTrack): void {
  if (import.meta.env?.PROD) {
    return;
  }

  for (let index = 1; index < track.keyframes.length; index += 1) {
    const previous = track.keyframes[index - 1];
    const current = track.keyframes[index];
    if (current.frame < previous.frame) {
      throw new Error(
        `Track ${track.id} keyframes are not sorted: frame ${current.frame} at index ${index} follows frame ${previous.frame} at index ${index - 1}.`,
      );
    }
    if (current.frame === previous.frame && current.id.localeCompare(previous.id) < 0) {
      throw new Error(
        `Track ${track.id} keyframes tie-break order broken at frame ${current.frame}: id "${current.id}" follows "${previous.id}".`,
      );
    }
  }
}

export function getTrackSegments(track: AnimationTrack): Array<{ from: AnimationKeyframe; to: AnimationKeyframe }> {
  const ordered = sortTrackKeyframes(track.keyframes);
  const segments: Array<{ from: AnimationKeyframe; to: AnimationKeyframe }> = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index];
    const to = ordered[index + 1];
    if (to.frame <= from.frame) {
      continue;
    }
    segments.push({ from, to });
  }

  return segments;
}

export function getAnimationValue(node: EditorNode, property: AnimationPropertyPath): number {
  const value = property.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, node);
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function applyAnimationValue(node: EditorNode, property: AnimationPropertyPath, value: number): void {
  const segments = property.split(".");
  const lastSegment = segments.pop();
  if (!lastSegment) {
    return;
  }

  // `transform.skew` is an optional Vec3Like — auto-create the container so
  // animated skew tracks can write into it on a node that didn't have static
  // skew. Mirrors the runtime which inserts a skewLayer Group on demand.
  if (segments.length === 2 && segments[0] === "transform" && segments[1] === "skew") {
    if (!node.transform.skew) {
      node.transform.skew = { x: 0, y: 0, z: 0 };
    }
  }

  const target = segments.reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, node);

  if (target && typeof target === "object") {
    (target as Record<string, unknown>)[lastSegment] = isDiscreteAnimationProperty(property)
      ? animationValueToBoolean(property, value)
      : normalizeAnimationValueForProperty(property, value);
  }
}

function normalizeTrackKeyframes(
  rawKeyframes: unknown[],
  property: AnimationPropertyPath,
  durationFrames: number,
): AnimationKeyframe[] {
  const normalized: AnimationKeyframe[] = [];
  const usedFrames = new Set<number>();
  const usedIds = new Set<string>();

  for (const rawKeyframe of rawKeyframes) {
    if (!rawKeyframe || typeof rawKeyframe !== "object") {
      continue;
    }

    const source = rawKeyframe as Record<string, unknown>;
    const frame = clampFrame(normalizePositiveInteger(source.frame, 0), durationFrames);
    const rawValue = typeof source.value === "boolean"
      ? (source.value ? 1 : 0)
      : typeof source.value === "number" && Number.isFinite(source.value)
        ? source.value
        : 0;
    const value = normalizeAnimationValueForProperty(property, rawValue);
    const ease = typeof source.ease === "string" && isAnimationEasePreset(source.ease) ? source.ease : DEFAULT_ANIMATION_EASE;
    if (usedFrames.has(frame)) {
      continue;
    }

    let id = typeof source.id === "string" && source.id.trim() ? source.id : generateAnimationId("key");
    while (usedIds.has(id)) {
      id = generateAnimationId("key");
    }

    usedFrames.add(frame);
    usedIds.add(id);
    normalized.push({ id, frame, value, ease });
  }

  return sortTrackKeyframes(normalized);
}

function normalizeAnimationClips(
  rawClips: unknown[],
  validNodeIds: Set<string>,
  fallbackClips: AnimationClip[],
): AnimationClip[] {
  const normalized: AnimationClip[] = [];
  const seenClipIds = new Set<string>();
  const usedNames = new Set<string>();

  for (const rawClip of rawClips) {
    if (!rawClip || typeof rawClip !== "object") {
      continue;
    }

    const clipSource = rawClip as Record<string, unknown>;
    const fallbackClip = fallbackClips[normalized.length] ?? fallbackClips[0] ?? createAnimationClip(DEFAULT_ANIMATION_CLIP_NAME);
    let clipId = typeof clipSource.id === "string" && clipSource.id.trim() ? clipSource.id : generateAnimationId("clip");
    while (seenClipIds.has(clipId)) {
      clipId = generateAnimationId("clip");
    }
    seenClipIds.add(clipId);

    const baseName = typeof clipSource.name === "string" && clipSource.name.trim() ? clipSource.name.trim() : fallbackClip.name;
    const name = makeUniqueClipName(baseName, usedNames);
    usedNames.add(name.toLowerCase());
    const fps = normalizePositiveInteger(clipSource.fps, fallbackClip.fps);
    const durationFrames = normalizePositiveInteger(clipSource.durationFrames, fallbackClip.durationFrames);
    const tracks = normalizeAnimationTracks(Array.isArray(clipSource.tracks) ? clipSource.tracks : [], validNodeIds, durationFrames);
    // Preserve the W3D PreviewMarker if it was carried on the clip (set
    // by the parser). Negative values mean "no preview chosen" and are
    // dropped; values outside the duration are clamped to the last frame.
    const rawPreview = typeof clipSource.previewFrame === "number" ? clipSource.previewFrame : null;
    const previewFrame = rawPreview !== null && Number.isFinite(rawPreview) && rawPreview >= 0
      ? Math.min(Math.round(rawPreview), durationFrames)
      : undefined;
    const clip: AnimationClip = {
      id: clipId,
      name,
      fps,
      durationFrames,
      tracks,
    };
    if (previewFrame !== undefined) clip.previewFrame = previewFrame;
    normalized.push(clip);
  }

  return normalized;
}

function normalizeLegacyAnimationClip(source: Record<string, unknown>, validNodeIds: Set<string>): AnimationClip {
  const fallback = createAnimationClip(DEFAULT_ANIMATION_CLIP_NAME);
  const fps = normalizePositiveInteger(source.fps, fallback.fps);
  const durationFrames = normalizePositiveInteger(source.durationFrames, fallback.durationFrames);
  const tracks = normalizeAnimationTracks(Array.isArray(source.tracks) ? source.tracks : [], validNodeIds, durationFrames);
  return {
    ...fallback,
    fps,
    durationFrames,
    tracks,
  };
}

function normalizeAnimationTracks(rawTracks: unknown[], validNodeIds: Set<string>, durationFrames: number): AnimationTrack[] {
  const tracks: AnimationTrack[] = [];
  const seenTrackIds = new Set<string>();

  for (const rawTrack of rawTracks) {
    if (!rawTrack || typeof rawTrack !== "object") {
      continue;
    }

    const trackSource = rawTrack as Record<string, unknown>;
    const nodeId = typeof trackSource.nodeId === "string" ? trackSource.nodeId : "";
    const property = typeof trackSource.property === "string" ? trackSource.property : "";
    if (!validNodeIds.has(nodeId) || !isAnimationPropertyPath(property)) {
      continue;
    }

    let trackId = typeof trackSource.id === "string" && trackSource.id.trim() ? trackSource.id : generateAnimationId("track");
    while (seenTrackIds.has(trackId)) {
      trackId = generateAnimationId("track");
    }
    seenTrackIds.add(trackId);

    const muted = typeof trackSource.muted === "boolean" ? trackSource.muted : undefined;
    const track: AnimationTrack = {
      id: trackId,
      nodeId,
      property,
      keyframes: normalizeTrackKeyframes(Array.isArray(trackSource.keyframes) ? trackSource.keyframes : [], property, durationFrames),
    };
    if (muted !== undefined) {
      track.muted = muted;
    }
    tracks.push(track);
  }

  return tracks;
}

function makeUniqueClipName(name: string, usedNames: Set<string>): string {
  const base = name.trim() || "clip";
  let candidate = base;
  let suffix = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base} ${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function generateAnimationId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
