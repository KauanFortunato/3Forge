// playgrounds/w3d-translation/src/viewport.test.ts
//
// Phase V — unit tests for the pure ortho-frustum helper. The viewport
// module itself can't be exercised under jsdom (no WebGL context), so we
// extract `computeOrtho2DHalfHeight` and test it in isolation.
import { describe, expect, test } from "vitest";
import {
  computeOrtho2DHalfHeight,
  ORTHO_DEFAULT_HALF_HEIGHT,
  W3D_FRAME_PX_PER_UNIT,
} from "./viewport";

describe("computeOrtho2DHalfHeight (Phase V)", () => {
  test("default 1080-pixel canvas in 2D mode → halfH ≈ 2.071 (half of W3D 4.142 frame)", () => {
    const h = computeOrtho2DHalfHeight({
      mode: "2d",
      canvas: { width: 1920, height: 1080 },
    });
    expect(h).toBeCloseTo(2.071068, 5); // 1080 / 2 / 260.7349
  });

  test("derivation: halfH × 16/9 reconstructs half of the W3D 7.364 frame width", () => {
    const h = computeOrtho2DHalfHeight({
      mode: "2d",
      canvas: { width: 1920, height: 1080 },
    });
    const halfW = h * (16 / 9);
    expect(halfW).toBeCloseTo(7.363797 / 2, 5);
  });

  test("720p canvas in 2D mode → halfH ≈ 1.381 (proportional)", () => {
    const h = computeOrtho2DHalfHeight({
      mode: "2d",
      canvas: { width: 1280, height: 720 },
    });
    expect(h).toBeCloseTo(720 / 2 / W3D_FRAME_PX_PER_UNIT, 5);
    expect(h).toBeCloseTo(1.380712, 5);
  });

  test('3D mode falls back to ORTHO_DEFAULT_HALF_HEIGHT (5)', () => {
    const h = computeOrtho2DHalfHeight({
      mode: "3d",
      canvas: { width: 1920, height: 1080 },
    });
    expect(h).toBe(ORTHO_DEFAULT_HALF_HEIGHT);
    expect(h).toBe(5);
  });

  test("undefined sceneSettings → default", () => {
    expect(computeOrtho2DHalfHeight(undefined)).toBe(ORTHO_DEFAULT_HALF_HEIGHT);
  });

  test("2D mode with missing canvas → default (graceful, doesn't collapse to NaN)", () => {
    const h = computeOrtho2DHalfHeight({ mode: "2d" });
    expect(h).toBe(ORTHO_DEFAULT_HALF_HEIGHT);
  });

  test("2D mode with degenerate canvas (height 0) → default (no zero-height frustum)", () => {
    const h = computeOrtho2DHalfHeight({
      mode: "2d",
      canvas: { width: 1920, height: 0 },
    });
    expect(h).toBe(ORTHO_DEFAULT_HALF_HEIGHT);
  });

  test("2D mode with negative canvas height → default (defensive)", () => {
    const h = computeOrtho2DHalfHeight({
      mode: "2d",
      canvas: { width: 1920, height: -1080 },
    });
    expect(h).toBe(ORTHO_DEFAULT_HALF_HEIGHT);
  });
});

describe("W3D_FRAME_PX_PER_UNIT constant (Phase V)", () => {
  test("matches the 1080 / 4.142136 conversion derived from BACKGROUND quad dimensions", () => {
    // Every TEXTURE_FULLFRAME_* quad in the 2D corpus authors size
    // 7.363797 × 4.142136 — the canonical W3D 1080p broadcast frame in
    // world units. The width-derivation (1920 / 7.363797) and the
    // height-derivation (1080 / 4.142136) differ by ~1.2e-5 due to corpus
    // rounding — both hit the same ≈260.735 conversion to within 3 decimals.
    expect(W3D_FRAME_PX_PER_UNIT).toBeCloseTo(1080 / 4.142136, 3);
    expect(W3D_FRAME_PX_PER_UNIT).toBeCloseTo(1920 / 7.363797, 3);
    expect(W3D_FRAME_PX_PER_UNIT).toBeCloseTo(260.735, 2);
  });
});
