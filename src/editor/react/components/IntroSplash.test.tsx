import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntroSplash } from "./IntroSplash";

describe("IntroSplash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("finishes automatically after the hold and fade", () => {
    const onFinish = vi.fn();
    render(<IntroSplash onFinish={onFinish} />);
    expect(onFinish).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1900 + 450 + 20);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("skips on click and only finishes once", () => {
    const onFinish = vi.fn();
    const { container } = render(<IntroSplash onFinish={onFinish} />);
    const overlay = container.querySelector(".intro-splash");
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay!);
    vi.advanceTimersByTime(300);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(overlay!.className).toContain("is-leaving");

    // The original auto-dismiss timer must not fire a second time.
    vi.advanceTimersByTime(3000);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("renders the animated logo asset", () => {
    const onFinish = vi.fn();
    const { container } = render(<IntroSplash onFinish={onFinish} />);
    const logo = container.querySelector(".intro-splash__logo") as HTMLImageElement | null;
    expect(logo?.getAttribute("src")).toBe("/assets/web/logo_anim.svg");
  });
});
