import { describe, expect, it } from "vitest";
import { createDefaultFontAsset, getAvailableFonts, getFontData, normalizeFontLibrary } from "./fonts";

describe("font helpers", () => {
  it("exposes the default builtin font", () => {
    const font = createDefaultFontAsset();

    expect(font.source).toBe("builtin");
    expect(font.id).toMatch(/^builtin-/);
    expect(font.name.length).toBeGreaterThan(0);
    expect(getFontData(font)).toContain("\"glyphs\"");
  });

  it("combines builtin fonts with custom fonts and deduplicates by payload", () => {
    const defaultFont = createDefaultFontAsset();
    const customFonts = normalizeFontLibrary([
      {
        id: "custom-font",
        name: "Custom Font",
        source: "imported",
        data: getFontData(defaultFont),
      },
      {
        id: "custom-font-2",
        name: "Custom Font 2",
        source: "imported",
        data: JSON.stringify({
          glyphs: {},
          familyName: "Custom Font 2",
        }),
      },
    ]);

    expect(customFonts).toHaveLength(1);
    expect(customFonts[0]?.id).toBe("custom-font-2");
    expect(getAvailableFonts(customFonts).length).toBeGreaterThan(customFonts.length);
  });
});
