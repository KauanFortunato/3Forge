/**
 * Source-side hashing helpers used to give MOV-converted sequences a
 * stable, content-addressed folder name and to detect "we already
 * converted this exact file" on re-import. The full digest is stored
 * inside `sequence.json` (`sourceHash`); the folder name only includes
 * the first 8 hex chars for readability.
 *
 * Implementation note: this module is browser-only (it uses
 * `crypto.subtle.digest`). Node ≥ 18 exposes the same WebCrypto API,
 * so the helpers also run inside `vitest` (jsdom) without an extra
 * shim. We avoid pulling in a heavy crypto dep — a single algorithm
 * with a stable output is all this pipeline needs.
 */

const SHA256_PREFIX = "sha256:";

interface SubtleLike {
  digest(algorithm: string, data: ArrayBuffer | Uint8Array): Promise<ArrayBuffer>;
}

interface CryptoLike {
  subtle?: SubtleLike;
}

function resolveSubtle(crypto: CryptoLike | undefined = globalThis.crypto as CryptoLike | undefined): SubtleLike {
  const subtle = crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new Error("WebCrypto subtle.digest is not available in this environment.");
  }
  return subtle;
}

/**
 * Compute the sha256 of the source bytes and return it in the canonical
 * `sha256:<hex>` form that goes into `sequence.json.sourceHash`.
 *
 * The function intentionally accepts either an `ArrayBuffer` (typical for
 * `File.arrayBuffer()`) or a `Uint8Array` (typical for test fixtures /
 * synthetic inputs) so callers don't have to copy.
 */
export async function computeSequenceSourceHash(
  bytes: ArrayBuffer | Uint8Array,
  options: { crypto?: CryptoLike } = {},
): Promise<string> {
  const subtle = resolveSubtle(options.crypto);
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await subtle.digest("SHA-256", buffer);
  return `${SHA256_PREFIX}${toHex(new Uint8Array(digest))}`;
}

/**
 * Short, human-readable suffix used in the on-disk folder name. We use
 * the first 8 hex chars of the sha256 — collision-free in practice for
 * the handful of videos a single project carries, and short enough that
 * `<video-name>_sequence_<hash8>` stays under typical Windows path
 * limits even after the `Resources/Textures/` prefix.
 */
export function shortHashFromSourceHash(fullHash: string): string {
  if (!fullHash.startsWith(SHA256_PREFIX)) {
    throw new Error(`Expected a "${SHA256_PREFIX}..." hash, got ${JSON.stringify(fullHash)}`);
  }
  const hex = fullHash.slice(SHA256_PREFIX.length);
  if (!/^[0-9a-fA-F]{8,}$/.test(hex)) {
    throw new Error(`Source hash has too few hex chars: ${JSON.stringify(fullHash)}`);
  }
  return hex.slice(0, 8).toLowerCase();
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte < 0x10) out += "0";
    out += byte.toString(16);
  }
  return out;
}
