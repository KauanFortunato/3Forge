import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const playgroundRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: playgroundRoot,
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
  },
  publicDir: false,
  build: {
    outDir: resolve(playgroundRoot, "../../dist-w3d-translation"),
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
