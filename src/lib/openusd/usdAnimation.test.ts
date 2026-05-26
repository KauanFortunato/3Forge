import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";

import { buildUsdPrimAnimation, resolveUsdAnimationFps, usdTimeCodeToFrame, type UsdAnimationSampler } from "./usdAnimation";

function matrixArray(matrix: Matrix4): number[] {
  return matrix.toArray();
}

describe("usdAnimation", () => {
  it("converts USD time codes to editor frames using the USD spec formula", () => {
    // USD spec: frame = (timeCode - startTime) * fps / timeCodesPerSecond.
    // When tcps is unauthored, USD defaults it to fps — so timeCode is the
    // frame number directly (the Apple/Maya/Houdini default).
    const apple = { startTime: 0, endTime: 60, framesPerSecond: 60, timeCodesPerSecond: 60 };
    expect(resolveUsdAnimationFps(apple)).toBe(60);
    expect(usdTimeCodeToFrame(0, apple)).toBe(0);
    expect(usdTimeCodeToFrame(30, apple)).toBe(30);
    expect(usdTimeCodeToFrame(60, apple)).toBe(60);

    // tcps != fps (e.g. a file authored at 24 tcps but played back at 30 fps).
    const retimed = { startTime: 0, endTime: 24, framesPerSecond: 30, timeCodesPerSecond: 24 };
    expect(usdTimeCodeToFrame(24, retimed)).toBe(30);

    // Defaults: fps falls back to tcps, then to 24.
    expect(resolveUsdAnimationFps({ timeCodesPerSecond: 48 })).toBe(48);
    expect(resolveUsdAnimationFps(null)).toBe(24);
  });

  it("samples world transforms as local tracks relative to the kept parent", () => {
    const matrices = new Map<string, number[]>([
      ["parent:0", matrixArray(new Matrix4().makeTranslation(10, 0, 0))],
      ["parent:24", matrixArray(new Matrix4().makeTranslation(10, 0, 0))],
      ["child:0", matrixArray(new Matrix4().makeTranslation(12, 0, 0))],
      ["child:24", matrixArray(new Matrix4().makeTranslation(15, 0, 0))],
    ]);
    const sampler: UsdAnimationSampler = {
      getTimeSamples: (_stageId, attrPath) => attrPath === "/Root/Child.xformOp:translate" ? [0, 24] : [],
      getWorldTransform: (_stageId, primPath, timeCode) => {
        const key = `${primPath === "/Root" ? "parent" : "child"}:${timeCode}`;
        return matrices.get(key) ?? null;
      },
    };

    const animation = buildUsdPrimAnimation({
      sampler,
      stageId: 1,
      primPath: "/Root/Child",
      parentPath: "/Root",
      stageTimeInfo: { startTime: 0, endTime: 24, framesPerSecond: 24, timeCodesPerSecond: 24 },
    });

    const xTrack = animation?.tracks.find((track) => track.property === "transform.position.x");
    expect(xTrack?.keyframes.map((keyframe) => [keyframe.frame, keyframe.value])).toEqual([[0, 2], [24, 5]]);
    expect(animation?.tracks.some((track) => track.property === "transform.position.y")).toBe(false);
  });

  it("detects suffixed xform op attributes reported by the WASM wrapper", () => {
    const sampler: UsdAnimationSampler = {
      getTimeSampledAttributes: () => ["xformOp:translate:maya:pivot", "xformOpOrder"],
      getTimeSamples: (_stageId, attrPath) => attrPath === "/Root.xformOp:translate:maya:pivot" ? [12, 24] : [],
      getWorldTransform: (_stageId, _primPath, timeCode) => matrixArray(new Matrix4().makeTranslation(timeCode, 0, 0)),
    };

    const animation = buildUsdPrimAnimation({
      sampler,
      stageId: 1,
      primPath: "/Root",
      parentPath: "",
      stageTimeInfo: { startTime: 0, endTime: 24, framesPerSecond: 24, timeCodesPerSecond: 24 },
    });

    expect(animation?.tracks.find((track) => track.property === "transform.position.x")?.keyframes).toEqual([
      { frame: 12, value: 12 },
      { frame: 24, value: 24 },
    ]);
  });

  it("filters constant transform channels", () => {
    const sampler: UsdAnimationSampler = {
      getTimeSamples: (_stageId, attrPath) => attrPath === "/Static.xformOp:translate" ? [0, 24] : [],
      getWorldTransform: () => matrixArray(new Matrix4().makeTranslation(3, 0, 0)),
    };

    expect(buildUsdPrimAnimation({
      sampler,
      stageId: 1,
      primPath: "/Static",
      parentPath: "",
      stageTimeInfo: { startTime: 0, endTime: 24, framesPerSecond: 24, timeCodesPerSecond: 24 },
    })).toBeUndefined();
  });

  it("converts visibility samples to discrete visible tracks when a sampler is available", () => {
    const sampler: UsdAnimationSampler = {
      getTimeSamples: (_stageId, attrPath) => attrPath === "/Blink.visibility" ? [0, 12, 24] : [],
      getWorldTransform: () => matrixArray(new Matrix4()),
      getVisibility: (_stageId, _primPath, timeCode) => timeCode === 12 ? "invisible" : "inherited",
    };

    const animation = buildUsdPrimAnimation({
      sampler,
      stageId: 1,
      primPath: "/Blink",
      parentPath: "",
      stageTimeInfo: { startTime: 0, endTime: 24, framesPerSecond: 24, timeCodesPerSecond: 24 },
    });

    expect(animation?.tracks).toEqual([{
      property: "visible",
      keyframes: [
        { frame: 0, value: 1 },
        { frame: 12, value: 0 },
        { frame: 24, value: 1 },
      ],
    }]);
  });
});
