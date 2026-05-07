import { describe, expect, it } from "vitest";
import { parseW3D, decideSequenceLogStatus } from "./w3d";
import type { EditorNode, ImageAsset } from "../types";
// Vite's ?raw import keeps the test runtime self-contained without Node fs.
import testSceneXml from "../../test/fixtures/w3d/TestScene.w3d?raw";
import gameNameFsXml from "../../test/fixtures/w3d/GameName_FS.w3d?raw";

describe("W3D import", () => {
  it("parses the simple TestScene fixture", () => {
    const result = parseW3D(testSceneXml, { sceneName: "TestScene" });

    expect(result.blueprint.componentName).toBe("TestScene");
    const root = result.blueprint.nodes.find((node) => node.parentId === null);
    expect(root?.type).toBe("group");

    const disk = result.blueprint.nodes.find((node) => node.name === "Disk1");
    expect(disk?.type).toBe("circle");
    expect(disk?.transform.position.x).toBeCloseTo(-4.19);
    if (disk?.type === "circle") {
      expect(disk.geometry.radius).toBeCloseTo(0.5);
      // 3Forge stores arc length in `thetaStarts` (yes, naming is reversed).
      expect(disk.geometry.thetaStarts).toBeCloseTo(Math.PI * 2, 3);
      // Start angle is stored in `thetaLenght`.
      expect(disk.geometry.thetaLenght).toBeCloseTo(0, 3);
    }

    expect(result.blueprint.animation.clips.length).toBe(2);
    const clipNames = result.blueprint.animation.clips.map((c) => c.name).sort();
    expect(clipNames).toEqual(["In", "Out"]);

    const inClip = result.blueprint.animation.clips.find((c) => c.name === "In");
    const track = inClip?.tracks[0];
    expect(track?.property).toBe("transform.position.x");
    expect(track?.keyframes.length).toBe(2);

    expect(result.warnings.some((w) => w.includes("DirectionalLight"))).toBe(true);
  });

  it("uses 25 fps for HD1080i50 timeline format", () => {
    const result = parseW3D(testSceneXml, { sceneName: "TestScene" });
    for (const clip of result.blueprint.animation.clips) {
      expect(clip.fps).toBe(25);
    }
  });

  it("parses the complex GameName_FS fixture without crashing", () => {
    const result = parseW3D(gameNameFsXml, { sceneName: "GameName_FS" });

    expect(result.blueprint.componentName).toBe("GameName_FS");
    expect(result.blueprint.nodes.length).toBeGreaterThan(20);

    const planes = result.blueprint.nodes.filter((node) => node.type === "plane");
    expect(planes.length).toBeGreaterThan(10);

    const groupNames = result.blueprint.nodes
      .filter((node) => node.type === "group")
      .map((node) => node.name);
    expect(groupNames).toContain("TEMPLATE");
    expect(groupNames).toContain("CONTENT");

    const texts = result.blueprint.nodes.filter((node) => node.type === "text");
    expect(texts.length).toBeGreaterThan(0);

    const clipNames = result.blueprint.animation.clips.map((c) => c.name);
    expect(clipNames).toContain("In");

    const maskNodes = result.blueprint.nodes.filter((n) => n.isMask === true);
    expect(maskNodes.length).toBeGreaterThan(0);
    const maskedNodes = result.blueprint.nodes.filter((n) => typeof n.maskId === "string");
    expect(maskedNodes.length).toBeGreaterThan(0);
    // Every maskId must point to a node that exists and is itself a mask.
    for (const masked of maskedNodes) {
      const mask = result.blueprint.nodes.find((n) => n.id === masked.maskId);
      expect(mask?.isMask).toBe(true);
    }
  });

  it("resolves <ImageSequence> resources to image nodes when supplied as video assets", () => {
    // GameName_FS references four .mov clips via <ImageSequence> entries in
    // <Resources>. Without the ImageSequence lookup the parser would treat
    // the layer's Texture GUID as unresolved and fall back to a plane.
    const videoFilenames = [
      "04_Game_Name_PITCH_IN.mov",
      "04_Game_Name_PITCH_OUT.mov",
      "CompetitionLogo_In.mov",
      "NEW LKL logo_LOOP_alt.mov",
    ];
    const textures = new Map<string, ImageAsset>();
    for (const name of videoFilenames) {
      textures.set(name, {
        name,
        mimeType: "video/quicktime",
        src: `blob:mock-${name}`,
        width: 1920,
        height: 1080,
      });
    }

    const result = parseW3D(gameNameFsXml, { sceneName: "GameName_FS", textures });

    const imageNodes = result.blueprint.nodes.filter((n) => n.type === "image");
    const videoImageNodes = imageNodes.filter(
      (n) => n.type === "image" && n.image.mimeType.startsWith("video/"),
    );
    expect(videoImageNodes.length).toBe(videoFilenames.length);

    // The parser must not also report the four ImageSequence GUIDs as missing.
    const missingWarning = result.warnings.find((w) => w.startsWith("Missing"));
    if (missingWarning) {
      for (const name of videoFilenames) {
        expect(missingWarning).not.toContain(name);
      }
    }
  });

  it("invariant: every <ImageSequence>-backed quad in GameName_FS produces an image node with video/* mime", () => {
    // Locks the parser side of the non-disappearance invariant
    // (FASE D / Pass 4). Even if a downstream surface drops these,
    // the parser must always emit them — that's the contract the rest
    // of the system can rely on.
    const videoFilenames = [
      "04_Game_Name_PITCH_IN.mov",
      "04_Game_Name_PITCH_OUT.mov",
      "CompetitionLogo_In.mov",
      "NEW LKL logo_LOOP_alt.mov",
    ];
    const textures = new Map<string, ImageAsset>();
    for (const name of videoFilenames) {
      textures.set(name, {
        name,
        mimeType: "video/quicktime",
        src: `blob:mock-${name}`,
        width: 1920,
        height: 1080,
      });
    }
    const result = parseW3D(gameNameFsXml, {
      sceneName: "GameName_FS",
      textures,
      videos: new Set(videoFilenames),
    });
    const videoNodes = result.blueprint.nodes.filter(
      (n) => n.type === "image" && n.image.mimeType.startsWith("video/"),
    );
    // GameName_FS contains four <Quad>s textured by an <ImageSequence>:
    // PITCH_IN, PITCH_Out, CompLogo_In, CompLogo_In_shadow. Two of them
    // (CompLogo_In + its shadow) share the same TextureLayer GUID, so
    // they reference the same .mov asset. Net result: 4 video image
    // nodes, 3 unique video assets in blueprint.images. The contract
    // we lock here is "no video node disappears" — both the per-node
    // count and the asset-library presence must hold.
    expect(videoNodes.length).toBe(4);
    // Every video node MUST appear in blueprint.images so the asset
    // library can show it. Compare by stable id rather than count to
    // catch the case where a node points at an asset that got dropped
    // from blueprint.images during dedup.
    const videoAssets = result.blueprint.images.filter((img) =>
      img.mimeType.startsWith("video/"),
    );
    const videoAssetIds = new Set(videoAssets.map((a) => a.id));
    for (const n of videoNodes) {
      if (n.type !== "image") continue;
      expect(n.imageId).toBeTruthy();
      expect(videoAssetIds.has(n.imageId!)).toBe(true);
    }
    // Static fixture binds three of the four .mov ImageSequences via
    // TextureLayer/TextureMappingOption (CompetitionLogo_In.mov is
    // wired up at runtime by an ExportProperty, not statically).
    expect(videoAssets.length).toBe(3);
  });

  it("converts animated TextureMappingOption.Offset/Scale into material.textureOptions tracks", () => {
    // GameName_FS animates TextureMappingOption.Offset.YProp on a TextureLayer
    // shared by HOME_1/HOME_2/HOME_3 (etc). Without TextureLayer-aware
    // resolution these tracks would be aggregated as "no track mapping".
    const result = parseW3D(gameNameFsXml, { sceneName: "GameName_FS" });

    const offsetVTracks = result.blueprint.animation.clips.flatMap((clip) =>
      clip.tracks.filter((t) => t.property === "material.textureOptions.offsetV"),
    );
    expect(offsetVTracks.length).toBeGreaterThan(0);
    // R3 V grows downward, Three's grows upward. The keyframe values must
    // be sign-flipped at decode time to match the static parseTextureSamplingOptions.
    const allValues = offsetVTracks.flatMap((t) => t.keyframes.map((k) => k.value));
    expect(allValues.some((v) => v !== 0)).toBe(true);

    // No skip warning should mention the now-supported AnimatedProperty.
    const skippedOffsetWarning = result.warnings.find((w) =>
      w.includes("TextureMappingOption.Offset"),
    );
    expect(skippedOffsetWarning).toBeUndefined();

    // The path is registered in the AnimationPropertyPath union; the type
    // narrowing of `t.property === "material.textureOptions.offsetV"` above
    // is the static guarantee. As a runtime cross-check, confirm at least
    // one track resolves to an actual node id we imported.
    const nodeIds = new Set(result.blueprint.nodes.map((n) => n.id));
    for (const track of offsetVTracks) {
      expect(nodeIds.has(track.nodeId)).toBe(true);
    }
  });

  it("invariant: image-sequence assets are treated as alpha-bearing (transparent material)", async () => {
    // PNG sequences produced by scripts/movConversion.mjs always carry an
    // alpha channel (ffmpeg -pix_fmt rgba). assetHasAlphaChannel must
    // recognise them so imageNode.material.transparent fires; otherwise
    // sequence overlays render as opaque rectangles instead of cutouts.
    const enc = new TextEncoder();
    const minimalXml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><Resources>
<ImageSequence Id="seq1" Name="PITCH_IN.mov"/>
<TextureLayer Id="LY1"><TextureMappingOption Texture="seq1"/></TextureLayer>
</Resources><SceneLayer><SceneNode><Children>
<Quad Id="q1" Name="PITCH_IN">
<Primitive><FaceMappingList>
<NamedBaseFaceMapping TextureLayerId="LY1"/>
</FaceMappingList></Primitive>
</Quad></Children></SceneNode></SceneLayer></Scene>`;
    void enc;

    // Inject a sequence directly via the parseW3D `sequences` option,
    // bypassing parseW3DFromFolder's file-walking. This isolates the
    // parser's material-binding behaviour.
    const sequences = new Map<string, import("../types").ImageSequenceMetadata>();
    sequences.set("PITCH_IN.mov", {
      version: 1,
      type: "image-sequence",
      source: "PITCH_IN.mov",
      framePattern: "frame_%06d.png",
      frameCount: 3,
      fps: 25,
      width: 1920,
      height: 1080,
      durationSec: 0.12,
      loop: true,
      alpha: true,
      pixelFormat: "rgba",
      frameUrls: ["blob:f1", "blob:f2", "blob:f3"],
    });

    // We also need the asset present in the textures map so the parser
    // resolves the layer to an asset before applying the sequence swap.
    const textures = new Map<string, import("../types").ImageAsset>();
    textures.set("PITCH_IN.mov", {
      name: "PITCH_IN.mov",
      mimeType: "video/quicktime",
      src: "blob:src-mov",
      width: 0,
      height: 0,
    });

    const result = parseW3D(minimalXml, {
      sceneName: "ASeqAlpha",
      textures,
      videos: new Set(["PITCH_IN.mov"]),
      sequences,
    });

    const node = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    expect(node?.type).toBe("image");
    if (node?.type !== "image") return;
    expect(node.image.mimeType).toBe("application/x-image-sequence");
    // The actual contract under test:
    expect(node.material.transparent).toBe(true);
    expect(node.material.alphaTest).toBeGreaterThan(0);
  });

  it("invariant: initially-disabled video/image-sequence nodes stay hidden (broadcast take-out animations are content, not scaffolding)", () => {
    // GameName_FS's PITCH_Out is Enable="False" in the XML — it's the
    // take-out sweep animation, intended to render only when the
    // runtime triggers it. The "design-view" rule that promotes
    // scaffolding (HELPERS/ESCONDER) to visible should NOT apply here.
    const videoFilenames = [
      "04_Game_Name_PITCH_IN.mov",
      "04_Game_Name_PITCH_OUT.mov",
      "CompetitionLogo_In.mov",
      "NEW LKL logo_LOOP_alt.mov",
    ];
    const textures = new Map<string, ImageAsset>();
    for (const name of videoFilenames) {
      textures.set(name, {
        name,
        mimeType: "video/quicktime",
        src: `blob:mock-${name}`,
        width: 1920,
        height: 1080,
      });
    }
    const result = parseW3D(gameNameFsXml, {
      sceneName: "GameName_FS",
      textures,
      videos: new Set(videoFilenames),
    });
    const pitchOut = result.blueprint.nodes.find((n) => n.name === "PITCH_Out");
    expect(pitchOut?.type).toBe("image");
    expect(pitchOut?.visible).toBe(false);  // ← KEY: stays hidden

    // PITCH_IN is Enable=True; must remain visible.
    const pitchIn = result.blueprint.nodes.find((n) => n.name === "PITCH_IN");
    expect(pitchIn?.visible).toBe(true);

    // Static plane nodes that were Enable=False (HELPERS scaffolding etc.)
    // should still be promoted to visible — that's the existing design-view
    // contract for non-content nodes.
    // (No assertion here unless GameName_FS happens to have one — it
    // doesn't, per the offline dump's helperNodeCount: 0.)
  });

  it("invariant: image-sequence nodes also respect Enable=False (consistency with video)", () => {
    // Same contract as the test above, but exercising the
    // application/x-image-sequence mime path explicitly. Even though
    // GameName_FS's PITCH_Out is loaded as video/quicktime in this test
    // setup, we want the rule to fire for sequences too — they're
    // semantically identical (broadcast content with playback intent).
    const sequences = new Map<string, import("../types").ImageSequenceMetadata>();
    sequences.set("04_Game_Name_PITCH_OUT.mov", {
      version: 1, type: "image-sequence", source: "04_Game_Name_PITCH_OUT.mov",
      framePattern: "frame_%06d.png", frameCount: 2, fps: 25,
      width: 1920, height: 1080, durationSec: 0.08,
      loop: true, alpha: true, pixelFormat: "rgba",
      frameUrls: ["blob:f1", "blob:f2"],
    });
    const result = parseW3D(gameNameFsXml, {
      sceneName: "GameName_FS",
      textures: new Map(),
      videos: new Set(),
      sequences,
    });
    const pitchOut = result.blueprint.nodes.find((n) => n.name === "PITCH_Out");
    expect(pitchOut?.type).toBe("image");
    if (pitchOut?.type === "image") {
      expect(pitchOut.image.mimeType).toBe("application/x-image-sequence");
    }
    expect(pitchOut?.visible).toBe(false);
  });

  it("invariant: when a .mov DOES decode AND has a sibling sequence, the sequence-swap fires correctly", () => {
    // Locks the parser side of the FASE K bug: a .mov that decodes in the
    // browser (i.e. enters ctx.textures normally) AND has a sibling PNG
    // sequence on disk MUST come out the parser as
    // application/x-image-sequence, never video/quicktime. Otherwise the
    // sequence player never registers and the runtime plays nothing.
    //
    // GameName_FS doesn't statically reference CompetitionLogo_In.mov via a
    // <TextureLayer> (it's wired up at runtime via an <ExportProperty>), so
    // we can't exercise the contract on that fixture directly. We use a
    // minimal XML that DOES bind the .mov to a Quad so the swap path is on
    // the critical path of the parser.
    const minimalXml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><Resources>
<ImageSequence Id="seqHL" Name="HotLogo.mov"/>
<TextureLayer Id="LYHL"><TextureMappingOption Texture="seqHL"/></TextureLayer>
</Resources><SceneLayer><SceneNode><Children>
<Quad Id="qHL" Name="HotLogo">
<Primitive><FaceMappingList>
<NamedBaseFaceMapping TextureLayerId="LYHL"/>
</FaceMappingList></Primitive>
</Quad></Children></SceneNode></SceneLayer></Scene>`;

    // The .mov decoded successfully in the browser → present in textures map.
    const textures = new Map<string, ImageAsset>();
    textures.set("HotLogo.mov", {
      name: "HotLogo.mov",
      mimeType: "video/quicktime",
      src: "blob:mock-mov",
      width: 1920,
      height: 1080,
    });
    const sequences = new Map<string, import("../types").ImageSequenceMetadata>();
    sequences.set("HotLogo.mov", {
      version: 1, type: "image-sequence", source: "HotLogo.mov",
      framePattern: "frame_%06d.png", frameCount: 11,
      fps: 25, width: 1920, height: 1080, durationSec: 0.44,
      loop: true, alpha: true, pixelFormat: "rgba",
      frameUrls: Array.from({ length: 11 }, (_, i) => `blob:mock-${i + 1}`),
    });

    const result = parseW3D(minimalXml, {
      sceneName: "HotLogoScene",
      textures,
      videos: new Set(["HotLogo.mov"]),
      sequences,
    });

    const node = result.blueprint.nodes.find((n) => n.name === "HotLogo");
    expect(node?.type).toBe("image");
    if (node?.type !== "image") return;
    // KEY: even though the .mov decoded, the sequence is authoritative.
    expect(node.image.mimeType).toBe("application/x-image-sequence");
    expect(node.image.sequence).toBeDefined();
    expect(node.image.sequence?.frameCount).toBe(11);
  });

  describe("decideSequenceLogStatus", () => {
    // Pure helper that powers the [w3d parser] sequence resolution log.
    // Lives on its own so the operator-facing diagnostic stays honest:
    // a sequence on disk that no <TextureLayer> ever referenced should
    // be reported as "unreferenced" (the runtime ExportProperty will
    // wire it up later) — NOT as "missing", which implies a parse-time
    // failure to bind. Pass K's misleading
    // "CompetitionLogo_In.mov → missing" log was exactly this conflation.
    const makeImage = (mime: string): EditorNode => ({
      id: "n1",
      parentId: null,
      type: "image",
      name: "x",
      visible: true,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      } as never,
      geometry: { width: 1, height: 1 } as never,
      material: { type: "basic", color: "#fff", opacity: 1, transparent: false, alphaTest: 0 } as never,
      image: { name: "x", mimeType: mime, src: "blob:x", width: 1, height: 1 },
      imageId: "img-x",
    } as unknown as EditorNode);

    it("reports sequence when the bound node carries the image-sequence mime", () => {
      expect(decideSequenceLogStatus(makeImage("application/x-image-sequence"), true))
        .toBe("sequence");
    });
    it("reports video when the bound node still carries video/* mime (real bug)", () => {
      expect(decideSequenceLogStatus(makeImage("video/quicktime"), true))
        .toBe("video");
    });
    it("reports missing when a referenced .mov has no bound image node", () => {
      expect(decideSequenceLogStatus(undefined, true)).toBe("missing");
    });
    it("reports unreferenced when no <TextureLayer> ever pointed at the .mov", () => {
      // CompetitionLogo_In.mov in GameName_FS: discovered on disk but
      // wired up via an <ExportProperty> rather than a static layer.
      // The diagnostic must NOT call this "missing" — it would imply a
      // parse failure where there isn't one.
      expect(decideSequenceLogStatus(undefined, false)).toBe("unreferenced");
    });
  });
});
