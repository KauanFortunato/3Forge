/**
 * Paint-order helpers for W3D-imported scenes.
 *
 * R3 broadcast 2D layouts encode draw order on the Z axis with very small
 * separations (e.g. -0.001 → -0.5). The renderer's 2D path turns the depth
 * buffer off and relies on `Mesh.renderOrder` to decide who paints first.
 * Sorting by world Z ascending — most-negative (deepest, furthest from a
 * z-positive ortho camera) first → drawn first → ends up behind — recovers
 * the authoring intent.
 *
 * 3D scenes do not use this; they keep real depth testing.
 */

export interface PaintOrderNode {
  id: string;
}

/**
 * Returns a map from node id → render order (0..N-1) computed from each
 * node's world-space Z, with the original array index as a stable tiebreak.
 *
 * @param nodes        Source order (typically `blueprint.nodes`). The DFS
 *                     index from this list is the secondary sort key, so
 *                     existing R3 conventions keep working when authors
 *                     leave Z at zero across siblings.
 * @param getWorldZ    Reads world-space Z for a node id. Production passes
 *                     `(id) => objectMap.get(id)?.getWorldPosition().z`.
 *                     Tests pass an in-memory map so the helper stays
 *                     pure (no Three.js dependency).
 */
export function computeRenderOrderByWorldZ(
  nodes: ReadonlyArray<PaintOrderNode>,
  getWorldZ: (id: string) => number | undefined,
): Map<string, number> {
  const indexed = nodes.map((node, index) => ({
    id: node.id,
    index,
    z: getWorldZ(node.id) ?? 0,
  }));
  indexed.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.index - b.index;
  });
  const out = new Map<string, number>();
  indexed.forEach((slot, order) => out.set(slot.id, order));
  return out;
}
