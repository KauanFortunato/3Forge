import createOpenUSD from "./openusd.js";

const usd = await createOpenUSD();

console.log("USD version:", usd.getUsdVersion());

console.log(
  "Register plugins:",
  usd.registerPlugins("/home/kauanfortunato/wasm/openusd-wasm-official/lib/usd")
);

console.log("Layer:", usd.createAnonymousLayer());

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

console.log("Imported USDA:");
console.log(usd.importUsdaFromString(usda));

console.log("Stage:");
console.log(usd.openStageFromUsdaString(usda));

console.log("Prims:");
console.log(usd.listPrimsFromUsdaString(usda));
