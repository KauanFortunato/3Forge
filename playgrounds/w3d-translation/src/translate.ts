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
import { parseTimelinePreviewSnapshot, type TimelinePreviewSnapshot } from "./nodes/timelines";

export interface TranslateOptions {
  onWarn?: (msg: string) => void;
}

export interface TranslateResult {
  blueprint: ComponentBlueprint;
  nodes: W3DNodeData[];
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

  // Phase 2G + 2D.2 — evaluate animated properties at the selected timeline's
  // PreviewMarker and override the corresponding static <Quad>/<Group>
  // attributes on the parsed tree:
  //   - Alpha            → Quad.alpha
  //   - Size.XProp/YProp → Quad.geometry.size.x/y
  //   - Transform.Position.{X,Y,Z}Prop → Quad/Group.transform.position.{x,y,z}
  // Other animated properties stay at their authored static value until needed.
  const previewSnapshot = parseTimelinePreviewSnapshot(xml);
  applyTimelineSnapshot(nodesResult.roots, previewSnapshot);

  const resourcesResult = parseResources(xml);
  for (const w of resourcesResult.warnings) warn(w);

  return {
    blueprint: base.blueprint,
    nodes: nodesResult.roots,
    resources: resourcesResult.registry,
    warnings,
  };
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
function applyTimelineSnapshot(roots: W3DNodeData[], snap: TimelinePreviewSnapshot): void {
  const {
    alphaByControllableId,
    sizeByControllableId,
    positionByControllableId,
    scaleByControllableId,
    enabledByControllableId,
  } = snap;
  if (
    alphaByControllableId.size === 0 &&
    sizeByControllableId.size === 0 &&
    positionByControllableId.size === 0 &&
    scaleByControllableId.size === 0 &&
    enabledByControllableId.size === 0
  ) {
    return;
  }
  const walk = (n: W3DNodeData): void => {
    if (n.kind === "Quad") {
      const a = alphaByControllableId.get(n.id);
      if (a !== undefined) n.alpha = a;
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
    }
    // Phase 2D.4 — Scale snapshot applies to all node kinds (Group/Quad/TextureText)
    // because each carries a transform.scale.
    const sc = scaleByControllableId.get(n.id);
    if (sc !== undefined) {
      if (sc.x !== undefined) n.transform.scale.x = sc.x;
      if (sc.y !== undefined) n.transform.scale.y = sc.y;
      if (sc.z !== undefined) n.transform.scale.z = sc.z;
    }
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
}
