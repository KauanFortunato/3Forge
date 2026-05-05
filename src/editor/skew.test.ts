import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { buildSkewMatrix, isIdentitySkew } from "./skew";

describe("isIdentitySkew", () => {
  it("treats undefined as identity", () => {
    expect(isIdentitySkew(undefined)).toBe(true);
  });
  it("treats all-zero as identity", () => {
    expect(isIdentitySkew({ x: 0, y: 0, z: 0 })).toBe(true);
  });
  it("treats sub-epsilon noise as identity", () => {
    expect(isIdentitySkew({ x: 1e-9, y: -1e-9, z: 0 })).toBe(true);
  });
  it("treats any axis above epsilon as non-identity", () => {
    expect(isIdentitySkew({ x: 0.5, y: 0, z: 0 })).toBe(false);
    expect(isIdentitySkew({ x: 0, y: 1, z: 0 })).toBe(false);
  });
});

describe("buildSkewMatrix", () => {
  it("shears x by tan(angleX) * y for the canonical Skew X=15 broadcast case", () => {
    // R3 emits "Skew X=15" all over GameName_FS (lower-third bars). The 14
    // affected nodes need their x-coordinate displaced by tan(15°)*y so a
    // tall vertical bar reads as a parallelogram leaning right.
    const m = buildSkewMatrix({ x: 15, y: 0, z: 0 });
    const point = new Vector3(0, 1, 0).applyMatrix4(m);
    const expectedX = Math.tan((15 * Math.PI) / 180);
    expect(point.x).toBeCloseTo(expectedX, 5);
    expect(point.y).toBeCloseTo(1, 5);
    expect(point.z).toBeCloseTo(0, 5);
  });

  it("shears y by tan(angleY) * x", () => {
    const m = buildSkewMatrix({ x: 0, y: 6, z: 0 });
    const point = new Vector3(1, 0, 0).applyMatrix4(m);
    expect(point.x).toBeCloseTo(1, 5);
    expect(point.y).toBeCloseTo(Math.tan((6 * Math.PI) / 180), 5);
    expect(point.z).toBeCloseTo(0, 5);
  });

  it("composes both axes when both are authored", () => {
    const m = buildSkewMatrix({ x: 15, y: 6, z: 0 });
    const point = new Vector3(2, 3, 0).applyMatrix4(m);
    expect(point.x).toBeCloseTo(2 + Math.tan((15 * Math.PI) / 180) * 3, 5);
    expect(point.y).toBeCloseTo(3 + Math.tan((6 * Math.PI) / 180) * 2, 5);
  });

  it("leaves the origin at the origin", () => {
    // Shear matrices fix the origin — vertices sitting at the node-local
    // (0,0,0) anchor must not move, otherwise the wrapper's Position no
    // longer points at the visual centre of the geometry.
    const m = buildSkewMatrix({ x: 15, y: 6, z: 0 });
    const origin = new Vector3(0, 0, 0).applyMatrix4(m);
    expect(origin.x).toBeCloseTo(0, 6);
    expect(origin.y).toBeCloseTo(0, 6);
    expect(origin.z).toBeCloseTo(0, 6);
  });
});
