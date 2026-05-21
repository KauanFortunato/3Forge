import { Euler, Matrix4, Quaternion, Vector3 } from "three";

import type { AnimationPropertyPath, ImportedNodeAnimation } from "../../editor/types";

export interface UsdStageTimeInfo {
  startTime?: number;
  endTime?: number;
  framesPerSecond?: number;
  timeCodesPerSecond?: number;
}

export interface UsdAnimationSampler {
  getTimeSamples(stageId: number, attrPath: string): number[] | ArrayLike<number> | null;
  getTimeSampledAttributes?: (stageId: number, primPath: string) => string[] | ArrayLike<string> | null;
  getWorldTransform(stageId: number, primPath: string, timeCode: number): Float32Array | number[] | null;
  getVisibility?: (stageId: number, primPath: string, timeCode: number) => boolean | string | null;
}

export interface UsdPrimAnimationOptions {
  sampler: UsdAnimationSampler;
  stageId: number;
  primPath: string;
  parentPath: string;
  stageTimeInfo: UsdStageTimeInfo | null;
}

type TransformSample = {
  frame: number;
  position: Vector3;
  rotation: Euler;
  scale: Vector3;
};

const XFORM_SAMPLE_ATTRIBUTES = [
  "xformOp:transform",
  "xformOp:translate",
  "xformOp:rotateXYZ",
  "xformOp:rotateX",
  "xformOp:rotateY",
  "xformOp:rotateZ",
  "xformOp:orient",
  "xformOp:scale",
] as const;

const XFORM_SAMPLE_PREFIXES = [
  "xformOp:transform",
  "xformOp:translate",
  "xformOp:rotate",
  "xformOp:orient",
  "xformOp:scale",
] as const;

const EPSILON = 1e-5;
const MAX_FALLBACK_SAMPLES_PER_PRIM = 600;

export function resolveUsdAnimationFps(stageTimeInfo: UsdStageTimeInfo | null): number {
  const fps = stageTimeInfo?.framesPerSecond;
  if (typeof fps === "number" && Number.isFinite(fps) && fps > 0) {
    return Math.round(fps);
  }
  const timeCodesPerSecond = stageTimeInfo?.timeCodesPerSecond;
  if (typeof timeCodesPerSecond === "number" && Number.isFinite(timeCodesPerSecond) && timeCodesPerSecond > 0) {
    return Math.round(timeCodesPerSecond);
  }
  return 24;
}

export function usdTimeCodeToFrame(timeCode: number, stageTimeInfo: UsdStageTimeInfo | null): number {
  const fps = resolveUsdAnimationFps(stageTimeInfo);
  const timeCodesPerSecond = resolveUsdTimeCodesPerSecond(stageTimeInfo, fps);
  const startTime = typeof stageTimeInfo?.startTime === "number" && Number.isFinite(stageTimeInfo.startTime)
    ? stageTimeInfo.startTime
    : 0;
  return Math.max(0, Math.round(((timeCode - startTime) * fps) / timeCodesPerSecond));
}

export function buildUsdPrimAnimation(options: UsdPrimAnimationOptions): ImportedNodeAnimation | undefined {
  const transformTimes = collectTransformSampleTimes(options.sampler, options.stageId, options.primPath, options.stageTimeInfo);
  const visibilityTimes = collectVisibilitySampleTimes(options.sampler, options.stageId, options.primPath);
  const tracks = [
    ...buildTransformTracks(options, transformTimes),
    ...buildVisibilityTracks(options, visibilityTimes),
  ];
  if (tracks.length === 0) {
    return undefined;
  }
  const fps = resolveUsdAnimationFps(options.stageTimeInfo);
  const durationFrames = Math.max(
    1,
    ...tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.frame)),
    usdTimeCodeToFrame(options.stageTimeInfo?.endTime ?? 0, options.stageTimeInfo),
  );
  return { fps, durationFrames, tracks };
}

function collectTransformSampleTimes(
  sampler: UsdAnimationSampler,
  stageId: number,
  primPath: string,
  stageTimeInfo: UsdStageTimeInfo | null,
): number[] {
  const times = new Set<number>();
  for (const attr of collectTimeSampledAttributeNames(sampler, stageId, primPath)) {
    if (!XFORM_SAMPLE_PREFIXES.some((prefix) => attr === prefix || attr.startsWith(`${prefix}:`))) {
      continue;
    }
    for (const time of collectSampleTimes(sampler, stageId, `${primPath}.${attr}`)) {
      times.add(time);
    }
  }
  for (const attr of XFORM_SAMPLE_ATTRIBUTES) {
    for (const time of collectSampleTimes(sampler, stageId, `${primPath}.${attr}`)) {
      times.add(time);
    }
  }
  const authoredTimes = [...times].sort((a, b) => a - b);
  return authoredTimes.length > 0 ? authoredTimes : collectFallbackStageSampleTimes(sampler, stageId, primPath, stageTimeInfo);
}

function collectVisibilitySampleTimes(sampler: UsdAnimationSampler, stageId: number, primPath: string): number[] {
  const sampledAttributes = collectTimeSampledAttributeNames(sampler, stageId, primPath);
  if (sampledAttributes.length > 0 && !sampledAttributes.includes("visibility")) {
    return [];
  }
  return collectSampleTimes(sampler, stageId, `${primPath}.visibility`);
}

function collectTimeSampledAttributeNames(sampler: UsdAnimationSampler, stageId: number, primPath: string): string[] {
  const raw = sampler.getTimeSampledAttributes?.(stageId, primPath);
  if (!raw) {
    return [];
  }
  return Array.from(raw).filter((value): value is string => typeof value === "string" && value.length > 0);
}

function collectSampleTimes(sampler: UsdAnimationSampler, stageId: number, attrPath: string): number[] {
  const raw = sampler.getTimeSamples(stageId, attrPath);
  if (!raw) {
    return [];
  }
  return Array.from(raw)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
}

function collectFallbackStageSampleTimes(
  sampler: UsdAnimationSampler,
  stageId: number,
  primPath: string,
  stageTimeInfo: UsdStageTimeInfo | null,
): number[] {
  const startTime = typeof stageTimeInfo?.startTime === "number" && Number.isFinite(stageTimeInfo.startTime)
    ? stageTimeInfo.startTime
    : 0;
  const endTime = typeof stageTimeInfo?.endTime === "number" && Number.isFinite(stageTimeInfo.endTime)
    ? stageTimeInfo.endTime
    : startTime;
  if (endTime <= startTime) {
    return [];
  }
  const fps = resolveUsdAnimationFps(stageTimeInfo ?? null);
  const timeCodesPerSecond = resolveUsdTimeCodesPerSecond(stageTimeInfo ?? null, fps);
  const durationFrames = Math.max(1, Math.round(((endTime - startTime) * fps) / timeCodesPerSecond));
  const stride = Math.max(1, Math.ceil(durationFrames / MAX_FALLBACK_SAMPLES_PER_PRIM));
  const times: number[] = [];
  for (let frame = 0; frame <= durationFrames; frame += stride) {
    times.push(startTime + (frame * timeCodesPerSecond) / fps);
  }
  if (times[times.length - 1] !== endTime) {
    times.push(endTime);
  }
  return sampler.getWorldTransform(stageId, primPath, times[0] ?? startTime) ? times : [];
}

function resolveUsdTimeCodesPerSecond(stageTimeInfo: UsdStageTimeInfo | null, fallbackFps: number): number {
  const timeCodesPerSecond = stageTimeInfo?.timeCodesPerSecond;
  if (typeof timeCodesPerSecond === "number" && Number.isFinite(timeCodesPerSecond) && timeCodesPerSecond > 0) {
    return timeCodesPerSecond;
  }
  return fallbackFps;
}

function buildTransformTracks(options: UsdPrimAnimationOptions, timeCodes: number[]) {
  if (timeCodes.length === 0) {
    return [];
  }

  const samples: TransformSample[] = [];
  for (const timeCode of timeCodes) {
    const localMatrix = getLocalMatrixAtTime(options, timeCode);
    if (!localMatrix) {
      continue;
    }
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    localMatrix.decompose(position, rotation, scale);
    samples.push({
      frame: usdTimeCodeToFrame(timeCode, options.stageTimeInfo),
      position,
      rotation: new Euler().setFromQuaternion(rotation, "XYZ"),
      scale,
    });
  }

  if (samples.length < 2) {
    return [];
  }

  return [
    buildNumericTrack("transform.position.x", samples, (sample) => sample.position.x),
    buildNumericTrack("transform.position.y", samples, (sample) => sample.position.y),
    buildNumericTrack("transform.position.z", samples, (sample) => sample.position.z),
    buildNumericTrack("transform.rotation.x", samples, (sample) => sample.rotation.x),
    buildNumericTrack("transform.rotation.y", samples, (sample) => sample.rotation.y),
    buildNumericTrack("transform.rotation.z", samples, (sample) => sample.rotation.z),
    buildNumericTrack("transform.scale.x", samples, (sample) => sample.scale.x),
    buildNumericTrack("transform.scale.y", samples, (sample) => sample.scale.y),
    buildNumericTrack("transform.scale.z", samples, (sample) => sample.scale.z),
  ].filter((track): track is NonNullable<typeof track> => Boolean(track));
}

function buildVisibilityTracks(options: UsdPrimAnimationOptions, timeCodes: number[]) {
  if (!options.sampler.getVisibility || timeCodes.length === 0) {
    return [];
  }

  const keyframes = timeCodes
    .map((timeCode) => {
      const raw = options.sampler.getVisibility?.(options.stageId, options.primPath, timeCode);
      if (raw === null || raw === undefined) {
        return null;
      }
      const visible = typeof raw === "string" ? raw !== "invisible" : raw;
      return {
        frame: usdTimeCodeToFrame(timeCode, options.stageTimeInfo),
        value: visible ? 1 : 0,
      };
    })
    .filter((keyframe): keyframe is { frame: number; value: number } => Boolean(keyframe));

  if (keyframes.length < 2 || isConstant(keyframes.map((keyframe) => keyframe.value))) {
    return [];
  }

  return [{ property: "visible" as const, keyframes }];
}

function getLocalMatrixAtTime(options: UsdPrimAnimationOptions, timeCode: number): Matrix4 | null {
  const primWorld = toMatrix(options.sampler.getWorldTransform(options.stageId, options.primPath, timeCode));
  if (!primWorld) {
    return null;
  }
  if (!options.parentPath) {
    return primWorld;
  }
  const parentWorld = toMatrix(options.sampler.getWorldTransform(options.stageId, options.parentPath, timeCode));
  if (!parentWorld) {
    return primWorld;
  }
  return new Matrix4().multiplyMatrices(parentWorld.invert(), primWorld);
}

function toMatrix(value: Float32Array | number[] | null): Matrix4 | null {
  if (!value || value.length !== 16) {
    return null;
  }
  return new Matrix4().fromArray(Array.from(value));
}

function buildNumericTrack(
  property: AnimationPropertyPath,
  samples: TransformSample[],
  read: (sample: TransformSample) => number,
) {
  const values = samples.map(read);
  if (isConstant(values)) {
    return null;
  }
  return {
    property,
    keyframes: samples.map((sample, index) => ({
      frame: sample.frame,
      value: values[index] ?? 0,
    })),
  };
}

function isConstant(values: number[]): boolean {
  if (values.length < 2) {
    return true;
  }
  const first = values[0] ?? 0;
  return values.every((value) => Math.abs(value - first) <= EPSILON);
}
