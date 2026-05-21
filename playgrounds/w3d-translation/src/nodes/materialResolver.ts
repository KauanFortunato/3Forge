import { ClampToEdgeWrapping, MirroredRepeatWrapping, RepeatWrapping, type Wrapping } from "three";
import type { W3DResourceRegistry, W3DTextureLayerData } from "./resources";

/**
 * W3D project-level default transparent material.
 * Used as a pass-through "no color" base in many scenes.
 * Not present in scene-level <Resources> — intentionally transparent at runtime.
 */
const W3D_DEFAULT_TRANSPARENT = "DE1A3E3C-AE85-4B7B-BA86-056463611630";

/**
 * Phase 2C — UV transform extracted from a <TextureMappingOption> block.
 * The resolver computes this from W3DTextureLayerData; the builder applies it
 * to a (cloned) Three.js Texture before assigning it to material.map or
 * material.alphaMap. Identity values are the Three.js defaults so an identity
 * transform can be detected and the cached singleton reused without cloning.
 */
export type UVTransform = {
  offset: { x: number; y: number };
  repeat: { x: number; y: number };
  rotationDeg: number;
  wrapS: Wrapping;
  wrapT: Wrapping;
};

export type ResolvedMaterial = {
  color: string;
  opacity: number;
  transparent: boolean;
  mapUrl?: string;
  alphaMapUrl?: string;
  /** UV transform for material.map. Present when mapUrl is present. */
  mapTransform?: UVTransform;
  /**
   * UV transform for material.alphaMap, sourced from the W3D OffsetKey /
   * ScaleKey / RotationKey elements (independent from map). Present when
   * alphaMapUrl is present.
   */
  alphaMapTransform?: UVTransform;
  hasMaterialResolved: boolean;
  hasTextureLayerResolved: boolean;
  materialName?: string;
  textureLayerName?: string;
  textureFilename?: string;
};

/**
 * Map W3D TextureAddressMode strings to Three.js Wrapping constants.
 * Falls back to ClampToEdgeWrapping for missing / unrecognised values.
 */
export function addressModeToWrap(mode: string | undefined): Wrapping {
  if (!mode) return ClampToEdgeWrapping;
  switch (mode.trim().toLowerCase()) {
    case "repeat":
      return RepeatWrapping;
    case "mirror":
    case "mirrorrepeat":
    case "mirroredrepeat":
      return MirroredRepeatWrapping;
    case "clamp":
    case "clamptoedge":
    default:
      return ClampToEdgeWrapping;
  }
}

function buildMapTransform(tl: W3DTextureLayerData): UVTransform {
  return {
    offset: { x: tl.offset?.x ?? 0, y: tl.offset?.y ?? 0 },
    repeat: { x: tl.scale?.x ?? 1, y: tl.scale?.y ?? 1 },
    rotationDeg: tl.rotationDeg ?? 0,
    wrapS: addressModeToWrap(tl.mapping?.textureAddressModeU),
    wrapT: addressModeToWrap(tl.mapping?.textureAddressModeV),
  };
}

function buildAlphaMapTransform(tl: W3DTextureLayerData): UVTransform {
  return {
    offset: { x: tl.offsetKey?.x ?? 0, y: tl.offsetKey?.y ?? 0 },
    repeat: { x: tl.scaleKey?.x ?? 1, y: tl.scaleKey?.y ?? 1 },
    rotationDeg: tl.rotationKeyDeg ?? 0,
    // alphaMap shares the layer's TextureAddressMode (W3D has no per-Key mode).
    wrapS: addressModeToWrap(tl.mapping?.textureAddressModeU),
    wrapT: addressModeToWrap(tl.mapping?.textureAddressModeV),
  };
}

export type ResolverContext = {
  registry: W3DResourceRegistry;
  textureUrlsByFilename: Map<string, string>;
};

export function resolveMaterial(
  materialId: string | undefined,
  textureLayerId: string | undefined,
  displayColor: string | undefined,
  quadAlpha: number,
  ctx: ResolverContext,
  warnings: string[],
): ResolvedMaterial {
  // --- 1. Colour from BaseMaterial ---
  let color = "#ff00ff";
  let matAlpha = 1;
  let hasMaterialResolved = false;
  let materialName: string | undefined;

  if (materialId) {
    if (materialId.toUpperCase() === W3D_DEFAULT_TRANSPARENT) {
      // Known project-level transparent/pass-through material — not in scene Resources.
      // In W3D runtime this is invisible; opacity overridden below after texture check.
      hasMaterialResolved = false;
      materialName = "(project-default-transparent)";
      color = "#ffffff";
      // No warning — this GUID is a known, expected omission from scene Resources.
    } else {
      const mat = ctx.registry.baseMaterials.get(materialId);
      if (mat) {
        hasMaterialResolved = true;
        materialName = mat.name;
        matAlpha = mat.alpha;
        if (mat.hasEmissive) {
          color = `#${mat.emissive}`;
        } else if (mat.hasDiffuse) {
          color = `#${mat.diffuse}`;
        } else {
          color = "#ffffff";
        }
      } else {
        warnings.push(`MaterialId "${materialId}" not in registry; using DisplayColor fallback.`);
        color = displayColorToHex(displayColor);
      }
    }
  } else {
    color = displayColorToHex(displayColor);
  }

  // --- 2. Opacity ---
  let opacity = quadAlpha * matAlpha;
  let transparent = opacity < 1;

  // --- 3. Texture from TextureLayer ---
  let mapUrl: string | undefined;
  let alphaMapUrl: string | undefined;
  let mapTransform: UVTransform | undefined;
  let alphaMapTransform: UVTransform | undefined;
  let hasTextureLayerResolved = false;
  let textureLayerName: string | undefined;
  let textureFilename: string | undefined;

  if (textureLayerId && textureLayerId !== "Standard") {
    const tl = ctx.registry.textureLayers.get(textureLayerId);
    if (!tl) {
      warnings.push(`TextureLayerId "${textureLayerId}" not in registry.`);
    } else {
      textureLayerName = tl.name;
      const texGuid = tl.mapping?.textureGuid;

      if (texGuid) {
        const tex = ctx.registry.textures.get(texGuid);
        if (!tex) {
          warnings.push(`TextureGuid "${texGuid}" not found in texture registry for TextureLayer "${tl.name}".`);
        } else {
          const url = ctx.textureUrlsByFilename.get(tex.filename);
          if (url) {
            mapUrl = url;
            textureFilename = tex.filename;
            hasTextureLayerResolved = true;
            // PNG textures carry their own alpha — transparent=true allows Three.js to use it
            transparent = true;
          } else {
            warnings.push(`Texture file "${tex.filename}" not loaded; no mapUrl for TextureLayer "${tl.name}".`);
          }
        }
      } else {
        // Phase H: no static textureGuid — check ExportProperty dynamic binding
        const dynFilename = ctx.registry.dynamicTextureFilenameByLayerId?.get(textureLayerId);
        if (dynFilename) {
          const url = ctx.textureUrlsByFilename.get(dynFilename);
          if (url) {
            mapUrl = url;
            textureFilename = dynFilename;
            hasTextureLayerResolved = true;
            transparent = true;
          } else {
            warnings.push(`Dynamic texture "${dynFilename}" for TextureLayer "${tl.name}" not loaded.`);
          }
        }
        // No dynFilename → unbound dynamic slot (e.g. FF_PHOTO) → no warning, no mapUrl
      }

      // alphaMapUrl — ONLY when a separate Key texture GUID exists (never auto-assigned from mapUrl)
      const keyGuid = tl.mapping?.keyGuid;
      if (keyGuid) {
        const keyTex = ctx.registry.textures.get(keyGuid);
        if (keyTex) {
          const keyUrl = ctx.textureUrlsByFilename.get(keyTex.filename);
          if (keyUrl) {
            alphaMapUrl = keyUrl;
          } else {
            warnings.push(`Key texture "${keyTex.filename}" not loaded; no alphaMapUrl.`);
          }
        } else {
          warnings.push(`KeyGuid "${keyGuid}" not found in texture registry.`);
        }
      }

      // Phase 2C — populate UV transforms when the corresponding URL resolved.
      // Each transform is independent: map uses Offset/Scale/Rotation; alphaMap
      // uses OffsetKey/ScaleKey/RotationKey. Both share the layer's wrap mode.
      if (mapUrl) mapTransform = buildMapTransform(tl);
      if (alphaMapUrl) alphaMapTransform = buildAlphaMapTransform(tl);
    }
  }

  // DE1A3E3C without a resolved texture → fully transparent at runtime.
  // If a texture was resolved (mapUrl exists), let the texture/opacity flow normally.
  if (materialId?.toUpperCase() === W3D_DEFAULT_TRANSPARENT && !mapUrl) {
    opacity = 0;
    transparent = true;
  }

  return {
    color,
    opacity,
    transparent,
    mapUrl,
    alphaMapUrl,
    mapTransform,
    alphaMapTransform,
    hasMaterialResolved,
    hasTextureLayerResolved,
    materialName,
    textureLayerName,
    textureFilename,
  };
}

/**
 * Convert W3D DisplayColor (signed Int32 ARGB) to "#rrggbb".
 * Fallback: magenta "#ff00ff" when missing or unparseable.
 */
export function displayColorToHex(raw: string | undefined): string {
  if (!raw || raw.trim() === "") return "#ff00ff";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "#ff00ff";
  const argb = n < 0 ? n + 0x1_0000_0000 : n;
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
