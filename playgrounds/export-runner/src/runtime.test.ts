import { describe, expect, it } from "vitest";
import { Group } from "three";
import { discoverGeneratedModules, getAnimationCapabilities, resolveExportedComponent } from "./runtime";

class ValidExport {
  public readonly group = new Group();

  public async build(): Promise<void> {
    return undefined;
  }

  public dispose(): void {
    return undefined;
  }

  public play(): void {
    return undefined;
  }

  public pause(): void {
    return undefined;
  }

  public stop(): void {
    return undefined;
  }

  public seek(_frame: number): void {
    return undefined;
  }

  public createTimeline(): object {
    return {};
  }
}

describe("export runner runtime", () => {
  it("discovers generated modules from arbitrary file names and sorts them", () => {
    const discovered = discoverGeneratedModules({
      "./generated/Vote.ts": async () => ({ ValidExport }),
      "./generated/component.ts": async () => ({ ValidExport }),
      "./generated/_ignored.test.ts": async () => ({ ValidExport }),
    });

    expect(discovered.map((entry) => entry.fileName)).toEqual(["component", "Vote"]);
    expect(discovered.map((entry) => entry.modulePath)).toEqual([
      "./generated/component.ts",
      "./generated/Vote.ts",
    ]);
  });

  it("detects the first exported component constructor with build/dispose", () => {
    const resolved = resolveExportedComponent({
      noop: 123,
      ValidExport,
    });

    expect(resolved).toEqual({
      exportName: "ValidExport",
      constructor: ValidExport,
    });
  });

  it("returns null when the module does not expose a compatible export", () => {
    expect(resolveExportedComponent({ plain: {}, value: "nope" })).toBeNull();
  });

  it("reports animation capabilities from the built instance", () => {
    const capabilities = getAnimationCapabilities(new ValidExport());

    expect(capabilities).toEqual({
      canPlay: true,
      canPause: true,
      canRestart: false,
      canReverse: false,
      canStop: true,
      canSeek: true,
      canCreateTimeline: true,
      canPlayClip: false,
      clipNames: [],
    });
  });
});
