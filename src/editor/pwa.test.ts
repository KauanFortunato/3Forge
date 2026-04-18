import { beforeEach, describe, expect, it, vi } from "vitest";

const registerSWMock = vi.fn();

vi.mock("virtual:pwa-register", () => ({
  registerSW: registerSWMock,
}));

vi.mock("./pwa-register", () => ({
  registerSW: registerSWMock,
}));

describe("pwa runtime", () => {
  beforeEach(() => {
    registerSWMock.mockReset();
  });

  it("registers the service worker only in production with service worker support", async () => {
    const { registerPwaServiceWorker, shouldRegisterPwaServiceWorker } = await import("./pwa");

    expect(shouldRegisterPwaServiceWorker({ PROD: true }, { serviceWorker: {} })).toBe(true);
    expect(shouldRegisterPwaServiceWorker({ PROD: false }, { serviceWorker: {} })).toBe(false);
    expect(shouldRegisterPwaServiceWorker({ PROD: true }, {})).toBe(false);

    registerPwaServiceWorker();
    expect(registerSWMock).toHaveBeenCalledTimes(0);

    registerPwaServiceWorker({ PROD: true }, { serviceWorker: {} });
    expect(registerSWMock).toHaveBeenCalledTimes(1);
    expect(registerSWMock).toHaveBeenCalledWith({ immediate: true });
  });
});
