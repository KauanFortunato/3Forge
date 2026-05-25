// playgrounds/w3d-translation/src/lineup_left.snapshot.test.ts
//
// Phase — Snapshot fidelity verification for LINEUP_LEFT PreviewMarker.
//
// Loads the REAL LINEUP_LEFT scene.w3d (committed read-only fixture) and runs
// it through the SAME translateBlueprint path the playground uses (App.tsx →
// translateBlueprint → applyTimelineSnapshot). It then asserts the post-snapshot
// values on the parsed W3DNodeData tree, BEFORE any Three.js build/render.
//
// Purpose: prove whether the final/static PreviewMarker (frame 799) values are
// actually landing on the parsed scene. If these pass, the snapshot DATA is
// correct and any remaining thumbnail mismatch is render/composition-side. If
// any fail, the failing snapshot property is not being applied — fix only that
// matcher/application path.
//
// The fixture is a verbatim copy of LINEUP_LEFT/scene.w3d; the source scene is
// never modified.

import { describe, expect, test } from "vitest";
import { translateBlueprint } from "./translate";
import type { W3DNodeData, W3DGroupData, W3DQuadData, W3DTextureTextData } from "./nodes/data";
// Vite `?raw` import inlines the committed fixture as a string. The module type
// comes from vite/client (configured in tsconfig types), so this needs neither
// node:fs nor @types/node to typecheck — and works under the jsdom test env
// where import.meta.url is not a file:// URL.
import lineupLeftXmlRaw from "./__fixtures__/LINEUP_LEFT.scene.w3d?raw";

// Strip a leading UTF-8 BOM if present so DOMParser sees a clean prolog.
const lineupLeftXml = lineupLeftXmlRaw.replace(/^﻿/, "");

/** Depth-first search for the first node whose name matches exactly. */
function findByName(roots: W3DNodeData[], name: string): W3DNodeData | undefined {
  const stack = [...roots];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.name === name) return n;
    stack.push(...n.children);
  }
  return undefined;
}

describe("LINEUP_LEFT PreviewMarker snapshot fidelity (real scene.w3d)", () => {
  const { nodes } = translateBlueprint(lineupLeftXml);

  const group = (name: string): W3DGroupData => {
    const n = findByName(nodes, name);
    expect(n, `node "${name}" not found`).toBeDefined();
    expect(n!.kind, `node "${name}" should be a Group`).toBe("Group");
    return n as W3DGroupData;
  };
  const quad = (name: string): W3DQuadData => {
    const n = findByName(nodes, name);
    expect(n, `node "${name}" not found`).toBeDefined();
    expect(n!.kind, `node "${name}" should be a Quad`).toBe("Quad");
    return n as W3DQuadData;
  };

  test("PLAYER_02.position.y rises from authored -3.5 to ~-1.4 (Transform.Position.YProp)", () => {
    expect(group("PLAYER_02").transform.position.y).toBeCloseTo(-1.4, 2);
  });

  test("PLAYER_02.scale settles to ~(0.95, 0.95, 0.85) (Transform.Scale)", () => {
    const s = group("PLAYER_02").transform.scale;
    expect(s.x).toBeCloseTo(0.95, 2);
    expect(s.y).toBeCloseTo(0.95, 2);
    expect(s.z).toBeCloseTo(0.85, 2);
  });

  test("VERTICAL_REPOS_02.position.y becomes ~0.3 (Transform.Position.YProp)", () => {
    expect(group("VERTICAL_REPOS_02").transform.position.y).toBeCloseTo(0.3, 2);
  });

  test("NAME_02.scale.x/y becomes ~0.75 (Transform.Scale, from authored 0)", () => {
    const s = group("NAME_02").transform.scale;
    expect(s.x).toBeCloseTo(0.75, 2);
    expect(s.y).toBeCloseTo(0.75, 2);
  });

  test("BASE_MAIN.geometry.size becomes ~7.7 x 2.77 (Size.X/YProp from authored 0 x 1.404)", () => {
    const sz = quad("BASE_MAIN").geometry.size;
    expect(sz.x).toBeCloseTo(7.7, 1);
    expect(sz.y).toBeCloseTo(2.77, 1);
  });

  test("BASE_TEAM.geometry.size.x becomes ~5.625 (Size.XProp from authored 0)", () => {
    expect(quad("BASE_TEAM").geometry.size.x).toBeCloseTo(5.625, 2);
  });

  test("LOGO.alpha becomes ~1 (Alpha from authored 0)", () => {
    expect(quad("LOGO").alpha).toBeCloseTo(1, 2);
  });

  test("LOGO.geometry.size becomes ~1.4 x 1.4 (Size.X/YProp from authored 3.5)", () => {
    const sz = quad("LOGO").geometry.size;
    expect(sz.x).toBeCloseTo(1.4, 1);
    expect(sz.y).toBeCloseTo(1.4, 1);
  });

  test("HORIZONTAL_SLIDE.position.x becomes ~-3.65 (Transform.Position.XProp)", () => {
    expect(group("HORIZONTAL_SLIDE").transform.position.x).toBeCloseTo(-3.65, 2);
  });

  test("MAIN.position.x becomes ~-1 (Transform.Position.XProp)", () => {
    expect(group("MAIN").transform.position.x).toBeCloseTo(-1, 2);
  });

  // Phase 2D.5 — Enabled snapshot. Visibility tracks ("True"/"False", step
  // hold-last) must flip node.enable on Quad/TextureText at the marker.
  const text = (name: string) => {
    const n = findByName(nodes, name);
    expect(n, `node "${name}" not found`).toBeDefined();
    expect(n!.kind, `node "${name}" should be a TextureText`).toBe("TextureText");
    return n as W3DTextureTextData;
  };

  test("PLAYER_FIRST_NAME_02 becomes enabled at PreviewMarker (authored Enable=False → True)", () => {
    expect(text("PLAYER_FIRST_NAME_02").enable).toBe(true);
  });

  test("team-name font swap: FS_01 disables and FS_03 enables by PreviewMarker", () => {
    // R3 cross-fades the team-name font variants via Enabled. At frame 799 the
    // FS_01 variants are off and the FS_03 variants are the live ones — the
    // name stays visible, just in its final font. Verifies Enabled both ways.
    expect(text("TEAM_NAME_FS_01_L_01").enable).toBe(false);
    expect(text("TEAM_NAME_FS_03_L01").enable).toBe(true);
  });

  test("SPLITTER_06 (Quad) becomes enabled at PreviewMarker (authored Enable=False → True)", () => {
    expect(quad("SPLITTER_06").enable).toBe(true);
  });
});
