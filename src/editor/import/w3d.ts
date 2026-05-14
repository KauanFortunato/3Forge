/**
 * Minimal W3D scene-metadata reader (Phase C).
 *
 * Reads ONLY top-level Scene/SceneLayer/Camera attributes from a
 * `scene.w3d` XML file and emits a blueprint with engine settings and
 * scene mode populated. The actual node tree (Quad, TextureText, Group,
 * animations, masks, materials) is intentionally NOT translated — that
 * arrives in a later phase ("Phase F" — user-driven).
 *
 * Forward-compatible by design: any XML element below `<SceneLayer>` is
 * ignored, so newer W3D scenes still produce a valid (empty) blueprint
 * with their authored canvas/camera defaults.
 */
import { createDefaultSceneSettings } from "../state";
import { createDefaultAnimation } from "../animation";
import type {
  ComponentBlueprint,
  EngineCameraMetadata,
  EngineCameraSettings,
  EngineViewportSettings,
  ImportMetadata,
  SceneMode,
} from "../types";

export interface W3DImportResult {
  blueprint: ComponentBlueprint;
  warnings: string[];
}

/**
 * Parse a `scene.w3d` XML string and produce a blueprint carrying only
 * scene-level metadata. The node tree is left empty.
 *
 * Throws if `<Scene>` is absent. All other anomalies degrade to warnings.
 */
export function parseW3DSceneMetadata(xml: string): W3DImportResult {
  const warnings: string[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid W3D XML: ${parseError.textContent ?? "unknown error"}`);
  }

  const sceneEl = doc.querySelector("Scene");
  if (!sceneEl) {
    throw new Error("W3D XML has no <Scene> root element.");
  }

  const sceneName = sceneEl.getAttribute("Name")?.trim() || "Imported Scene";
  const is2DScene = parseBoolAttr(sceneEl.getAttribute("Is2DScene"), false);
  const mode: SceneMode = is2DScene ? "2d" : "3d";

  const sceneLayerEl = findDirectChild(sceneEl, "SceneLayer");
  const backgroundColor = sceneLayerEl
    ? w3dColorToHex(sceneLayerEl.getAttribute("BackgroundColor"), warnings)
    : null;

  const cameraManagerEl = sceneLayerEl ? findDirectChild(sceneLayerEl, "CameraManager") : null;
  const cameraEl = cameraManagerEl ? findDirectChild(cameraManagerEl, "Camera") : null;
  const cameraSettings = cameraEl ? readCamera(cameraEl, mode) : undefined;

  const engine: EngineViewportSettings = {
    background: backgroundColor
      ? { type: "color", color: backgroundColor, alpha: 1 }
      : undefined,
    camera: cameraSettings,
  };

  const importMetadata: ImportMetadata = {
    source: "w3d",
    notes: [
      `Scene "${sceneName}" imported as metadata-only (Phase C). Node tree, animations, materials, and textures will be brought in by later phases.`,
    ],
  };

  const sceneSettings = createDefaultSceneSettings();
  sceneSettings.mode = mode;
  if (backgroundColor) {
    sceneSettings.backgroundColor = backgroundColor;
  }

  const blueprint: ComponentBlueprint = {
    version: 1,
    componentName: sceneName,
    fonts: [],
    materials: [],
    images: [],
    models: [],
    sceneSettings,
    engine,
    importMetadata,
    nodes: [],
    animation: createDefaultAnimation(),
  };

  return { blueprint, warnings };
}

function readCamera(cameraEl: Element, sceneMode: SceneMode): EngineCameraSettings {
  const projection = cameraEl.getAttribute("Projection")?.trim() ?? "";
  // R3 spells the value "Ortographic" (no `h` after `t`); accept that typo
  // AND the corrected "Orthographic" with a permissive prefix match.
  const isOrtho = /^ort/i.test(projection);
  const position = readVec(findDirectChild(cameraEl, "Position"));
  const metadata: EngineCameraMetadata = {};
  const sourceId = cameraEl.getAttribute("Id")?.toLowerCase();
  const sourceName = cameraEl.getAttribute("Name") ?? undefined;
  const trackingCamera = cameraEl.getAttribute("TrackingCamera") ?? undefined;
  if (sourceId) metadata.sourceId = sourceId;
  if (sourceName) metadata.sourceName = sourceName;
  if (trackingCamera) {
    metadata.trackingCamera = trackingCamera;
    metadata.isTracked = true;
  }

  return {
    mode: isOrtho || sceneMode === "2d" ? "orthographic" : "perspective",
    position,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function findDirectChild(parent: Element, tagName: string): Element | null {
  const target = tagName.toLowerCase();
  for (const child of Array.from(parent.children)) {
    if (child.tagName.toLowerCase() === target) return child;
  }
  return null;
}

function readVec(el: Element | null): { x: number; y: number; z: number } | undefined {
  if (!el) return undefined;
  const x = Number(el.getAttribute("X") ?? "0");
  const y = Number(el.getAttribute("Y") ?? "0");
  const z = Number(el.getAttribute("Z") ?? "0");
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return { x, y, z };
}

function parseBoolAttr(value: string | null, fallback: boolean): boolean {
  if (!value) return fallback;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;
  return fallback;
}

/**
 * Convert R3's signed Int32 BackgroundColor to a `#rrggbb` string.
 * Values are stored as 32-bit ARGB (`0xAARRGGBB`); we ignore alpha here
 * since SceneSettings.backgroundColor is opaque.
 */
function w3dColorToHex(raw: string | null, warnings: string[]): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    warnings.push(`SceneLayer BackgroundColor "${raw}" is not numeric — using default.`);
    return null;
  }
  const argb = n < 0 ? n + 0x1_0000_0000 : n;
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
