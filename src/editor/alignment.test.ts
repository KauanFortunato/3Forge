import { describe, expect, it } from "vitest";
import { createAlignmentShape, findAlignmentSnaps } from "./alignment";

describe("alignment snapping", () => {
  it("snaps geometric centers on the closest axis within threshold", () => {
    const moving = createAlignmentShape(
      "moving",
      { x: 1.92, y: 0.08, z: 0.02 },
      { x: 1.42, y: -0.42, z: -0.48 },
      { x: 2.42, y: 0.58, z: 0.52 },
    );
    const candidate = createAlignmentShape(
      "candidate",
      { x: 0, y: 0, z: 0 },
      { x: 1.5, y: -0.5, z: -0.5 },
      { x: 2.5, y: 0.5, z: 0.5 },
    );

    const snap = findAlignmentSnaps(moving, [candidate], 0.12);

    expect(snap.position.x).toBeCloseTo(2);
    expect(snap.position.y).toBeCloseTo(0);
    expect(snap.position.z).toBeCloseTo(0);
    expect(snap.matches).toEqual([
      expect.objectContaining({ axis: "x", sourceFeature: "center", targetFeature: "center", targetId: "candidate" }),
      expect.objectContaining({ axis: "y", sourceFeature: "max", targetFeature: "max", targetId: "candidate" }),
      expect.objectContaining({ axis: "z", sourceFeature: "center", targetFeature: "center", targetId: "candidate" }),
    ]);
  });

  it("snaps edges when they are closer than center alignment", () => {
    const moving = createAlignmentShape(
      "moving",
      { x: 0.76, y: 0, z: 0 },
      { x: 0.26, y: -0.5, z: -0.5 },
      { x: 1.26, y: 0.5, z: 0.5 },
    );
    const candidate = createAlignmentShape(
      "candidate",
      { x: 0, y: 0, z: 0 },
      { x: -1.8, y: -0.5, z: -0.5 },
      { x: 0.2, y: 0.5, z: 0.5 },
    );

    const snap = findAlignmentSnaps(moving, [candidate], 0.08);

    expect(snap.position.x).toBeCloseTo(0.7);
    expect(snap.matches[0]).toMatchObject({
      axis: "x",
      sourceFeature: "min",
      targetFeature: "max",
    });
  });

  it("ignores candidates outside the snapping threshold", () => {
    const moving = createAlignmentShape(
      "moving",
      { x: 0, y: 0, z: 0 },
      { x: -0.5, y: -0.5, z: -0.5 },
      { x: 0.5, y: 0.5, z: 0.5 },
    );
    const candidate = createAlignmentShape(
      "candidate",
      { x: 4, y: 0, z: 0 },
      { x: 3.5, y: -0.5, z: -0.5 },
      { x: 4.5, y: 0.5, z: 0.5 },
    );

    const snap = findAlignmentSnaps(moving, [candidate], 0.1);
    expect(snap.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(snap.matches).toHaveLength(2);
    expect(snap.matches.every((match) => match.axis !== "x")).toBe(true);
  });

  it("uses the nearest valid candidate when multiple snaps are available", () => {
    const moving = createAlignmentShape(
      "moving",
      { x: 0.94, y: 0, z: 0 },
      { x: 0.44, y: -0.5, z: -0.5 },
      { x: 1.44, y: 0.5, z: 0.5 },
    );
    const fartherCandidate = createAlignmentShape(
      "farther",
      { x: 0, y: 0, z: 0 },
      { x: 1.55, y: -0.5, z: -0.5 },
      { x: 2.55, y: 0.5, z: 0.5 },
    );
    const closerCandidate = createAlignmentShape(
      "closer",
      { x: 0, y: 0, z: 0 },
      { x: 1.46, y: -0.5, z: -0.5 },
      { x: 2.46, y: 0.5, z: 0.5 },
    );

    const snap = findAlignmentSnaps(moving, [fartherCandidate, closerCandidate], 0.08);

    expect(snap.position.x).toBeCloseTo(0.96);
    expect(snap.matches[0]?.targetId).toBe("closer");
  });

  it("only snaps along the axes allowed by the active transform handle", () => {
    const moving = createAlignmentShape(
      "moving",
      { x: 1.92, y: 0.08, z: 0.02 },
      { x: 1.42, y: -0.42, z: -0.48 },
      { x: 2.42, y: 0.58, z: 0.52 },
    );
    const candidate = createAlignmentShape(
      "candidate",
      { x: 0, y: 0, z: 0 },
      { x: 1.5, y: -0.5, z: -0.5 },
      { x: 2.5, y: 0.5, z: 0.5 },
    );

    const snap = findAlignmentSnaps(moving, [candidate], 0.12, undefined, ["x"]);

    expect(snap.position).toEqual({
      x: 2,
      y: 0.08,
      z: 0.02,
    });
    expect(snap.matches).toEqual([
      expect.objectContaining({ axis: "x", sourceFeature: "center", targetFeature: "center", targetId: "candidate" }),
    ]);
  });
});
