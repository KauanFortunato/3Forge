declare module "../../scripts/pwa-config.mjs" {
  export const PWA_THEME_COLOR: string;
  export const PWA_BACKGROUND_COLOR: string;
  export const PWA_APP_NAME: string;
  export const PWA_APP_SHORT_NAME: string;
  export const PWA_DESCRIPTION: string;
  export const PWA_ANDROID_ICON_192: string;
  export const PWA_ANDROID_ICON_512: string;
  export const PWA_APPLE_ICON_180: string;
  export const pwaManifest: {
    id: string;
    name: string;
    short_name: string;
    description: string;
    theme_color: string;
    background_color: string;
    display: string;
    scope: string;
    start_url: string;
    lang: string;
    icons: Array<{
      src: string;
      sizes: string;
      type: string;
      purpose?: string;
    }>;
  };
  export function createPwaHeadTags(): Array<{
    tag: string;
    attrs: Record<string, string>;
    injectTo: "head" | "body";
  }>;
}
