// playgrounds/w3d-translation/src/nodes/resources.ts

export type W3DBaseMaterialData = {
  kind: "BaseMaterial";
  id: string;
  name: string;
  hasEmissive: boolean;
  hasDiffuse: boolean;
  emissive: string;       // hex without "#", e.g. "663087"
  diffuse: string;
  alpha: number;
  raw?: Record<string, string>;
};

export type W3DTextureData = {
  kind: "Texture";
  id: string;
  name: string;
  filename: string;       // attribute is "Filename" (capital F, lowercase "ilename")
  folderPath: string;
  raw?: Record<string, string>;
};

export type W3DTextureMappingOption = {
  textureGuid?: string;
  keyGuid?: string;
  keyType?: string;
  isEmissive: boolean;
  textureAddressModeU?: string;
  textureAddressModeV?: string;
  textureStretchOption?: string;
  useMipMapping: boolean;
  raw?: Record<string, string>;
};

export type W3DTextureLayerData = {
  kind: "TextureLayer";
  id: string;
  name: string;
  textureBlending: string;
  mapping?: W3DTextureMappingOption;
  offset?: { x: number; y: number };
  scale?: { x: number; y: number };
  rotationDeg?: number;
  offsetKey?: { x?: number; y?: number };
  scaleKey?: { x?: number; y?: number };
  rotationKeyDeg?: number;
  raw?: Record<string, string>;
};

export type W3DFontStyleData = {
  kind: "FontStyle";
  id: string;
  name: string;          // e.g. "FS_01"
  fontName: string;      // e.g. "Obviously Cond"
  type: string;          // e.g. "Light", "Bold", "Italic", "Black Italic"
  baselineAligned: boolean;
  lineSpacing: number;
  kerning: number;
  kerningScale: number;
  raw?: Record<string, string>;
};

export type W3DResourceRegistry = {
  baseMaterials: Map<string, W3DBaseMaterialData>;
  textures: Map<string, W3DTextureData>;
  textureLayers: Map<string, W3DTextureLayerData>;
  dynamicTextureFilenameByLayerId: Map<string, string>;
  fontStyles: Map<string, W3DFontStyleData>;
};

export interface ParseResourcesResult {
  registry: W3DResourceRegistry;
  warnings: string[];
}

export function parseResources(xml: string): ParseResourcesResult {
  const registry: W3DResourceRegistry = {
    baseMaterials: new Map(),
    textures: new Map(),
    textureLayers: new Map(),
    dynamicTextureFilenameByLayerId: new Map(),
    fontStyles: new Map(),
  };
  const warnings: string[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return { registry, warnings };

  const resourcesEl = doc.querySelector("Scene > Resources") ?? doc.querySelector("Resources");
  if (!resourcesEl) return { registry, warnings };

  for (const el of Array.from(resourcesEl.children)) {
    if (el.tagName === "BaseMaterial") {
      const attrs = readAllAttrs(el);
      const id = attrs.Id;
      if (!id) { warnings.push(`BaseMaterial missing Id, skipping.`); continue; }
      registry.baseMaterials.set(id, {
        kind: "BaseMaterial",
        id,
        name: attrs.Name ?? "",
        hasEmissive: parseBool(attrs.HasEmissive, false),
        hasDiffuse: parseBool(attrs.HasDiffuse, false),
        emissive: (attrs.Emissive ?? "ffffff").toLowerCase(),
        diffuse: (attrs.Diffuse ?? "ffffff").toLowerCase(),
        alpha: parseNum(attrs.Alpha, 1),
        raw: attrs,
      });
    } else if (el.tagName === "Texture") {
      const attrs = readAllAttrs(el);
      const id = attrs.Id;
      if (!id) { warnings.push(`Texture missing Id, skipping.`); continue; }
      registry.textures.set(id, {
        kind: "Texture",
        id,
        name: attrs.Name ?? "",
        filename: attrs.Filename ?? "",   // NOTE: "Filename" not "FileName"
        folderPath: attrs.FolderPath ?? "",
        raw: attrs,
      });
    } else if (el.tagName === "ImageSequence") {
      // Video / image-sequence resource (e.g. SCORE.mp4). Not translated yet:
      // playback needs a VideoTexture + the runtime binding path. Surface a
      // warning so an imported scene's missing motion is diagnosable.
      const attrs = readAllAttrs(el);
      warnings.push(`ImageSequence resource "${attrs.Name ?? attrs.Id ?? "?"}" (video/sequence) is not translated yet.`);
    } else if (el.tagName === "TextureTextFontStyle") {
      const attrs = readAllAttrs(el);
      const id = attrs.Id;
      if (!id) { warnings.push(`TextureTextFontStyle missing Id, skipping.`); continue; }
      registry.fontStyles.set(id, {
        kind: "FontStyle",
        id,
        name: attrs.Name ?? "",
        fontName: attrs.FontName ?? "",
        type: attrs.Type ?? "",
        baselineAligned: parseBool(attrs.BaselineAligned, false),
        lineSpacing: parseNum(attrs.LineSpacing, 1),
        kerning: parseNum(attrs.Kerning, 0),
        kerningScale: parseNum(attrs.KerningScale, 1),
        raw: attrs,
      });
    } else if (el.tagName === "TextureLayer") {
      const attrs = readAllAttrs(el);
      const id = attrs.Id;
      if (!id) { warnings.push(`TextureLayer missing Id, skipping.`); continue; }

      // Parse <TextureMappingOption>
      const tmoEl = Array.from(el.children).find(c => c.tagName === "TextureMappingOption");
      let mapping: W3DTextureMappingOption | undefined;
      if (tmoEl) {
        const t = readAllAttrs(tmoEl);
        mapping = {
          textureGuid: t.Texture || undefined,
          keyGuid: t.Key || undefined,
          keyType: t.KeyType || undefined,
          isEmissive: parseBool(t.IsEmissive, false),
          textureAddressModeU: t.TextureAddressModeU,
          textureAddressModeV: t.TextureAddressModeV,
          textureStretchOption: t.TextureStretchOption,
          useMipMapping: parseBool(t.UseMipMapping, false),
          raw: t,
        };
      }

      // Phase UV — parse UV metadata elements from inside <TextureMappingOption>.
      // The previous implementation searched el.children (the <TextureLayer> level)
      // but every <Offset>, <Scale>, <Rotation>, <OffsetKey>, <ScaleKey>, <RotationKey>
      // actually lives inside <TextureMappingOption> in the W3D corpus. The bad
      // scope silently dropped every TextureLayer UV transform — most visibly
      // INVERTED_GRADIENT's <Scale X="-1"/> (purple panel fade direction) and
      // PHOTO_NN's <Offset> / <OffsetKey> / <ScaleKey> (player photo crop).
      const findChild = (tag: string): Element | undefined =>
        tmoEl ? Array.from(tmoEl.children).find((c) => c.tagName === tag) : undefined;
      // <Offset> missing axes default to 0 (no shift). <Scale> missing axes
      // default to 1 (no scale change). E.g. <Scale X="-1"/> must parse as
      // { x: -1, y: 1 } so a horizontal flip doesn't collapse the texture
      // vertically.
      const readOffsetXY = (e: Element | undefined): { x: number; y: number } | undefined =>
        e ? {
          x: parseNum(e.getAttribute("X") ?? undefined, 0),
          y: parseNum(e.getAttribute("Y") ?? undefined, 0),
        } : undefined;
      const readScaleXY = (e: Element | undefined): { x: number; y: number } | undefined =>
        e ? {
          x: parseNum(e.getAttribute("X") ?? undefined, 1),
          y: parseNum(e.getAttribute("Y") ?? undefined, 1),
        } : undefined;
      // OffsetKey / ScaleKey keep the existing partial-axis behaviour: only
      // explicitly authored axes appear. materialResolver pairs them with its
      // own ?? 0 (offset) / ?? 1 (scale) defaults at consumption time.
      const readXYopt = (e: Element | undefined): { x?: number; y?: number } | undefined =>
        e ? {
          ...(e.getAttribute("X") !== null ? { x: parseNum(e.getAttribute("X") ?? undefined, 0) } : {}),
          ...(e.getAttribute("Y") !== null ? { y: parseNum(e.getAttribute("Y") ?? undefined, 0) } : {}),
        } : undefined;

      const offsetEl = findChild("Offset");
      const scaleEl = findChild("Scale");
      const rotEl = findChild("Rotation");
      const offsetKeyEl = findChild("OffsetKey");
      const scaleKeyEl = findChild("ScaleKey");
      const rotKeyEl = findChild("RotationKey");

      registry.textureLayers.set(id, {
        kind: "TextureLayer",
        id,
        name: attrs.Name ?? "",
        textureBlending: attrs.TextureBlending ?? "Normal",
        mapping,
        offset: readOffsetXY(offsetEl),
        scale: readScaleXY(scaleEl),
        rotationDeg: rotEl ? parseNum(rotEl.getAttribute("Z") ?? undefined, 0) : undefined,
        offsetKey: readXYopt(offsetKeyEl),
        scaleKey: readXYopt(scaleKeyEl),
        rotationKeyDeg: rotKeyEl ? parseNum(rotKeyEl.getAttribute("Z") ?? undefined, 0) : undefined,
        raw: attrs,
      });
    }
  }

  // Phase H: parse dynamic texture bindings from ExportManagerProperties
  const empEl = doc.querySelector("ExportManagerProperties");
  if (empEl) {
    for (const listEl of Array.from(empEl.children)) {
      if (listEl.tagName !== "ExportList") continue;
      for (const propEl of Array.from(listEl.children)) {
        if (propEl.tagName !== "ExportProperty") continue;
        if (propEl.getAttribute("Type") !== "Texture") continue;
        if (propEl.getAttribute("PropertyName") !== "TextureMappingOption.Texture") continue;
        const controllableId = propEl.getAttribute("ControllableId");
        const value = propEl.getAttribute("Value");
        if (controllableId && value) {
          registry.dynamicTextureFilenameByLayerId.set(controllableId, value);
        }
      }
    }
  }

  return { registry, warnings };
}

function readAllAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) out[a.name] = a.value;
  return out;
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (!v) return fallback;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1" ? true : s === "false" || s === "0" ? false : fallback;
}

function parseNum(v: string | undefined, fallback: number): number {
  if (!v || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
