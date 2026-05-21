import { describe, expect, it } from "vitest";
import { applyPatches, computePatches, summarizePatches } from "./historyDiff";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function roundTrip<T extends object>(before: T, after: T): void {
  const patches = computePatches(before, after);
  const forwardTarget = clone(before);
  applyPatches(forwardTarget, patches, "forward");
  expect(forwardTarget).toEqual(after);

  const reverseTarget = clone(after);
  applyPatches(reverseTarget, patches, "reverse");
  expect(reverseTarget).toEqual(before);
}

describe("historyDiff", () => {
  it("emits no patches for identical inputs", () => {
    expect(computePatches({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
  });

  it("round-trips primitive field changes", () => {
    roundTrip({ name: "old", count: 3 }, { name: "new", count: 7 });
  });

  it("round-trips nested object changes", () => {
    roundTrip(
      { transform: { position: { x: 0, y: 0, z: 0 }, scale: 1 } },
      { transform: { position: { x: 5, y: 0, z: 0 }, scale: 1 } },
    );
  });

  it("round-trips adding a key on an object", () => {
    roundTrip({ a: 1 }, { a: 1, b: 2 });
  });

  it("round-trips removing a key on an object", () => {
    roundTrip({ a: 1, b: 2 }, { a: 1 });
  });

  it("treats null and undefined as distinct values", () => {
    const patches = computePatches({ a: null }, { a: undefined });
    expect(patches).toHaveLength(1);

    const target: Record<string, unknown> = { a: null };
    applyPatches(target, patches, "forward");
    expect(target).toEqual({});

    applyPatches(target, patches, "reverse");
    expect(target).toEqual({ a: null });
  });

  describe("id-keyed arrays", () => {
    it("round-trips an id-keyed item addition", () => {
      roundTrip(
        { nodes: [{ id: "a", name: "A" }] },
        { nodes: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
      );
    });

    it("round-trips an id-keyed item removal", () => {
      roundTrip(
        { nodes: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
        { nodes: [{ id: "a", name: "A" }] },
      );
    });

    it("round-trips an item field change within an id-keyed array", () => {
      roundTrip(
        { nodes: [{ id: "a", x: 1 }, { id: "b", x: 2 }] },
        { nodes: [{ id: "a", x: 99 }, { id: "b", x: 2 }] },
      );
    });

    it("round-trips a reorder within an id-keyed array", () => {
      roundTrip(
        { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] },
        { nodes: [{ id: "c" }, { id: "a" }, { id: "b" }] },
      );
    });

    it("round-trips combined add + remove + reorder + field change", () => {
      roundTrip(
        { nodes: [{ id: "a", x: 1 }, { id: "b", x: 2 }, { id: "c", x: 3 }] },
        { nodes: [{ id: "d", x: 4 }, { id: "c", x: 33 }, { id: "a", x: 1 }] },
      );
    });

    it("round-trips deeply nested id-keyed arrays (animation tracks/keyframes)", () => {
      const before = {
        animation: {
          clips: [
            {
              id: "clip-1",
              tracks: [
                {
                  id: "track-a",
                  keyframes: [
                    { id: "kf-1", frame: 0, value: 0 },
                    { id: "kf-2", frame: 30, value: 1 },
                  ],
                },
              ],
            },
          ],
        },
      };
      const after = {
        animation: {
          clips: [
            {
              id: "clip-1",
              tracks: [
                {
                  id: "track-a",
                  keyframes: [
                    { id: "kf-1", frame: 0, value: 0.5 },
                    { id: "kf-2", frame: 30, value: 1 },
                    { id: "kf-3", frame: 60, value: 2 },
                  ],
                },
              ],
            },
          ],
        },
      };
      roundTrip(before, after);
    });
  });

  describe("opaque (non-id-keyed) arrays", () => {
    it("round-trips an opaque array change as a single set patch", () => {
      const before = { selection: ["a", "b", "c"] };
      const after = { selection: ["a", "c"] };
      const patches = computePatches(before, after);
      expect(patches).toHaveLength(1);
      expect(patches[0].op).toBe("set");

      const forward = clone(before);
      applyPatches(forward, patches, "forward");
      expect(forward).toEqual(after);

      const reverse = clone(after);
      applyPatches(reverse, patches, "reverse");
      expect(reverse).toEqual(before);
    });
  });

  describe("asset arrays (shallow capture)", () => {
    it("captures asset additions without deep-cloning heavy fields", () => {
      const heavySrc = "x".repeat(1000);
      const before = { images: [] as Array<{ id: string; name: string; src: string }> };
      const after = { images: [{ id: "img-1", name: "Photo", src: heavySrc }] };

      const patches = computePatches(before, after);
      expect(patches).toHaveLength(1);
      expect(patches[0].op).toBe("arrayPatch");

      const arrayPatch = patches[0] as Extract<typeof patches[number], { op: "arrayPatch" }>;
      expect(arrayPatch.added).toHaveLength(1);
      // Critical: the captured asset entry must share the heavy `src` string
      // by reference with the live blueprint so HISTORY_LIMIT snapshots don't
      // multiply 100MB+ payloads.
      const captured = arrayPatch.added[0].item as { src: string };
      expect(captured.src).toBe(heavySrc);

      const forward = clone(before);
      applyPatches(forward, patches, "forward");
      expect(forward).toEqual(after);

      const reverse = clone(after);
      applyPatches(reverse, patches, "reverse");
      expect(reverse).toEqual(before);
    });

    it("round-trips asset rename without touching src", () => {
      const heavySrc = "y".repeat(1000);
      const before = { images: [{ id: "img-1", name: "Photo", src: heavySrc }] };
      const after = { images: [{ id: "img-1", name: "Renamed", src: heavySrc }] };
      roundTrip(before, after);

      const patches = computePatches(before, after);
      // Only the name field should be captured.
      const setPatches = patches.filter((p) => p.op === "set");
      expect(setPatches).toHaveLength(1);
      expect((setPatches[0] as { value: unknown }).value).toBe("Renamed");
    });
  });

  describe("isolation after capture", () => {
    it("does not leak future mutations into stored patches", () => {
      const before = { nodes: [{ id: "a", x: 1 }] };
      const after = { nodes: [{ id: "a", x: 2 }, { id: "b", x: 0 }] };

      const patches = computePatches(before, after);

      // Mutate the live `after` after the diff. Stored patches must remain
      // pristine — otherwise applying forward to a fresh copy of `before`
      // would yield the corrupted state, not the original after.
      (after.nodes[1] as { x: number }).x = 999;

      const forward = clone(before);
      applyPatches(forward, patches, "forward");
      expect((forward.nodes.find((n) => n.id === "b") as { x: number }).x).toBe(0);
    });
  });

  describe("summarizePatches", () => {
    it("classifies a single transform field change as lightweight", () => {
      const patches = computePatches(
        { nodes: [{ id: "a", transform: { position: { x: 0, y: 0, z: 0 } } }] },
        { nodes: [{ id: "a", transform: { position: { x: 5, y: 0, z: 0 } } }] },
      );
      const summary = summarizePatches(patches);
      expect(summary.kind).toBe("lightweight");
      expect([...summary.affectedNodeIds]).toEqual(["a"]);
    });

    it("classifies a visibility toggle as lightweight", () => {
      const patches = computePatches(
        { nodes: [{ id: "a", visible: true }] },
        { nodes: [{ id: "a", visible: false }] },
      );
      const summary = summarizePatches(patches);
      expect(summary.kind).toBe("lightweight");
      expect([...summary.affectedNodeIds]).toEqual(["a"]);
    });

    it("classifies multi-node transform tweaks as lightweight with all ids", () => {
      const patches = computePatches(
        { nodes: [
          { id: "a", transform: { position: { x: 0, y: 0, z: 0 } } },
          { id: "b", transform: { position: { x: 0, y: 0, z: 0 } } },
        ] },
        { nodes: [
          { id: "a", transform: { position: { x: 1, y: 0, z: 0 } } },
          { id: "b", transform: { position: { x: 0, y: 2, z: 0 } } },
        ] },
      );
      const summary = summarizePatches(patches);
      expect(summary.kind).toBe("lightweight");
      expect([...summary.affectedNodeIds].sort()).toEqual(["a", "b"]);
    });

    it("classifies node-array topology changes (add/remove) as heavy", () => {
      const patches = computePatches(
        { nodes: [{ id: "a" }] },
        { nodes: [{ id: "a" }, { id: "b" }] },
      );
      expect(summarizePatches(patches).kind).toBe("heavy");
    });

    it("classifies geometry or material edits as heavy", () => {
      const patches = computePatches(
        { nodes: [{ id: "a", geometry: { width: 1 } }] },
        { nodes: [{ id: "a", geometry: { width: 2 } }] },
      );
      expect(summarizePatches(patches).kind).toBe("heavy");
    });

    it("classifies non-node patches (sceneSettings, animation) as heavy", () => {
      const patches = computePatches(
        { sceneSettings: { backgroundColor: "#000" } },
        { sceneSettings: { backgroundColor: "#fff" } },
      );
      expect(summarizePatches(patches).kind).toBe("heavy");
    });

    it("returns lightweight with no ids when patches list is empty", () => {
      const summary = summarizePatches([]);
      expect(summary.kind).toBe("lightweight");
      expect(summary.affectedNodeIds.size).toBe(0);
    });
  });

  describe("type transitions", () => {
    it("round-trips a field going from undefined to an object", () => {
      roundTrip({ a: undefined as unknown as { x: number } | undefined }, { a: { x: 5 } });
    });

    it("round-trips a field going from primitive to object", () => {
      roundTrip({ a: 1 as unknown as number | { x: number } }, { a: { x: 5 } });
    });
  });
});
