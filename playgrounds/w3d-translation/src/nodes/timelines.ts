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
  /**
   * Phase 2D.4 — partial Scale override per ControllableId. Populated from
   * the W3D `Transform.Scale` controller (vec3 string Value="x,y,z") and the
   * per-axis variants Transform.Scale.{X,Y,Z}Prop. Applied to
   * W3DTransform.scale on Quads, Groups and TextureText nodes.
   */
  scaleByControllableId: Map<string, { x?: number; y?: number; z?: number }>;
}

interface RawKeyFrame { frame: number; value: number }

/** Property names recognised by Phase 2D.2 / 2D.4 timeline evaluation. */
const PROP_ALPHA = "Alpha";
const PROP_SIZE_X = "Size.XProp";
const PROP_SIZE_Y = "Size.YProp";
const PROP_POS_X = "Transform.Position.XProp";
const PROP_POS_Y = "Transform.Position.YProp";
const PROP_POS_Z = "Transform.Position.ZProp";
// Phase 2D.4 — Transform.Scale uses a vec3 string Value="x,y,z" in LINEUP_LEFT.
// The per-axis variants are accepted defensively for scenes that may use them.
const PROP_SCALE_VEC3 = "Transform.Scale";
const PROP_SCALE_X = "Transform.Scale.XProp";
const PROP_SCALE_Y = "Transform.Scale.YProp";
const PROP_SCALE_Z = "Transform.Scale.ZProp";

const SUPPORTED_PROPS = new Set<string>([
  PROP_ALPHA, PROP_SIZE_X, PROP_SIZE_Y,
  PROP_POS_X, PROP_POS_Y, PROP_POS_Z,
  PROP_SCALE_VEC3, PROP_SCALE_X, PROP_SCALE_Y, PROP_SCALE_Z,
]);

export function parseTimelinePreviewSnapshot(xml: string): TimelinePreviewSnapshot {
  const empty: TimelinePreviewSnapshot = {
    alphaByControllableId: new Map(),
    sizeByControllableId: new Map(),
    positionByControllableId: new Map(),
    scaleByControllableId: new Map(),
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
      scaleByControllableId: new Map(),
    };
  }

  const alphaByControllableId = new Map<string, number>();
  const sizeByControllableId = new Map<string, { x?: number; y?: number }>();
  const positionByControllableId = new Map<string, { x?: number; y?: number; z?: number }>();
  const scaleByControllableId = new Map<string, { x?: number; y?: number; z?: number }>();

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
    // Phase 2D.4 — Transform.Scale uses a vec3 string Value; handle it before
    // the scalar parser path so we don't drop perfectly-good controllers.
    if (prop === PROP_SCALE_VEC3) {
      const vec3KFs: { frame: number; value: { x: number; y: number; z: number } }[] = [];
      for (const kf of Array.from(ctrl.children)) {
        if (kf.tagName !== "KeyFrame") continue;
        const frame = Number(kf.getAttribute("FrameNumber"));
        const value = parseVec3String(kf.getAttribute("Value"));
        if (Number.isFinite(frame) && value) vec3KFs.push({ frame, value });
      }
      if (vec3KFs.length === 0) continue;
      vec3KFs.sort((a, b) => a.frame - b.frame);
      const v = evaluateVec3At(vec3KFs, previewMarker);
      scaleByControllableId.set(controllableId, { x: v.x, y: v.y, z: v.z });
      continue;
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
    } else if (prop === PROP_SCALE_X) {
      const cur = scaleByControllableId.get(controllableId) ?? {};
      cur.x = v;
      scaleByControllableId.set(controllableId, cur);
    } else if (prop === PROP_SCALE_Y) {
      const cur = scaleByControllableId.get(controllableId) ?? {};
      cur.y = v;
      scaleByControllableId.set(controllableId, cur);
    } else if (prop === PROP_SCALE_Z) {
      const cur = scaleByControllableId.get(controllableId) ?? {};
      cur.z = v;
      scaleByControllableId.set(controllableId, cur);
    }
  }

  return {
    timelineName,
    previewMarker,
    alphaByControllableId,
    sizeByControllableId,
    positionByControllableId,
    scaleByControllableId,
  };
}

/** Parse a comma-separated "x,y,z" string into a vec3, or null if malformed. */
function parseVec3String(raw: string | null): { x: number; y: number; z: number } | null {
  if (!raw) return null;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

/** Linear interpolation between vec3 keyframes, same hold-first/hold-last as evaluateAt. */
function evaluateVec3At(
  keyframes: { frame: number; value: { x: number; y: number; z: number } }[],
  frame: number,
): { x: number; y: number; z: number } {
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
      return {
        x: prev.value.x + (curr.value.x - prev.value.x) * t,
        y: prev.value.y + (curr.value.y - prev.value.y) * t,
        z: prev.value.z + (curr.value.z - prev.value.z) * t,
      };
    }
  }
  return last.value;
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
