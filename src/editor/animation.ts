import type {
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

export const ANIMATION_PROPERTIES: Array<{ path: AnimationPropertyPath; label: string }> = [
  { path: "transform.position.x", label: "Position X" },
  { path: "transform.position.y", label: "Position Y" },
  { path: "transform.position.z", label: "Position Z" },
  { path: "transform.rotation.x", label: "Rotation X" },
  { path: "transform.rotation.y", label: "Rotation Y" },
  { path: "transform.rotation.z", label: "Rotation Z" },
  { path: "transform.scale.x", label: "Scale X" },
  { path: "transform.scale.y", label: "Scale Y" },
  { path: "transform.scale.z", label: "Scale Z" },
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
    fps: DEFAULT_ANIMATION_FPS,
    durationFrames: DEFAULT_ANIMATION_DURATION_FRAMES,
    tracks: [],
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
  const fps = normalizePositiveInteger(source.fps, fallback.fps);
  const durationFrames = normalizePositiveInteger(source.durationFrames, fallback.durationFrames);
  const rawTracks = Array.isArray(source.tracks) ? source.tracks : [];
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

    const rawKeyframes = Array.isArray(trackSource.keyframes) ? trackSource.keyframes : [];
    const keyframes = normalizeTrackKeyframes(rawKeyframes, durationFrames);

    tracks.push({
      id: trackId,
      nodeId,
      property,
      keyframes,
    });
  }

  return {
    fps,
    durationFrames,
    tracks,
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
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function applyAnimationValue(node: EditorNode, property: AnimationPropertyPath, value: number): void {
  const segments = property.split(".");
  const lastSegment = segments.pop();
  if (!lastSegment) {
    return;
  }

  const target = segments.reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, node);

  if (target && typeof target === "object") {
    (target as Record<string, unknown>)[lastSegment] = value;
  }
}

function normalizeTrackKeyframes(rawKeyframes: unknown[], durationFrames: number): AnimationKeyframe[] {
  const normalized: AnimationKeyframe[] = [];
  const usedFrames = new Set<number>();
  const usedIds = new Set<string>();

  for (const rawKeyframe of rawKeyframes) {
    if (!rawKeyframe || typeof rawKeyframe !== "object") {
      continue;
    }

    const source = rawKeyframe as Record<string, unknown>;
    const frame = clampFrame(normalizePositiveInteger(source.frame, 0), durationFrames);
    const value = typeof source.value === "number" && Number.isFinite(source.value) ? source.value : 0;
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

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function generateAnimationId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
