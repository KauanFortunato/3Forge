import type { HdrAsset } from "./types";

export const MAX_HDR_FILE_SIZE_BYTES = 32 * 1024 * 1024;
export const MAX_HDR_FILE_SIZE_LABEL = "32 MB";
export const HDR_FILE_TOO_LARGE_MESSAGE = `HDR is too large. Maximum supported size is ${MAX_HDR_FILE_SIZE_LABEL}.`;
export const HDR_MIME_TYPE = "image/vnd.radiance";

export function isHdrFile(file: File): boolean {
  return /\.hdr$/i.test(file.name)
    || file.type === HDR_MIME_TYPE
    || (file.type === "application/octet-stream" && /\.hdr$/i.test(file.name));
}

export async function hdrFileToAsset(file: File): Promise<HdrAsset> {
  if (!isHdrFile(file)) {
    throw new Error("Unsupported HDR file. Use a .hdr file.");
  }

  if (file.size > MAX_HDR_FILE_SIZE_BYTES) {
    throw new Error(HDR_FILE_TOO_LARGE_MESSAGE);
  }

  const src = await readFileAsDataUrl(file);

  return {
    id: "",
    name: file.name || "Environment.hdr",
    mimeType: file.type || HDR_MIME_TYPE,
    src,
    originalFileName: file.name || undefined,
    source: "imported",
  };
}

export function normalizeHdrAsset(value: unknown, fallback: HdrAsset = createFallbackHdrAsset()): HdrAsset {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : fallback.id;
  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : fallback.name;
  const mimeType = typeof source.mimeType === "string" && source.mimeType.trim() ? source.mimeType.trim() : fallback.mimeType;
  const src = typeof source.src === "string" && source.src.trim() ? source.src : fallback.src;
  const originalFileName = typeof source.originalFileName === "string" && source.originalFileName.trim()
    ? source.originalFileName.trim()
    : undefined;
  const assetSource = source.source === "external" ? "external" : source.source === "imported" ? "imported" : undefined;

  return {
    id,
    name,
    mimeType,
    src,
    ...(originalFileName ? { originalFileName } : {}),
    ...(assetSource ? { source: assetSource } : {}),
  };
}

export function normalizeHdrLibrary(value: unknown): HdrAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: HdrAsset[] = [];
  const usedIds = new Set<string>();

  for (const entry of value) {
    const asset = normalizeHdrAsset(entry);
    const proposedId = asset.id.trim() || toHdrAssetId(asset.name || "hdr", result.length + 1);
    let id = proposedId;
    let counter = 2;
    while (usedIds.has(id)) {
      id = `${proposedId}-${counter}`;
      counter += 1;
    }

    asset.id = id;
    usedIds.add(id);
    result.push(asset);
  }

  return result;
}

function createFallbackHdrAsset(): HdrAsset {
  return {
    id: "",
    name: "Environment.hdr",
    mimeType: HDR_MIME_TYPE,
    src: "",
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read HDR file."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid HDR file result."));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

function toHdrAssetId(name: string, fallbackIndex: number): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `hdr-${normalized}` : `hdr-${fallbackIndex}`;
}
