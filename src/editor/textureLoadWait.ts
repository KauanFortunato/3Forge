import { Texture, TextureLoader } from "three";

type TextureLoaderLoadFn = (
  this: TextureLoader,
  url: string,
  onLoad?: (texture: Texture) => void,
  onProgress?: (event: ProgressEvent) => void,
  onError?: (error: unknown) => void,
) => Texture;

/**
 * Runs `fn` while every `TextureLoader.prototype.load` call made during its
 * execution is tracked. Resolves with `fn`'s result only after all underlying
 * `<img>` decode callbacks (`onLoad`/`onError`) have fired. This is required
 * because `TextureLoader.load` returns synchronously with an empty `Texture`
 * (its `source.data === null`); the actual image is owned by `ImageLoader`
 * until its `load` event fires. Without awaiting those callbacks the
 * downstream `GLTFExporter` sees textures with no image data and fails with
 * "No valid image data found. Unable to process texture."
 *
 * The patched prototype is restored in `finally` so the global is never left
 * in a patched state — even if `fn` throws.
 */
export async function awaitTextureLoadsDuring<T>(fn: () => Promise<T> | T): Promise<T> {
  const originalLoad = TextureLoader.prototype.load as TextureLoaderLoadFn;
  const pending: Array<Promise<void>> = [];

  const patchedLoad: TextureLoaderLoadFn = function patchedLoad(
    this: TextureLoader,
    url: string,
    onLoad?: (texture: Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): Texture {
    let resolveWaiter!: () => void;
    let rejectWaiter!: (reason: unknown) => void;
    const waiter = new Promise<void>((resolve, reject) => {
      resolveWaiter = resolve;
      rejectWaiter = reject;
    });
    pending.push(waiter);

    const handleLoad = (texture: Texture): void => {
      try {
        if (onLoad) {
          onLoad(texture);
        }
      } finally {
        resolveWaiter();
      }
    };
    const handleError = (error: unknown): void => {
      try {
        if (onError) {
          onError(error);
        }
      } finally {
        const label = url || "anonymous";
        rejectWaiter(error instanceof Error ? error : new Error(`Texture image failed to decode: ${label}`));
      }
    };

    return originalLoad.call(this, url, handleLoad, onProgress, handleError);
  };

  (TextureLoader.prototype as unknown as { load: TextureLoaderLoadFn }).load = patchedLoad;

  try {
    const result = await fn();
    const settled = await Promise.allSettled(pending);
    for (const entry of settled) {
      if (entry.status === "rejected") {
        console.warn("Texture load failed; continuing.", entry.reason);
      }
    }
    return result;
  } finally {
    (TextureLoader.prototype as unknown as { load: TextureLoaderLoadFn }).load = originalLoad;
  }
}
