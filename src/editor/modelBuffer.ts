import { decodeDataUrl } from "./exportPackage";

const USDC_MAGIC = new Uint8Array([0x50, 0x58, 0x52, 0x2D, 0x55, 0x53, 0x44, 0x43]);

/**
 * Scans the first 4 KB of `bytes` for the `PXR-USDC` magic header used inside
 * USDZ archives that contain a binary USDC payload. Returns true when found.
 */
export function containsUsdcMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - USDC_MAGIC.length, 4096);
  for (let index = 0; index <= limit; index += 1) {
    let match = true;
    for (let offset = 0; offset < USDC_MAGIC.length; offset += 1) {
      if (bytes[index + offset] !== USDC_MAGIC[offset]) {
        match = false;
        break;
      }
    }
    if (match) {
      return true;
    }
  }
  return false;
}

/**
 * Decodes a `data:` URL into raw bytes, returning `null` when the input is not
 * a data URL or cannot be decoded. Use this in code paths that need to inspect
 * binary payloads before deciding which loader to invoke.
 */
export function tryDecodeDataUrl(value: string): Uint8Array | null {
  if (!value.startsWith("data:")) {
    return null;
  }
  try {
    return decodeDataUrl(value);
  } catch (error) {
    console.warn("Failed to decode data URL:", error);
    return null;
  }
}
