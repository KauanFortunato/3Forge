import { describe, expect, it } from "vitest";
import { createTransparentImageAsset, EMPTY_IMAGE_DATA_URL, fitImageToMaxSize } from "./images";

describe("image helpers", () => {
  it("creates the transparent placeholder asset", () => {
    expect(createTransparentImageAsset()).toEqual({
      name: "Transparent PNG",
      mimeType: "image/png",
      src: EMPTY_IMAGE_DATA_URL,
      width: 1,
      height: 1,
    });
  });

  it("fits image dimensions into the requested box", () => {
    expect(fitImageToMaxSize(400, 200, 2)).toEqual({
      width: 2,
      height: 1,
    });
    expect(fitImageToMaxSize(200, 400, 2)).toEqual({
      width: 1,
      height: 2,
    });
    expect(fitImageToMaxSize(0, 0, 3)).toEqual({
      width: 3,
      height: 3,
    });
  });
});
