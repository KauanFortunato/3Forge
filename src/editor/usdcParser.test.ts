import { afterEach, describe, expect, it, vi } from "vitest";

import { __setUsdSceneFactoryForTests, extractUsdcImages } from "./usdcParser";

interface FakeImage {
  uri?: string;
  bufferId?: number;
  decoded?: boolean;
  data?: Uint8Array;
  width?: number;
  height?: number;
  channels?: number;
}

interface FakeUsdScene {
  numMeshes: () => number;
  getMesh: (index: number) => { materialId: number } | null;
  getMaterial: (id: number) => Record<string, number> | null;
  getTexture: (id: number) => { textureImageId: number } | null;
  getImage: (id: number) => FakeImage | null;
}

// jsdom does not implement canvas getContext(), so the decoded -> PNG path is
// unreachable in tests. We use the non-decoded code path (which only needs to
// base64-encode the bytes) to exercise the iteration/dedupe/naming logic. The
// fake bytes start with the PNG magic header so MIME sniffing returns PNG.
const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
]);

function singlePixelDecodedImage(uri: string): FakeImage {
  return {
    uri,
    bufferId: 0,
    decoded: false,
    data: PNG_HEADER,
    width: 1,
    height: 1,
    channels: 4,
  };
}

describe("extractUsdcImages", () => {
  afterEach(() => {
    __setUsdSceneFactoryForTests(null);
  });

  it("returns one ExtractedUsdcImage per unique referenced texture image", async () => {
    const image = singlePixelDecodedImage("0/test_base.png");
    const scene: FakeUsdScene = {
      numMeshes: () => 1,
      getMesh: (index) => (index === 0 ? { materialId: 0 } : null),
      getMaterial: (id) => (id === 0 ? { diffuseColorTextureId: 0 } : null),
      getTexture: (id) => (id === 0 ? { textureImageId: 0 } : null),
      getImage: (id) => (id === 0 ? image : null),
    };
    __setUsdSceneFactoryForTests(() => scene);

    const result = await extractUsdcImages(new ArrayBuffer(8));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test_base.png");
    expect(result[0].width).toBe(1);
    expect(result[0].height).toBe(1);
    expect(result[0].mimeType).toBe("image/png");
    // In jsdom without canvas support the helper may return no src; tolerate
    // both cases — content is verified separately when canvas is available.
    if (result[0].src) {
      expect(result[0].src.startsWith("data:image/png")).toBe(true);
    }
  });

  it("dedupes textures referenced from multiple materials and slots", async () => {
    const sharedImage = singlePixelDecodedImage("0/shared.png");
    const scene: FakeUsdScene = {
      numMeshes: () => 2,
      // Two meshes -> two distinct materials -> both reference image 0
      // via different texture slots (one through textureId 0, one through 1).
      getMesh: (index) => {
        if (index === 0) return { materialId: 0 };
        if (index === 1) return { materialId: 1 };
        return null;
      },
      getMaterial: (id): Record<string, number> | null => {
        if (id === 0) return { diffuseColorTextureId: 0, normalTextureId: 1 };
        if (id === 1) return { diffuseColorTextureId: 0 };
        return null;
      },
      // Both texture ids point at the same image.
      getTexture: (id) => {
        if (id === 0 || id === 1) return { textureImageId: 0 };
        return null;
      },
      getImage: (id) => (id === 0 ? sharedImage : null),
    };
    __setUsdSceneFactoryForTests(() => scene);

    const result = await extractUsdcImages(new ArrayBuffer(8));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("shared.png");
  });

  it("skips texture slots whose value is -1", async () => {
    const image = singlePixelDecodedImage("0/diffuse.png");
    const scene: FakeUsdScene = {
      numMeshes: () => 1,
      getMesh: () => ({ materialId: 0 }),
      getMaterial: () => ({
        diffuseColorTextureId: 0,
        normalTextureId: -1,
        roughnessTextureId: -1,
      }),
      getTexture: (id) => (id === 0 ? { textureImageId: 0 } : null),
      getImage: (id) => (id === 0 ? image : null),
    };
    __setUsdSceneFactoryForTests(() => scene);

    const result = await extractUsdcImages(new ArrayBuffer(8));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("diffuse.png");
  });

  it("falls back to texture_<id>.png when uri is missing", async () => {
    const image: FakeImage = {
      uri: "",
      decoded: false,
      data: PNG_HEADER,
      width: 1,
      height: 1,
      channels: 4,
    };
    const scene: FakeUsdScene = {
      numMeshes: () => 1,
      getMesh: () => ({ materialId: 0 }),
      getMaterial: () => ({ diffuseColorTextureId: 0 }),
      getTexture: () => ({ textureImageId: 7 }),
      getImage: (id) => (id === 7 ? image : null),
    };
    __setUsdSceneFactoryForTests(() => scene);

    const result = await extractUsdcImages(new ArrayBuffer(8));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("texture_7.png");
  });

  it("passes through non-decoded image bytes as a data URL (PNG sniffed)", async () => {
    // PNG magic header + a few filler bytes — enough to sniff as PNG.
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    ]);
    const image: FakeImage = {
      uri: "0/encoded.png",
      decoded: false,
      data: pngBytes,
      width: 4,
      height: 4,
      channels: 4,
    };
    const scene: FakeUsdScene = {
      numMeshes: () => 1,
      getMesh: () => ({ materialId: 0 }),
      getMaterial: () => ({ diffuseColorTextureId: 0 }),
      getTexture: () => ({ textureImageId: 0 }),
      getImage: () => image,
    };
    __setUsdSceneFactoryForTests(() => scene);

    const result = await extractUsdcImages(new ArrayBuffer(8));

    expect(result).toHaveLength(1);
    expect(result[0].mimeType).toBe("image/png");
    expect(result[0].src.startsWith("data:image/png;base64,")).toBe(true);
    expect(result[0].width).toBe(4);
    expect(result[0].height).toBe(4);
  });

  it("returns empty when the scene has no meshes", async () => {
    const scene: FakeUsdScene = {
      numMeshes: () => 0,
      getMesh: () => null,
      getMaterial: () => null,
      getTexture: () => null,
      getImage: () => null,
    };
    __setUsdSceneFactoryForTests(() => scene);

    const result = await extractUsdcImages(new ArrayBuffer(8));

    expect(result).toEqual([]);
  });

  it("does not throw when getTexture returns null for a slot", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const scene: FakeUsdScene = {
        numMeshes: () => 1,
        getMesh: () => ({ materialId: 0 }),
        getMaterial: () => ({ diffuseColorTextureId: 0 }),
        getTexture: () => null,
        getImage: () => null,
      };
      __setUsdSceneFactoryForTests(() => scene);

      const result = await extractUsdcImages(new ArrayBuffer(8));
      expect(result).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
