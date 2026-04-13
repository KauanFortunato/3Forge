import defaultFontRaw from "three/examples/fonts/helvetiker_regular.typeface.json?raw";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TTFLoader } from "three/examples/jsm/loaders/TTFLoader.js";
import type { FontAsset } from "./types";

const bundledFontFiles = import.meta.glob("../../public/assets/fonts/*.json", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const fontLoader = new FontLoader();
const ttfLoader = new TTFLoader();
const defaultFontData = minifyFontData(defaultFontRaw);
const builtinFontCatalog = createBuiltinFontCatalog();
const builtinFontDataById = new Map(builtinFontCatalog.map((font) => [font.id, font.data]));
const parsedFontCache = new Map<string, Font>();

export const DEFAULT_FONT_ID = builtinFontCatalog[0]?.id ?? "builtin-helvetiker-regular";
export const DEFAULT_FONT_NAME = builtinFontCatalog[0]?.name ?? "Helvetiker Regular";

export function createDefaultFontAsset(): FontAsset {
  return {
    id: DEFAULT_FONT_ID,
    name: DEFAULT_FONT_NAME,
    source: "builtin",
  };
}

export function getAvailableFonts(customFonts: FontAsset[]): FontAsset[] {
  return [
    ...builtinFontCatalog.map(({ id, name }) => ({ id, name, source: "builtin" as const })),
    ...customFonts,
  ];
}

export function getFontData(font: FontAsset): string {
  if (font.source === "builtin") {
    return builtinFontDataById.get(font.id) ?? defaultFontData;
  }

  if (typeof font.data === "string" && font.data.trim()) {
    return font.data;
  }

  return defaultFontData;
}

export function parseFontAsset(font: FontAsset): Font {
  const cacheKey = font.id;
  const cached = parsedFontCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const parsed = fontLoader.parse(JSON.parse(getFontData(font)));
  parsedFontCache.set(cacheKey, parsed);
  return parsed;
}

export function normalizeFontLibrary(rawFonts: unknown): FontAsset[] {
  const fonts: FontAsset[] = [];
  const usedIds = new Set<string>(builtinFontCatalog.map((font) => font.id));
  const usedData = new Set<string>(builtinFontCatalog.map((font) => font.data));

  if (!Array.isArray(rawFonts)) {
    return fonts;
  }

  for (const rawFont of rawFonts) {
    const font = normalizeFontAsset(rawFont);
    if (!font) {
      continue;
    }

    const data = getFontData(font);
    if (usedData.has(data)) {
      continue;
    }

    let fontId = font.id;
    let suffix = 2;
    while (usedIds.has(fontId)) {
      fontId = `${font.id}-${suffix}`;
      suffix += 1;
    }

    fonts.push({
      ...font,
      id: fontId,
    });
    usedIds.add(fontId);
    usedData.add(data);
  }

  return fonts;
}

export async function fontFileToAsset(file: File): Promise<FontAsset> {
  const extension = file.name.toLowerCase();
  let data: string;

  if (extension.endsWith(".ttf") || extension.endsWith(".otf")) {
    const parsed = ttfLoader.parse(await file.arrayBuffer());
    fontLoader.parse(parsed);
    data = JSON.stringify(parsed);
  } else if (extension.endsWith(".json") || extension.endsWith(".typeface.json")) {
    data = minifyFontData(await file.text());
    fontLoader.parse(JSON.parse(data));
  } else {
    throw new Error("Formato de fonte nao suportado. Use .json, .typeface.json, .ttf ou .otf.");
  }

  return {
    id: createFontId(file.name),
    name: createFontDisplayName(file.name),
    source: "imported",
    data,
  };
}

function normalizeFontAsset(rawFont: unknown): FontAsset | null {
  if (!rawFont || typeof rawFont !== "object") {
    return null;
  }

  const source = rawFont as Record<string, unknown>;
  const id = typeof source.id === "string" && source.id.trim()
    ? source.id.trim()
    : createFontId(typeof source.name === "string" ? source.name : DEFAULT_FONT_NAME);

  const name = typeof source.name === "string" && source.name.trim()
    ? source.name.trim()
    : DEFAULT_FONT_NAME;

  const kind = source.source === "imported" ? "imported" : "builtin";
  if (kind === "builtin") {
    if (typeof source.id !== "string") {
      return createDefaultFontAsset();
    }

    const builtinName = builtinFontCatalog.find((font) => font.id === source.id)?.name;
    if (!builtinName) {
      return null;
    }

    return {
      id: source.id,
      name: builtinName,
      source: "builtin",
    };
  }

  if (typeof source.data !== "string" || !source.data.trim()) {
    return null;
  }

  try {
    const data = minifyFontData(source.data);
    fontLoader.parse(JSON.parse(data));

    return {
      id,
      name,
      source: "imported",
      data,
    };
  } catch {
    return null;
  }
}

function minifyFontData(raw: string): string {
  return JSON.stringify(JSON.parse(raw));
}

function createFontId(seed: string): string {
  const base = seed
    .replace(/\.(typeface\.json|json|ttf|otf)$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const normalized = base || "font";
  return `${normalized}-${Math.random().toString(36).slice(2, 8)}`;
}

function createFontDisplayName(fileName: string): string {
  const name = fileName
    .replace(/\.(typeface\.json|json|ttf|otf)$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();

  return name || "Imported Font";
}

function createBuiltinFontCatalog(): Array<{ id: string; name: string; data: string }> {
  const catalog = Object.entries(bundledFontFiles)
    .map(([path, raw]) => {
      const fileName = path.split("/").at(-1) ?? path;
      return {
        id: `builtin-${createFontSlug(fileName)}`,
        name: createFontDisplayName(fileName),
        data: minifyFontData(raw),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  catalog.push({
    id: "builtin-helvetiker-regular",
    name: "Helvetiker Regular",
    data: defaultFontData,
  });

  const preferredIndex = catalog.findIndex((font) => /regular/i.test(font.name) && !/italic/i.test(font.name));
  if (preferredIndex > 0) {
    const [preferredFont] = catalog.splice(preferredIndex, 1);
    catalog.unshift(preferredFont);
  }

  return catalog;
}

function createFontSlug(fileName: string): string {
  return fileName
    .replace(/\.(typeface\.json|json|ttf|otf)$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "font";
}
