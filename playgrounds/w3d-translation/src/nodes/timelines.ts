// playgrounds/w3d-translation/src/nodes/timelines.ts
//
// Phase 2G — Timeline preview-frame snapshot.
//
// R3 stores per-property keyframe animations in <Timelines>. The "Selected"
// timeline carries a PreviewMarker — the frame at which the editor shows the
// scene. When we import a W3D scene we currently use only the static <Quad>
// attributes (Alpha, …); animations are ignored, so the playground renders
// frame 0 even when the authored "final" graphic is at PreviewMarker (e.g.
// frame 799 for LINEUP_LEFT, where photos animate Alpha 0.5 → 1.0).
//
// This module parses the timelines, picks the selected one (or the first
// available), and evaluates each animated property at the PreviewMarker.
// Only Alpha is evaluated for now — other properties (Position, Scale, Enabled,
// …) are intentionally out of scope until needed.

export interface TimelinePreviewSnapshot {
  /** Name of the timeline whose PreviewMarker was used, when found. */
  timelineName?: string;
  /** Preview marker frame number on the selected timeline. */
  previewMarker?: number;
  /** Evaluated Alpha value at the preview marker, keyed by ControllableId (node GUID). */
  alphaByControllableId: Map<string, number>;
}

interface RawKeyFrame { frame: number; value: number }

export function parseTimelinePreviewSnapshot(xml: string): TimelinePreviewSnapshot {
  const empty: TimelinePreviewSnapshot = { alphaByControllableId: new Map() };
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return empty;

  const timelinesEl =
    doc.querySelector("Scene > Timelines") ?? doc.querySelector("Timelines");
  if (!timelinesEl) return empty;

  const selectedId = timelinesEl.getAttribute("SelectedTimelineId");
  const allTimelines = Array.from(timelinesEl.children).filter(
    (c) => c.tagName === "Timeline",
  );
  if (allTimelines.length === 0) return empty;

  let selected: Element | undefined;
  if (selectedId) {
    selected = allTimelines.find((t) => t.getAttribute("Id") === selectedId);
  }
  if (!selected) selected = allTimelines[0]; // fallback

  const previewAttr = selected.getAttribute("PreviewMarker");
  const previewMarker = previewAttr !== null ? Number(previewAttr) : NaN;
  const timelineName = selected.getAttribute("Name") ?? undefined;

  if (!Number.isFinite(previewMarker) || previewMarker < 0) {
    return { timelineName, previewMarker: undefined, alphaByControllableId: new Map() };
  }

  const alphaByControllableId = new Map<string, number>();
  for (const ctrl of Array.from(selected.children)) {
    if (ctrl.tagName !== "KeyFrameAnimationController") continue;
    if (ctrl.getAttribute("AnimatedProperty") !== "Alpha") continue;
    const controllableId = ctrl.getAttribute("ControllableId");
    if (!controllableId) continue;

    const keyframes: RawKeyFrame[] = [];
    for (const kf of Array.from(ctrl.children)) {
      if (kf.tagName !== "KeyFrame") continue;
      const frame = Number(kf.getAttribute("FrameNumber"));
      const value = Number(kf.getAttribute("Value"));
      if (Number.isFinite(frame) && Number.isFinite(value)) {
        keyframes.push({ frame, value });
      }
    }
    if (keyframes.length === 0) continue;
    keyframes.sort((a, b) => a.frame - b.frame);
    alphaByControllableId.set(controllableId, evaluateAt(keyframes, previewMarker));
  }

  return { timelineName, previewMarker, alphaByControllableId };
}

/**
 * Evaluate keyframes at a target frame using linear interpolation between
 * neighbouring keyframes. Hold-first / hold-last semantics apply outside the
 * authored range. Bezier control points carried by R3 are intentionally
 * ignored for now — Linear approximation is enough for the LINEUP_LEFT case
 * where the preview marker sits inside the "hold" region of every Alpha track.
 */
function evaluateAt(keyframes: RawKeyFrame[], frame: number): number {
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;
  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1];
    const curr = keyframes[i];
    if (frame <= curr.frame) {
      const span = curr.frame - prev.frame;
      if (span === 0) return curr.value;
      const t = (frame - prev.frame) / span;
      return prev.value + (curr.value - prev.value) * t;
    }
  }
  return last.value; // unreachable in practice
}
