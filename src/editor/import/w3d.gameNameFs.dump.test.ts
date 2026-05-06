/*
 * FASE D / Pass 2 — diagnostic only.
 *
 * Imports the real GameName_FS scene exactly the way the folder importer does
 * and writes a structured blueprint dump to debug/gamename-fs-blueprint.json.
 * Read by the operator (and by docs/w3d-runtime-visual-debug.md) — NOT a
 * regression test. Skipped silently if the R3 projects folder is unavailable.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseW3D } from "./w3d";
import { inferVideoMimeType, isVideoFileName } from "../images";
import type { ImageAsset, EditorNode } from "../types";

const PROJECTS_ROOT =
  process.env.R3_PROJECTS_ROOT ??
  "C:\\Users\\diogo.esteves\\Documents\\R3.Space.Projects\\Projects";
const SCENE_NAME = "GameName_FS";
const sceneDir = `${PROJECTS_ROOT}/${SCENE_NAME}`;
const scenePath = `${sceneDir}/scene.w3d`;
const texturesDir = `${sceneDir}/Resources/Textures`;
const meshesDir = `${sceneDir}/Resources/Meshes`;

describe("GameName_FS blueprint dump", () => {
  if (!existsSync(scenePath)) {
    it.skip(`(skipped — ${scenePath} not present)`, () => undefined);
    return;
  }

  it("writes a structured blueprint snapshot to debug/", () => {
    const xml = readFileSync(scenePath, "utf8");

    const textures = new Map<string, ImageAsset>();
    const videoFilenames = new Set<string>();
    if (existsSync(texturesDir)) {
      for (const file of readdirSync(texturesDir)) {
        const lower = file.toLowerCase();
        const isVideo = isVideoFileName(file);
        const mimeType = isVideo
          ? inferVideoMimeType(file)
          : lower.endsWith(".png")
            ? "image/png"
            : lower.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg";
        textures.set(file, {
          name: file,
          mimeType,
          src: `file://${texturesDir}/${file}`,
          width: 0,
          height: 0,
        });
        if (isVideo) videoFilenames.add(file);
      }
    }
    const meshAssets = new Set<string>();
    if (existsSync(meshesDir)) {
      for (const file of readdirSync(meshesDir)) {
        if (file.endsWith(".vert")) meshAssets.add(file.slice(0, -5).toLowerCase());
      }
    }

    const result = parseW3D(xml, {
      sceneName: SCENE_NAME,
      textures,
      videos: videoFilenames,
      meshAssets,
    });
    const bp = result.blueprint;
    const w3d = (bp.metadata?.w3d ?? {}) as {
      missingTextureNodeIds?: string[];
      meshPlaceholderNodeIds?: string[];
      helperNodeIds?: string[];
      initialDisabledNodeIds?: string[];
      unresolvedMaterialIds?: string[];
      maskProperties?: Record<string, Record<string, string>>;
    };

    // Per-type counts
    const counts = bp.nodes.reduce<Record<string, number>>((acc, n) => {
      acc[n.type] = (acc[n.type] ?? 0) + 1;
      return acc;
    }, {});

    const imageNodes = bp.nodes.filter((n) => n.type === "image");
    const videoImageNodes = imageNodes.filter(
      (n) => n.type === "image" && n.image.mimeType.startsWith("video/"),
    );
    const skewedNodes = bp.nodes.filter(
      (n) =>
        n.transform.skew &&
        (Math.abs(n.transform.skew.x) > 1e-6 ||
          Math.abs(n.transform.skew.y) > 1e-6 ||
          Math.abs(n.transform.skew.z) > 1e-6),
    );
    // Important: parser stores a single mask on `node.maskId` (singular) and
    // only populates `node.maskIds` (plural) when there is more than one.
    // Counting only `maskIds` would under-report wildly.
    const maskedNodes = bp.nodes.filter(
      (n) => (n.maskIds && n.maskIds.length > 0) || !!n.maskId,
    );
    const maskNodes = bp.nodes.filter((n) => n.isMask);

    // The user's report calls out specific suspect nodes. Pick them up by
    // name for the dump so it's easy to compare against the screenshot.
    const SUSPECT_NAMES = [
      "PITCH_IN",
      "PITCH_Out",
      "PITCH_OUT",
      "ORANGE_HOME_BIG",
      "ORANGE_HOME_BIG1",
      "ORANGE_HOME_BIG2",
      "ORANGE_AWAY_BIG",
      "ORANGE_AWAY_BIG1",
      "ORANGE_AWAY_BIG2",
      "Comp_Header_Bg",
      "BottomLogos",
    ];
    const suspects = bp.nodes.filter((n) =>
      SUSPECT_NAMES.some((needle) => n.name.toLowerCase() === needle.toLowerCase()),
    );

    function summarise(node: EditorNode): Record<string, unknown> {
      const w3dId = (bp.metadata?.w3d as { nodeIds?: Record<string, string> } | undefined)?.nodeIds?.[
        node.id
      ];
      return {
        id: node.id,
        w3dId,
        name: node.name,
        type: node.type,
        visible: node.visible,
        position: node.transform.position,
        scale: node.transform.scale,
        rotationDeg: node.transform.rotation,
        skew: node.transform.skew ?? null,
        material: node.material
          ? {
              type: node.material.type,
              color: node.material.color,
              emissive: node.material.emissive,
              opacity: node.material.opacity,
              transparent: node.material.transparent,
            }
          : null,
        image:
          node.type === "image"
            ? {
                src: node.image.src.slice(0, 80),
                mimeType: node.image.mimeType,
                width: node.image.width,
                height: node.image.height,
              }
            : null,
        geometry:
          (node as unknown as { geometry?: { width?: number; height?: number } }).geometry ?? null,
        isMask: node.isMask ?? false,
        maskIds: node.maskIds ?? (node.maskId ? [node.maskId] : []),
        flags: {
          isHelper: w3d.helperNodeIds?.includes(node.id) ?? false,
          isMissingTexture: w3d.missingTextureNodeIds?.includes(node.id) ?? false,
          wasInitialDisabled: w3d.initialDisabledNodeIds?.includes(node.id) ?? false,
          isMeshPlaceholder: w3d.meshPlaceholderNodeIds?.includes(node.id) ?? false,
        },
      };
    }

    // FASE 6 — for each mask reference, prove the referenced id is an
    // existing isMask node and surface the link both ways. Helps the
    // operator spot dangling references quickly.
    const maskIdToNode = new Map(bp.nodes.filter((n) => n.isMask).map((n) => [n.id, n]));
    const maskAudit = bp.nodes
      .filter((n) => !!n.maskId || (n.maskIds && n.maskIds.length > 0))
      .map((n) => {
        const ids = n.maskIds && n.maskIds.length > 0
          ? n.maskIds
          : n.maskId
            ? [n.maskId]
            : [];
        return {
          targetNode: n.name,
          targetId: n.id,
          targetType: n.type,
          inverted: n.maskInverted ?? false,
          maskRefs: ids.map((id) => {
            const mask = maskIdToNode.get(id);
            return {
              maskId: id,
              found: !!mask,
              maskName: mask?.name ?? null,
              maskType: mask?.type ?? null,
              maskHasSkew: mask?.transform.skew && (Math.abs(mask.transform.skew.x) > 1e-6 || Math.abs(mask.transform.skew.y) > 1e-6),
              maskGeometry: (mask as unknown as { geometry?: { width?: number; height?: number } } | undefined)?.geometry ?? null,
            };
          }),
        };
      });

    const dump = {
      scene: SCENE_NAME,
      sceneMode: bp.sceneMode,
      componentName: bp.componentName,
      camera: bp.engine?.camera ?? null,
      background: bp.engine?.background ?? null,
      totals: {
        nodes: bp.nodes.length,
        imageNodes: imageNodes.length,
        videoImageNodes: videoImageNodes.length,
        skewedNodes: skewedNodes.length,
        maskedNodes: maskedNodes.length,
        maskNodes: maskNodes.length,
        helperNodeCount: w3d.helperNodeIds?.length ?? 0,
        missingTextureNodeCount: w3d.missingTextureNodeIds?.length ?? 0,
        meshPlaceholderNodeCount: w3d.meshPlaceholderNodeIds?.length ?? 0,
        initialDisabledNodeCount: w3d.initialDisabledNodeIds?.length ?? 0,
        unresolvedMaterialIdCount: w3d.unresolvedMaterialIds?.length ?? 0,
      },
      byType: counts,
      unresolvedMaterialIds: w3d.unresolvedMaterialIds ?? [],
      helperNodeIds: w3d.helperNodeIds ?? [],
      missingTextureNodeIds: w3d.missingTextureNodeIds ?? [],
      initialDisabledNodeIds: w3d.initialDisabledNodeIds ?? [],
      videoImageNodes: videoImageNodes.map(summarise),
      skewedNodes: skewedNodes.map(summarise),
      suspects: suspects.map(summarise),
      maskedNodesSample: maskedNodes.slice(0, 12).map(summarise),
      maskAudit,
      maskNodes: maskNodes.map(summarise),
      // Largest image/plane/text nodes by area (geometry.width * geometry.height
      // * scale.x * scale.y). The user cares about "the giant wrong rectangle"
      // so surface the top 10 by world-projected area.
      largestNodes: bp.nodes
        .map((n) => {
          const g = (n as unknown as { geometry?: { width?: number; height?: number } }).geometry;
          const w = g?.width ?? 0;
          const h = g?.height ?? 0;
          const area = w * h * (n.transform.scale.x ?? 1) * (n.transform.scale.y ?? 1);
          return { node: n, area };
        })
        .filter(({ area }) => area > 0)
        .sort((a, b) => b.area - a.area)
        .slice(0, 12)
        .map(({ node, area }) => ({ ...summarise(node), area: +area.toFixed(3) })),
      warnings: result.warnings,
      // Map every unresolved material -> the nodes that reference it. Built
      // by walking the original XML again because the parser doesn't keep
      // back-pointers.
      unresolvedMaterialUsage: buildUnresolvedMaterialMap(xml, w3d.unresolvedMaterialIds ?? []),
    };

    if (!existsSync("debug")) mkdirSync("debug");
    const outPath = "debug/gamename-fs-blueprint.json";
    writeFileSync(outPath, JSON.stringify(dump, null, 2), "utf8");
    // eslint-disable-next-line no-console
    console.log(`[gameName_FS dump] wrote ${outPath} (${dump.totals.nodes} nodes)`);

    expect(dump.totals.nodes).toBeGreaterThan(0);
  });
});

/**
 * For each unresolved material GUID, list the W3D Node names that own a
 * <NamedBaseFaceMapping MaterialId="…"> matching it. The previous regex
 * walked back to ANY Name="…" attribute and ended up reporting face-mapping
 * names ("All Faces", "Front") instead of the enclosing node. This pass uses
 * a real XML traversal so we get the right ancestor.
 */
function buildUnresolvedMaterialMap(
  xml: string,
  unresolvedIds: string[],
): Record<string, string[]> {
  if (unresolvedIds.length === 0) return {};
  const out: Record<string, string[]> = {};
  for (const id of unresolvedIds) out[id] = [];
  const idLowerMap = new Map(unresolvedIds.map((i) => [i.toLowerCase(), i]));

  // jsdom is provided by the test environment so DOMParser exists here just
  // like in the parser itself.
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const mappings = doc.getElementsByTagName("NamedBaseFaceMapping");
  for (let i = 0; i < mappings.length; i += 1) {
    const m = mappings[i];
    const matId = (m.getAttribute("MaterialId") || "").toLowerCase();
    const original = idLowerMap.get(matId);
    if (!original) continue;
    // W3D uses typed primitive tags rather than a generic <Node>. Climb to
    // the nearest ancestor whose tag matches one of the known primitive
    // names and read its Name attribute.
    const PRIMITIVE_TAGS = new Set([
      "Quad",
      "Group",
      "Disk",
      "Mesh",
      "Model",
      "TextureText",
      "DirectionalLight",
      "PointLight",
      "SpotLight",
      "AmbientLight",
    ]);
    let p: Element | null = m.parentElement;
    let nodeName: string | null = null;
    while (p) {
      if (PRIMITIVE_TAGS.has(p.tagName)) {
        nodeName = p.getAttribute("Name");
        break;
      }
      p = p.parentElement;
    }
    if (nodeName) out[original].push(nodeName);
  }
  for (const id of Object.keys(out)) {
    const seen = new Set<string>();
    out[id] = out[id].filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  }
  return out;
}
