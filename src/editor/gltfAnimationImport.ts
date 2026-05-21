import {
  AnimationClip as ThreeAnimationClip,
  Euler,
  Object3D,
  PropertyBinding,
  Quaternion,
} from "three";

import type { ImportedAnimationTrack } from "./types";

export interface ImportedGltfAnimationClip {
  name: string;
  fps: number;
  durationFrames: number;
  tracks: ImportedAnimationTrack[];
}

const DEFAULT_GLTF_IMPORT_FPS = 24;

export function convertRootGltfAnimations(
  animations: ThreeAnimationClip[],
  scene: Object3D,
  fps = DEFAULT_GLTF_IMPORT_FPS,
): ImportedGltfAnimationClip[] {
  return animations
    .map((clip, index) => {
      const tracks = clip.tracks.flatMap((track) => convertRootGltfTrack(track.name, track.times, track.values, scene, fps));
      return {
        name: clip.name?.trim() || `GLTF animation ${index + 1}`,
        fps,
        durationFrames: Math.max(1, Math.round(clip.duration * fps)),
        tracks,
      };
    })
    .filter((clip) => clip.tracks.length > 0);
}

function convertRootGltfTrack(
  name: string,
  times: ArrayLike<number>,
  values: ArrayLike<number>,
  scene: Object3D,
  fps: number,
): ImportedAnimationTrack[] {
  const parsed = PropertyBinding.parseTrackName(name);
  if (!parsed.propertyName || !isRootLevelTarget(scene, parsed.nodeName)) {
    return [];
  }

  switch (parsed.propertyName) {
    case "position":
      return convertVectorTrack(times, values, "transform.position", fps);
    case "scale":
      return convertVectorTrack(times, values, "transform.scale", fps);
    case "quaternion":
      return convertQuaternionTrack(times, values, fps);
    default:
      return [];
  }
}

function isRootLevelTarget(scene: Object3D, nodeName: string | undefined): boolean {
  if (!nodeName || nodeName === scene.name || nodeName === scene.uuid) {
    return true;
  }
  const target = PropertyBinding.findNode(scene, nodeName);
  return target === scene || (scene.children.length === 1 && target === scene.children[0]);
}

function convertVectorTrack(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
  prefix: "transform.position" | "transform.scale",
  fps: number,
): ImportedAnimationTrack[] {
  return [0, 1, 2].map((axisIndex) => {
    const axis = axisIndex === 0 ? "x" : axisIndex === 1 ? "y" : "z";
    return {
      property: `${prefix}.${axis}` as ImportedAnimationTrack["property"],
      keyframes: Array.from(times).map((time, index) => ({
        frame: Math.max(0, Math.round(time * fps)),
        value: values[index * 3 + axisIndex] ?? (prefix === "transform.scale" ? 1 : 0),
      })),
    };
  }).filter((track) => !isConstant(track.keyframes.map((keyframe) => keyframe.value)));
}

function convertQuaternionTrack(times: ArrayLike<number>, values: ArrayLike<number>, fps: number): ImportedAnimationTrack[] {
  const rotations = Array.from(times).map((time, index) => {
    const offset = index * 4;
    const quaternion = new Quaternion(
      values[offset] ?? 0,
      values[offset + 1] ?? 0,
      values[offset + 2] ?? 0,
      values[offset + 3] ?? 1,
    );
    const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
    return {
      frame: Math.max(0, Math.round(time * fps)),
      values: [euler.x, euler.y, euler.z],
    };
  });

  return [0, 1, 2].map((axisIndex) => {
    const axis = axisIndex === 0 ? "x" : axisIndex === 1 ? "y" : "z";
    return {
      property: `transform.rotation.${axis}` as ImportedAnimationTrack["property"],
      keyframes: rotations.map((sample) => ({
        frame: sample.frame,
        value: sample.values[axisIndex] ?? 0,
      })),
    };
  }).filter((track) => !isConstant(track.keyframes.map((keyframe) => keyframe.value)));
}

function isConstant(values: number[]): boolean {
  if (values.length < 2) {
    return true;
  }
  const first = values[0] ?? 0;
  return values.every((value) => Math.abs(value - first) <= 1e-5);
}
