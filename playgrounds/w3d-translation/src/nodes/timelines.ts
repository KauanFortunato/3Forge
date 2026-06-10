// playgrounds/w3d-translation/src/nodes/timelines.ts
//
// Phase 2G — Timeline preview-frame snapshot (extended in Phase 2D.2).
// Phase TL — runtime animation: tracks are parsed ONCE (parseTimelineTracks)
// and can be evaluated at ANY frame (evaluateSnapshotAtFrame), which is what
// the timeline player drives. parseTimelinePreviewSnapshot remains as the
// PreviewMarker shortcut used by the static translate path.
//
// R3 stores per-property keyframe animations in <Timelines>. Each KeyFrame
// carries CubicBezier easing handles (LeftType/RightType + control points in
// normalized segment space): the segment between key i and key i+1 is the
// cubic bezier with P1 = key[i]'s RIGHT control point and P2 = key[i+1]'s
// LEFT control point. Linear keys author the control points ON the diagonal
// (0.5, 0.5), which makes the bezier exactly linear — so a single bezier
// evaluator covers both authored types.
//
// Evaluated properties: Alpha, Size.X/YProp, Transform.Position (vec3 +
// per-axis), Transform.Scale (vec3 + per-axis), Transform.Skew.X/YProp,
// Enabled (boolean step). Unknown AnimatedProperty values are surfaced in
// `unsupportedProps` so the translator can warn instead of silently dropping.

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
  /**
   * Phase H5 — partial Skew override per ControllableId, per-axis, in DEGREES.
   * Populated from `Transform.Skew.XProp` / `Transform.Skew.YProp` controllers.
   * Applied to `W3DTransform.skew.{x,y}`; the builder shears the node's
   * PlaneGeometry by these angles.
   */
  skewByControllableId: Map<string, { x?: number; y?: number }>;
  /**
   * Phase 2D.5 — Enabled snapshot per ControllableId. R3 stores visibility as
   * an `Enabled` track whose KeyFrame Value is the string "True"/"False".
   * Evaluated as a STEP (hold-last) — no interpolation.
   */
  enabledByControllableId: Map<string, boolean>;
}

/** Scalar keyframe with normalized bezier handles (segment space; 0.5 = linear). */
export interface ScalarKey {
  frame: number;
  value: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

export interface Vec3Key {
  frame: number;
  value: { x: number; y: number; z: number };
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

export interface BoolKey {
  frame: number;
  value: boolean;
}

/** Property names recognised by the timeline evaluation. */
const PROP_ALPHA = "Alpha";
const PROP_SIZE_X = "Size.XProp";
const PROP_SIZE_Y = "Size.YProp";
const PROP_POS_X = "Transform.Position.XProp";
const PROP_POS_Y = "Transform.Position.YProp";
const PROP_POS_Z = "Transform.Position.ZProp";
const PROP_POS_VEC3 = "Transform.Position";
const PROP_SCALE_VEC3 = "Transform.Scale";
const PROP_SCALE_X = "Transform.Scale.XProp";
const PROP_SCALE_Y = "Transform.Scale.YProp";
const PROP_SCALE_Z = "Transform.Scale.ZProp";
const PROP_SKEW_X = "Transform.Skew.XProp";
const PROP_SKEW_Y = "Transform.Skew.YProp";
const PROP_ENABLED = "Enabled";

const SCALAR_PROPS = new Set<string>([
  PROP_ALPHA, PROP_SIZE_X, PROP_SIZE_Y,
  PROP_POS_X, PROP_POS_Y, PROP_POS_Z,
  PROP_SCALE_X, PROP_SCALE_Y, PROP_SCALE_Z,
  PROP_SKEW_X, PROP_SKEW_Y,
]);

export interface ScalarTrack {
  prop: string;
  controllableId: string;
  keys: ScalarKey[];
}

export interface Vec3Track {
  prop: typeof PROP_POS_VEC3 | typeof PROP_SCALE_VEC3;
  controllableId: string;
  keys: Vec3Key[];
}

export interface BoolTrack {
  controllableId: string;
  keys: BoolKey[];
}

export interface TimelineTracks {
  timelineName?: string;
  /** PreviewMarker when authored and >= 0 (the editor's hero frame). */
  previewMarker?: number;
  /** Timeline length in frames (0 when absent). The player runs [0, maxFrames-1]. */
  maxFrames: number;
  /** Frames per second, parsed from <Timelines Format="HD1080p50"> (default 50). */
  fps: number;
  isLoop: boolean;
  scalar: ScalarTrack[];
  vec3: Vec3Track[];
  enabled: BoolTrack[];
  /** AnimatedProperty values we do not evaluate yet — surfaced for warnings. */
  unsupportedProps: { prop: string; controllableId: string }[];
}

const EMPTY_TRACKS: TimelineTracks = {
  maxFrames: 0,
  fps: 50,
  isLoop: false,
  scalar: [],
  vec3: [],
  enabled: [],
  unsupportedProps: [],
};

/** Parse the selected timeline (SelectedTimelineId, else the first) into
 * evaluable tracks. Pure parse — no frame is chosen here. */
export function parseTimelineTracks(xml: string): TimelineTracks {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return { ...EMPTY_TRACKS };

  const timelinesEl =
    doc.querySelector("Scene > Timelines") ?? doc.querySelector("Timelines");
  if (!timelinesEl) return { ...EMPTY_TRACKS };

  const fps = parseFpsFromFormat(timelinesEl.getAttribute("Format"));

  const selectedId = timelinesEl.getAttribute("SelectedTimelineId");
  const allTimelines = Array.from(timelinesEl.children).filter(
    (c) => c.tagName === "Timeline",
  );
  if (allTimelines.length === 0) return { ...EMPTY_TRACKS, fps };

  let selected: Element | undefined;
  if (selectedId) {
    selected = allTimelines.find((t) => t.getAttribute("Id") === selectedId);
  }
  if (!selected) selected = allTimelines[0]; // fallback

  const previewAttr = selected.getAttribute("PreviewMarker");
  const previewMarkerRaw = previewAttr !== null ? Number(previewAttr) : NaN;
  const previewMarker =
    Number.isFinite(previewMarkerRaw) && previewMarkerRaw >= 0 ? previewMarkerRaw : undefined;
  const timelineName = selected.getAttribute("Name") ?? undefined;
  const maxFramesRaw = Number(selected.getAttribute("MaxFrames"));
  const maxFrames = Number.isFinite(maxFramesRaw) && maxFramesRaw > 0 ? maxFramesRaw : 0;
  const isLoop = (selected.getAttribute("IsLoop") ?? "").trim().toLowerCase() === "true";

  const out: TimelineTracks = {
    timelineName,
    previewMarker,
    maxFrames,
    fps,
    isLoop,
    scalar: [],
    vec3: [],
    enabled: [],
    unsupportedProps: [],
  };

  for (const ctrl of Array.from(selected.children)) {
    // Image-sequence / video playback controllers — not evaluated yet, but
    // surfaced so the importer can warn instead of silently dropping motion.
    if (ctrl.tagName === "ImageSequenceAnimationController") {
      const seqId = ctrl.getAttribute("ControllableId");
      if (seqId) {
        out.unsupportedProps.push({
          prop: `${ctrl.getAttribute("AnimatedProperty") ?? "Animation"} (image sequence / video playback)`,
          controllableId: seqId,
        });
      }
      continue;
    }
    if (ctrl.tagName !== "KeyFrameAnimationController") continue;
    const prop = ctrl.getAttribute("AnimatedProperty");
    const controllableId = ctrl.getAttribute("ControllableId");
    if (!prop || !controllableId) continue;

    if (prop === PROP_POS_VEC3 || prop === PROP_SCALE_VEC3) {
      const keys: Vec3Key[] = [];
      for (const kf of Array.from(ctrl.children)) {
        if (kf.tagName !== "KeyFrame") continue;
        const frame = Number(kf.getAttribute("FrameNumber"));
        const value = parseVec3String(kf.getAttribute("Value"));
        if (Number.isFinite(frame) && value) keys.push({ frame, value, ...parseHandles(kf) });
      }
      if (keys.length === 0) continue;
      keys.sort((a, b) => a.frame - b.frame);
      out.vec3.push({ prop, controllableId, keys });
      continue;
    }

    if (prop === PROP_ENABLED) {
      const keys: BoolKey[] = [];
      for (const kf of Array.from(ctrl.children)) {
        if (kf.tagName !== "KeyFrame") continue;
        const frame = Number(kf.getAttribute("FrameNumber"));
        const raw = (kf.getAttribute("Value") ?? "").trim().toLowerCase();
        if (Number.isFinite(frame) && (raw === "true" || raw === "false")) {
          keys.push({ frame, value: raw === "true" });
        }
      }
      if (keys.length === 0) continue;
      keys.sort((a, b) => a.frame - b.frame);
      out.enabled.push({ controllableId, keys });
      continue;
    }

    if (SCALAR_PROPS.has(prop)) {
      const keys: ScalarKey[] = [];
      for (const kf of Array.from(ctrl.children)) {
        if (kf.tagName !== "KeyFrame") continue;
        const frame = Number(kf.getAttribute("FrameNumber"));
        const value = Number(kf.getAttribute("Value"));
        if (Number.isFinite(frame) && Number.isFinite(value)) {
          keys.push({ frame, value, ...parseHandles(kf) });
        }
      }
      if (keys.length === 0) continue;
      keys.sort((a, b) => a.frame - b.frame);
      out.scalar.push({ prop, controllableId, keys });
      continue;
    }

    out.unsupportedProps.push({ prop, controllableId });
  }

  return out;
}

/** Evaluate every track at `frame` and assemble the per-property override
 * maps (the same shape the static preview-marker path produces). */
export function evaluateSnapshotAtFrame(
  tracks: TimelineTracks,
  frame: number,
): TimelinePreviewSnapshot {
  const alphaByControllableId = new Map<string, number>();
  const sizeByControllableId = new Map<string, { x?: number; y?: number }>();
  const positionByControllableId = new Map<string, { x?: number; y?: number; z?: number }>();
  const positionVec3ById = new Map<string, { x: number; y: number; z: number }>();
  const scaleByControllableId = new Map<string, { x?: number; y?: number; z?: number }>();
  const skewByControllableId = new Map<string, { x?: number; y?: number }>();
  const enabledByControllableId = new Map<string, boolean>();

  for (const track of tracks.scalar) {
    const v = evaluateScalarAt(track.keys, frame);
    const id = track.controllableId;
    switch (track.prop) {
      case PROP_ALPHA: alphaByControllableId.set(id, v); break;
      case PROP_SIZE_X: upsert(sizeByControllableId, id, "x", v); break;
      case PROP_SIZE_Y: upsert(sizeByControllableId, id, "y", v); break;
      case PROP_POS_X: upsert(positionByControllableId, id, "x", v); break;
      case PROP_POS_Y: upsert(positionByControllableId, id, "y", v); break;
      case PROP_POS_Z: upsert(positionByControllableId, id, "z", v); break;
      case PROP_SCALE_X: upsert(scaleByControllableId, id, "x", v); break;
      case PROP_SCALE_Y: upsert(scaleByControllableId, id, "y", v); break;
      case PROP_SCALE_Z: upsert(scaleByControllableId, id, "z", v); break;
      case PROP_SKEW_X: upsert(skewByControllableId, id, "x", v); break;
      case PROP_SKEW_Y: upsert(skewByControllableId, id, "y", v); break;
    }
  }

  for (const track of tracks.vec3) {
    const v = evaluateVec3At(track.keys, frame);
    if (track.prop === PROP_POS_VEC3) {
      positionVec3ById.set(track.controllableId, v);
    } else {
      scaleByControllableId.set(track.controllableId, { x: v.x, y: v.y, z: v.z });
    }
  }

  for (const track of tracks.enabled) {
    enabledByControllableId.set(track.controllableId, evaluateBoolAt(track.keys, frame));
  }

  // Phase H6 — merge the vec3 Transform.Position base UNDER any per-axis
  // .{X,Y,Z}Prop overrides (axis props take precedence, order-independent).
  for (const [id, vec] of positionVec3ById) {
    const axis = positionByControllableId.get(id) ?? {};
    positionByControllableId.set(id, {
      x: axis.x ?? vec.x,
      y: axis.y ?? vec.y,
      z: axis.z ?? vec.z,
    });
  }

  return {
    timelineName: tracks.timelineName,
    previewMarker: tracks.previewMarker,
    alphaByControllableId,
    sizeByControllableId,
    positionByControllableId,
    scaleByControllableId,
    skewByControllableId,
    enabledByControllableId,
  };
}

/** PreviewMarker shortcut — parse + evaluate at the marker (no evaluation
 * when the marker is absent/negative, matching the static-translate rule). */
export function parseTimelinePreviewSnapshot(xml: string): TimelinePreviewSnapshot {
  const tracks = parseTimelineTracks(xml);
  if (tracks.previewMarker === undefined) {
    return {
      timelineName: tracks.timelineName,
      previewMarker: undefined,
      alphaByControllableId: new Map(),
      sizeByControllableId: new Map(),
      positionByControllableId: new Map(),
      scaleByControllableId: new Map(),
      skewByControllableId: new Map(),
      enabledByControllableId: new Map(),
    };
  }
  return evaluateSnapshotAtFrame(tracks, tracks.previewMarker);
}

function upsert<K extends string>(
  map: Map<string, Partial<Record<K, number>>>,
  id: string,
  axis: K,
  v: number,
): void {
  const cur: Partial<Record<K, number>> = map.get(id) ?? {};
  cur[axis] = v;
  map.set(id, cur);
}

/** "HD1080p50" / "HD720i25" → trailing digits after the scan marker. */
function parseFpsFromFormat(format: string | null): number {
  if (format) {
    const m = /[pi](\d+)\s*$/i.exec(format.trim());
    if (m) {
      const fps = Number(m[1]);
      if (Number.isFinite(fps) && fps > 0) return fps;
    }
  }
  return 50;
}

/** Bezier handles in normalized segment space; missing attrs default to the
 * diagonal (0.5) — which evaluates exactly linear. */
function parseHandles(kf: Element): { leftX: number; leftY: number; rightX: number; rightY: number } {
  const num = (attr: string): number => {
    const v = Number(kf.getAttribute(attr));
    return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.5;
  };
  return {
    leftX: num("LeftControlPointX"),
    leftY: num("LeftControlPointY"),
    rightX: num("RightControlPointX"),
    rightY: num("RightControlPointY"),
  };
}

/**
 * Step-evaluate boolean keyframes (hold-first before the first frame, then the
 * value of the most recent keyframe with frame <= target). Visibility is a
 * step function — never interpolated.
 */
function evaluateBoolAt(keyframes: BoolKey[], frame: number): boolean {
  let result = keyframes[0].value;
  for (const kf of keyframes) {
    if (kf.frame <= frame) result = kf.value;
    else break;
  }
  return result;
}

/** Parse a comma-separated "x,y,z" string into a vec3, or null if malformed. */
function parseVec3String(raw: string | null): { x: number; y: number; z: number } | null {
  if (!raw) return null;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

/** Eased interpolation between vec3 keyframes — same hold/bezier semantics as
 * the scalar path, with one easing curve shared by the three axes (R3 authors
 * one handle set per keyframe, not per axis). */
function evaluateVec3At(
  keyframes: Vec3Key[],
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
      const xNorm = (frame - prev.frame) / span;
      const eased = cubicBezierProgress(prev.rightX, prev.rightY, curr.leftX, curr.leftY, xNorm);
      return {
        x: prev.value.x + (curr.value.x - prev.value.x) * eased,
        y: prev.value.y + (curr.value.y - prev.value.y) * eased,
        z: prev.value.z + (curr.value.z - prev.value.z) * eased,
      };
    }
  }
  return last.value;
}

/**
 * Evaluate scalar keyframes at a target frame. Hold-first / hold-last outside
 * the authored range; inside a segment the value follows the cubic bezier
 * defined by the left key's RIGHT handle and the right key's LEFT handle
 * (R3 KeyFrame LeftType/RightType + control points). Linear keys author the
 * handles on the diagonal (0.5, 0.5) which makes the bezier exactly linear.
 */
function evaluateScalarAt(keyframes: ScalarKey[], frame: number): number {
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
      const xNorm = (frame - prev.frame) / span;
      const eased = cubicBezierProgress(prev.rightX, prev.rightY, curr.leftX, curr.leftY, xNorm);
      return prev.value + (curr.value - prev.value) * eased;
    }
  }
  return last.value; // unreachable in practice
}

/**
 * CSS-style cubic-bezier(x1, y1, x2, y2) progress: P0=(0,0), P3=(1,1).
 * Solves t for x(t) = x (Newton with bisection fallback), returns y(t).
 */
function cubicBezierProgress(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const sampleX = (t: number): number =>
    3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const sampleY = (t: number): number =>
    3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  const sampleDX = (t: number): number =>
    3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);

  // Newton-Raphson — fast path for well-behaved handles.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) return sampleY(t);
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
    if (t < 0 || t > 1) break;
  }
  // Bisection fallback — x(t) is monotonic for clamped handles in [0,1].
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 32; i++) {
    const sx = sampleX(t);
    if (Math.abs(sx - x) < 1e-6) break;
    if (sx < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}
