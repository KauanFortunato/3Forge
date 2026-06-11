// playgrounds/w3d-translation/src/fonts.test.ts
import { describe, expect, test } from "vitest";
import {
  buildFontDiagnostics,
  buildLoadedFontIndex,
  fontIndexKey,
  loadW3DFontFiles,
  parseFontBinaryMeta,
  parseFontFilename,
} from "./fonts";

/**
 * Minimal synthetic sfnt (TTF) with a `name` table and an `OS/2` table —
 * just enough structure for parseFontBinaryMeta. Strings are written as
 * platform 3 (Windows) UTF-16BE records, the common case in real fonts.
 */
function makeSfntFont(
  names: Record<number, string>,
  opts: { weightClass?: number; italic?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const ids = Object.keys(names).map(Number).sort((a, b) => a - b);
  const strings = ids.map((id) => {
    const bytes: number[] = [];
    for (const ch of names[id]) {
      const c = ch.charCodeAt(0);
      bytes.push(c >> 8, c & 0xff);
    }
    return { id, bytes };
  });
  const nameHeaderLen = 6 + strings.length * 12;
  const stringDataLen = strings.reduce((n, s) => n + s.bytes.length, 0);
  const nameLen = nameHeaderLen + stringDataLen;
  const os2Len = 64;

  const headerLen = 12 + 2 * 16; // sfnt header + 2 table records
  const os2Off = headerLen;
  const nameOff = os2Off + os2Len;
  const buf = new Uint8Array(nameOff + nameLen);
  const w16 = (o: number, v: number) => { buf[o] = v >> 8; buf[o + 1] = v & 0xff; };
  const w32 = (o: number, v: number) => { w16(o, v >>> 16); w16(o + 2, v & 0xffff); };
  const tag = (o: number, t: string) => { for (let i = 0; i < 4; i++) buf[o + i] = t.charCodeAt(i); };

  w32(0, 0x00010000); // TrueType magic
  w16(4, 2);          // numTables
  tag(12, "OS/2"); w32(12 + 8, os2Off); w32(12 + 12, os2Len);
  tag(28, "name"); w32(28 + 8, nameOff); w32(28 + 12, nameLen);

  w16(os2Off, 4); // OS/2 version
  w16(os2Off + 4, opts.weightClass ?? 400);
  w16(os2Off + 62, opts.italic ? 1 : 0); // fsSelection bit 0 = ITALIC

  w16(nameOff, 0);                   // name format
  w16(nameOff + 2, strings.length);  // count
  w16(nameOff + 4, nameHeaderLen);   // stringOffset
  let strCursor = 0;
  strings.forEach((s, i) => {
    const r = nameOff + 6 + i * 12;
    w16(r, 3);              // platformID Windows
    w16(r + 2, 1);          // encodingID Unicode BMP
    w16(r + 4, 0x0409);     // languageID en-US
    w16(r + 6, s.id);       // nameID
    w16(r + 8, s.bytes.length);
    w16(r + 10, strCursor);
    buf.set(s.bytes, nameOff + nameHeaderLen + strCursor);
    strCursor += s.bytes.length;
  });
  return buf;
}

describe("parseFontBinaryMeta — sfnt name table is the font identity", () => {
  test("typographic family/subfamily (nameID 16/17) win over legacy (1/2)", () => {
    const meta = parseFontBinaryMeta(makeSfntFont(
      { 1: "Foo Cond Black", 2: "Regular", 16: "Foo Cond", 17: "Black" },
      { weightClass: 900 },
    ));
    expect(meta?.family).toBe("Foo Cond");
    expect(meta?.subfamily).toBe("Black");
    expect(meta?.weightClass).toBe(900);
    expect(meta?.italic).toBe(false);
  });

  test("falls back to legacy nameID 1/2 when 16/17 are absent (e.g. arial.ttf)", () => {
    const meta = parseFontBinaryMeta(makeSfntFont({ 1: "Arial", 2: "Regular" }));
    expect(meta?.family).toBe("Arial");
    expect(meta?.subfamily).toBe("Regular");
  });

  test("fsSelection italic bit is surfaced", () => {
    const meta = parseFontBinaryMeta(makeSfntFont(
      { 16: "Foo", 17: "Thin Italic" },
      { weightClass: 250, italic: true },
    ));
    expect(meta?.italic).toBe(true);
    expect(meta?.weightClass).toBe(250);
  });

  test("non-sfnt bytes (wOFF magic / garbage) → undefined", () => {
    const woff = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0]); // "wOFF"
    expect(parseFontBinaryMeta(woff)).toBeUndefined();
    expect(parseFontBinaryMeta(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe("loadW3DFontFiles — name table overrides the filename heuristic", () => {
  test("misleading filename: family/weight/style come from the name table", async () => {
    // XML FontStyle matches the font's typographic names exactly (verified on
    // the corpus: FontName === nameID 16, Type === nameID 17), so the binary
    // identity must win over whatever the file happens to be called.
    const buf = makeSfntFont(
      { 1: "Foo Cond Black", 2: "Regular", 16: "Foo Cond", 17: "Black Italic" },
      { weightClass: 900, italic: true },
    );
    const file = new File([buf], "Whatever-Light.ttf");
    const [r] = await loadW3DFontFiles([file]);
    expect(r.parsed?.family).toBe("Foo Cond");
    expect(r.parsed?.weight).toBe("900");  // descriptor "Black Italic" → 900 (same mapping the builder uses)
    expect(r.parsed?.style).toBe("italic");
  });

  test("unparseable bytes keep the filename-derived meta", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "ObviouslyCond-Bold.ttf");
    const [r] = await loadW3DFontFiles([file]);
    expect(r.parsed?.family).toBe("Obviously Cond");
    expect(r.parsed?.weight).toBe("700");
  });
});

describe("parseFontFilename (Phase H3)", () => {
  test("Obviously-Regular.ttf → family 'Obviously', 400/normal", () => {
    expect(parseFontFilename("Obviously-Regular.ttf")).toEqual({
      filename: "Obviously-Regular.ttf",
      family: "Obviously",
      weight: "400",
      style: "normal",
    });
  });

  test("Obviously-Bold.otf → family 'Obviously', 700/normal", () => {
    expect(parseFontFilename("Obviously-Bold.otf")).toEqual({
      filename: "Obviously-Bold.otf",
      family: "Obviously",
      weight: "700",
      style: "normal",
    });
  });

  test("Obviously-LightItalic.ttf → 300/italic", () => {
    expect(parseFontFilename("Obviously-LightItalic.ttf")).toMatchObject({
      family: "Obviously",
      weight: "300",
      style: "italic",
    });
  });

  test("Obviously-Semibold.ttf → 600/normal", () => {
    expect(parseFontFilename("Obviously-Semibold.ttf")).toMatchObject({
      family: "Obviously",
      weight: "600",
    });
  });

  test("ObviouslyCond-BlackItalic.ttf → family 'Obviously Cond', 900/italic", () => {
    expect(parseFontFilename("ObviouslyCond-BlackItalic.ttf")).toEqual({
      filename: "ObviouslyCond-BlackItalic.ttf",
      family: "Obviously Cond",
      weight: "900",
      style: "italic",
    });
  });

  test("ObviouslyCond-ThinItalic.ttf → 100/italic", () => {
    expect(parseFontFilename("ObviouslyCond-ThinItalic.ttf")).toMatchObject({
      family: "Obviously Cond",
      weight: "100",
      style: "italic",
    });
  });

  test("ObviouslyWide-SemiBold.ttf → family 'Obviously Wide', 600/normal", () => {
    expect(parseFontFilename("ObviouslyWide-SemiBold.ttf")).toEqual({
      filename: "ObviouslyWide-SemiBold.ttf",
      family: "Obviously Wide",
      weight: "600",
      style: "normal",
    });
  });

  test("ObviouslyDemo-CondensedBoldItalic.otf → family 'Obviously Demo', 700/italic", () => {
    expect(parseFontFilename("ObviouslyDemo-CondensedBoldItalic.otf")).toMatchObject({
      family: "Obviously Demo",
      weight: "700",
      style: "italic",
    });
  });

  test("Obviously-Super.otf → 900/normal (Super maps to Black)", () => {
    expect(parseFontFilename("Obviously-Super.otf")).toMatchObject({
      family: "Obviously",
      weight: "900",
    });
  });

  test("BarlowCondensed-ExtraBold.ttf → family 'Barlow Condensed', 800/normal", () => {
    expect(parseFontFilename("BarlowCondensed-ExtraBold.ttf")).toEqual({
      filename: "BarlowCondensed-ExtraBold.ttf",
      family: "Barlow Condensed",
      weight: "800",
      style: "normal",
    });
  });

  test("arial.ttf → family 'arial', 400/normal", () => {
    expect(parseFontFilename("arial.ttf")).toMatchObject({
      family: "arial",
      weight: "400",
      style: "normal",
    });
  });

  test("ObviouslyCond preferred over Obviously prefix (longer match wins)", () => {
    // Regression: short prefix must not capture before long prefix.
    expect(parseFontFilename("ObviouslyCond-Light.ttf")?.family).toBe("Obviously Cond");
    expect(parseFontFilename("ObviouslyWide-SemiBold.ttf")?.family).toBe("Obviously Wide");
    expect(parseFontFilename("ObviouslyDemo-Condensed.otf")?.family).toBe("Obviously Demo");
  });

  test("Unknown extension returns undefined", () => {
    expect(parseFontFilename("foo.png")).toBeUndefined();
    expect(parseFontFilename("readme.txt")).toBeUndefined();
  });

  test("woff / woff2 are accepted", () => {
    expect(parseFontFilename("Obviously-Bold.woff")?.weight).toBe("700");
    expect(parseFontFilename("Obviously-Bold.woff2")?.weight).toBe("700");
  });
});

describe("buildLoadedFontIndex + fontIndexKey (Phase H3)", () => {
  test("indexes only registered faces", () => {
    const idx = buildLoadedFontIndex([
      {
        filename: "Obviously-Bold.ttf",
        parsed: { filename: "Obviously-Bold.ttf", family: "Obviously", weight: "700", style: "normal" },
        registered: true,
      },
      {
        filename: "ObviouslyCond-Black.ttf",
        parsed: { filename: "ObviouslyCond-Black.ttf", family: "Obviously Cond", weight: "900", style: "normal" },
        registered: false,
        error: "load failed",
      },
    ]);
    expect(idx.has(fontIndexKey("Obviously", "700", "normal"))).toBe(true);
    expect(idx.has(fontIndexKey("Obviously Cond", "900", "normal"))).toBe(false);
  });

  test("fontIndexKey is the same shape the builder uses", () => {
    expect(fontIndexKey("Obviously Cond", "300", "italic")).toBe("Obviously Cond|300|italic");
  });
});

describe("loadW3DFontFiles (Phase H3)", () => {
  test("no-ops gracefully in jsdom (FontFace API often unavailable)", async () => {
    // We don't assume jsdom either has or doesn't have FontFace; we just
    // assert that the call resolves and returns one result per input file
    // without throwing.
    const f1 = new File([new Uint8Array([0])], "Obviously-Bold.ttf");
    const f2 = new File([new Uint8Array([0])], "Unknown.xyz");
    const results = await loadW3DFontFiles([f1, f2]);
    expect(results).toHaveLength(2);
    // Whatever the environment, we MUST get a parsed entry for the .ttf
    // and an unrecognised-extension result for the .xyz.
    expect(results[0].filename).toBe("Obviously-Bold.ttf");
    expect(results[0].parsed?.family).toBe("Obviously");
    expect(results[1].filename).toBe("Unknown.xyz");
    expect(results[1].parsed).toBeUndefined();
    expect(results[1].registered).toBe(false);
  });

  test("empty input returns empty array", async () => {
    expect(await loadW3DFontFiles([])).toEqual([]);
  });
});

describe("buildFontDiagnostics", () => {
  test("no warning when every scene family is registered", () => {
    expect(
      buildFontDiagnostics({
        sceneFamilies: ["Obviously Cond", "Obviously"],
        registeredFamilies: ["Obviously", "Obviously Cond"],
        discoveredCount: 12,
      }),
    ).toEqual([]);
  });

  test("no warning when the scene uses no fonts", () => {
    expect(
      buildFontDiagnostics({ sceneFamilies: [], registeredFamilies: [], discoveredCount: 0 }),
    ).toEqual([]);
  });

  test("0 discovered → prompts to import the project root and names families", () => {
    const [msg] = buildFontDiagnostics({
      sceneFamilies: ["Obviously Cond", "Obviously"],
      registeredFamilies: [],
      discoveredCount: 0,
    });
    expect(msg).toMatch(/Obviously Cond/);
    expect(msg).toMatch(/PROJECT ROOT/i);
    expect(msg).toMatch(/_GRAPHICS\/FONTS/);
  });

  test("partial coverage → names the missing family and what is loaded", () => {
    const [msg] = buildFontDiagnostics({
      sceneFamilies: ["Obviously Cond", "Obviously"],
      registeredFamilies: ["Obviously"],
      discoveredCount: 4,
    });
    expect(msg).toMatch(/Obviously Cond/);
    expect(msg).toMatch(/loaded: Obviously/);
  });

  test("family matching is case-insensitive", () => {
    expect(
      buildFontDiagnostics({
        sceneFamilies: ["Obviously Cond"],
        registeredFamilies: ["obviously cond"],
        discoveredCount: 2,
      }),
    ).toEqual([]);
  });
});
