import { loadOpenUSD } from "./loadOpenUsd";

const EXPECTED_FUNCTIONS = [
  // existing
  "getUsdVersion",
  "registerPlugins",
  "createAnonymousLayer",
  "importUsdaFromString",
  "openStageFromUsdaString",
  "listPrimsFromUsdaString",
  // new — stage
  "openStageFromBinary",
  "closeStage",
  "hasStage",
  // new — geometry
  "listPrims",
  "getMeshData",
  "getLocalTransform",
  "getWorldTransform",
  // new — materials
  "getMaterialBinding",
  "getMaterialParams",
  // new — assets
  "getAssetBytes",
  // new — animation
  "getStageTimeInfo",
  "getTimeSamples",
] as const;

export async function testOpenUSD() {
  try {
    console.log("[OpenUSD-TEST] Loading WASM module…");
    const usd = (await loadOpenUSD()) as Record<string, unknown>;

    // Expose for manual exploration
    (window as unknown as { usd: unknown }).usd = usd;

    console.log("[OpenUSD-TEST] USD version:", (usd.getUsdVersion as () => string)());
    console.log(
      "[OpenUSD-TEST] Register plugins:",
      (usd.registerPlugins as (p: string) => string)("/usd"),
    );

    // Check API surface
    const present: string[] = [];
    const missing: string[] = [];
    for (const name of EXPECTED_FUNCTIONS) {
      if (typeof usd[name] === "function") present.push(name);
      else missing.push(name);
    }
    console.log(`[OpenUSD-TEST] API surface: ${present.length}/${EXPECTED_FUNCTIONS.length} functions present`);
    console.log("[OpenUSD-TEST] ✓ Present:", present);
    if (missing.length > 0) {
      console.warn("[OpenUSD-TEST] ✗ MISSING:", missing);
    }

    // Smoke-test the existing USDA path still works
    const usda = `#usda 1.0

def Xform "Root"
{
    def Mesh "Cube"
    {
    }

    def Xform "Child"
    {
        def Mesh "ChildMesh"
        {
        }
    }
}
`;
    console.log(
      "[OpenUSD-TEST] Stage from USDA:",
      (usd.openStageFromUsdaString as (s: string) => string)(usda),
    );
    console.log(
      "[OpenUSD-TEST] Prims from USDA:\n" +
        (usd.listPrimsFromUsdaString as (s: string) => string)(usda),
    );

    console.log("[OpenUSD-TEST] Done. Module attached to window.usd — explore from DevTools.");
    return usd;
  } catch (err) {
    console.error("[OpenUSD-TEST] Failed:", err);
    throw err;
  }
}
