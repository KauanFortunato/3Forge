// playgrounds/w3d-translation/src/fonts.ts
//
// Phase H3 — Runtime font registration for W3D playground.
//
// The 26PT_WTV_BASKETBALL R3 corpus authors TextureText with families like
// "Obviously Cond" / "Obviously" / "Obviously Wide" / "Obviously Demo". Those
// fonts are not installed system-wide and are NOT shipped in this repo (the
// faces are commercial and licensed to the user's R3 project, not to 3Forge).
//
// Instead, we discover the user's `.ttf`/`.otf`/`.woff(2)` files at folder-
// import time (see `w3dFolder.ts`) and register each face with the browser via
// the FontFace API. The R3 family name (e.g. "Obviously Cond") is derived from
// the filename stem: `ObviouslyCond-Black.ttf` → family `Obviously Cond`,
// weight 900, style normal.
//
// Pure module — no DOM at import time. `loadW3DFontFiles` is async and
// no-ops in test environments where `document.fonts` is undefined.

/**
 * Result of parsing a font filename into the W3D `FontStyle.fontName` /
 * weight / style needed to register the face under the same key the corpus
 * uses inside `<TextureText FontStyle="...">`.
 */
export type ParsedFontFilename = {
  /** Source filename (no path), e.g. "ObviouslyCond-BlackItalic.ttf". */
  filename: string;
  /** R3-style family name to register under, e.g. "Obviously Cond". */
  family: string;
  /** CSS weight string, e.g. "300", "400", "700", "900". */
  weight: string;
  /** CSS style string, "normal" or "italic". */
  style: string;
};

/**
 * Filename stems we recognise. Maps a stem prefix to the R3 family name with
 * canonical spacing. Order matters — longer prefixes are matched first so
 * `ObviouslyCond` is preferred over `Obviously` when both could apply.
 */
const FAMILY_PREFIX_TABLE: ReadonlyArray<readonly [string, string]> = [
  ["ObviouslyDemo", "Obviously Demo"],
  ["ObviouslyCond", "Obviously Cond"],
  ["ObviouslyWide", "Obviously Wide"],
  ["Obviously", "Obviously"],
  ["BarlowCondensed", "Barlow Condensed"],
  ["Barlow", "Barlow"],
  ["RobotoCondensed", "Roboto Condensed"],
  ["Roboto", "Roboto"],
];

/**
 * Parse a font filename into family/weight/style. Returns undefined when the
 * extension is unrecognised so callers can skip silently.
 */
export function parseFontFilename(filename: string): ParsedFontFilename | undefined {
  const ext = extensionOf(filename);
  if (![".ttf", ".otf", ".woff", ".woff2"].includes(ext)) return undefined;
  const stem = filename.slice(0, filename.length - ext.length);

  // Family prefix
  let family = "";
  let rest = stem;
  for (const [prefix, friendly] of FAMILY_PREFIX_TABLE) {
    if (stem.startsWith(prefix)) {
      family = friendly;
      rest = stem.slice(prefix.length);
      break;
    }
  }
  if (!family) {
    // Unknown family — fall back to the filename stem itself. The canvas will
    // try to use this name; if no FontFace is registered under it the browser
    // falls back to system sans-serif (current behaviour).
    family = stem.replace(/[-_].*$/, "") || stem;
  }

  // Strip leading "-" then split remaining descriptor on hyphen/space-case.
  // Examples for `rest`:
  //   ""                   → Regular
  //   "-Regular"           → Regular
  //   "-Bold"              → Bold
  //   "-BlackItalic"       → Black + Italic
  //   "-CondensedBlackItalic" → Condensed + Black + Italic
  //   "-SemiBoldItalic"    → SemiBold + Italic
  const descriptor = rest.replace(/^[-_\s]+/, "");
  const lower = descriptor.toLowerCase();

  const italic = /italic|oblique/.test(lower);
  let weight = "400";
  // Order matters: check longer/specific names first.
  if (/thin/.test(lower)) weight = "100";
  else if (/extralight|ultralight/.test(lower)) weight = "200";
  else if (/light/.test(lower)) weight = "300";
  else if (/medium/.test(lower)) weight = "500";
  else if (/semibold|demibold/.test(lower)) weight = "600";
  else if (/extrabold|ultrabold/.test(lower)) weight = "800";
  else if (/black|heavy/.test(lower)) weight = "900";
  else if (/super/.test(lower)) weight = "900"; // Obviously-Super maps to black
  else if (/bold/.test(lower)) weight = "700";

  // Special case: Arial — descriptor often empty; the regular face is 400/normal.
  // "ariblk" → 900, "arial_1" → still 400. Leave as-is.

  return {
    filename,
    family,
    weight,
    style: italic ? "italic" : "normal",
  };
}

/**
 * Result of attempting to register one font file. `registered: false` means
 * either the filename couldn't be parsed or `document.fonts` is unavailable
 * (test env). The error message is non-fatal; rendering falls back gracefully.
 */
export type FontLoadResult = {
  filename: string;
  parsed?: ParsedFontFilename;
  registered: boolean;
  error?: string;
};

/**
 * Load and register a set of font File objects. Returns one result per input
 * file. Safe to call in test environments — when `document.fonts` is
 * undefined every result is `{ registered: false }`.
 *
 * The caller is responsible for keeping the returned File blob URLs alive
 * for the session lifetime (FontFace holds an internal reference once
 * `load()` resolves, but blob URLs persist until explicitly revoked or the
 * page unloads).
 */
export async function loadW3DFontFiles(files: File[]): Promise<FontLoadResult[]> {
  const out: FontLoadResult[] = [];
  // `document.fonts` is the FontFaceSet. Absent in jsdom and old browsers.
  const fontSet = typeof document !== "undefined" ? document.fonts : undefined;

  for (const file of files) {
    const parsed = parseFontFilename(file.name);
    if (!parsed) {
      out.push({ filename: file.name, registered: false, error: "unrecognised extension" });
      continue;
    }
    if (!fontSet) {
      out.push({ filename: file.name, parsed, registered: false, error: "FontFace API unavailable" });
      continue;
    }
    try {
      const url = URL.createObjectURL(file);
      const face = new FontFace(parsed.family, `url(${url})`, {
        weight: parsed.weight,
        style: parsed.style,
      });
      await face.load();
      fontSet.add(face);
      out.push({ filename: file.name, parsed, registered: true });
    } catch (err) {
      out.push({
        filename: file.name,
        parsed,
        registered: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * Build a lookup map: "<family>|<weight>|<style>" → true when at least one
 * font face for that triple has been registered. The TextureText builder /
 * inspector can consult this to surface a per-FontStyle "loaded" status.
 */
export function buildLoadedFontIndex(results: FontLoadResult[]): Set<string> {
  const idx = new Set<string>();
  for (const r of results) {
    if (r.registered && r.parsed) {
      idx.add(`${r.parsed.family}|${r.parsed.weight}|${r.parsed.style}`);
    }
  }
  return idx;
}

/** Key used by `buildLoadedFontIndex`. Mirrors the lookup performed by callers. */
export function fontIndexKey(family: string, weight: string, style: string): string {
  return `${family}|${weight}|${style}`;
}

/**
 * Build human-readable warnings about font coverage for a scene. Pure helper so
 * it is unit-testable: given the font families the scene's FontStyles reference,
 * the families that were actually registered, and how many font files were
 * discovered, it returns guidance — including the "import the project root"
 * prompt when shared fonts (e.g. `_GRAPHICS/FONTS`) weren't part of the picked
 * folder. The browser cannot read sibling/parent folders from a single
 * scene-folder import, so this is the diagnose-and-prompt path.
 */
export function buildFontDiagnostics(opts: {
  sceneFamilies: string[];
  registeredFamilies: string[];
  discoveredCount: number;
}): string[] {
  const scene = Array.from(new Set(opts.sceneFamilies.map((f) => f.trim()).filter(Boolean)));
  if (scene.length === 0) return []; // scene uses no TextureText fonts
  const registeredLower = new Set(
    opts.registeredFamilies.map((f) => f.trim().toLowerCase()).filter(Boolean),
  );
  const missing = scene.filter((f) => !registeredLower.has(f.toLowerCase()));
  if (missing.length === 0) return [];
  const loaded = opts.registeredFamilies.length
    ? Array.from(new Set(opts.registeredFamilies)).join(", ")
    : "none";
  if (opts.discoveredCount === 0) {
    return [
      `No font files were discovered, so TextureText families [${scene.join(", ")}] ` +
        `fall back to system sans-serif. The real faces live in a /Fonts/ or _GRAPHICS/FONTS ` +
        `folder — import the PROJECT ROOT (e.g. 26PT_WTV_BASKETBALL) so shared fonts are ` +
        `included (the browser cannot read sibling folders from a single scene-folder import).`,
    ];
  }
  return [
    `Fonts not loaded for FontStyle families [${missing.join(", ")}] (loaded: ${loaded}). ` +
      `Those labels use fallback sans-serif. Missing faces should be under a /Fonts/ or ` +
      `_GRAPHICS/FONTS folder; import the project root to include them.`,
  ];
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}
