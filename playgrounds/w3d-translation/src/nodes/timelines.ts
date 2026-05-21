// playgrounds/w3d-translation/src/nodes/timelines.ts
//
// Phase 2G — Timeline preview-frame snapshot (extended in Phase 2D.2).
//
// R3 stores per-property keyframe animations in <Timelines>. The "Selected"
// timeline carries a PreviewMarker — the frame at which the editor shows the
// scene. When we import a W3D scene we currently use only the static <Quad>
// attributes (Alpha, Size, Position, …); animations are ignored, so the
// playground renders frame 0 for un-evaluated properties even when the
// authored "final" graphic is at PreviewMarker (e.g. frame 799 for
// LINEUP_LEFT, where BASE_MAIN animates Size.X from 0 to 7.7).
//
// This module parses the timelines, picks the selected one (or the first
// available), and evaluates the following animated properties at the
// PreviewMarker:
//   - Alpha                          (Phase 2G)
//   - Size.XProp / Size.YProp        (Phase 2D.2)
//   - Transform.Position.XProp /
//     Transform.Position.YProp /
//     Transform.Position.ZProp       (Phase 2D.2)
//
// Other properties (rotation, scale, enable, …) stay at their authored static
// value until a future phase adds them.

export interface TimelinePreviewSnapshot {
  /** Name of the timeline whose PreviewMarker was used, when found. */
  timelineName?: string;
  /** Preview marker frame number on the selected timeline. */
  previewMarker?: number;
  /** Evaluated Alpha value at the preview marker, keyed by ControllableId (node GUID). */
  alphaByControllableId: Map<string, number>;
  /**
   * Phase 2D.2 — partial Size override per ControllableId. Only the axes that
   * have keyframes appear (Size.XProp → x, Size.YProp → y). The translator
   * applies these to W3DQuadData.geometry.size in place.
   */
  sizeByControllableId: Map<string, { x?: number; y?: number }>;
  /**
   * Phase 2D.2 — partial Position override per ControllableId. Only the axes
   * that have keyframes appear. Applied to W3DTransform.position on both
   * Quads and Groups (both kinds carry a transform).
   */
  positionByControllableId: Map<string, { x?: number; y?: number; z?: number }>;
}

interface RawKeyFrame { frame: number; value: number }

/** Property names recognised by Phase 2D.2 timeline evaluation. */
const PROP_ALPHA = "Alpha";
const PROP_SIZE_X = "Size.XProp";
const PROP_SIZE_Y = "Size.YProp";
const PROP_POS_X = "Transform.Position.XProp";
const PROP_POS_Y = "Transform.Position.YProp";
const PROP_POS_Z = "Transform.Position.ZProp";

const SUPPORTED_PROPS = new Set<string>([
  PROP_ALPHA, PROP_SIZE_X, PROP_SIZE_Y, PROP_POS_X, PROP_POS_Y, PROP_POS_Z,
]);

export function parseTimelinePreviewSnapshot(xml: string): TimelinePreviewSnapshot {
  const empty: TimelinePreviewSnapshot = {
    alphaByControllableId: new Map(),
    sizeByControllableId: new Map(),
    positionByControllableId: new Map(),
  };
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
    return {
      timelineName,
      previewMarker: undefined,
      alphaByControllableId: new Map(),
      sizeByControllableId: new Map(),
      positionByControllableId: new Map(),
    };
  }

  const alphaByControllableId = new Map<string, number>();
  const sizeByControllableId = new Map<string, { x?: number; y?: number }>();
  const positionByControllableId = new Map<string, { x?: number; y?: number; z?: number }>();

  for (const ctrl of Array.from(selected.children)) {
    if (ctrl.tagName !== "KeyFrameAnimationController") continue;
    const prop = ctrl.getAttribute("AnimatedProperty");
    if (!prop || !SUPPORTED_PROPS.has(prop)) continue;
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
    const v = evaluateAt(keyframes, previewMarker);

    if (prop === PROP_ALPHA) {
      alphaByControllableId.set(controllableId, v);
    } else if (prop === PROP_SIZE_X) {
      const cur = sizeByControllableId.get(controllableId) ?? {};
      cur.x = v;
      sizeByControllableId.set(controllableId, cur);
    } else if (prop === PROP_SIZE_Y) {
      const cur = sizeByControllableId.get(controllableId) ?? {};
      cur.y = v;
      sizeByControllableId.set(controllableId, cur);
    } else if (prop === PROP_POS_X) {
      const cur = positionByControllableId.get(controllableId) ?? {};
      cur.x = v;
      positionByControllableId.set(controllableId, cur);
    } else if (prop === PROP_POS_Y) {
      const cur = positionByControllableId.get(controllableId) ?? {};
      cur.y = v;
      positionByControllableId.set(controllableId, cur);
    } else if (prop === PROP_POS_Z) {
      const cur = positionByControllableId.get(controllableId) ?? {};
      cur.z = v;
      positionByControllableId.set(controllableId, cur);
    }
  }

  return {
    timelineName,
    previewMarker,
    alphaByControllableId,
    sizeByControllableId,
    positionByControllableId,
  };
}

/**
 * Evaluate keyframes at a target frame using linear interpolation between
 * neighbouring keyframes. Hold-first / hold-last semantics apply outside the
 * authored range. Bezier control points carried by R3 are intentionally
 * ignored for now — Linear approximation is enough for the LINEUP_LEFT case
 * where the preview marker sits inside the "hold" region of every track.
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
