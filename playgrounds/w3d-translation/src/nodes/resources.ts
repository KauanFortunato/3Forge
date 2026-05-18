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

export type W3DResourceRegistry = {
  baseMaterials: Map<string, W3DBaseMaterialData>;
  textures: Map<string, W3DTextureData>;
  textureLayers: Map<string, W3DTextureLayerData>;
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

      // Parse UV metadata elements — preserved, not applied this phase
      const findChild = (tag: string) => Array.from(el.children).find(c => c.tagName === tag);
      const readXY = (e: Element | undefined): { x: number; y: number } | undefined =>
        e ? {
          x: parseNum(e.getAttribute("X") ?? undefined, 0),
          y: parseNum(e.getAttribute("Y") ?? undefined, 0),
        } : undefined;
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
        offset: readXY(offsetEl),
        scale: readXY(scaleEl),
        rotationDeg: rotEl ? parseNum(rotEl.getAttribute("Z") ?? undefined, 0) : undefined,
        offsetKey: readXYopt(offsetKeyEl),
        scaleKey: readXYopt(scaleKeyEl),
        rotationKeyDeg: rotKeyEl ? parseNum(rotKeyEl.getAttribute("Z") ?? undefined, 0) : undefined,
        raw: attrs,
      });
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
