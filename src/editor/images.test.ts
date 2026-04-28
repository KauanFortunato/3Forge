import { describe, expect, it } from "vitest";
import { createTransparentImageAsset, EMPTY_IMAGE_DATA_URL, fitImageToMaxSize, normalizeImageLibrary } from "./images";

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

  it("normalizes image libraries and assigns missing or duplicate ids", () => {
    expect(normalizeImageLibrary([
      {
        name: "Poster.png",
        mimeType: "image/png",
        src: "data:image/png;base64,cG9zdGVy",
        width: 640,
        height: 320,
      },
      {
        id: "shared",
        name: "Shared.png",
        mimeType: "image/png",
        src: "data:image/png;base64,c2hhcmVk",
        width: 100,
        height: 50,
      },
      {
        id: "shared",
        name: "Shared Copy.png",
        mimeType: "image/png",
        src: "data:image/png;base64,Y29weQ==",
        width: 200,
        height: 100,
      },
    ])).toMatchObject([
      { id: "image-poster-png", name: "Poster.png" },
      { id: "shared", name: "Shared.png" },
      { id: "shared-2", name: "Shared Copy.png" },
    ]);
  });
});
