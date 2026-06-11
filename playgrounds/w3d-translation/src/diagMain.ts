// THROWAWAY headless-render harness entry — see diag.html. Renders the
// LINEUP_LEFT fixture at ?frame=N with the real pipeline (translate → clone →
// snapshot → buildNodeTree → WebGLRenderer) so Chrome headless screenshots
// show the exact pixels the playground produces. ?hide=NAME,NAME hides nodes
// by w3d name for A/B isolation.
import {
  Color,
  Mesh,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
  type Object3D,
  type Texture,
} from "three";
import { applyTimelineSnapshot, cloneNodes, translateBlueprint } from "./translate";
import { evaluateSnapshotAtFrame } from "./nodes/timelines";
import { buildNodeTree, frameWorldSizeFor, type BuildContext } from "./nodes/builder";
import { descriptorToCss } from "./fonts";
import lineupLeftXmlRaw from "./__fixtures__/LINEUP_LEFT.scene.w3d?raw";

const textureUrls = import.meta.glob("../diag-assets/textures/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const fontUrls = import.meta.glob("../diag-assets/fonts/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Same filename→family/weight parsing as the app, minimal version. */
function parseFontMeta(filename: string): { family: string; weight: string; style: string } | null {
  const stem = filename.replace(/\.(otf|ttf|woff2?)$/i, "");
  const dash = stem.lastIndexOf("-");
  if (dash === -1) return { family: stem.replace(/_/g, " "), weight: "400", style: "normal" };
  const family = stem.slice(0, dash).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  const { weight, style } = descriptorToCss(stem.slice(dash + 1));
  return { family, weight, style };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const frame = Number(params.get("frame") ?? "799");
  const hide = new Set((params.get("hide") ?? "").split(",").filter(Boolean));

  // Register fonts so canvas text rasterises with the real families.
  const fontLoads: Promise<unknown>[] = [];
  for (const [path, url] of Object.entries(fontUrls)) {
    const meta = parseFontMeta(basename(path));
    if (!meta) continue;
    const face = new FontFace(meta.family, `url(${url})`, { weight: meta.weight, style: meta.style });
    fontLoads.push(face.load().then((f) => document.fonts.add(f)).catch(() => undefined));
  }
  await Promise.allSettled(fontLoads);

  const xml = lineupLeftXmlRaw.replace(/^﻿/, "");
  const { blueprint, pristineNodes, tracks, resources } = translateBlueprint(xml);

  const textureUrlsByFilename = new Map<string, string>();
  for (const [path, url] of Object.entries(textureUrls)) {
    textureUrlsByFilename.set(basename(path), url);
  }

  const nodes = cloneNodes(pristineNodes);
  applyTimelineSnapshot(nodes, evaluateSnapshotAtFrame(tracks, frame));

  const ctx: BuildContext = {
    registry: resources,
    textureUrlsByFilename,
    textureCache: new Map<string, Texture>(),
    warnings: [],
    frameSize: frameWorldSizeFor(blueprint.sceneSettings),
  };
  const root = buildNodeTree(nodes, ctx);

  if (hide.size > 0) {
    root.traverse((o: Object3D) => {
      const w = (o.userData?.w3d ?? {}) as { name?: string };
      if (w.name && hide.has(w.name)) o.visible = false;
    });
  }

  const W = 1280;
  const H = 720;
  const renderer = new WebGLRenderer({ antialias: true, stencil: true });
  renderer.localClippingEnabled = true;
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  document.body.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color("#000000"); // SceneLayer BackgroundColor (black)
  scene.add(root);

  const halfH = 2.0710678; // broadcast crop (1080/2/260.7349)
  const halfW = halfH * (16 / 9);
  let frustum = { left: -halfW, right: halfW, top: halfH, bottom: -halfH };
  // ?zoom=minX,maxX,minY,maxY — world-units crop for pixel-level inspection.
  const zoom = (params.get("zoom") ?? "").split(",").map(Number);
  if (zoom.length === 4 && zoom.every(Number.isFinite)) {
    frustum = { left: zoom[0], right: zoom[1], bottom: zoom[2], top: zoom[3] };
  }
  const cam = new OrthographicCamera(frustum.left, frustum.right, frustum.top, frustum.bottom, 0.1, 100);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);

  // Let async texture decodes land, then render a few frames.
  const renderOnce = () => renderer.render(scene, cam);
  for (let i = 0; i < 5; i++) {
    renderOnce();
    await new Promise((r) => setTimeout(r, 400));
  }
  renderOnce();
  document.title = `DIAG-READY f${frame} meshes=${countMeshes(root)} warn=${ctx.warnings.length}`;
}

function countMeshes(root: Object3D): number {
  let n = 0;
  root.traverse((o) => { if ((o as Mesh).isMesh) n++; });
  return n;
}

void main();
