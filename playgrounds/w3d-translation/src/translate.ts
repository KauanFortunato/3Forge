/**
 * Playground entry point. Translates a W3D XML document into:
 *  - a ComponentBlueprint (scene metadata only — unchanged from prior phases)
 *  - a W3DNodeData[] tree (Phase F-Quad)
 *  - a W3DResourceRegistry (Phase G — BaseMaterial, Texture, TextureLayer)
 *
 * The playground viewport renders the W3DNodeData tree via builder.ts.
 * The Blueprint panel still shows the metadata blueprint for context.
 * Resources are resolved in the builder via BuildContext (App wires this).
 */
import { parseW3DSceneMetadata } from "../../../src/editor/import/w3d";
import type { ComponentBlueprint } from "../../../src/editor/types";
import { parseNodes, type W3DNodeData } from "./nodes/data";
import { parseResources, type W3DResourceRegistry } from "./nodes/resources";
import {
  evaluateSnapshotAtFrame,
  parseTimelineTracks,
  type TimelinePreviewSnapshot,
  type TimelineTracks,
} from "./nodes/timelines";

export interface TranslateOptions {
  onWarn?: (msg: string) => void;
}

export interface TranslateResult {
  blueprint: ComponentBlueprint;
  /** Parsed nodes with the PreviewMarker snapshot applied (the hero frame). */
  nodes: W3DNodeData[];
  /**
   * Phase TL — pristine parse, NO timeline snapshot applied. The timeline
   * player clones this (cloneNodes) and applies evaluateSnapshotAtFrame(tracks,
   * frame) per frame, so scrubbing never accumulates state.
   */
  pristineNodes: W3DNodeData[];
  /** Phase TL — parsed keyframe tracks of the selected timeline. */
  tracks: TimelineTracks;
  resources: W3DResourceRegistry;
  warnings: string[];
}

export function translateBlueprint(xml: string, options: TranslateOptions = {}): TranslateResult {
  const warnings: string[] = [];
  const warn = (msg: string) => {
    warnings.push(msg);
    options.onWarn?.(msg);
  };

  const base = parseW3DSceneMetadata(xml);
  for (const w of base.warnings) warn(w);

  const nodesResult = parseNodes(xml);
  for (const w of nodesResult.warnings) warn(w);

  // Phase TL — parse the selected timeline's tracks once. The static path
  // below evaluates them at the PreviewMarker (the editor's hero frame); the
  // timeline player re-evaluates the SAME tracks at any frame.
  const tracks = parseTimelineTracks(xml);
  const unsupportedByProp = new Map<string, number>();
  for (const u of tracks.unsupportedProps) {
    unsupportedByProp.set(u.prop, (unsupportedByProp.get(u.prop) ?? 0) + 1);
  }
  for (const [prop, count] of unsupportedByProp) {
    warn(`Animated property "${prop}" (${count} controller${count === 1 ? "" : "s"}) is not translated yet; those tracks are ignored.`);
  }

  // Keep a pristine copy BEFORE the marker snapshot mutates the parse — the
  // per-frame animation path needs unmodified authored values as its base.
  const pristineNodes = cloneNodes(nodesResult.roots);

  // Phase 2G + 2D.2 — evaluate animated properties at the selected timeline's
  // PreviewMarker and override the corresponding static <Quad>/<Group>
  // attributes on the parsed tree.
  if (tracks.previewMarker !== undefined) {
    applyTimelineSnapshot(nodesResult.roots, evaluateSnapshotAtFrame(tracks, tracks.previewMarker));
  }

  const resourcesResult = parseResources(xml);
  for (const w of resourcesResult.warnings) warn(w);

  return {
    blueprint: base.blueprint,
    nodes: nodesResult.roots,
    pristineNodes,
    tracks,
    resources: resourcesResult.registry,
    warnings,
  };
}

/** Deep-clone a parsed node tree (plain data — no functions/class instances). */
export function cloneNodes(roots: W3DNodeData[]): W3DNodeData[] {
  if (typeof structuredClone === "function") return structuredClone(roots);
  return JSON.parse(JSON.stringify(roots)) as W3DNodeData[];
}

/**
 * Walk the parsed node tree and apply the timeline preview snapshot in place:
 *
 *  - Alpha overrides Quad.alpha (Groups don't carry alpha).
 *  - Size.X/Y overrides Quad.geometry.size.x/y (Groups don't carry geometry).
 *  - Position.X/Y/Z overrides Quad/Group.transform.position.x/y/z.
 *  - Enabled overrides Quad/TextureText.enable (Groups don't carry enable).
 *
 * Partial axes are supported — a controller with only Size.XProp leaves
 * geometry.size.y untouched. Nodes whose GUID is absent from every map
 * remain at their authored static values.
 */
export function applyTimelineSnapshot(roots: W3DNodeData[], snap: TimelinePreviewSnapshot): void {
  const {
    alphaByControllableId,
    sizeByControllableId,
    positionByControllableId,
    scaleByControllableId,
    skewByControllableId,
    enabledByControllableId,
  } = snap;
  if (
    alphaByControllableId.size === 0 &&
    sizeByControllableId.size === 0 &&
    positionByControllableId.size === 0 &&
    scaleByControllableId.size === 0 &&
    skewByControllableId.size === 0 &&
    enabledByControllableId.size === 0
  ) {
    return;
  }
  const walk = (n: W3DNodeData): void => {
    if (n.kind === "Group") {
      // Group Alpha tracks (e.g. TEAM_COMPOSITION) — the builder multiplies
      // group.alpha into every descendant leaf opacity, so an animated group
      // fade applies to the whole subtree.
      const a = alphaByControllableId.get(n.id);
      if (a !== undefined) n.alpha = a;
    }
    if (n.kind === "Quad") {
      const a = alphaByControllableId.get(n.id);
      if (a !== undefined) {
        // Stash the authored static before overriding — the card-fill
        // materialisation pass normalises the reveal against it.
        if (n.authoredAlpha === undefined) n.authoredAlpha = n.alpha;
        n.alpha = a;
      }
      const sz = sizeByControllableId.get(n.id);
      if (sz !== undefined) {
        if (sz.x !== undefined) n.geometry.size.x = sz.x;
        if (sz.y !== undefined) n.geometry.size.y = sz.y;
      }
      // Phase 2D.5 — Enabled snapshot (visibility). Only Quad / TextureText
      // carry `enable`; Groups have no enable field in this model.
      const en = enabledByControllableId.get(n.id);
      if (en !== undefined) n.enable = en;
    } else if (n.kind === "TextureText") {
      const a = alphaByControllableId.get(n.id);
      if (a !== undefined) n.alpha = a;
      const en = enabledByControllableId.get(n.id);
      if (en !== undefined) n.enable = en;
    }
    const pos = positionByControllableId.get(n.id);
    if (pos !== undefined) {
      if (pos.x !== undefined) n.transform.position.x = pos.x;
      if (pos.y !== undefined) n.transform.position.y = pos.y;
      if (pos.z !== undefined) n.transform.position.z = pos.z;
      // Phase P7 — record which axes were animated so the builder's
      // `applyPivotAnchor` can opt animated axes into the
      // "Position is where the pivot lands" semantic for PivotType="Absolute"
      // nodes. Static axes (axes not present in `pos`) keep the legacy Maya
      // behavior — this preserves PLAYER_02 X-ordering (its Pivot X=1.29
      // pairs with a STATIC Position X=0 that is never in pos[]).
      const axes: { x?: boolean; y?: boolean; z?: boolean } =
        n.transform.positionAnimatedAxes ?? {};
      if (pos.x !== undefined) axes.x = true;
      if (pos.y !== undefined) axes.y = true;
      if (pos.z !== undefined) axes.z = true;
      n.transform.positionAnimatedAxes = axes;
    }
    // Phase 2D.4 — Scale snapshot applies to all node kinds (Group/Quad/TextureText)
    // because each carries a transform.scale.
    const sc = scaleByControllableId.get(n.id);
    if (sc !== undefined) {
      if (sc.x !== undefined) n.transform.scale.x = sc.x;
      if (sc.y !== undefined) n.transform.scale.y = sc.y;
      if (sc.z !== undefined) n.transform.scale.z = sc.z;
    }
    // Phase H5 — Skew snapshot (degrees), per-axis, all node kinds carry a
    // transform. Builder shears the PlaneGeometry by these angles.
    const sk = skewByControllableId.get(n.id);
    if (sk !== undefined) {
      const cur = n.transform.skew ?? { x: 0, y: 0, z: 0 };
      if (sk.x !== undefined) cur.x = sk.x;
      if (sk.y !== undefined) cur.y = sk.y;
      n.transform.skew = cur;
    }
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
}
