import { decodeDataUrl } from "./exportPackage";

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
