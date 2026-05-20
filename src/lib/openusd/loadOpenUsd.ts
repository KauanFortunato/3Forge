let openUsdPromise: Promise<unknown> | null = null;

// Dynamic import constructed at runtime so Vite's import-analyzer never sees
// the path string. Required because the Emscripten output lives in /public/.
const dynamicImport = new Function("url", "return import(url)") as (
  url: string,
) => Promise<{ default: (opts?: Record<string, unknown>) => Promise<unknown> }>;

export function loadOpenUSD() {
  if (!openUsdPromise) {
    openUsdPromise = (async () => {
      const mod = await dynamicImport("/wasm/openusd/openusd.js");
      const createOpenUSD = mod.default;
      return createOpenUSD({
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) {
            return "/wasm/openusd/openusd.wasm";
          }

          if (path.endsWith(".data")) {
            return "/wasm/openusd/openusd.data";
          }

          return `/wasm/openusd/${path}`;
        },
      });
    })();
  }

  return openUsdPromise;
}

export function releaseOpenUSD(): void {
  openUsdPromise = null;
}
