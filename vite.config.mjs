import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { createPwaHeadTags, pwaManifest } from "./scripts/pwa-config.mjs";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "3forge-pwa-head",
      transformIndexHtml() {
        return createPwaHeadTags();
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: [
        "assets/web/logo-32x32.png",
        "assets/web/logo.png",
        "assets/web/logo.png",
        "assets/ios/icons/ios-icon-180.png",
        "assets/android/icons/android-icon-192.png",
        "assets/android/icons/android-icon-512.png",
      ],
      manifest: pwaManifest,
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});
