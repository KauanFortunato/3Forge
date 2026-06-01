// playgrounds/w3d-translation/src/fonts.test.ts
import { describe, expect, test } from "vitest";
import {
  buildFontDiagnostics,
  buildLoadedFontIndex,
  fontIndexKey,
  loadW3DFontFiles,
  parseFontFilename,
} from "./fonts";

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
