import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const runnerRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: runnerRoot,
  plugins: [react()],
  server: {
    host: true,
  },
  publicDir: false,
  build: {
    outDir: resolve(runnerRoot, "../../dist-export-runner"),
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
