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

  const resourcesResult = parseResources(xml);
  for (const w of resourcesResult.warnings) warn(w);

  return {
    blueprint: base.blueprint,
    nodes: nodesResult.roots,
    resources: resourcesResult.registry,
    warnings,
  };
}
