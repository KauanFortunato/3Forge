import { cleanup } from "@testing-library/react";
// `/vitest` registers the matchers AND augments vitest's Assertion type so
// `expect(...).toBeInTheDocument()` typechecks. Replaces the explicit
// `expect.extend(matchers)` (which worked at runtime but missed the type
// augmentation, leaving every jest-dom matcher as a TS2339 error).
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}
