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
// the FontFace API.
//
// Identity comes from the font FILE itself: the sfnt `name` table's
// typographic family (nameID 16, falling back to legacy nameID 1) matches the
// XML `FontStyle.FontName` EXACTLY, and the typographic subfamily (17 → 2)
// matches `FontStyle.Type` (verified across the corpus: "Obviously Cond" /
// "Black", "Obviously Wide" / "SemiBold", …). Weight/style are derived from
// that subfamily string with the same keyword mapping the builder applies to
// `Type`, so registration and canvas lookup always agree. The filename
// heuristic remains only as a fallback for unparseable containers (woff/woff2
// compress their tables) or corrupt files.
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

  // Strip leading "-" then map the remaining descriptor.
  // Examples for `rest`:
  //   ""                   → Regular
  //   "-Regular"           → Regular
  //   "-Bold"              → Bold
  //   "-BlackItalic"       → Black + Italic
  //   "-CondensedBlackItalic" → Condensed + Black + Italic
  //   "-SemiBoldItalic"    → SemiBold + Italic
  const descriptor = rest.replace(/^[-_\s]+/, "");
  const { weight, style } = descriptorToCss(descriptor);

  // Special case: Arial — descriptor often empty; the regular face is 400/normal.
  // "ariblk" → 900, "arial_1" → still 400. Leave as-is.

  return { filename, family, weight, style };
}

/**
 * Map a style descriptor ("Black Italic", "SemiBold", "ThinItalic", …) to CSS
 * weight/style. The SINGLE authority for this keyword convention — used for
 * the filename descriptor, the name-table subfamily, the builder's
 * `FontStyle.Type` mapping and the diag harness — so a registered face is
 * always found under exactly the key the canvas asks for.
 */
export function descriptorToCss(descriptor: string): { weight: string; style: string } {
  const lower = descriptor.toLowerCase();
  const italic = /italic|oblique/.test(lower);
  let weight = "400";
  // Order matters: check longer/specific names first ("semibold" before "bold",
  // "ultralight" before "light").
  if (/thin/.test(lower)) weight = "100";
  else if (/extralight|ultralight/.test(lower)) weight = "200";
  else if (/light/.test(lower)) weight = "300";
  else if (/medium/.test(lower)) weight = "500";
  else if (/semi|demibold/.test(lower)) weight = "600";
  else if (/extrabold|ultrabold/.test(lower)) weight = "800";
  else if (/black|heavy/.test(lower)) weight = "900";
  else if (/super/.test(lower)) weight = "900"; // Obviously-Super maps to black
  else if (/bold/.test(lower)) weight = "700";
  return { weight, style: italic ? "italic" : "normal" };
}

/** Identity read from the sfnt binary itself (see module header). */
export type FontBinaryMeta = {
  /** Typographic family (nameID 16) or legacy family (nameID 1). */
  family?: string;
  /** Typographic subfamily (nameID 17) or legacy subfamily (nameID 2). */
  subfamily?: string;
  /** OS/2 usWeightClass (1–1000) when present. */
  weightClass?: number;
  /** OS/2 fsSelection bit 0 (ITALIC) when present. */
  italic?: boolean;
};

/**
 * Parse the `name` and `OS/2` tables out of a raw sfnt (TTF / CFF-OTF) file.
 * Returns undefined for non-sfnt containers (woff/woff2 compress their
 * tables) and for anything that fails bounds checks — callers fall back to
 * the filename heuristic. Pure binary reader, no DOM.
 */
export function parseFontBinaryMeta(bytes: Uint8Array): FontBinaryMeta | undefined {
  try {
    const u16 = (o: number): number => (bytes[o] << 8) | bytes[o + 1];
    const u32 = (o: number): number =>
      (((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0);
    if (bytes.length < 12) return undefined;
    const magic = u32(0);
    // 0x00010000 = TrueType, "OTTO" = CFF OpenType, "true" = legacy Apple TTF.
    if (magic !== 0x00010000 && magic !== 0x4f54544f && magic !== 0x74727565) return undefined;

    const numTables = u16(4);
    let nameOff = 0, nameLen = 0, os2Off = 0, os2Len = 0;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (rec + 16 > bytes.length) return undefined;
      const tag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
      if (tag === "name") { nameOff = u32(rec + 8); nameLen = u32(rec + 12); }
      if (tag === "OS/2") { os2Off = u32(rec + 8); os2Len = u32(rec + 12); }
    }

    const out: FontBinaryMeta = {};
    if (os2Off && os2Off + 6 <= bytes.length) {
      const wc = u16(os2Off + 4);
      if (wc >= 1 && wc <= 1000) out.weightClass = wc;
      if (os2Len >= 64 && os2Off + 64 <= bytes.length) {
        out.italic = (u16(os2Off + 62) & 1) === 1;
      }
    }

    if (nameOff && nameOff + 6 <= bytes.length) {
      const count = u16(nameOff + 2);
      const strBase = nameOff + u16(nameOff + 4);
      // Prefer Windows en-US (3/0x0409) — fonts ship LOCALIZED records (e.g.
      // arial.ttf's subfamily is "Normal" in Catalan, "Κανονικά" in Greek) and
      // the en-US one is what matches the XML. Then any Windows language, then
      // Unicode (0), then Mac (1). Platforms 3 and 0 store UTF-16BE, Mac
      // stores single-byte.
      const best = new Map<number, { rank: number; value: string }>();
      for (let i = 0; i < count; i++) {
        const r = nameOff + 6 + i * 12;
        if (r + 12 > bytes.length) break;
        const platform = u16(r);
        const language = u16(r + 4);
        const nameId = u16(r + 6);
        if (nameId !== 1 && nameId !== 2 && nameId !== 16 && nameId !== 17) continue;
        const rank =
          platform === 3 ? (language === 0x0409 ? 0 : 1)
            : platform === 0 ? 2
              : platform === 1 ? 3
                : 4;
        if (rank === 4) continue;
        const prev = best.get(nameId);
        if (prev && prev.rank <= rank) continue;
        const len = u16(r + 8);
        const off = strBase + u16(r + 10);
        if (off + len > bytes.length || (nameLen && off + len > nameOff + nameLen)) continue;
        let s = "";
        if (platform === 1) {
          for (let j = 0; j < len; j++) s += String.fromCharCode(bytes[off + j]);
        } else {
          for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(u16(off + j));
        }
        if (s) best.set(nameId, { rank, value: s });
      }
      out.family = best.get(16)?.value ?? best.get(1)?.value;
      out.subfamily = best.get(17)?.value ?? best.get(2)?.value;
    }

    return out.family || out.subfamily || out.weightClass !== undefined ? out : undefined;
  } catch {
    return undefined;
  }
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
    let parsed = parseFontFilename(file.name);
    if (!parsed) {
      out.push({ filename: file.name, registered: false, error: "unrecognised extension" });
      continue;
    }
    // The binary name table is the authoritative identity (matches the XML
    // FontStyle exactly — see module header); the filename parse above is the
    // fallback when the container can't be read (woff/woff2, corrupt file,
    // or an environment without Blob.arrayBuffer).
    let bin: FontBinaryMeta | undefined;
    try {
      bin = parseFontBinaryMeta(new Uint8Array(await file.arrayBuffer()));
    } catch {
      bin = undefined;
    }
    if (bin?.family) {
      const css = descriptorToCss(bin.subfamily ?? "");
      parsed = {
        filename: file.name,
        family: bin.family,
        weight: css.weight,
        style: bin.italic || css.style === "italic" ? "italic" : "normal",
      };
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
