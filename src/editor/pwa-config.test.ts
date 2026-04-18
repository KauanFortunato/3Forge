import { describe, expect, it } from "vitest";
// @ts-expect-error The PWA config is authored in Vite-side ESM and validated by build output.
import { PWA_APP_NAME, PWA_THEME_COLOR, createPwaHeadTags, pwaManifest } from "../../scripts/pwa-config.mjs";

describe("pwa config", () => {
  it("defines a standalone manifest with the expected core icons", () => {
    expect(pwaManifest.name).toBe(PWA_APP_NAME);
    expect(pwaManifest.display).toBe("standalone");
    expect(pwaManifest.theme_color).toBe(PWA_THEME_COLOR);
    expect(pwaManifest.start_url).toBe("/");
    expect(pwaManifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/assets/android/icons/android-icon-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/assets/android/icons/android-icon-512.png", sizes: "512x512" }),
    ]));
  });

  it("generates mobile and iOS head tags for installability", () => {
    const tags = createPwaHeadTags();

    expect(tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: "meta", attrs: expect.objectContaining({ name: "theme-color", content: PWA_THEME_COLOR }) }),
      expect.objectContaining({ tag: "meta", attrs: expect.objectContaining({ name: "apple-mobile-web-app-capable", content: "yes" }) }),
      expect.objectContaining({ tag: "link", attrs: expect.objectContaining({ rel: "apple-touch-icon", href: "/assets/ios/icons/ios-icon-180.png" }) }),
      expect.objectContaining({ tag: "link", attrs: expect.objectContaining({ rel: "apple-touch-startup-image", href: "/assets/ios/splash/ios-splash-1125x2436.png" }) }),
    ]));
  });
});
