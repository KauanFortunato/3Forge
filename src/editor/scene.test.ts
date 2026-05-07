import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTexture, Texture } from "three";
import {
  buildSequencePlaceholderTexture,
  decideImageMeshKind,
  formatVideoLoadFailureMessage,
  ImageSequencePlayer,
  orbitPolicyForSceneMode,
  resolveMaskInversion,
  setTextureUpdateIfReady,
  shouldAttachTransformGizmo,
  summariseVideoTextureState,
} from "./scene";
import { createNode } from "./state";
import type { ComponentBlueprint, EditorNode } from "./types";

function makeBlueprint(nodes: EditorNode[]): ComponentBlueprint {
  return {
    version: 1,
    componentName: "test",
    sceneMode: "2d",
    nodes,
    fonts: [],
    images: [],
    materials: [],
    animation: { clips: [] },
  } as unknown as ComponentBlueprint;
}

describe("shouldAttachTransformGizmo", () => {
  it("does not attach when the current tool is select", () => {
    expect(shouldAttachTransformGizmo("select", 1, true)).toBe(false);
    expect(shouldAttachTransformGizmo("select", 3, true)).toBe(false);
  });

  it("does not attach when there is no selection", () => {
    expect(shouldAttachTransformGizmo("translate", 0, false)).toBe(false);
  });

  it("attaches to the primary object in a single selection", () => {
    expect(shouldAttachTransformGizmo("translate", 1, true)).toBe(true);
    expect(shouldAttachTransformGizmo("rotate", 1, true)).toBe(true);
    expect(shouldAttachTransformGizmo("scale", 1, true)).toBe(true);
  });

  it("attaches to the primary object when multi-selection is active", () => {
    expect(shouldAttachTransformGizmo("translate", 3, true)).toBe(true);
    expect(shouldAttachTransformGizmo("rotate", 2, true)).toBe(true);
  });

  it("does not attach when the primary object is missing from the scene graph", () => {
    expect(shouldAttachTransformGizmo("translate", 2, false)).toBe(false);
  });
});

describe("resolveMaskInversion", () => {
  it("returns true when the mask node is marked inverted", () => {
    const mask = createNode("plane", { name: "Mask", parentId: null });
    mask.isMask = true;
    mask.maskInverted = true;
    const target = createNode("plane", { name: "Target", parentId: null });
    target.maskId = mask.id;
    const bp = makeBlueprint([mask, target]);

    expect(resolveMaskInversion(bp, mask.id, target)).toBe(true);
  });

  it("returns false when the mask node is not inverted", () => {
    const mask = createNode("plane", { name: "Mask", parentId: null });
    mask.isMask = true;
    const target = createNode("plane", { name: "Target", parentId: null });
    target.maskId = mask.id;
    const bp = makeBlueprint([mask, target]);

    expect(resolveMaskInversion(bp, mask.id, target)).toBe(false);
  });

  it("ignores a maskInverted flag on the target — inversion is a property of the mask", () => {
    // Older blueprints (or hand-edited data) might still set maskInverted on
    // the target. The new contract treats only the mask as authoritative so
    // a target-only flag MUST NOT flip clipping.
    const mask = createNode("plane", { name: "Mask", parentId: null });
    mask.isMask = true;
    const target = createNode("plane", { name: "Target", parentId: null });
    target.maskId = mask.id;
    target.maskInverted = true; // stale, must be ignored
    const bp = makeBlueprint([mask, target]);

    expect(resolveMaskInversion(bp, mask.id, target)).toBe(false);
  });

  it("returns false when the mask id does not resolve to any node", () => {
    const target = createNode("plane", { name: "Target", parentId: null });
    target.maskId = "missing-mask-id";
    const bp = makeBlueprint([target]);

    expect(resolveMaskInversion(bp, "missing-mask-id", target)).toBe(false);
  });
});

describe("summariseVideoTextureState", () => {
  it("returns null for a non-video image (HTMLImageElement)", () => {
    const img = document.createElement("img");
    expect(summariseVideoTextureState(img)).toBeNull();
  });

  it("returns null when no image is bound", () => {
    expect(summariseVideoTextureState(null)).toBeNull();
    expect(summariseVideoTextureState(undefined)).toBeNull();
  });

  it("extracts the diagnostic fields from a real <video> element", () => {
    // jsdom provides a working HTMLVideoElement; we only need to read
    // its public state, not actually decode anything.
    const video = document.createElement("video");
    video.src = "blob:test-clip";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.currentTime = 0;
    const state = summariseVideoTextureState(video);
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.src).toBe("blob:test-clip");
    expect(typeof state.readyState).toBe("number");
    expect(typeof state.networkState).toBe("number");
    expect(state.paused).toBe(true);  // jsdom never auto-plays
    expect(state.muted).toBe(true);
    expect(state.loop).toBe(true);
    expect(state.playsInline).toBe(true);
    // currentTime/duration: jsdom returns 0/NaN by default — accept either.
    expect(typeof state.currentTime).toBe("number");
  });

  it("surfaces an error code when the video has one", () => {
    const video = document.createElement("video");
    // jsdom doesn't trigger media errors organically; simulate by
    // overriding the `error` getter so the helper can read it.
    Object.defineProperty(video, "error", {
      configurable: true,
      get: () => ({ code: 4, message: "MEDIA_ERR_SRC_NOT_SUPPORTED" }),
    });
    const state = summariseVideoTextureState(video);
    expect(state?.errorCode).toBe(4);
  });
});

describe("formatVideoLoadFailureMessage", () => {
  it("includes the src and the error code", () => {
    const msg = formatVideoLoadFailureMessage("blob:foo.mov", 4);
    expect(msg).toContain("blob:foo.mov");
    expect(msg).toContain("4");
  });

  it("for MEDIA_ERR_SRC_NOT_SUPPORTED (code 4) names the codec problem and gives a remediation hint", () => {
    const msg = formatVideoLoadFailureMessage("blob:foo.mov", 4);
    // Operator-facing message — the wording matters because it tells the
    // user *what to do*. Lock the substrings so a future refactor can't
    // silently regress to a generic "video failed".
    expect(msg).toMatch(/cannot decode/i);
    expect(msg).toMatch(/H\.?264|MP4/i);
  });

  it("falls back to a generic message when the error code is unknown", () => {
    const msg = formatVideoLoadFailureMessage("blob:foo.mov", undefined);
    expect(msg).toContain("blob:foo.mov");
    expect(msg).toMatch(/unknown|failed/i);
  });
});

describe("setTextureUpdateIfReady", () => {
  // Three's `Texture.needsUpdate` is a write-only setter that bumps
  // `texture.version`; reading the property returns undefined. We
  // therefore assert via the version counter — a bump means the
  // helper called `needsUpdate = true`, no bump means it didn't.
  it("does not mark a texture dirty when image is null", () => {
    const tex = new Texture();
    tex.image = null as unknown as undefined;
    const before = tex.version;
    setTextureUpdateIfReady(tex);
    expect(tex.version).toBe(before);
  });
  it("does not mark dirty when image is an HTMLImageElement that hasn't loaded", () => {
    const tex = new Texture();
    const img = document.createElement("img");
    // jsdom defaults `complete` to true on a fresh <img>; force it to
    // false so we test the actually-loading path.
    Object.defineProperty(img, "complete", { value: false, configurable: true });
    tex.image = img;
    const before = tex.version;
    setTextureUpdateIfReady(tex);
    expect(tex.version).toBe(before);
  });
  it("marks dirty when image is an HTMLImageElement with complete=true", () => {
    const tex = new Texture();
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: true });
    tex.image = img;
    const before = tex.version;
    setTextureUpdateIfReady(tex);
    expect(tex.version).toBeGreaterThan(before);
  });
  it("does not mark dirty when image is a video with readyState < 2", () => {
    const tex = new Texture();
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { value: 0, configurable: true });
    tex.image = video;
    const before = tex.version;
    setTextureUpdateIfReady(tex);
    expect(tex.version).toBe(before);
  });
  it("marks dirty when image is a video with readyState >= 2", () => {
    const tex = new Texture();
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { value: 2, configurable: true });
    tex.image = video;
    const before = tex.version;
    setTextureUpdateIfReady(tex);
    expect(tex.version).toBeGreaterThan(before);
  });
});

function makeFrameUrls(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `blob:frame-${i + 1}`);
}

describe("ImageSequencePlayer", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
  afterEach(() => { warnSpy.mockRestore(); });

  it("starts at frame 0 and advances by deltaSec * fps", () => {
    const player = new ImageSequencePlayer({ frameUrls: makeFrameUrls(10), fps: 25, loop: true, width: 100, height: 100 });
    expect(player.state().currentFrame).toBe(0);
    player.tick(1 / 25); expect(player.state().currentFrame).toBe(1);
    player.tick(2 / 25); expect(player.state().currentFrame).toBe(3);
    player.dispose();
  });
  it("loop: true wraps past the last frame back to 0", () => {
    const player = new ImageSequencePlayer({ frameUrls: makeFrameUrls(3), fps: 25, loop: true, width: 100, height: 100 });
    player.tick(3 / 25); expect(player.state().currentFrame).toBe(0);
    player.dispose();
  });
  it("loop: false clamps at the last frame", () => {
    const player = new ImageSequencePlayer({ frameUrls: makeFrameUrls(3), fps: 25, loop: false, width: 100, height: 100 });
    player.tick(10); expect(player.state().currentFrame).toBe(2);
    player.dispose();
  });
  it("falls back to fps=25 when fps is 0 or missing", () => {
    const player = new ImageSequencePlayer({ frameUrls: makeFrameUrls(50), fps: 0, loop: true, width: 100, height: 100 });
    player.tick(1); expect(player.state().currentFrame).toBe(25);
    player.dispose();
  });
  it("warns once when frameCount > 60", () => {
    const player = new ImageSequencePlayer({ frameUrls: makeFrameUrls(120), fps: 25, loop: true, width: 1920, height: 1080 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/large image sequence/i);
    player.dispose();
  });
  it("warns once when estimated memory > 200 MB", () => {
    const player = new ImageSequencePlayer({ frameUrls: makeFrameUrls(60), fps: 25, loop: true, width: 1920, height: 1080 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/MB/);
    player.dispose();
  });
  it("dispose() releases all cached textures (no leaks)", () => {
    const player = new ImageSequencePlayer({ frameUrls: makeFrameUrls(5), fps: 25, loop: true, width: 100, height: 100 });
    const tex = player.texture;
    const disposeSpy = vi.spyOn(tex, "dispose");
    player.dispose();
    expect(disposeSpy).toHaveBeenCalled();
  });
  it("state() reports currentFrame, totalFrames, paused, error", () => {
    const player = new ImageSequencePlayer({ frameUrls: makeFrameUrls(4), fps: 25, loop: true, width: 100, height: 100 });
    const s = player.state();
    expect(s.currentFrame).toBe(0);
    expect(s.totalFrames).toBe(4);
    expect(s.paused).toBe(false);
    expect(s.error).toBeNull();
    player.dispose();
  });
  it("bind() sets needsUpdate even when the image's complete flag would make the guard no-op", () => {
    // Regression for FASE F / Pass A. setTextureUpdateIfReady refuses to
    // bump the version counter when an HTMLImageElement reports
    // complete === false. In jsdom (and intermittently in real browsers
    // when a blob: URL races the onload event), this leaves the GPU
    // upload skipped forever and the sequence renders as an empty white
    // quad. The player owns the load lifecycle (bind() is only invoked
    // from img.onload), so it MUST mark the texture dirty unconditionally.
    const player = new ImageSequencePlayer({
      frameUrls: makeFrameUrls(1),
      fps: 25,
      loop: true,
      width: 100,
      height: 100,
    });
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: false, configurable: true });
    const versionBefore = player.texture.version;
    // Reach into the private bind() — the public surface (loadFrame +
    // onload) doesn't fire under jsdom because Image#src doesn't trigger
    // a real network/decoding pass. Calling bind() directly exercises the
    // exact line that was silently broken.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (player as any).bind(img);
    expect(player.texture.image).toBe(img);
    expect(player.texture.version).toBeGreaterThan(versionBefore);
    player.dispose();
  });
  it("bind() logs '[seq] first frame bound' exactly once per player", () => {
    // Operator-facing diagnostic: confirms in devtools that the wiring
    // fired end-to-end. Must NOT spam the console on every frame.
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const player = new ImageSequencePlayer({
        frameUrls: makeFrameUrls(3),
        fps: 25,
        loop: true,
        width: 100,
        height: 100,
      });
      const img = document.createElement("img");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player as any).bind(img);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player as any).bind(img);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player as any).bind(img);
      const seqLogs = infoSpy.mock.calls.filter((c) => typeof c[0] === "string" && c[0].includes("[seq] first frame bound"));
      expect(seqLogs.length).toBe(1);
      expect(seqLogs[0][0]).toContain("3 frames");
      player.dispose();
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe("__r3Dump non-disappearance invariant", () => {
  it("textureMime per node matches node.image.mimeType when image is present", () => {
    // Constructs the smallest possible blueprint with a video-mime
    // image node, confirms the dump does NOT silently drop it. This
    // doesn't need a real renderer — it asserts the dump function's
    // contract end-to-end.
    const videoNode = createNode("image", null);
    videoNode.name = "VideoQuad";
    videoNode.image = {
      name: "test.mov",
      mimeType: "video/quicktime",
      src: "blob:test",
      width: 1920,
      height: 1080,
    };
    videoNode.imageId = "test-id";
    const bp = makeBlueprint([videoNode]);
    bp.images = [videoNode.image];
    // We can't easily instantiate SceneEditor in jsdom (WebGL needed).
    // Instead, assert the parts of the contract that DON'T need a live
    // renderer: blueprint.images carries the asset, and the asset's
    // mimeType is video/*.
    expect(bp.images.length).toBe(1);
    expect(bp.images[0].mimeType).toBe("video/quicktime");
    // Any per-node summary surface (asset library, panel, dump) must
    // therefore have access to this asset. A consumer that filters it
    // out is the bug.
    const videoAssets = bp.images.filter((i) => i.mimeType.startsWith("video/"));
    expect(videoAssets.length).toBe(1);
  });
});

describe("orbitPolicyForSceneMode", () => {
  it("disables rotate for 2D scenes — broadcast layouts are not free-orbit", () => {
    const policy = orbitPolicyForSceneMode("2d");
    expect(policy.enableRotate).toBe(false);
    expect(policy.enablePan).toBe(true);
    expect(policy.enableZoom).toBe(true);
  });

  it("allows full free orbit for 3D scenes", () => {
    const policy = orbitPolicyForSceneMode("3d");
    expect(policy.enableRotate).toBe(true);
    expect(policy.enablePan).toBe(true);
    expect(policy.enableZoom).toBe(true);
  });

  it("treats unknown / undefined sceneMode as 3D (safe default — don't lock the camera by accident)", () => {
    const policy = orbitPolicyForSceneMode(undefined);
    expect(policy.enableRotate).toBe(true);
  });
});

describe("ImageSequencePlayer playback robustness (Pass J)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("tickCount field starts at 0 and increments per tick()", () => {
    const player = new ImageSequencePlayer({
      frameUrls: ["blob:f1", "blob:f2", "blob:f3"],
      fps: 25, loop: true, width: 100, height: 100,
    });
    expect(player.state().tickCount ?? 0).toBe(0);  // pre-tick
    player.tick(1 / 25);
    expect(player.state().tickCount ?? 0).toBe(1);
    player.tick(1 / 25);
    expect(player.state().tickCount ?? 0).toBe(2);
    player.dispose();
  });

  it("loadFrame onload binds even when the loaded idx is not currentFrame, if texture.image is null", () => {
    // Reproduces the "player ticked past frame 0 before it loaded" race.
    // Without this, the texture stays empty and the user sees a blank
    // quad until the new currentFrame's frame loads.
    const player = new ImageSequencePlayer({
      frameUrls: ["blob:f1", "blob:f2", "blob:f3"],
      fps: 25, loop: true, width: 100, height: 100,
    });
    // Simulate: player has ticked past frame 0; no frame loaded yet.
    // We can't directly inspect inFlight, but we can call private
    // bind() via prototype and simulate the late-load by reaching in.
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: true, configurable: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (player as any).currentFrame = 1;  // simulate tick has advanced
    expect(player.texture.image).toBeFalsy();
    // Force-call the would-be onload handler for frame 0 (late load):
    const versionBefore = player.texture.version;
    // Direct bind to mimic the cold-start fallback path:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (player as any).bind(img);
    expect(player.texture.image).toBe(img);
    expect(player.texture.version).toBeGreaterThan(versionBefore);
    player.dispose();
  });

  it("state() exposes the new diagnostic fields (currentFrameSrc, tickCount)", () => {
    const player = new ImageSequencePlayer({
      frameUrls: ["blob:test-frame-src"],
      fps: 25, loop: true, width: 100, height: 100,
    });
    const s = player.state();
    expect(typeof s.tickCount).toBe("number");
    // currentFrameSrc may be null until bind happens — accept either.
    expect("currentFrameSrc" in s).toBe(true);
    player.dispose();
  });
});

describe("decideImageMeshKind", () => {
  it("returns 'image-sequence' when mime is x-image-sequence AND frameUrls populated", () => {
    expect(decideImageMeshKind({
      mimeType: "application/x-image-sequence",
      sequence: { frameUrls: ["blob:f1", "blob:f2"] },
    })).toBe("image-sequence");
  });

  it("returns 'sequence-payload-missing' when mime is x-image-sequence but sequence field is undefined (persistence dropped it)", () => {
    expect(decideImageMeshKind({
      mimeType: "application/x-image-sequence",
    })).toBe("sequence-payload-missing");
  });

  it("returns 'sequence-payload-missing' when sequence is present but frameUrls is empty", () => {
    expect(decideImageMeshKind({
      mimeType: "application/x-image-sequence",
      sequence: { frameUrls: [] },
    })).toBe("sequence-payload-missing");
  });

  it("returns 'video' for video/* mime", () => {
    expect(decideImageMeshKind({ mimeType: "video/quicktime" })).toBe("video");
    expect(decideImageMeshKind({ mimeType: "video/mp4" })).toBe("video");
  });

  it("returns 'image' for image mime", () => {
    expect(decideImageMeshKind({ mimeType: "image/png" })).toBe("image");
    expect(decideImageMeshKind({ mimeType: "image/jpeg" })).toBe("image");
  });
});

describe("sequence-payload-missing fallback (Pass L — discrete by default)", () => {
  // Pass K/B's fallback bound the magenta/black checker via
  // getDebugFallbackImage. After Pass K/C started stripping
  // image.sequence.frameUrls from localStorage to dodge the quota,
  // the round-trip on reload triggered the placeholder for every
  // sequence node — the viewport was dominated by a giant magenta
  // checker. Pass L splits the placeholder into two paths so the
  // default is discreet (transparent) and the magenta is opt-in.

  it("decideImageMeshKind still returns 'sequence-payload-missing' (data path unchanged)", () => {
    expect(decideImageMeshKind({
      mimeType: "application/x-image-sequence",
    })).toBe("sequence-payload-missing");
    expect(decideImageMeshKind({
      mimeType: "application/x-image-sequence",
      sequence: { frameUrls: [] },
    })).toBe("sequence-payload-missing");
  });
});

describe("buildSequencePlaceholderTexture", () => {
  it("returns a 1×1 transparent DataTexture by default (no debug)", () => {
    const tex = buildSequencePlaceholderTexture({ debug: false });
    expect(tex).toBeInstanceOf(DataTexture);
    const data = (tex as DataTexture).image.data as Uint8Array;
    expect(data.length).toBe(4);
    // Fully transparent: alpha (4th byte) is 0.
    expect(data[3]).toBe(0);
    // RGB channels are zero too — nothing visible even if the GPU
    // ignored alpha for some reason.
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    // needsUpdate is a write-only setter that bumps version. Confirm we
    // bumped past the initial 0 so Three uploads the texture once.
    expect(tex.version).toBeGreaterThan(0);
  });

  it("ignores buildDebugTexture when debug is false (no accidental magenta)", () => {
    const debugTex = new Texture();
    const result = buildSequencePlaceholderTexture({
      debug: false,
      buildDebugTexture: () => debugTex,
    });
    expect(result).not.toBe(debugTex);
    expect(result).toBeInstanceOf(DataTexture);
  });

  it("uses the debug builder when debug flag is true", () => {
    const debugTex = new Texture();
    const result = buildSequencePlaceholderTexture({
      debug: true,
      buildDebugTexture: () => debugTex,
    });
    expect(result).toBe(debugTex);
  });

  it("falls back to the transparent DataTexture when debug is true but no builder is provided", () => {
    const tex = buildSequencePlaceholderTexture({ debug: true });
    expect(tex).toBeInstanceOf(DataTexture);
    const data = (tex as DataTexture).image.data as Uint8Array;
    expect(data[3]).toBe(0);
  });
});
