/**
 * Playground entry point. Translates a W3D XML document into:
 *  - a ComponentBlueprint (scene metadata only — unchanged from prior phases)
 *  - a W3DNodeData[] tree (Phase F-Quad)
 *
 * The playground viewport renders the W3DNodeData tree via builder.ts; the
 * Blueprint panel still shows the metadata blueprint for context.
 */

import { parseW3DSceneMetadata } from "../../../src/editor/import/w3d";
import type { ComponentBlueprint } from "../../../src/editor/types";
import { parseNodes, type W3DNodeData } from "./nodes/data";

export interface TranslateOptions {
  onWarn?: (msg: string) => void;
}

export interface TranslateResult {
  blueprint: ComponentBlueprint;
  nodes: W3DNodeData[];
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

  return { blueprint: base.blueprint, nodes: nodesResult.roots, warnings };
}
