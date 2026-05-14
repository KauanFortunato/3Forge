import { Loader, LoadingManager } from "three";

export interface TinyUSDZLoaderInitOptions {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (file: string) => string;
  useZstdCompressedWasm?: boolean;
}

export class TinyUSDZLoader extends Loader {
  constructor(manager?: LoadingManager);
  native_: unknown;
  init(options?: TinyUSDZLoaderInitOptions): Promise<this>;
  parse(
    binary: Uint8Array | ArrayBuffer,
    filePath: string,
    onLoad: (usdScene: unknown) => void,
    onError?: (error: unknown) => void,
  ): void;
}

export class FetchAssetResolver {
  constructor();
  resolveAsync(uri: string): Promise<[string, ArrayBuffer]>;
  getAsset(uri: string): ArrayBuffer | null;
  hasAsset(uri: string): boolean;
  setAsset(uri: string, data: ArrayBuffer): void;
  clearCache(): void;
}
