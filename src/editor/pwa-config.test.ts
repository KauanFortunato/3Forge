import { describe, expect, it } from "vitest";
// @ts-expect-error The PWA config is authored in Vite-side ESM and validated by build output.
import {
  PWA_ANDROID_ICON_192,
  PWA_ANDROID_ICON_512,
  PWA_APPLE_ICON_180,
  PWA_APP_NAME,
  PWA_THEME_COLOR,
  createPwaHeadTags,
  pwaManifest,
} from "../../scripts/pwa-config.mjs";

describe("pwa config", () => {
  it("defines a standalone manifest with the expected core icons", () => {
    expect(pwaManifest.name).toBe(PWA_APP_NAME);
    expect(pwaManifest.display).toBe("standalone");
    expect(pwaManifest.theme_color).toBe(PWA_THEME_COLOR);
    expect(pwaManifest.start_url).toBe("/");
    expect(pwaManifest.lang).toBe("pt");
    expect(pwaManifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: PWA_ANDROID_ICON_192, sizes: "192x192", purpose: "any maskable" }),
      expect.objectContaining({ src: PWA_ANDROID_ICON_512, sizes: "512x512", purpose: "any maskable" }),
    ]));
  });

  it("generates mobile and iOS head tags for installability", () => {
    const tags = createPwaHeadTags();

    expect(tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: "meta", attrs: expect.objectContaining({ name: "theme-color", content: PWA_THEME_COLOR }) }),
      expect.objectContaining({ tag: "meta", attrs: expect.objectContaining({ name: "apple-mobile-web-app-capable", content: "yes" }) }),
      expect.objectContaining({ tag: "meta", attrs: expect.objectContaining({ name: "msapplication-TileImage", content: PWA_ANDROID_ICON_192 }) }),
      expect.objectContaining({ tag: "link", attrs: expect.objectContaining({ rel: "apple-touch-icon", href: PWA_APPLE_ICON_180 }) }),
      expect.objectContaining({ tag: "link", attrs: expect.objectContaining({ rel: "apple-touch-icon-precomposed", href: PWA_APPLE_ICON_180 }) }),
      expect.objectContaining({ tag: "link", attrs: expect.objectContaining({ rel: "apple-touch-startup-image", href: "/assets/ios/splash/ios-splash-1125x2436.png" }) }),
    ]));
  });
});
