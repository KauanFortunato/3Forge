// Pure measure logic for TextureText — tested with INJECTED glyph metrics so it
// runs in jsdom (no real canvas). Browser supplies real metrics; tests mock them.
import { describe, expect, test } from "vitest";
import { inkAnchorOffset, measureTextureText, type MetricsProvider } from "./textureTextMeasure";

// Mock provider: advance scales with em and text length; ascent/descent scale
// with em. All values in WORLD units (same as the em passed in).
const makeMetrics = (len: number, perChar = 0.3, asc = 0.7, desc = 0.1): MetricsProvider =>
  (em) => ({ advanceWidth: em * perChar * len, ascent: em * asc, descent: em * desc });

const BASE_EM = 0.18;

describe("measureTextureText — ink bounds", () => {
  test("inkWidth uses actual ink bounds (left+right) when the provider supplies them", () => {
    // Italic-style overhang: ink overhangs left of the pen AND past the advance.
    const metrics: MetricsProvider = (em) => ({
      advanceWidth: em * 1.0,
      ascent: em * 0.7,
      descent: em * 0.1,
      inkLeft: em * 0.1,   // ink starts 0.1·em LEFT of the pen origin
      inkRight: em * 1.15, // ink ends 1.15·em right of the pen (past the advance)
    });
    const r = measureTextureText(
      {
        text: "X", baseEm: BASE_EM, hasTextBox: false,
        constrainMethod: "None", alignmentY: "Center", baselineAligned: true,
      },
      metrics,
    );
    // visible width = inkLeft + inkRight = 0.18·(0.1 + 1.15) = 0.225
    expect(r.inkWidth).toBeCloseTo(BASE_EM * 1.25, 6);
    // inkLeft is the render pen offset (so the left overhang is not clipped)
    expect(r.inkLeft).toBeCloseTo(BASE_EM * 0.1, 6);
  });

  test("inkWidth falls back to the advance when no ink bounds are provided", () => {
    const r = measureTextureText(
      {
        text: "AB", baseEm: BASE_EM, hasTextBox: false,
        constrainMethod: "None", alignmentY: "Center", baselineAligned: true,
      },
      makeMetrics(2),
    );
    expect(r.inkWidth).toBeCloseTo(0.108, 6); // = advance, unchanged
    expect(r.inkLeft).toBe(0);
  });
});

describe("measureTextureText", () => {
  test("geometry comes from glyph ink, NOT from TextBoxSize", () => {
    const r = measureTextureText(
      {
        text: "AB", baseEm: BASE_EM, hasTextBox: true, textBox: { x: 5, y: 5 },
        constrainMethod: "None", alignmentY: "Center", baselineAligned: true,
      },
      makeMetrics(2),
    );
    // ink = em*perChar*len = 0.18*0.3*2 = 0.108 ; height = em*(asc+desc)=0.18*0.8=0.144
    expect(r.inkWidth).toBeCloseTo(0.108, 6);
    expect(r.inkHeight).toBeCloseTo(0.144, 6);
    // explicitly NOT the authored box
    expect(r.inkWidth).not.toBeCloseTo(5, 1);
    expect(r.inkHeight).not.toBeCloseTo(5, 1);
  });

  test("ConstrainMethod=Width shrinks ONLY when ink width exceeds TextBoxSize.x", () => {
    // overflow case: base ink width 0.18*0.3*10 = 0.54 > box 0.2 -> shrink to fit
    const shrunk = measureTextureText(
      {
        text: "ABCDEFGHIJ", baseEm: BASE_EM, hasTextBox: true, textBox: { x: 0.2, y: 5 },
        constrainMethod: "Width", alignmentY: "Center", baselineAligned: false,
      },
      makeMetrics(10),
    );
    expect(shrunk.widthConstrained).toBe(true);
    expect(shrunk.inkWidth).toBeCloseTo(0.2, 4); // fits the box width exactly
    expect(shrunk.fontEm).toBeLessThan(BASE_EM);

    // fits case: base ink width 0.108 < box 5 -> no shrink, full base em
    const fits = measureTextureText(
      {
        text: "AB", baseEm: BASE_EM, hasTextBox: true, textBox: { x: 5, y: 5 },
        constrainMethod: "Width", alignmentY: "Center", baselineAligned: false,
      },
      makeMetrics(2),
    );
    expect(fits.widthConstrained).toBe(false);
    expect(fits.fontEm).toBeCloseTo(BASE_EM, 6);
    expect(fits.inkWidth).toBeCloseTo(0.108, 6);
  });

  test("ConstrainMethod None/Height never width-shrinks (even if ink overflows box)", () => {
    const r = measureTextureText(
      {
        text: "ABCDEFGHIJ", baseEm: BASE_EM, hasTextBox: true, textBox: { x: 0.2, y: 5 },
        constrainMethod: "None", alignmentY: "Center", baselineAligned: false,
      },
      makeMetrics(10),
    );
    expect(r.widthConstrained).toBe(false);
    expect(r.inkWidth).toBeCloseTo(0.54, 6);
  });

  test("no TextBox -> base size, no shrink, ink = full advance", () => {
    const r = measureTextureText(
      {
        text: "ABCDEFGHIJ", baseEm: BASE_EM, hasTextBox: false,
        constrainMethod: "Width", alignmentY: "Center", baselineAligned: true,
      },
      makeMetrics(10),
    );
    expect(r.widthConstrained).toBe(false);
    expect(r.inkWidth).toBeCloseTo(0.54, 6);
    expect(r.fontEm).toBeCloseTo(BASE_EM, 6);
  });

  test("BaselineAligned=true overrides AlignmentY", () => {
    const baseInput = {
      text: "AB", baseEm: BASE_EM, hasTextBox: true, textBox: { x: 5, y: 5 },
      constrainMethod: "None" as const,
    };
    const m = makeMetrics(2);
    expect(measureTextureText({ ...baseInput, baselineAligned: true, alignmentY: "Top" }, m).verticalMode).toBe("baseline");
    expect(measureTextureText({ ...baseInput, baselineAligned: true, alignmentY: "Bottom" }, m).verticalMode).toBe("baseline");
    // when not baseline-aligned, AlignmentY is honoured
    expect(measureTextureText({ ...baseInput, baselineAligned: false, alignmentY: "Top" }, m).verticalMode).toBe("top");
    expect(measureTextureText({ ...baseInput, baselineAligned: false, alignmentY: "Center" }, m).verticalMode).toBe("center");
    expect(measureTextureText({ ...baseInput, baselineAligned: false, alignmentY: "Bottom" }, m).verticalMode).toBe("bottom");
  });
});

describe("inkAnchorOffset", () => {
  // A centred PlaneGeometry spans [-w/2,w/2] × [-h/2,h/2]. The offset translates
  // it so the text's anchor point lands at (0,0) — the mesh position then places
  // that anchor at the authored NodeTransform.Position.
  const W = 0.4;        // inkWidth
  const ASC = 0.14;     // ascent
  const DESC = 0.04;    // descent  → inkHeight = 0.18

  test("AlignmentX picks which horizontal edge sits at the origin", () => {
    // Left: left edge at origin → shift right by half width
    expect(inkAnchorOffset("Left", "baseline", W, ASC, DESC).dx).toBeCloseTo(W / 2, 6);
    // Right: right edge at origin → shift left
    expect(inkAnchorOffset("Right", "baseline", W, ASC, DESC).dx).toBeCloseTo(-W / 2, 6);
    // Center: centre at origin → no shift
    expect(inkAnchorOffset("Center", "baseline", W, ASC, DESC).dx).toBeCloseTo(0, 6);
  });

  test("verticalMode picks the vertical anchor line", () => {
    // bottom of ink at origin → shift up by half height
    expect(inkAnchorOffset("Left", "bottom", W, ASC, DESC).dy).toBeCloseTo((ASC + DESC) / 2, 6);
    // top of ink at origin → shift down
    expect(inkAnchorOffset("Left", "top", W, ASC, DESC).dy).toBeCloseTo(-(ASC + DESC) / 2, 6);
    // centre → no shift
    expect(inkAnchorOffset("Left", "center", W, ASC, DESC).dy).toBeCloseTo(0, 6);
    // baseline → the descender sits below origin; baseline is `descent` above the bottom
    expect(inkAnchorOffset("Left", "baseline", W, ASC, DESC).dy).toBeCloseTo((ASC - DESC) / 2, 6);
  });

  test("baseline differs from bottom by exactly the descent", () => {
    const base = inkAnchorOffset("Left", "baseline", W, ASC, DESC).dy;
    const bottom = inkAnchorOffset("Left", "bottom", W, ASC, DESC).dy;
    expect(bottom - base).toBeCloseTo(DESC, 6);
  });

  test("legacy bottom-left case reproduces the old translate(w/2, h/2)", () => {
    const o = inkAnchorOffset("Left", "bottom", W, ASC, DESC);
    expect(o.dx).toBeCloseTo(W / 2, 6);
    expect(o.dy).toBeCloseTo((ASC + DESC) / 2, 6);
  });
});
