import type { W3DResourceRegistry } from "./resources";

/**
 * W3D project-level default transparent material.
 * Used as a pass-through "no color" base in many scenes.
 * Not present in scene-level <Resources> — intentionally transparent at runtime.
 */
const W3D_DEFAULT_TRANSPARENT = "DE1A3E3C-AE85-4B7B-BA86-056463611630";

export type ResolvedMaterial = {
  color: string;
  opacity: number;
  transparent: boolean;
  mapUrl?: string;
  alphaMapUrl?: string;
  hasMaterialResolved: boolean;
  hasTextureLayerResolved: boolean;
  materialName?: string;
  textureLayerName?: string;
  textureFilename?: string;
};

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
