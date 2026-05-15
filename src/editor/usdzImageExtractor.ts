import JSZip from "jszip";

import type { ImageAsset } from "./types";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return "application/octet-stream";
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

async function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  if (typeof Image === "undefined") return { width: 0, height: 0 };
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

/**
 * Extract embedded images from a USDZ archive (which is a ZIP). Used to surface
 * model textures as standalone ImageAssets in the editor's assets panel —
 * independent of whether the OpenUSD parser successfully bound them onto the
 * mesh materials. Failures here must not abort the model import.
 */
export async function extractUsdzImages(buffer: ArrayBuffer): Promise<ImageAsset[]> {
  const zip = await JSZip.loadAsync(buffer);
  const images: ImageAsset[] = [];

  const entries = Object.entries(zip.files).filter(([path, entry]) => !entry.dir && IMAGE_EXTENSIONS.test(path));
  for (const [path, entry] of entries) {
    try {
      const bytes = await entry.async("uint8array");
      const mimeType = mimeFromName(path);
      const dataUrl = bytesToDataUrl(bytes, mimeType);
      const { width, height } = await readImageDimensions(dataUrl);
      const name = path.split("/").pop() || path;
      images.push({ name, mimeType, src: dataUrl, width, height });
    } catch (err) {
      console.warn(`extractUsdzImages: skipping "${path}":`, err);
    }
  }

  return images;
}
