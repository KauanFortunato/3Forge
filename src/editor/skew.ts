import { Matrix4 } from "three";
import type { Vec3Like } from "./types";

/**
 * Helpers for the static `<Skew>` portion of W3D `<NodeTransform>`. R3 stores
 * the shear in degrees per axis; the renderer converts to a 4×4 shear matrix
 * applied via an inserted skewLayer Group between the wrapper and the mesh.
 *
 * Conventions (matches R3 broadcast templates):
 *   x' = x + tan(skewX) * y     (most-common case, "Skew X=15" leaning bars)
 *   y' = y + tan(skewY) * x
 *   z   is parsed for round-trip but does not visibly contribute in the
 *       flat 2D shaders we ship today — it stays in the matrix as identity.
 */

const DEG_TO_RAD = Math.PI / 180;
const EPSILON = 1e-6;

export function isIdentitySkew(skew: Vec3Like | undefined): boolean {
  if (!skew) return true;
  return (
    Math.abs(skew.x) < EPSILON &&
    Math.abs(skew.y) < EPSILON &&
    Math.abs(skew.z) < EPSILON
  );
}

/**
 * Build the shear matrix for a node's authored skew (degrees). Returns a
 * brand-new Matrix4 each call — callers may freely mutate / copy it.
 */
export function buildSkewMatrix(skew: Vec3Like): Matrix4 {
  const tanX = skew.x === 0 ? 0 : Math.tan(skew.x * DEG_TO_RAD);
  const tanY = skew.y === 0 ? 0 : Math.tan(skew.y * DEG_TO_RAD);
  // Matrix4.set is row-major. The off-diagonal slots above the diagonal
  // shear that row's coordinate by the next column's coordinate.
  const m = new Matrix4();
  m.set(
    1,    tanX, 0, 0,
    tanY, 1,    0, 0,
    0,    0,    1, 0,
    0,    0,    0, 1,
  );
  return m;
}
