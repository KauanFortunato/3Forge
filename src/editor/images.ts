import type { ImageAsset } from "./types";

export const EMPTY_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9erVkAAAAASUVORK5CYII=";

export function createTransparentImageAsset(): ImageAsset {
  return {
    name: "Transparent PNG",
    mimeType: "image/png",
    src: EMPTY_IMAGE_DATA_URL,
    width: 1,
    height: 1,
  };
}

export async function imageFileToAsset(file: File): Promise<ImageAsset> {
  const src = await readFileAsDataUrl(file);
  const dimensions = await readImageDimensions(src);

  return {
    name: file.name || "Image",
    mimeType: file.type || inferMimeType(file.name),
    src,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export function fitImageToMaxSize(width: number, height: number, maxSize = 2): { width: number; height: number } {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const aspect = safeWidth / safeHeight;

  if (aspect >= 1) {
    return {
      width: maxSize,
      height: Number((maxSize / aspect).toFixed(4)),
    };
  }

  return {
    width: Number((maxSize * aspect).toFixed(4)),
    height: maxSize,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image file."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid image file result."));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width || 1,
        height: image.naturalHeight || image.height || 1,
      });
    };
    image.onerror = () => reject(new Error("Failed to decode image."));
    image.src = src;
  });
}

function inferMimeType(fileName: string): string {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
