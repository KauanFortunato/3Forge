// Pure measure logic for W3D TextureText.
//
// R3 does NOT use TextBoxSize as the rendered geometry. The object Measure is
// the rendered glyph line box (advance width × font line height) at a FIXED R3
// base text size; TextBoxSize is only a constraint/layout box. This module
// computes that measure from INJECTED font metrics so it is deterministic and
// testable in jsdom (no real canvas); the browser supplies real metrics.
//
// Grounded in R3 panel prints (DARIUS / STEPHENS / 00-00): the unscaled ink
// height is ~constant across fonts and box heights, i.e. size is base-em driven,
// not box driven. NodeTransform.Scale is applied later by the builder.

export interface FontMetrics {
  /** Advance width of the text rendered at `em`, in WORLD units. */
  advanceWidth: number;
  /** Font ascent at `em`, in world units. */
  ascent: number;
  /** Font descent at `em`, in world units. */
  descent: number;
  /**
   * Actual ink bounds (world units), from canvas `actualBoundingBoxLeft/Right`.
   * `inkLeft` = how far the ink overhangs LEFT of the pen origin; `inkRight` =
   * how far it extends RIGHT. The visible width is `inkLeft + inkRight`, which
   * differs from the advance for italics (right overhang) and side bearings.
   * Optional: when absent (tests / engines without the metric) the measure
   * falls back to the advance and a zero left offset.
   */
  inkLeft?: number;
  inkRight?: number;
}

/** Returns world-unit glyph metrics for the (closed-over) text+font at a given em size. */
export type MetricsProvider = (em: number) => FontMetrics;

export type ConstrainMethod = "Width" | "Height" | "None";
export type AlignmentX = "Left" | "Right" | "Center";
export type AlignmentY = "Top" | "Bottom" | "Center";
export type VerticalMode = "baseline" | "top" | "bottom" | "center";

export interface AnchorOffset {
  dx: number;
  dy: number;
}

/**
 * Offset to translate a CENTRED PlaneGeometry (spanning [-w/2,w/2] × [-h/2,h/2])
 * so the text's anchor point lands at the local origin (0,0). The mesh position
 * (NodeTransform.Position) then places that anchor at the authored point.
 *
 * - X: `alignmentX` picks the horizontal edge that sits at the origin —
 *   Left = left edge, Right = right edge, Center = centre.
 * - Y: `verticalMode` picks the vertical anchor line — top / centre / bottom of
 *   the ink, or the `baseline` (the line glyphs rest on; `descent` above the
 *   bottom). R3 uses `baseline` when the FontStyle is BaselineAligned.
 *
 * The legacy bottom-left anchor is just (Left, bottom): dx = w/2, dy = h/2.
 */
export function inkAnchorOffset(
  alignmentX: AlignmentX,
  verticalMode: VerticalMode,
  inkWidth: number,
  ascent: number,
  descent: number,
): AnchorOffset {
  const w = inkWidth;
  const h = ascent + descent;
  let dx = 0;
  if (alignmentX === "Left") dx = w / 2;
  else if (alignmentX === "Right") dx = -w / 2;
  // Center → 0
  let dy = 0;
  if (verticalMode === "top") dy = -h / 2;
  else if (verticalMode === "bottom") dy = h / 2;
  else if (verticalMode === "baseline") dy = (ascent - descent) / 2;
  // center → 0
  return { dx, dy };
}

export interface MeasureInput {
  text: string;
  /** R3 base text em in world units (engine constant). */
  baseEm: number;
  hasTextBox: boolean;
  /** Authored constraint box (world units). Only the X is used (width constraint). */
  textBox?: { x: number; y: number };
  constrainMethod: ConstrainMethod;
  alignmentY: AlignmentY;
  /** From the FontStyle. When true, R3 ignores AlignmentY and uses baseline alignment. */
  baselineAligned: boolean;
}

export interface MeasureResult {
  /** World-unit em used to render (== baseEm unless width-constrained). */
  fontEm: number;
  /** Object ink size in world units — the PlaneGeometry size (pre NodeTransform.Scale). */
  inkWidth: number;
  inkHeight: number;
  /**
   * Pen-x offset (world units) where the glyph run must be drawn so the left
   * ink overhang is not clipped — i.e. the ink's left edge sits at local x=0.
   * 0 unless the provider reports `inkLeft`.
   */
  inkLeft: number;
  /** Ink ascent/descent in world units (sum = inkHeight). Used for baseline placement. */
  ascent: number;
  descent: number;
  /** True when ConstrainMethod=Width shrank the text to fit the box width. */
  widthConstrained: boolean;
  /** Vertical placement actually used (baseline overrides alignmentY). */
  verticalMode: VerticalMode;
}

function verticalModeOf(baselineAligned: boolean, alignmentY: AlignmentY): VerticalMode {
  if (baselineAligned) return "baseline";
  return alignmentY === "Top" ? "top" : alignmentY === "Bottom" ? "bottom" : "center";
}

/**
 * Compute the rendered ink size (object measure) and font em for a TextureText.
 *
 * - Renders at `baseEm` (the fixed R3 base size). Geometry = measured ink, never
 *   the TextBoxSize.
 * - `ConstrainMethod="Width"` with a box: shrink the em so the ink width fits
 *   `textBox.x` — and only then. `Height`/`None`/no-box never width-shrink.
 * - Vertical: `baselineAligned` (from FontStyle) overrides `alignmentY`.
 */
export function measureTextureText(input: MeasureInput, metrics: MetricsProvider): MeasureResult {
  let fontEm = input.baseEm;
  let m = metrics(fontEm);
  let widthConstrained = false;

  if (
    input.constrainMethod === "Width" &&
    input.hasTextBox &&
    input.textBox &&
    input.textBox.x > 0 &&
    m.advanceWidth > input.textBox.x
  ) {
    fontEm = input.baseEm * (input.textBox.x / m.advanceWidth);
    m = metrics(fontEm);
    widthConstrained = true;
  }

  // Visible width = ink overhang on both sides. Falls back to the advance (and a
  // zero left offset) when the provider doesn't report ink bounds.
  const inkLeft = m.inkLeft ?? 0;
  const inkRight = m.inkRight ?? m.advanceWidth;
  return {
    fontEm,
    inkWidth: inkLeft + inkRight,
    inkHeight: m.ascent + m.descent,
    inkLeft,
    ascent: m.ascent,
    descent: m.descent,
    widthConstrained,
    verticalMode: verticalModeOf(input.baselineAligned, input.alignmentY),
  };
}
