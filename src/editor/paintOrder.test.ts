import { describe, expect, it } from "vitest";
import { computeRenderOrderByWorldZ } from "./paintOrder";

describe("computeRenderOrderByWorldZ", () => {
  it("places deeper Z behind shallower Z regardless of array order", () => {
    // R3 broadcast 2D layouts: A is the background (deepest), B is the
    // foreground UI. The XML happens to declare A second, so the legacy
    // DFS-index painter would (wrongly) draw A on top of B.
    const nodes = [
      { id: "B" }, // declared first, but Z=-0.001 → foreground
      { id: "A" }, // declared second, but Z=-0.5 → background
    ];
    const z = new Map([
      ["A", -0.5],
      ["B", -0.001],
    ]);
    const order = computeRenderOrderByWorldZ(nodes, (id) => z.get(id));
    expect(order.get("A")).toBe(0); // drawn first → behind
    expect(order.get("B")).toBe(1); // drawn last → in front
  });

  it("falls back to declaration order when Z is identical", () => {
    // Templates that don't author Z — our previous DFS behaviour should win
    // for siblings at the same Z so existing scenes don't shuffle.
    const nodes = [{ id: "first" }, { id: "second" }, { id: "third" }];
    const order = computeRenderOrderByWorldZ(nodes, () => 0);
    expect(order.get("first")).toBe(0);
    expect(order.get("second")).toBe(1);
    expect(order.get("third")).toBe(2);
  });

  it("handles missing Z lookups by treating them as zero", () => {
    // A node that hasn't been mounted yet returns undefined from the
    // accessor; treating it as Z=0 keeps it in declaration order with the
    // other zero-Z nodes instead of throwing.
    const nodes = [{ id: "A" }, { id: "B" }];
    const order = computeRenderOrderByWorldZ(nodes, (id) => (id === "A" ? -1 : undefined));
    expect(order.get("A")).toBe(0);
    expect(order.get("B")).toBe(1);
  });

  it("uses world Z, so a child inherits its parent's Z when its local Z is zero", () => {
    // Caller composes the world Z from parent + local. The helper itself
    // just consumes whatever the lookup returns. Parent at -0.5, child
    // local 0 → world -0.5 from the caller's perspective.
    const nodes = [{ id: "child" }, { id: "topUI" }];
    const worldZ = new Map([
      ["child", -0.5], // would be -0.5 + 0 if computed by caller
      ["topUI", -0.001],
    ]);
    const order = computeRenderOrderByWorldZ(nodes, (id) => worldZ.get(id));
    expect(order.get("child")).toBeLessThan(order.get("topUI") ?? 0);
  });
});
