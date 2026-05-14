export class TinyUSDZComposer {
  constructor();
  setLayer(layer: unknown): void;
  setUSDLoader(loader: unknown): void;
  setAssetSearchPaths(paths: string[]): void;
  setBaseWorkingPath(path: string): void;
  progressiveComposition(): Promise<void>;
}
