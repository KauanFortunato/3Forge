import { describe, expect, it } from "vitest";
import { HDR_FILE_TOO_LARGE_MESSAGE, MAX_HDR_FILE_SIZE_BYTES, hdrFileToAsset, isHdrFile } from "./hdr";

describe("HDR file imports", () => {
  it("accepts HDR files by extension or MIME type", () => {
    expect(isHdrFile(new File(["hdr"], "studio.hdr", { type: "" }))).toBe(true);
    expect(isHdrFile(new File(["hdr"], "studio.bin", { type: "image/vnd.radiance" }))).toBe(true);
    expect(isHdrFile(new File(["png"], "studio.png", { type: "image/png" }))).toBe(false);
  });

  it("converts an HDR file to serializable asset metadata", async () => {
    const asset = await hdrFileToAsset(new File(["#?RADIANCE"], "Studio.hdr", { type: "image/vnd.radiance" }));

    expect(asset).toMatchObject({
      id: "",
      name: "Studio.hdr",
      mimeType: "image/vnd.radiance",
      originalFileName: "Studio.hdr",
      source: "imported",
    });
    expect(asset.src).toMatch(/^data:image\/vnd\.radiance;base64,/);
  });

  it("rejects oversized HDR files", async () => {
    const oversizedHdr = new File([new Uint8Array(MAX_HDR_FILE_SIZE_BYTES + 1)], "oversized.hdr", {
      type: "image/vnd.radiance",
    });

    await expect(hdrFileToAsset(oversizedHdr))
      .rejects
      .toThrow(HDR_FILE_TOO_LARGE_MESSAGE);
  });
});
