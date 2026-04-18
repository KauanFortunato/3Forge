import { registerSW } from "./pwa-register";

interface PwaEnvironment {
  PROD: boolean;
}

interface PwaNavigatorLike {
  serviceWorker?: unknown;
}

export function shouldRegisterPwaServiceWorker(
  environment: PwaEnvironment = import.meta.env,
  navigatorObject: PwaNavigatorLike = globalThis.navigator,
): boolean {
  return Boolean(environment.PROD && navigatorObject && "serviceWorker" in navigatorObject);
}

export function registerPwaServiceWorker(
  environment: PwaEnvironment = import.meta.env,
  navigatorObject: PwaNavigatorLike = globalThis.navigator,
): void {
  if (!shouldRegisterPwaServiceWorker(environment, navigatorObject)) {
    return;
  }

  registerSW({
    immediate: true,
  });
}
