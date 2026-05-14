/**
 * *** PLAYGROUND ENTRY POINT ***
 *
 * Edita esta função para iterar sobre a tradução do node tree W3D.
 * O playground re-monta o resultado num viewport Three.js sempre que gravas.
 *
 * Quando uma técnica vencer, promove para `src/editor/import/w3d.ts`
 * (em commit `feat(import): ...` numa branch normal).
 *
 * Esta função CHAMA o parser mínimo já existente para apanhar os metadados
 * da scene (mode, camera, background) e depois fica do teu lado adicionar
 * a tradução do `<SceneNode>` em diante.
 */

import { parseW3DSceneMetadata } from "../../../src/editor/import/w3d";
import type { ComponentBlueprint, EditorNode } from "../../../src/editor/types";

export interface TranslateOptions {
  /** Logged warnings collected during the experiment. */
  onWarn?: (msg: string) => void;
}

export interface TranslateResult {
  blueprint: ComponentBlueprint;
  warnings: string[];
}

/**
 * Translate a W3D XML document into a 3Forge `ComponentBlueprint`.
 *
 * **Default behaviour**: chama o parser mínimo (metadata-only) — node tree
 * fica vazio. A partir daqui é tudo teu.
 */
export function translateBlueprint(xml: string, options: TranslateOptions = {}): TranslateResult {
  const warnings: string[] = [];
  const warn = (msg: string) => {
    warnings.push(msg);
    options.onWarn?.(msg);
  };

  const base = parseW3DSceneMetadata(xml);
  for (const w of base.warnings) warn(w);

  const blueprint = { ...base.blueprint };

  // -------- TODO playground area --------
  //
  // Aqui podes percorrer o XML e adicionar nodes ao blueprint.
  // Por exemplo:
  //
  //   const parser = new DOMParser();
  //   const doc = parser.parseFromString(xml, "application/xml");
  //   const rootSceneNode = doc.querySelector("Scene > SceneLayer > SceneNode");
  //   if (rootSceneNode) {
  //     const nodes = translateChildren(rootSceneNode, /* parentId */ null);
  //     blueprint.nodes = nodes;
  //   }
  //
  // Helpers que podes querer escrever:
  //   - readNodeTransform(el): TransformSpec
  //   - readBaseMaterial(el): MaterialSpec
  //   - quadToBlueprintNode(el): EditorNode
  //   - textureTextToBlueprintNode(el): EditorNode
  //   - flattenGroup(el): EditorNode[]
  //
  // Quando achares que está estável, copia para src/editor/import/w3d.ts.
  //
  // --------------------------------------

  return { blueprint, warnings };
}

/**
 * Reserved as a slot for translation helpers that grow during exploration.
 * Keep them here while iterating; promote to `src/editor/import/` modules
 * when stable.
 */
export const helpers = {
  // example placeholder for now
  emptyNodeList: (): EditorNode[] => [],
};
