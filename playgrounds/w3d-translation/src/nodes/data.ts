// playgrounds/w3d-translation/src/nodes/data.ts

export type W3DTransform = {
  position: { x: number; y: number; z: number };
  rotationDeg: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number; lock?: string };
  pivot?: { x: number; y: number; z: number };
};

export type W3DQuadFaceMapping = {
  surfaceName: string;
  materialId: string;
  textureLayerId: string;
  baseMaterialInherited: boolean;
  textureInherited: boolean;
};

export type W3DMaskProperties = {
  disableBinaryAlpha: boolean;
  hasSampleCount: boolean;
  isColoredMask: boolean;
  isInvertedMask: boolean;
};

export type W3DGroupFlow = {
  /** R3 GeometryOptions.FlowChildren — when true, R3 distributes the children along the flow axis. */
  children: boolean;
  /** R3 GeometryOptions.LeadingSpace — signed gap between consecutive children (negative = overlap). */
  leadingSpace?: number;
  /** R3 GeometryOptions.Direction (e.g. "XPlus", "YMinus") — flow axis hint when present. Default is "XPlus" when omitted. */
  direction?: string;
  /**
   * R3 GeometryOptions.FlowChildrenAlignment (e.g. "Center", "Trailing", "Leading") — cross-axis
   * alignment applied to each child relative to the container origin. Stored verbatim from XML; the
   * builder interprets known values and treats unknown/missing as "Leading" (no cross-axis shift).
   */
  alignment?: string;
};

export type W3DGroupData = {
  kind: "Group";
  id: string;
  name: string;
  speedScale: number;
  displayColor?: string;
  maskIds: string[];
  transform: W3DTransform;
  /**
   * Parsed generically for any Group with <GeometryOptions FlowChildren/LeadingSpace/Direction>.
   * The builder currently applies it only to the PLAYERS group (Phase 2A staging gate);
   * Phase 2F removes that gate and generalises to all groups.
   */
  flow?: W3DGroupFlow;
  children: W3DNodeData[];
  raw?: {
    attributes: Record<string, string>;
    unknownChildren: string[];
  };
};

export type W3DQuadData = {
  kind: "Quad";
  id: string;
  name: string;
  enable: boolean;
  alpha: number;
  speedScale: number;
  displayColor?: string;
  isMask: boolean;
  maskIds: string[];
  geometry: {
    alignmentX?: "Left" | "Right" | "Center";
    alignmentY?: "Top" | "Bottom" | "Center";
    size: { x: number; y: number; lock?: string };
  };
  faceMapping?: W3DQuadFaceMapping;
  transform: W3DTransform;
  maskProperties?: W3DMaskProperties;
  children: W3DNodeData[];
  raw?: {
    attributes: Record<string, string>;
    unknownChildren: string[];
    extraFaceMappings?: number;
  };
};

export type W3DTextureTextData = {
  kind: "TextureText";
  id: string;
  name: string;
  enable: boolean;
  alpha: number;
  speedScale: number;
  displayColor?: string;
  /** Verbatim text content from <GeometryOptions Text="…">. */
  text: string;
  /** FontStyle GUID — resolves via W3DResourceRegistry.fontStyles. */
  fontStyleId?: string;
  /** 2D box for text layout in world units (TextBoxSize). */
  textBox: { x: number; y: number };
  alignmentX?: "Left" | "Right" | "Center";
  alignmentY?: "Top" | "Bottom" | "Center";
  /** R3 rasterization quality multiplier (typical 0.8..5). */
  textQuality: number;
  /**
   * R3 GeometryOptions.ConstrainMethod (e.g. "Width", "Height", "None").
   * Phase TextureText layout v2 honors "Width" by shrinking the font to fit
   * the canvas width; other values fall through to the default sizing.
   */
  constrainMethod?: string;
  maskIds: string[];
  faceMapping?: W3DQuadFaceMapping;
  transform: W3DTransform;
  maskProperties?: W3DMaskProperties;
  children: W3DNodeData[];
  raw?: {
    attributes: Record<string, string>;
    unknownChildren: string[];
    extraFaceMappings?: number;
  };
};

export type W3DNodeData = W3DGroupData | W3DQuadData | W3DTextureTextData;

export interface ParseNodesResult {
  roots: W3DNodeData[];
  warnings: string[];
}

export function parseNodes(xml: string): ParseNodesResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid W3D XML: ${parseError.textContent ?? "unknown error"}`);
  }
  const sceneNode = doc.querySelector("Scene > SceneLayer > SceneNode");
  const warnings: string[] = [];
  if (!sceneNode) {
    return { roots: [], warnings };
  }
  const children = findDirectChild(sceneNode, "Children");
  if (!children) {
    return { roots: [], warnings };
  }
  const roots = walkChildren(children, warnings);
  return { roots, warnings };
}

function walkChildren(parent: Element, warnings: string[]): W3DNodeData[] {
  const out: W3DNodeData[] = [];
  for (const child of Array.from(parent.children)) {
    const tag = child.tagName;
    if (tag === "Quad") {
      out.push(parseQuad(child, warnings));
    } else if (tag === "Group") {
      out.push(parseGroup(child, warnings));
    } else if (tag === "TextureText") {
      out.push(parseTextureText(child, warnings));
    } else if (tag === "Extensions") {
      // <Extensions> appears on every W3D node and is empty in current scenes.
      // Treat as structural noise and skip silently — not a warning.
    } else {
      const name = child.getAttribute("Name") ?? child.getAttribute("Id") ?? "?";
      warnings.push(`Ignored <${tag}> "${name}" (out of phase scope).`);
    }
  }
  return out;
}

function parseGroup(el: Element, warnings: string[]): W3DGroupData {
  const attrs = readAllAttrs(el);
  const transform = readTransform(el);
  const flow = readGroupFlow(el);
  const childrenEl = findDirectChild(el, "Children");
  const children = childrenEl ? walkChildren(childrenEl, warnings) : [];
  const group: W3DGroupData = {
    kind: "Group",
    id: attrs.Id ?? "",
    name: attrs.Name ?? "",
    speedScale: parseNumberAttr(attrs.SpeedScale, 1),
    displayColor: attrs.DisplayColor,
    maskIds: parseMaskIds(attrs.MaskId),
    transform,
    children,
  };
  if (flow) group.flow = flow;
  return group;
}

/**
 * Reads <GeometryOptions FlowChildren/LeadingSpace/Direction> from a Group element.
 * Generic — does not assume any particular group name. Returns undefined when none
 * of the flow-related attributes are present.
 */
function readGroupFlow(el: Element): W3DGroupFlow | undefined {
  const go = findDirectChild(el, "GeometryOptions");
  if (!go) return undefined;
  const flowAttr = go.getAttribute("FlowChildren");
  const leadingSpaceAttr = go.getAttribute("LeadingSpace");
  const directionAttr = go.getAttribute("Direction");
  const alignmentAttr = go.getAttribute("FlowChildrenAlignment");
  if (
    flowAttr === null &&
    leadingSpaceAttr === null &&
    directionAttr === null &&
    alignmentAttr === null
  ) {
    return undefined;
  }
  const flow: W3DGroupFlow = {
    children: parseBoolAttr(flowAttr ?? undefined, false),
  };
  if (leadingSpaceAttr !== null) flow.leadingSpace = parseNumberAttr(leadingSpaceAttr, 0);
  if (directionAttr !== null) flow.direction = directionAttr;
  if (alignmentAttr !== null) flow.alignment = alignmentAttr;
  return flow;
}

function readFaceMapping(el: Element): {
  faceMapping?: W3DQuadFaceMapping;
  extraFaceMappings?: number;
} {
  const prim = findDirectChild(el, "Primitive");
  const list = prim ? findDirectChild(prim, "FaceMappingList") : null;
  if (!list) return {};
  const mappings = Array.from(list.children).filter(
    (c) => c.tagName === "NamedBaseFaceMapping",
  );
  if (mappings.length === 0) return {};
  const first = mappings[0];
  const faceMapping: W3DQuadFaceMapping = {
    surfaceName: first.getAttribute("SurfaceName") ?? "",
    materialId: first.getAttribute("MaterialId") ?? "",
    textureLayerId: first.getAttribute("TextureLayerId") ?? "",
    baseMaterialInherited: parseBoolAttr(first.getAttribute("BaseMaterialInherited") ?? undefined, false),
    textureInherited: parseBoolAttr(first.getAttribute("TextureInherited") ?? undefined, false),
  };
  const extra = mappings.length - 1;
  return { faceMapping, ...(extra > 0 ? { extraFaceMappings: extra } : {}) };
}

function readMaskProperties(el: Element): W3DMaskProperties | undefined {
  const mp = findDirectChild(el, "MaskProperties");
  if (!mp) return undefined;
  return {
    disableBinaryAlpha: parseBoolAttr(mp.getAttribute("DisableBinaryAlpha") ?? undefined, false),
    hasSampleCount: parseBoolAttr(mp.getAttribute("HasSampleCount") ?? undefined, false),
    isColoredMask: parseBoolAttr(mp.getAttribute("IsColoredMask") ?? undefined, false),
    isInvertedMask: parseBoolAttr(mp.getAttribute("IsInvertedMask") ?? undefined, false),
  };
}

function parseQuad(el: Element, warnings: string[]): W3DQuadData {
  const attrs = readAllAttrs(el);
  const label = attrs.Name ?? attrs.Id ?? "?";
  const geometry = readQuadGeometry(el, label, warnings);
  const transform = readTransform(el);
  const { faceMapping, extraFaceMappings } = readFaceMapping(el);
  const maskProperties = readMaskProperties(el);

  const quad: W3DQuadData = {
    kind: "Quad",
    id: attrs.Id ?? "",
    name: attrs.Name ?? "",
    enable: parseBoolAttr(attrs.Enable, true),
    alpha: parseNumberAttr(attrs.Alpha, 1),
    speedScale: parseNumberAttr(attrs.SpeedScale, 1),
    displayColor: attrs.DisplayColor,
    isMask: parseBoolAttr(attrs.IsMask, false),
    maskIds: parseMaskIds(attrs.MaskId),
    geometry,
    transform,
    children: [],
  };
  if (faceMapping) quad.faceMapping = faceMapping;
  if (maskProperties) quad.maskProperties = maskProperties;
  if (extraFaceMappings !== undefined) {
    quad.raw = { ...(quad.raw ?? { attributes: {}, unknownChildren: [] }), extraFaceMappings };
  }
  const childrenEl = findDirectChild(el, "Children");
  if (childrenEl) {
    quad.children = walkChildren(childrenEl, warnings);
  }
  return quad;
}

function parseTextureText(el: Element, warnings: string[]): W3DTextureTextData {
  const attrs = readAllAttrs(el);
  const transform = readTransform(el);
  const { faceMapping, extraFaceMappings } = readFaceMapping(el);
  const maskProperties = readMaskProperties(el);

  const go = findDirectChild(el, "GeometryOptions");
  const text = go?.getAttribute("Text") ?? "";
  const fontStyleId = go?.getAttribute("FontStyle") ?? undefined;
  const alignmentX = (go?.getAttribute("AlignmentX") ?? undefined) as W3DTextureTextData["alignmentX"];
  const alignmentY = (go?.getAttribute("AlignmentY") ?? undefined) as W3DTextureTextData["alignmentY"];
  const textQuality = parseNumberAttr(go?.getAttribute("TextQuality") ?? undefined, 1);
  const constrainMethod = go?.getAttribute("ConstrainMethod") ?? undefined;

  const tbsEl = go ? findDirectChild(go, "TextBoxSize") : null;
  const textBox = {
    x: parseNumberAttr(tbsEl?.getAttribute("X") ?? undefined, 0),
    y: parseNumberAttr(tbsEl?.getAttribute("Y") ?? undefined, 0),
  };
  const label = attrs.Name ?? attrs.Id ?? "?";
  if (tbsEl && (textBox.x === 0 || textBox.y === 0)) {
    warnings.push(`TextureText "${label}" has zero TextBoxSize (${textBox.x} x ${textBox.y}); building anyway.`);
  }

  const node: W3DTextureTextData = {
    kind: "TextureText",
    id: attrs.Id ?? "",
    name: attrs.Name ?? "",
    enable: parseBoolAttr(attrs.Enable, true),
    alpha: parseNumberAttr(attrs.Alpha, 1),
    speedScale: parseNumberAttr(attrs.SpeedScale, 1),
    displayColor: attrs.DisplayColor,
    text,
    fontStyleId,
    textBox,
    alignmentX,
    alignmentY,
    textQuality,
    ...(constrainMethod !== undefined ? { constrainMethod } : {}),
    maskIds: parseMaskIds(attrs.MaskId),
    transform,
    children: [],
  };
  if (faceMapping) node.faceMapping = faceMapping;
  if (maskProperties) node.maskProperties = maskProperties;
  if (extraFaceMappings !== undefined) {
    node.raw = { ...(node.raw ?? { attributes: {}, unknownChildren: [] }), extraFaceMappings };
  }
  const childrenEl = findDirectChild(el, "Children");
  if (childrenEl) {
    node.children = walkChildren(childrenEl, warnings);
  }
  return node;
}

function readQuadGeometry(
  el: Element,
  label: string,
  warnings: string[],
): W3DQuadData["geometry"] {
  const go = findDirectChild(el, "GeometryOptions");
  const alignmentX = go?.getAttribute("AlignmentX") ?? undefined;
  const alignmentY = go?.getAttribute("AlignmentY") ?? undefined;
  const sizeEl = go ? findDirectChild(go, "Size") : null;
  const x = parseNumberAttr(sizeEl?.getAttribute("X") ?? undefined, 0);
  const y = parseNumberAttr(sizeEl?.getAttribute("Y") ?? undefined, 0);
  const lock = sizeEl?.getAttribute("Lock") ?? undefined;
  // Only warn when a <Size> element exists with a zero dimension — a missing
  // <Size> defaults to 0/0 silently (genuinely unspecified, not an error).
  if (sizeEl && (x === 0 || y === 0)) {
    warnings.push(`Quad "${label}" has zero Size (${x} x ${y}); building anyway.`);
  }
  return {
    alignmentX: alignmentX as W3DQuadData["geometry"]["alignmentX"],
    alignmentY: alignmentY as W3DQuadData["geometry"]["alignmentY"],
    size: { x, y, ...(lock ? { lock } : {}) },
  };
}

function readAllAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) out[a.name] = a.value;
  return out;
}

function parseBoolAttr(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return fallback;
}

function parseNumberAttr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseMaskIds(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
}

function readVec3(el: Element | null, defaults: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  if (!el) return { ...defaults };
  return {
    x: parseNumberAttr(el.getAttribute("X") ?? undefined, defaults.x),
    y: parseNumberAttr(el.getAttribute("Y") ?? undefined, defaults.y),
    z: parseNumberAttr(el.getAttribute("Z") ?? undefined, defaults.z),
  };
}

function readTransform(el: Element): W3DTransform {
  const nt = findDirectChild(el, "NodeTransform");
  const position = readVec3(nt ? findDirectChild(nt, "Position") : null, { x: 0, y: 0, z: 0 });
  const rotationDeg = readVec3(nt ? findDirectChild(nt, "Rotation") : null, { x: 0, y: 0, z: 0 });
  const scaleEl = nt ? findDirectChild(nt, "Scale") : null;
  const scaleVec = readVec3(scaleEl, { x: 1, y: 1, z: 1 });
  const scaleLock = scaleEl?.getAttribute("Lock") ?? undefined;
  const scale: W3DTransform["scale"] = { ...scaleVec, ...(scaleLock ? { lock: scaleLock } : {}) };

  // Pivot lives inside <NodeTransform>, not <GeometryOptions>.
  const pivotEl = nt ? findDirectChild(nt, "Pivot") : null;
  const pivot = pivotEl ? readVec3(pivotEl, { x: 0, y: 0, z: 0 }) : undefined;

  return { position, rotationDeg, scale, ...(pivot ? { pivot } : {}) };
}

function defaultTransform(): W3DTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function findDirectChild(parent: Element, tagName: string): Element | null {
  const target = tagName.toLowerCase();
  for (const child of Array.from(parent.children)) {
    if (child.tagName.toLowerCase() === target) return child;
  }
  return null;
}
