declare const initTinyUSDZNative: (options?: {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (file: string) => string;
}) => Promise<unknown>;

export default initTinyUSDZNative;
