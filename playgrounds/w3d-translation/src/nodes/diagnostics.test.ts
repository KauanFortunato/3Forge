// playgrounds/w3d-translation/src/nodes/diagnostics.test.ts
import { describe, expect, test } from "vitest";
import { dumpNodes } from "./diagnostics";
import type { W3DGroupData, W3DQuadData } from "./data";

function tx() {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function quad(p: Partial<W3DQuadData>): W3DQuadData {
  return {
    kind: "Quad",
    id: "q",
    name: "Q",
    enable: true,
    alpha: 1,
    speedScale: 1,
    isMask: false,
    maskIds: [],
    geometry: { size: { x: 1, y: 1 } },
    transform: tx(),
    children: [],
    ...p,
  };
}

describe("dumpNodes", () => {
  test("computes visibility flags", () => {
    const rows = dumpNodes([
      quad({ id: "a", name: "A", enable: true, alpha: 1 }),
      quad({ id: "b", name: "B", enable: false, alpha: 1 }),
      quad({ id: "c", name: "C", enable: true, alpha: 0 }),
      quad({ id: "d", name: "D", enable: true, alpha: 0.5 }),
    ]);
    const map = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(map.a).toMatchObject({ enabled: true, disabledByEnable: false, transparentByAlpha0: false, effectiveVisible: true });
    expect(map.b).toMatchObject({ enabled: false, disabledByEnable: true, effectiveVisible: false });
    expect(map.c).toMatchObject({ transparentByAlpha0: true, effectiveVisible: false });
    expect(map.d).toMatchObject({ effectiveVisible: true });
  });

  test("emits Group rows with path and depth", () => {
    const child: W3DQuadData = quad({ id: "qc", name: "Child" });
    const parent: W3DGroupData = {
      kind: "Group",
      id: "g1",
      name: "Parent",
      speedScale: 1,
      maskIds: [],
      transform: tx(),
      children: [child],
    };
    const rows = dumpNodes([parent]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "Group", depth: 0, path: "Parent" });
    expect(rows[1]).toMatchObject({ kind: "Quad", depth: 1, path: "Parent > Child" });
  });
});
