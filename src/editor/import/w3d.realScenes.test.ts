import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, it } from "vitest";
import { parseW3D } from "./w3d";
import type { ImageAsset } from "../types";

const downloadsRoot = "C:/Users/sayos/Downloads";
const sceneNames = ["AR_GAMEINTRO", "GameName_FS", "AR_TACTIC", "AR_PLAYER_V_PLAYER"];

/**
 * End-to-end smoke against real .w3d scenes from the user's Downloads folder.
 * The test is skipped on machines that don't have those fixtures (e.g. CI).
 * On the dev box it logs a summary so we can eyeball the import behaviour.
 */
describe("real W3D scenes smoke", () => {
  for (const name of sceneNames) {
    const path = `${downloadsRoot}/${name}/scene.w3d`;
    const texturesDir = `${downloadsRoot}/${name}/Resources/Textures`;
    const meshesDir = `${downloadsRoot}/${name}/Resources/Meshes`;
    const exists = existsSync(path);
    const itFn = exists ? it : it.skip;
    itFn(`imports ${name} and reports a sensible summary`, () => {
      const xml = readFileSync(path, "utf8");
      // Simulate folder import by passing the texture filenames available on
      // disk + the mesh GUIDs — that's the path the UI takes via
      // parseW3DFromFolder. Without this the parser only sees the XML and
      // emits "Scene references X textures — re-import via folder".
      const textures = new Map<string, ImageAsset>();
      if (existsSync(texturesDir)) {
        for (const file of readdirSync(texturesDir)) {
          textures.set(file, {
            name: file,
            mimeType: file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
            src: `file://${texturesDir}/${file}`,
            width: 0,
            height: 0,
          });
        }
      }
      const meshAssets = new Set<string>();
      if (existsSync(meshesDir)) {
        for (const file of readdirSync(meshesDir)) {
          if (file.endsWith(".vert")) meshAssets.add(file.slice(0, -5).toLowerCase());
        }
      }
      const result = parseW3D(xml, { sceneName: name, textures, meshAssets });
      const bp = result.blueprint;
      const counts = bp.nodes.reduce<Record<string, number>>((acc, n) => {
        acc[n.type] = (acc[n.type] ?? 0) + 1;
        return acc;
      }, {});
      const totalKfs = bp.animation.clips.reduce(
        (sum, c) => sum + c.tracks.reduce((s, t) => s + t.keyframes.length, 0),
        0,
      );
      const cam = bp.engine?.camera;
      const camStr = cam
        ? `${cam.mode} fovY=${cam.fovY ?? "n/a"} pos=${cam.position ? `(${cam.position.x},${cam.position.y},${cam.position.z})` : "n/a"}`
        : "(none)";
      const w3d = bp.metadata?.w3d as { initialDisabledNodeIds?: string[] } | undefined;
      const designViewPromoted = w3d?.initialDisabledNodeIds?.length ?? 0;
      const bgStr = bp.engine?.background?.type === "color"
        ? bp.engine.background.color
        : bp.engine?.background?.type === "transparent"
          ? "transparent"
          : "(none)";
      // eslint-disable-next-line no-console
      console.log(
        `\n[${name}] sceneMode=${bp.sceneMode} bg=${bgStr} cam=${camStr}` +
        `\n  nodes=${bp.nodes.length} byType=${JSON.stringify(counts)}` +
        `\n  designView: ${designViewPromoted} nodes promoted from Enable=False to visible` +
        `\n  clips=${bp.animation.clips.length} kfs=${totalKfs}` +
        `\n  warnings(${result.warnings.length}):\n    - ${result.warnings.join("\n    - ")}`,
      );
    });
  }
});
