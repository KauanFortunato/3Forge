import { describe, expect, it, vi } from "vitest";
import { queryClipboardWritePermission, writeTextToClipboard } from "./clipboard";

describe("clipboard", () => {
  it("writes text when clipboard access is available", async () => {
    const writeText = vi.fn(async () => undefined);
    const navigatorObject = {
      clipboard: { writeText },
      permissions: {
        query: vi.fn(async () => ({ state: "granted" as const })),
      },
    };

    const result = await writeTextToClipboard("hello", navigatorObject);

    expect(result).toEqual({ status: "copied", permission: "granted" });
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("reports denied permission without attempting to write", async () => {
    const writeText = vi.fn(async () => undefined);
    const navigatorObject = {
      clipboard: { writeText },
      permissions: {
        query: vi.fn(async () => ({ state: "denied" as const })),
      },
    };

    const result = await writeTextToClipboard("hello", navigatorObject);

    expect(result).toEqual({ status: "denied", permission: "denied" });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats missing clipboard support safely", async () => {
    expect(await queryClipboardWritePermission({})).toBe("unsupported");
    expect(await writeTextToClipboard("hello", {})).toEqual({ status: "unsupported" });
  });
});
