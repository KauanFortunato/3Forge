export const PWA_THEME_COLOR = "#111318";
export const PWA_BACKGROUND_COLOR = "#111318";
export const PWA_APP_NAME = "3Forge";
export const PWA_APP_SHORT_NAME = "3Forge";
export const PWA_DESCRIPTION = "Editor 3D visual baseado em Three.js, React e TypeScript.";

export const pwaManifest = {
  id: "/",
  name: PWA_APP_NAME,
  short_name: PWA_APP_SHORT_NAME,
  description: PWA_DESCRIPTION,
  theme_color: PWA_THEME_COLOR,
  background_color: PWA_BACKGROUND_COLOR,
  display: "standalone",
  scope: "/",
  start_url: "/",
  lang: "en",
  icons: [
    {
      src: "/assets/android/icons/android-icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/assets/android/icons/android-icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/assets/ios/icons/ios-icon-180.png",
      sizes: "180x180",
      type: "image/png",
      purpose: "any",
    },
  ],
};

const APPLE_TOUCH_ICONS = [
  { href: "/assets/ios/icons/ios-icon-180.png", sizes: "180x180" },
  { href: "/assets/ios/icons/ios-icon-152.png", sizes: "152x152" },
  { href: "/assets/ios/icons/ios-icon-120.png", sizes: "120x120" },
];

const APPLE_STARTUP_IMAGES = [
  {
    href: "/assets/ios/splash/ios-splash-640x1136.png",
    media: "(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
  {
    href: "/assets/ios/splash/ios-splash-750x1334.png",
    media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
  {
    href: "/assets/ios/splash/ios-splash-828x1792.png",
    media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
  {
    href: "/assets/ios/splash/ios-splash-1125x2436.png",
    media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/assets/ios/splash/ios-splash-1242x2208.png",
    media: "(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/assets/ios/splash/ios-splash-1242x2688.png",
    media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/assets/ios/splash/ios-splash-1536x2048.png",
    media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
  {
    href: "/assets/ios/splash/ios-splash-2208x1242.png",
    media: "(device-width: 736px) and (device-height: 414px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
  },
  {
    href: "/assets/ios/splash/ios-splash-2688x1242.png",
    media: "(device-width: 896px) and (device-height: 414px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
  },
  {
    href: "/assets/ios/splash/ios-splash-1024x1366.png",
    media: "(device-width: 512px) and (device-height: 683px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
  {
    href: "/assets/ios/splash/ios-splash-2732x2732.png",
    media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)",
  },
];

export function createPwaHeadTags() {
  const tags = [
    {
      tag: "meta",
      attrs: { name: "theme-color", content: PWA_THEME_COLOR },
      injectTo: "head",
    },
    {
      tag: "meta",
      attrs: { name: "mobile-web-app-capable", content: "yes" },
      injectTo: "head",
    },
    {
      tag: "meta",
      attrs: { name: "apple-mobile-web-app-capable", content: "yes" },
      injectTo: "head",
    },
    {
      tag: "meta",
      attrs: { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      injectTo: "head",
    },
    {
      tag: "meta",
      attrs: { name: "apple-mobile-web-app-title", content: PWA_APP_NAME },
      injectTo: "head",
    },
    {
      tag: "meta",
      attrs: { name: "application-name", content: PWA_APP_NAME },
      injectTo: "head",
    },
    {
      tag: "meta",
      attrs: { name: "description", content: PWA_DESCRIPTION },
      injectTo: "head",
    },
  ];

  for (const icon of APPLE_TOUCH_ICONS) {
    tags.push({
      tag: "link",
      attrs: {
        rel: "apple-touch-icon",
        href: icon.href,
        sizes: icon.sizes,
      },
      injectTo: "head",
    });
  }

  for (const splash of APPLE_STARTUP_IMAGES) {
    tags.push({
      tag: "link",
      attrs: {
        rel: "apple-touch-startup-image",
        href: splash.href,
        media: splash.media,
      },
      injectTo: "head",
    });
  }

  return tags;
}
