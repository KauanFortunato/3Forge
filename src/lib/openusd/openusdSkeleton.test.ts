import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";

import { buildThreeSkeleton } from "./openusdParser";
import type { ParsedUsdSkeleton } from "./openusdWorkerTypes";

function flatten(matrices: Matrix4[]): Float32Array {
  const out = new Float32Array(matrices.length * 16);
  matrices.forEach((m, i) => {
    const arr = m.toArray();
    for (let k = 0; k < 16; k += 1) out[i * 16 + k] = arr[k];
  });
  return out;
}

describe("buildThreeSkeleton", () => {
  it("wires a 3-joint hierarchy and computes boneInverses from bind matrices", () => {
    const root = new Matrix4().identity();
    const child = new Matrix4().makeTranslation(1, 0, 0);
    const grandchild = new Matrix4().makeTranslation(0, 2, 0);

    const data: ParsedUsdSkeleton = {
      joints: ["root", "root/A", "root/A/B"],
      parentIndices: new Int32Array([-1, 0, 1]),
      restMatrices: flatten([root, child, grandchild]),
      // Bind matrices are typically world-space; for this test we reuse rest
      // matrices since the hierarchy is flat-translation.
      bindMatrices: flatten([root, child, grandchild]),
    };

    const built = buildThreeSkeleton(data);
    expect(built).not.toBeNull();
    if (!built) throw new Error("expected skeleton");

    expect(built.skeleton.bones).toHaveLength(3);
    expect(built.skeleton.bones[1].parent).toBe(built.skeleton.bones[0]);
    expect(built.skeleton.bones[2].parent).toBe(built.skeleton.bones[1]);
    expect(built.bonesByJoint.get("root/A")).toBe(built.skeleton.bones[1]);

    // Bone positions come from decomposing the local rest matrices.
    expect(built.skeleton.bones[1].position.x).toBeCloseTo(1);
    expect(built.skeleton.bones[2].position.y).toBeCloseTo(2);

    // boneInverses[i] = inverse(bindMatrix[i]); for translate(1,0,0) the
    // inverse translates by (-1, 0, 0) — element 12 is the X translation
    // in Three.js's column-major Matrix4.
    expect(built.skeleton.boneInverses[1].elements[12]).toBeCloseTo(-1);
  });

  it("returns null for an empty skeleton", () => {
    const data: ParsedUsdSkeleton = {
      joints: [],
      parentIndices: new Int32Array([]),
      restMatrices: new Float32Array([]),
      bindMatrices: new Float32Array([]),
    };
    expect(buildThreeSkeleton(data)).toBeNull();
  });
});
