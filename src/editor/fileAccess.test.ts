import { describe, expect, it, vi } from "vitest";
import { createDefaultBlueprint } from "./state";
import {
  getBlueprintFileName,
  openBlueprintWithPicker,
  saveBlueprintAs,
  saveBlueprintToExistingHandle,
} from "./fileAccess";

describe("fileAccess", () => {
  it("opens a blueprint through the file picker and parses the JSON", async () => {
    const blueprint = createDefaultBlueprint();
    const handle = {
      name: "fixture.json",
      getFile: vi.fn(async () => new File([JSON.stringify(blueprint)], "fixture.json", { type: "application/json" })),
      createWritable: vi.fn(),
    };

    const result = await openBlueprintWithPicker({
      showOpenFilePicker: vi.fn(async () => [handle]),
      showSaveFilePicker: vi.fn(),
    });

    expect(result?.fileName).toBe("fixture.json");
    expect(result?.blueprint).toEqual(blueprint);
  });

  it("overwrites the original file when write permission is granted", async () => {
    const blueprint = createDefaultBlueprint();
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const handle = {
      name: "fixture.json",
      getFile: vi.fn(),
      queryPermission: vi.fn(async () => "granted" as const),
      createWritable: vi.fn(async () => ({ write, close })),
    };

    const result = await saveBlueprintToExistingHandle(blueprint, handle);

    expect(result.status).toBe("saved");
    expect(handle.createWritable).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports denied permission when overwrite is blocked", async () => {
    const blueprint = createDefaultBlueprint();
    const handle = {
      name: "fixture.json",
      getFile: vi.fn(),
      queryPermission: vi.fn(async () => "prompt" as const),
      requestPermission: vi.fn(async () => "denied" as const),
      createWritable: vi.fn(),
    };

    const result = await saveBlueprintToExistingHandle(blueprint, handle);

    expect(result).toEqual({ status: "permission-denied" });
  });

  it("falls back to unsupported when Save As is unavailable", async () => {
    const result = await saveBlueprintAs(createDefaultBlueprint(), "fixture.json", {});

    expect(result).toEqual({ status: "unsupported" });
    expect(getBlueprintFileName("Fixture")).toBe("Fixture.json");
  });
});
