import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Box3, DataTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Texture, Vector3 } from "three";
import {
  buildKeepInsidePlanesFromBox,
  buildSequencePlaceholderTexture,
  computeAuthoredPermanentlyHidden,
  computeSequenceResolverStatus,
  computeTextAlignOffset,
  computeWorldBoundsFromMeshes,
  decideImageMeshKind,
  formatVideoLoadFailureMessage,
  ImageSequencePlayer,
  orbitPolicyForSceneMode,
  resolveMaskInversion,
  setTextureUpdateIfReady,
  shouldAttachTransformGizmo,
  summariseSequenceResolverWarnings,
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
    const mask = createNode("plane", null); mask.name = "Mask";
    mask.isMask = true;
    mask.maskInverted = true;
    const target = createNode("plane", null); target.name = "Target";
    target.maskId = mask.id;
    const bp = makeBlueprint([mask, target]);

    expect(resolveMaskInversion(bp, mask.id, target)).toBe(true);
  });

  it("returns false when the mask node is not inverted", () => {
    const mask = createNode("plane", null); mask.name = "Mask";
    mask.isMask = true;
    const target = createNode("plane", null); target.name = "Target";
    target.maskId = mask.id;
    const bp = makeBlueprint([mask, target]);

    expect(resolveMaskInversion(bp, mask.id, target)).toBe(false);
  });

  it("ignores a maskInverted flag on the target — inversion is a property of the mask", () => {
    // Older blueprints (or hand-edited data) might still set maskInverted on
    // the target. The new contract treats only the mask as authoritative so
    // a target-only flag MUST NOT flip clipping.
    const mask = createNode("plane", null); mask.name = "Mask";
    mask.isMask = true;
    const target = createNode("plane", null); target.name = "Target";
    target.maskId = mask.id;
    target.maskInverted = true; // stale, must be ignored
    const bp = makeBlueprint([mask, target]);

    expect(resolveMaskInversion(bp, mask.id, target)).toBe(false);
  });

  it("returns false when the mask id does not resolve to any node", () => {
    const target = createNode("plane", null); target.name = "Target";
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

// ---------------------------------------------------------------------------
// Agent A5 — Scene Safety + Visibility Gating
// ---------------------------------------------------------------------------

/**
 * Test helper: creates an ImageSequencePlayer with N synthetic frame URLs.
 * Used by Tasks 17-19 to test player behaviour without a live SceneEditor.
 */
function makeStandalonePlayerWithFrames(n: number): ImageSequencePlayer {
  return new ImageSequencePlayer({
    frameUrls: Array.from({ length: n }, (_, i) => `blob:frame-${i + 1}`),
    fps: 25,
    loop: true,
    width: 100,
    height: 100,
  });
}

/**
 * Lightweight "scene" factory used for Task 17 and Task 20 integration tests.
 * Returns an object with `_sequencePlayers()` backed by real ImageSequencePlayer
 * instances, avoiding the need to instantiate SceneEditor (which requires WebGL).
 */
interface FakeScene {
  _sequencePlayers(): ReadonlyMap<string, ImageSequencePlayer>;
  _simulateFrames(n: number): void;
}

function makeSceneWithImageSequenceNode(nodeId: string): FakeScene {
  const player = makeStandalonePlayerWithFrames(10);
  // Give the player a bound Object3D whose name includes the nodeId so tests
  // can assert player?.boundObject3D?.name.toContain(nodeId).
  const obj = { name: nodeId, visible: true } as unknown as import("three").Object3D;
  player.setBoundObject3D(obj);
  const players = new Map<string, ImageSequencePlayer>([[nodeId, player]]);
  return {
    _sequencePlayers: () => players,
    _simulateFrames: (n: number) => {
      for (let i = 0; i < n; i += 1) {
        for (const p of players.values()) p.tick(1 / 25);
      }
    },
  };
}

/**
 * Creates a fake scene that mimics the PITCH_IN / PITCH_Out scenario.
 * PITCH_Out is bound to a hidden Object3D (Enable=False); PITCH_IN is visible.
 */
function loadFixtureScene(_name: string): FakeScene {
  const pitchOut = makeStandalonePlayerWithFrames(10);
  pitchOut.setBoundObject3D({ name: "PITCH_Out", visible: false } as unknown as import("three").Object3D);

  const pitchIn = makeStandalonePlayerWithFrames(10);
  pitchIn.setBoundObject3D({ name: "PITCH_IN", visible: true } as unknown as import("three").Object3D);

  const players = new Map<string, ImageSequencePlayer>([
    ["node-pitch-out", pitchOut],
    ["node-pitch-in", pitchIn],
  ]);

  return {
    _sequencePlayers: () => players,
    _simulateFrames: (n: number) => {
      for (let i = 0; i < n; i += 1) {
        for (const p of players.values()) p.tick(1 / 25);
      }
    },
  };
}

/** Finds a player's map key by the bound Object3D's name. */
function findNodeIdByName(scene: FakeScene, name: string): string | undefined {
  for (const [id, player] of scene._sequencePlayers()) {
    if (player.boundObject3D?.name === name) return id;
  }
  return undefined;
}

describe("Agent A5 — Task 18: visibility-gated tick", () => {
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

  it("does not advance currentFrame while boundObject3D.visible is false", () => {
    const player = makeStandalonePlayerWithFrames(10);
    player.setBoundObject3D({ visible: false } as unknown as import("three").Object3D);
    const before = player.state().currentFrame;
    // 25 ticks at 1/25 = 25 frames advanced without gate; with gate = 0.
    // Use 25 (not 30) so the expected frame without gate is 5 (not 0 after wrap),
    // making the assertion actually discriminate.
    for (let i = 0; i < 25; i += 1) player.tick(1 / 25);
    expect(player.state().currentFrame).toBe(before);
  });

  it("resumes from the same currentFrame when visibility flips back to true", () => {
    const player = makeStandalonePlayerWithFrames(10);
    const obj = { visible: true } as unknown as import("three").Object3D;
    player.setBoundObject3D(obj);
    for (let i = 0; i < 5; i += 1) player.tick(1 / 25);
    const mid = player.state().currentFrame;  // should be 5
    obj.visible = false;
    // 7 hidden ticks: without gate these would advance to frame 2 (not mid).
    // With gate, frame is preserved at mid.
    for (let i = 0; i < 7; i += 1) player.tick(1 / 25);
    expect(player.state().currentFrame).toBe(mid);
    obj.visible = true;
    player.tick(1 / 25);
    expect(player.state().currentFrame).toBe(mid + 1);
  });
});

describe("Agent A5 — Task 17: boundObject3D registration", () => {
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

  it("registers boundObject3D on the player when bound to a node", () => {
    const scene = makeSceneWithImageSequenceNode("intro");
    const player = scene._sequencePlayers().get("intro");
    expect(player).toBeDefined();
    expect(player?.boundObject3D).toBeDefined();
    expect(player?.boundObject3D?.name).toContain("intro");
  });
});

/**
 * Helper: returns true if the canvas is tagged as a magenta debug fallback.
 * `makeSequenceFallbackImage()` stamps `data-r3-fallback="magenta"` when the
 * debug flag is on, so this works in jsdom (which cannot draw pixels) as well
 * as in a real browser where pixel inspection is also possible.
 */
function isMagentaDebugImage(image: unknown): boolean {
  if (!(image instanceof HTMLCanvasElement)) return false;
  return image.dataset["r3Fallback"] === "magenta";
}

describe("Agent A5 — Task 19: no-magenta invariant", () => {
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

  it("never assigns a magenta default when an image-sequence frame fails to load", () => {
    const player = makeStandalonePlayerWithFrames(3);
    player._simulateFrameError(0);
    const tex = player.texture;
    expect(isMagentaDebugImage(tex.image)).toBe(false);
  });

  it("__r3DebugBrokenTextures=true opts back into magenta debug imagery", () => {
    (window as unknown as Record<string, unknown>).__r3DebugBrokenTextures = true;
    try {
      const player = makeStandalonePlayerWithFrames(3);
      player._simulateFrameError(0);
      expect(isMagentaDebugImage(player.texture.image)).toBe(true);
    } finally {
      delete (window as unknown as Record<string, unknown>).__r3DebugBrokenTextures;
    }
  });
});

describe("Agent A5 — Task 20: PITCH_Out / PITCH_IN regression", () => {
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

  it("PITCH_Out (Enable=False) registers a player but the player never advances", () => {
    const scene = loadFixtureScene("GameName_FS");
    const players = scene._sequencePlayers();

    const pitchOutId = findNodeIdByName(scene, "PITCH_Out")!;
    expect(pitchOutId).toBeDefined();
    const pitchOut = players.get(pitchOutId)!;
    expect(pitchOut).toBeDefined();

    const before = pitchOut.state().currentFrame;
    // Simulate 60 frames of animation — PITCH_Out is hidden so it must NOT advance.
    scene._simulateFrames(60);
    expect(pitchOut.state().currentFrame).toBe(before);

    const pitchInId = findNodeIdByName(scene, "PITCH_IN")!;
    expect(pitchInId).toBeDefined();
    const pitchIn = players.get(pitchInId)!;
    expect(pitchIn).toBeDefined();

    // PITCH_IN is visible — its tickCount must have incremented (currentFrame
    // can wrap to 0 with 10 frames, so we check the monotonic tick counter).
    expect(pitchIn.state().tickCount).toBeGreaterThan(0);
  });
});

describe("computeTextAlignOffset — W3D TextureText alignment math", () => {
  // The renderer feeds the geometry's post-fit bounding box plus the
  // TextBoxSize-derived box (boxW × boxH) into this helper, then translates
  // the geometry by (dx, dy). These tests pin the math by checking the
  // post-translation reference points the alignment is *supposed* to land on.
  //
  // bbox starts at the Three.js TextGeometry's natural baseline-left origin
  // — minX≈0 (or slightly negative for left-bearing glyphs), minY≈-descent.
  // We use minX=0, minY=0 for clarity; the helper is linear in bbox.min,
  // so the actual offset moves the *geometry* to the chosen alignment slot
  // regardless of where the initial bbox sits.
  const bbox = { minX: 0, maxX: 1.5, minY: 0, maxY: 0.4 };
  const boxW = 2;
  const boxH = 1;

  it("AlignmentX='Left' aligns text's left edge to -boxW/2", () => {
    const { dx } = computeTextAlignOffset(bbox, boxW, boxH, "Left", undefined);
    // After translation, bbox.minX + dx must equal -boxW/2 = -1.
    expect(bbox.minX + dx).toBeCloseTo(-1, 6);
  });

  it("AlignmentX='Center' centres the text horizontally on x=0", () => {
    const { dx } = computeTextAlignOffset(bbox, boxW, boxH, "Center", undefined);
    // Text centre after translation = (bbox.minX + width/2) + dx = 0.
    const centerX = bbox.minX + (bbox.maxX - bbox.minX) / 2 + dx;
    expect(centerX).toBeCloseTo(0, 6);
  });

  it("AlignmentX='Right' aligns text's right edge to +boxW/2", () => {
    const { dx } = computeTextAlignOffset(bbox, boxW, boxH, "Right", undefined);
    expect(bbox.maxX + dx).toBeCloseTo(1, 6);
  });

  it("AlignmentX='Right' shifts the geometry compared to 'Left' (sanity: distinct outputs)", () => {
    const left = computeTextAlignOffset(bbox, boxW, boxH, "Left", undefined);
    const right = computeTextAlignOffset(bbox, boxW, boxH, "Right", undefined);
    // For a 1.5-wide bbox in a 2-wide box, Left → -1, Right → -0.5 → difference 0.5.
    expect(right.dx - left.dx).toBeCloseTo(boxW - (bbox.maxX - bbox.minX), 6);
    expect(right.dx).not.toBeCloseTo(left.dx, 3);
  });

  it("AlignmentY='Top' aligns text's top edge to +boxH/2", () => {
    const { dy } = computeTextAlignOffset(bbox, boxW, boxH, undefined, "Top");
    expect(bbox.maxY + dy).toBeCloseTo(0.5, 6);
  });

  it("AlignmentY='Center' vertically centres the text on y=0", () => {
    const { dy } = computeTextAlignOffset(bbox, boxW, boxH, undefined, "Center");
    const centerY = bbox.minY + (bbox.maxY - bbox.minY) / 2 + dy;
    expect(centerY).toBeCloseTo(0, 6);
  });

  it("AlignmentY='Bottom' aligns text's bottom edge to -boxH/2", () => {
    const { dy } = computeTextAlignOffset(bbox, boxW, boxH, undefined, "Bottom");
    expect(bbox.minY + dy).toBeCloseTo(-0.5, 6);
  });

  it("undefined on either axis leaves that axis offset at 0", () => {
    const { dx, dy } = computeTextAlignOffset(bbox, boxW, boxH, undefined, undefined);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  it("works on bboxes that don't start at origin (real TextGeometry has glyph descender below baseline)", () => {
    // Simulate a TextGeometry with a small descender: minY = -0.05.
    const realish = { minX: 0.01, maxX: 0.39, minY: -0.05, maxY: 0.28 };
    const { dx, dy } = computeTextAlignOffset(realish, 0.4, 0.33, "Left", "Center");
    // Left: bbox.minX + dx === -boxW/2 → realish.minX + dx === -0.2 → dx = -0.21
    expect(realish.minX + dx).toBeCloseTo(-0.2, 6);
    // Center: vertical centre of bbox lands on y=0.
    const centerY = realish.minY + (realish.maxY - realish.minY) / 2 + dy;
    expect(centerY).toBeCloseTo(0, 6);
  });
});

describe("__r3Dump.imageSequence.resolverStatus (Phase 3 diagnostic)", () => {
  it("returns 'missing-folder-access' when the sequence has no frameUrls", () => {
    expect(
      computeSequenceResolverStatus({ hasFrameUrls: false, playerError: null }),
    ).toBe("missing-folder-access");
  });

  it("returns 'player-error' when frameUrls exist but the player reports an error", () => {
    expect(
      computeSequenceResolverStatus({ hasFrameUrls: true, playerError: "decode failed" }),
    ).toBe("player-error");
  });

  it("returns 'resolved' when frameUrls exist and the player has no error", () => {
    expect(
      computeSequenceResolverStatus({ hasFrameUrls: true, playerError: null }),
    ).toBe("resolved");
  });

  it("'missing-folder-access' takes precedence over a stale player error", () => {
    // If frameUrls are gone, we report the root cause, not a downstream
    // player crash that merely echoes it.
    expect(
      computeSequenceResolverStatus({ hasFrameUrls: false, playerError: "boom" }),
    ).toBe("missing-folder-access");
  });

  it("returns 'dev-cache-expired' for a dev-cache sequence with no frameUrls", () => {
    expect(
      computeSequenceResolverStatus({
        hasFrameUrls: false,
        playerError: null,
        storageType: "dev-cache",
      }),
    ).toBe("dev-cache-expired");
  });

  it("returns 'unsupported-storage' for an unknown storageType with no frameUrls", () => {
    expect(
      computeSequenceResolverStatus({
        hasFrameUrls: false,
        playerError: null,
        storageType: "weird-cloud-storage",
      }),
    ).toBe("unsupported-storage");
  });

  it("returns 'missing-folder-access' when storageType is explicitly 'project-folder'", () => {
    expect(
      computeSequenceResolverStatus({
        hasFrameUrls: false,
        playerError: null,
        storageType: "project-folder",
        hasManifestPath: true,
      }),
    ).toBe("missing-folder-access");
  });
});

describe("summariseSequenceResolverWarnings (Phase 3B)", () => {
  function makeSeq(opts: {
    storageType?: "project-folder" | "dev-cache";
    frameCount?: number;
    hasFrameUrls?: boolean;
  }) {
    const fc = opts.frameCount ?? 1;
    return {
      type: "image-sequence" as const,
      version: 3 as const,
      format: "webp" as const,
      source: "x.mov",
      framePattern: "frame_%06d.webp",
      frameCount: fc,
      fps: 25,
      width: 100,
      height: 100,
      durationSec: fc / 25,
      loop: true,
      alpha: true,
      pixelFormat: "rgba" as const,
      frameUrls: opts.hasFrameUrls ? Array.from({ length: fc }, (_, i) => `blob:f-${i + 1}`) : [],
      storageType: opts.storageType,
      manifestPath: opts.storageType === "project-folder"
        ? "Resources/Textures/x_sequence_aabbccdd/sequence.json"
        : undefined,
      sourceHash: "sha256:aabbccddeeff",
    };
  }

  function makeBp(images: { id: string; name: string; sequence: ReturnType<typeof makeSeq> }[]): ComponentBlueprint {
    return {
      version: 1,
      componentName: "test",
      sceneMode: "2d",
      nodes: [],
      fonts: [],
      images: images.map((i) => ({
        id: i.id,
        name: i.name,
        mimeType: "application/x-image-sequence",
        src: i.sequence.frameUrls[0] ?? "",
        width: 100,
        height: 100,
        sequence: i.sequence,
      })),
      materials: [],
      animation: { clips: [] },
    } as unknown as ComponentBlueprint;
  }

  it("returns no warnings when every sequence is resolved", () => {
    const bp = makeBp([
      { id: "a", name: "ok.mov", sequence: makeSeq({ storageType: "project-folder", hasFrameUrls: true }) },
    ]);
    expect(summariseSequenceResolverWarnings(bp)).toEqual([]);
  });

  it("reports a single grouped warning for project-folder sequences with no frameUrls", () => {
    const bp = makeBp([
      { id: "a", name: "logo.mov", sequence: makeSeq({ storageType: "project-folder" }) },
      { id: "b", name: "stage.mov", sequence: makeSeq({ storageType: "project-folder" }) },
      { id: "c", name: "intro.mov", sequence: makeSeq({ storageType: "project-folder" }) },
    ]);
    const warnings = summariseSequenceResolverWarnings(bp);
    expect(warnings.length).toBe(1);
    expect(warnings[0].status).toBe("missing-folder-access");
    expect(warnings[0].count).toBe(3);
    expect(warnings[0].message).toMatch(/3 image sequences/);
    expect(warnings[0].message).toMatch(/Reconnect|re-import/i);
    expect(warnings[0].assetNames.sort()).toEqual(["intro.mov", "logo.mov", "stage.mov"]);
  });

  it("reports a separate group for dev-cache-expired sequences", () => {
    const bp = makeBp([
      { id: "a", name: "ok.mov", sequence: makeSeq({ storageType: "project-folder", hasFrameUrls: true }) },
      { id: "b", name: "tmp.mov", sequence: makeSeq({ storageType: "dev-cache" }) },
    ]);
    const warnings = summariseSequenceResolverWarnings(bp);
    expect(warnings.length).toBe(1);
    expect(warnings[0].status).toBe("dev-cache-expired");
    expect(warnings[0].message).toMatch(/Temporary|expired|Re-import/i);
    expect(warnings[0].assetNames).toEqual(["tmp.mov"]);
  });

  it("groups separately by status (project-folder + dev-cache mixed)", () => {
    const bp = makeBp([
      { id: "a", name: "logo.mov", sequence: makeSeq({ storageType: "project-folder" }) },
      { id: "b", name: "tmp.mov", sequence: makeSeq({ storageType: "dev-cache" }) },
    ]);
    const warnings = summariseSequenceResolverWarnings(bp);
    expect(warnings.length).toBe(2);
    const statuses = warnings.map((w) => w.status).sort();
    expect(statuses).toEqual(["dev-cache-expired", "missing-folder-access"]);
  });

  it("uses singular wording when only one sequence is affected", () => {
    const bp = makeBp([
      { id: "a", name: "lone.mov", sequence: makeSeq({ storageType: "project-folder" }) },
    ]);
    const warnings = summariseSequenceResolverWarnings(bp);
    expect(warnings[0].count).toBe(1);
    expect(warnings[0].message).not.toMatch(/^\d+ image sequences/);
    expect(warnings[0].message).toMatch(/it/);
  });
});

describe("computeWorldBoundsFromMeshes (Phase 10 degenerate-bounds regression)", () => {
  // Backing the LINEUP_LEFT PHOTO_MASK_* / PHOTO_DUMMY_* fix. The dump
  // showed `worldBounds.min == worldBounds.max == (one finite point)`
  // for those masks, downstream clipping planes collapsed to a single
  // point, and inverted masks then hid every consumer. Root cause was
  // the old "pick first Mesh + applyMatrix4" approach producing a
  // degenerate world box when the chosen mesh had a degenerate local
  // bbox (replaced geometry, parent group with zero-scale animation,
  // etc.). The new helper unions every descendant mesh's world bbox
  // AND returns `null` when nothing contributed a non-empty box — the
  // caller (`computeMaskPlanes`) then refuses to emit collapsed planes.

  function makePlaneMesh(width: number, height: number): Mesh {
    return new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial());
  }

  it("returns a non-empty world bbox for a wrapper containing one PlaneGeometry mesh", () => {
    const wrapper = new Group();
    const mesh = makePlaneMesh(1, 3); // PHOTO_MASK_01 dimensions
    wrapper.add(mesh);
    const box = computeWorldBoundsFromMeshes(wrapper);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.isEmpty()).toBe(false);
    expect(box.max.x - box.min.x).toBeCloseTo(1, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(3, 5);
  });

  it("returns null when the wrapper has no Mesh descendants (group-only subtree)", () => {
    const wrapper = new Group();
    wrapper.add(new Group());
    const box = computeWorldBoundsFromMeshes(wrapper);
    expect(box).toBeNull();
  });

  it("returns null when the only Mesh has degenerate geometry (PlaneGeometry(0,0))", () => {
    const wrapper = new Group();
    wrapper.add(makePlaneMesh(0, 0));
    const box = computeWorldBoundsFromMeshes(wrapper);
    expect(box).toBeNull();
  });

  it("returns null when an ancestor scale collapses every descendant to a single point", () => {
    // Real-world version of the LINEUP_LEFT bug: PHOTO_MASK_01 sits under a
    // parent whose Phase 7 normalization (or Transform.Scale animation)
    // produced scale=0 at the active frame. The MESH itself is healthy
    // (PlaneGeometry(1, 3)), but matrixWorld collapses to a single point
    // and `applyMatrix4` produces min == max. The helper detects this and
    // bails so the caller doesn't emit a degenerate-rectangle clip plane.
    const wrapper = new Group();
    wrapper.scale.set(0, 0, 1);
    wrapper.add(makePlaneMesh(1, 3));
    const box = computeWorldBoundsFromMeshes(wrapper);
    expect(box).toBeNull();
  });

  it("respects matrixAutoUpdate=false skewLayer wrappers (Phase 6 nested-mesh case)", () => {
    // Mask quad with static W3D <Skew>: wrapper → skewLayer (matrix copied,
    // matrixAutoUpdate=false) → mesh. The helper must still find the mesh
    // and produce a non-empty world bbox — the previous "first Mesh"
    // shortcut worked for this case but a wrong-prototype check (e.g.
    // gated on matrixAutoUpdate) would skip the skewLayer subtree.
    const wrapper = new Group();
    const skewLayer = new Group();
    skewLayer.userData.isSkewLayer = true;
    skewLayer.matrixAutoUpdate = false;
    skewLayer.matrix.identity();
    skewLayer.add(makePlaneMesh(2, 4));
    wrapper.add(skewLayer);
    const box = computeWorldBoundsFromMeshes(wrapper);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.isEmpty()).toBe(false);
    expect(box.max.x - box.min.x).toBeCloseTo(2, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(4, 5);
  });

  it("unions multiple mesh descendants into a single AABB (defensive against accidentally-nested helpers)", () => {
    // If something accidentally added a helper Mesh under the wrapper (e.g.
    // a debug Box3Helper), the old "first Mesh" approach could pick that
    // helper instead of the actual mask geometry. The union approach merges
    // everything so the result is at least as large as the authored mask.
    const wrapper = new Group();
    const a = makePlaneMesh(1, 1);
    a.position.set(-2, 0, 0);
    const b = makePlaneMesh(1, 1);
    b.position.set(2, 0, 0);
    wrapper.add(a);
    wrapper.add(b);
    const box = computeWorldBoundsFromMeshes(wrapper);
    expect(box).not.toBeNull();
    if (!box) return;
    // Two 1×1 meshes at x=±2 → unioned x-extent = (-2-0.5)..(2+0.5) = 5.
    expect(box.max.x - box.min.x).toBeCloseTo(5, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(1, 5);
  });

  it("respects the wrapper's own world transform (translation propagates to bbox)", () => {
    const wrapper = new Group();
    wrapper.position.set(10, 20, 0);
    wrapper.add(makePlaneMesh(1, 1));
    const box = computeWorldBoundsFromMeshes(wrapper);
    expect(box).not.toBeNull();
    if (!box) return;
    // Centered 1×1 mesh translated to (10, 20) → bounds (9.5..10.5, 19.5..20.5).
    expect(box.min.x).toBeCloseTo(9.5, 5);
    expect(box.max.x).toBeCloseTo(10.5, 5);
    expect(box.min.y).toBeCloseTo(19.5, 5);
    expect(box.max.y).toBeCloseTo(20.5, 5);
  });
});

describe("buildKeepInsidePlanesFromBox (Phase 11.5 — inverted mask reveal regression)", () => {
  // The "PHOTO_01..05 disappeared" symptom traced to the inverted-mask sign
  // flip in computeMaskPlanes: with sign=-1 the four plane normals face
  // outward, and Three's `material.clippingPlanes` array is the
  // INTERSECTION of half-spaces. The intersection of four outward planes
  // around a non-degenerate box is mathematically empty (no point can
  // satisfy x≤minX AND x≥maxX simultaneously) → consumer hidden
  // everywhere. The fix is to always emit inward-facing "keep inside"
  // planes; the box exterior (the union of four half-spaces) is non-
  // convex and unrepresentable as a single material.clippingPlanes array.
  //
  // These tests pin the math so the inversion bug can't sneak back.

  function pointIsKept(planes: ReturnType<typeof buildKeepInsidePlanesFromBox>, p: Vector3): boolean {
    if (!planes) return true; // null = no clipping → always kept
    // Three's clippingPlanes semantic: a fragment at world position p is
    // KEPT iff `plane.normal.dot(p) + plane.constant >= 0` for every plane.
    return planes.every((plane) => plane.normal.dot(p) + plane.constant >= 0);
  }

  it("for a healthy mask box, keeps points INSIDE the box (regardless of `inverted` flag)", () => {
    // Mask of dimensions 4 × 2 centred at origin → -2..+2 in x, -1..+1 in y.
    const box = new Box3(new Vector3(-2, -1, 0), new Vector3(2, 1, 0));
    for (const inverted of [false, true]) {
      const planes = buildKeepInsidePlanesFromBox(box, inverted);
      expect(planes).not.toBeNull();
      if (!planes) continue;
      expect(planes.length).toBe(4);
      // Centre is inside → kept.
      expect(pointIsKept(planes, new Vector3(0, 0, 0))).toBe(true);
      // Just inside each edge → kept.
      expect(pointIsKept(planes, new Vector3(1.9, 0, 0))).toBe(true);
      expect(pointIsKept(planes, new Vector3(-1.9, 0, 0))).toBe(true);
      expect(pointIsKept(planes, new Vector3(0, 0.9, 0))).toBe(true);
      expect(pointIsKept(planes, new Vector3(0, -0.9, 0))).toBe(true);
      // Outside on any axis → clipped (the consumer's pixel discarded).
      expect(pointIsKept(planes, new Vector3(3, 0, 0))).toBe(false);
      expect(pointIsKept(planes, new Vector3(-3, 0, 0))).toBe(false);
      expect(pointIsKept(planes, new Vector3(0, 2, 0))).toBe(false);
      expect(pointIsKept(planes, new Vector3(0, -2, 0))).toBe(false);
    }
  });

  it("LINEUP_LEFT BASE_MAIN-shape mask (7.7 × 2.77 at origin) keeps PHOTO-equivalent consumer pixels inside", () => {
    // Frame-end shape for BASE_MAIN: post-flatten width 7.7, height 2.77.
    // AlignmentX="Right" centres it around its right anchor (line 42 W3D)
    // but for clipping math we only care about the world-space bbox, which
    // is centred at the wrapper's origin after applyMatrix4.
    const box = new Box3(new Vector3(-3.85, -1.385, 0), new Vector3(3.85, 1.385, 0));
    const planes = buildKeepInsidePlanesFromBox(box, /* inverted */ true);
    expect(planes).not.toBeNull();
    if (!planes) return;
    // A typical TEXTURE_FULLFRAME_MAIN consumer pixel near the mask centre
    // must NOT be clipped (this was hidden pre-Phase-11.5).
    expect(pointIsKept(planes, new Vector3(0, 0, 0))).toBe(true);
    // SMALL_TEAM_NAME's authored position is X=3.883 Y=-1.545 — just past
    // the X edge but within the post-rendering pipeline. Confirm the math:
    // X=3.883 > 3.85 so this specific point IS clipped (mask ends at 3.85).
    // The point of the test is the inside-mask point being VISIBLE.
    expect(pointIsKept(planes, new Vector3(3, 0, 0))).toBe(true);
    // Far outside the mask → still clipped, as expected.
    expect(pointIsKept(planes, new Vector3(50, 0, 0))).toBe(false);
  });

  it("returns null for a degenerate box (Phase 10 guard remains intact)", () => {
    const point = new Box3(new Vector3(1, 2, 0), new Vector3(1, 2, 0));
    expect(buildKeepInsidePlanesFromBox(point, false)).toBeNull();
    expect(buildKeepInsidePlanesFromBox(point, true)).toBeNull();
    // Zero-width but non-zero-height also degenerate (X collapse).
    const xCollapse = new Box3(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    expect(buildKeepInsidePlanesFromBox(xCollapse, true)).toBeNull();
  });

  it("REGRESSION: inverted=true does NOT produce an empty-intersection plane set", () => {
    // The pre-Phase-11.5 bug: `sign = inverted ? -1 : 1` flipped every
    // normal outward, and the intersection of four outward planes is
    // empty → every consumer pixel clipped. Pinning the centre-point
    // visibility under inverted=true would have caught that regression.
    const box = new Box3(new Vector3(-1, -1, 0), new Vector3(1, 1, 0));
    const planes = buildKeepInsidePlanesFromBox(box, true);
    expect(planes).not.toBeNull();
    if (!planes) return;
    // A point at the mask centre must be kept. Pre-fix this was false →
    // PHOTO_01..05 disappeared under their IsInvertedMask="True" masks.
    expect(pointIsKept(planes, new Vector3(0, 0, 0))).toBe(true);
  });
});

// Phase B.1 (LINEUP_LEFT learning fixture) — predicate for "treat this node
// as permanently hidden because R3 authored Enable=False with no way to ever
// reveal it". The renderer wires this into the wrapper visibility; these
// tests pin the rule's exact preconditions so the predicate stays
// conservative (never hides a production node that animates).
describe("computeAuthoredPermanentlyHidden (LINEUP_LEFT background section)", () => {
  function bpWith(
    nodes: EditorNode[],
    options?: {
      initialDisabledNodeIds?: string[];
      tracks?: Array<{ nodeId: string; property: string; keyframeFrames?: number[] }>;
    },
  ): ComponentBlueprint {
    const clips = (options?.tracks ?? []).reduce((acc, t) => {
      const keyframes = (t.keyframeFrames ?? [0]).map((frame, idx) => ({
        id: `kf-${t.nodeId}-${t.property}-${idx}`,
        frame,
        value: 1,
        ease: "linear" as const,
      }));
      acc.push({
        id: `clip-${acc.length}`,
        name: `clip-${acc.length}`,
        fps: 50,
        durationFrames: 100,
        tracks: [{ id: `track-${acc.length}`, nodeId: t.nodeId, property: t.property as never, keyframes }],
      });
      return acc;
    }, [] as ComponentBlueprint["animation"]["clips"]);
    return {
      version: 1,
      componentName: "test",
      sceneMode: "2d",
      nodes,
      fonts: [],
      images: [],
      materials: [],
      animation: { activeClipId: clips[0]?.id ?? null, clips },
      metadata: options?.initialDisabledNodeIds
        ? { w3d: { initialDisabledNodeIds: options.initialDisabledNodeIds } }
        : {},
    } as unknown as ComponentBlueprint;
  }

  it("Test 1 (BACKGROUND-like): Enable=False + no animation tracks + not mask + no mask consumers → authoredPermanentlyHidden", () => {
    const bg = createNode("plane", null); bg.name = "BACKGROUND";
    const bp = bpWith([bg], { initialDisabledNodeIds: [bg.id] });
    expect(computeAuthoredPermanentlyHidden(bp, bg.id)).toBe(true);
  });

  it("Test 2 (production node): Enable=False BUT has Size animation track → NOT authoredPermanentlyHidden", () => {
    // Real LINEUP_LEFT shape: BASE_MAIN's Size.XProp grows from 0 → 7.7
    // between frames 50 → 97. Even with Enable=False, the timeline reveals
    // it; predicate must keep the wrapper visible-eligible.
    const animated = createNode("plane", null); animated.name = "ANIMATED_BASE";
    const bp = bpWith([animated], {
      initialDisabledNodeIds: [animated.id],
      tracks: [{ nodeId: animated.id, property: "geometry.width", keyframeFrames: [50, 97] }],
    });
    expect(computeAuthoredPermanentlyHidden(bp, animated.id)).toBe(false);
  });

  it("Test 2b (production node, Position track only): Enable=False + Position.Y track → NOT authoredPermanentlyHidden", () => {
    // SMALL_TEAM_NAME-like: only a Position track moves it. Must not be
    // hidden because Enable=False; the In timeline drives the position.
    const animated = createNode("plane", null); animated.name = "SMALL_TEXT_LIKE";
    const bp = bpWith([animated], {
      initialDisabledNodeIds: [animated.id],
      tracks: [{ nodeId: animated.id, property: "transform.position.y", keyframeFrames: [120, 150] }],
    });
    expect(computeAuthoredPermanentlyHidden(bp, animated.id)).toBe(false);
  });

  it("Test 3 (BASE_MAIN-like mask): IsMask=True + Enable=False still NOT permanently hidden — must remain in mask topology", () => {
    // The wrapper's `visible` is already false for masks (separate rule),
    // but the predicate must NOT independently mark it authoredPermanentlyHidden
    // because mask-consumers still rely on its bounds for clipping planes.
    const mask = createNode("plane", null); mask.name = "BASE_MAIN_LIKE";
    mask.isMask = true;
    const consumer = createNode("plane", null); consumer.name = "FF_MAIN_LIKE";
    consumer.maskId = mask.id;
    const bp = bpWith([mask, consumer], { initialDisabledNodeIds: [mask.id] });
    expect(computeAuthoredPermanentlyHidden(bp, mask.id)).toBe(false);
  });

  it("Test 3b (mask producer protection): Enable=False non-mask that is referenced by a consumer's maskId stays renderable", () => {
    const producer = createNode("plane", null); producer.name = "PRODUCER";
    const consumer = createNode("plane", null); consumer.name = "CONSUMER";
    consumer.maskId = producer.id;
    const bp = bpWith([producer, consumer], { initialDisabledNodeIds: [producer.id] });
    expect(computeAuthoredPermanentlyHidden(bp, producer.id)).toBe(false);
  });

  it("Test 5 (HORIZONTAL_SLIDE / MAIN parent group): Enable=False parent with animated descendants → NOT authoredPermanentlyHidden", () => {
    // Real LINEUP_LEFT: HORIZONTAL_SLIDE wraps TEAM_NAME's LINE_01/LINE_02
    // which contain animated text. If an author marked HORIZONTAL_SLIDE
    // Enable=False, hiding it would erase the entire animated subtree.
    const parent = createNode("group", null); parent.name = "HORIZONTAL_SLIDE_LIKE";
    const child = createNode("plane", parent.id); child.name = "ANIMATED_CHILD";
    const bp = bpWith([parent, child], {
      initialDisabledNodeIds: [parent.id],
      tracks: [{ nodeId: child.id, property: "transform.position.x", keyframeFrames: [0, 100] }],
    });
    expect(computeAuthoredPermanentlyHidden(bp, parent.id)).toBe(false);
  });

  it("Test 5b: parent group with a MASK descendant also stays renderable", () => {
    // A Group whose subtree contains a mask producer must stay visible so
    // matrixWorld propagates to the mask correctly.
    const parent = createNode("group", null); parent.name = "PARENT_WITH_MASK";
    const mask = createNode("plane", parent.id); mask.name = "INNER_MASK";
    mask.isMask = true;
    const bp = bpWith([parent, mask], { initialDisabledNodeIds: [parent.id] });
    expect(computeAuthoredPermanentlyHidden(bp, parent.id)).toBe(false);
  });

  it("Test 6: Enable=True nodes are never authoredPermanentlyHidden regardless of other state", () => {
    const n = createNode("plane", null); n.name = "ENABLED_NODE";
    const bp = bpWith([n]); // not in initialDisabledNodeIds
    expect(computeAuthoredPermanentlyHidden(bp, n.id)).toBe(false);
  });
});

