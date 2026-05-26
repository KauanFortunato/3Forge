import { AnimationClip, Object3D, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";

import { convertRootGltfAnimations } from "./gltfAnimationImport";

describe("gltfAnimationImport", () => {
  it("converts root position, scale, and quaternion tracks", () => {
    const scene = new Object3D();
    const root = new Object3D();
    root.name = "Root";
    scene.add(root);
    const quarterTurn = Math.sin(Math.PI / 4);
    const clip = new AnimationClip("Take 001", 1, [
      new VectorKeyframeTrack("Root.position", [0, 1], [0, 0, 0, 2, 0, 0]),
      new VectorKeyframeTrack("Root.scale", [0, 1], [1, 1, 1, 1, 2, 1]),
      new QuaternionKeyframeTrack("Root.quaternion", [0, 1], [0, 0, 0, 1, 0, quarterTurn, 0, quarterTurn]),
    ]);

    const [converted] = convertRootGltfAnimations([clip], scene, 24);

    expect(converted?.name).toBe("Take 001");
    expect(converted?.durationFrames).toBe(24);
    expect(converted?.tracks.find((track) => track.property === "transform.position.x")?.keyframes).toEqual([
      { frame: 0, value: 0 },
      { frame: 24, value: 2 },
    ]);
    expect(converted?.tracks.find((track) => track.property === "transform.scale.y")?.keyframes).toEqual([
      { frame: 0, value: 1 },
      { frame: 24, value: 2 },
    ]);
    expect(converted?.tracks.find((track) => track.property === "transform.rotation.y")?.keyframes[1]?.value).toBeCloseTo(Math.PI / 2);
  });

  it("skips internal node animation tracks", () => {
    const scene = new Object3D();
    const root = new Object3D();
    root.name = "Root";
    const child = new Object3D();
    child.name = "Wheel";
    root.add(child);
    scene.add(root);
    const clip = new AnimationClip("WheelSpin", 1, [
      new VectorKeyframeTrack("Wheel.position", [0, 1], [0, 0, 0, 1, 0, 0]),
    ]);

    expect(convertRootGltfAnimations([clip], scene)).toEqual([]);
  });
});
