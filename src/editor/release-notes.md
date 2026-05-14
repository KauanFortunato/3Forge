# What's New

- USDZ import now uses the new OpenUSD WASM pipeline for production assets, with better material binding, texture extraction, UV handling, and fallback support.

- GLB, GLTF, and USDZ export now handle imported USDZ textures more reliably, including raw texture data and correct texture orientation.

- HDR environment assets can now be imported, previewed, selected, packaged, and exported through the editor settings.

- Model structure is surfaced in the scene graph so imported model parts can be inspected and managed more easily.

- The Assets panel has been simplified by removing the model/object asset tab, keeping the panel focused on animations, images, and materials.

- Long-running import and export tasks now show a blocking progress overlay with estimated remaining time.
