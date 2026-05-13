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

  it("uses TextBoxSize.X (not Y) as glyph height when the box is portrait-oriented and ConstrainMethod=Width", () => {
    // Real-world: LINEUP_LEFT has <TextureText Text="COACH"> with
    // <TextBoxSize X="0.73" Y="2.73"/> and ConstrainMethod="Width". W3D
    // engine fits the 5-char string inside the 0.73-wide box and the Y
    // dimension is just reserved vertical space. Treating Y as the glyph
    // cap-height rendered text 3.7× too tall, filling the viewport.
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<TextureText Id="t-coach" Name="COACH_FUNCTION">
  <GeometryOptions ConstrainMethod="Width" HasTextBox="True" Text="COACH">
    <TextBoxSize X="0.73" Y="2.73"/>
  </GeometryOptions>
</TextureText>
<TextureText Id="t-team" Name="DETROIT_IRONHAWKS">
  <GeometryOptions ConstrainMethod="Width" HasTextBox="True" Text="DETROIT IRONHAWKS">
    <TextBoxSize X="6.39" Y="0.23"/>
  </GeometryOptions>
</TextureText>
</Children></SceneNode></SceneLayer></Scene>`;
    const result = parseW3D(xml);
    const coach = result.blueprint.nodes.find((n) => n.name === "COACH_FUNCTION");
    expect(coach?.type).toBe("text");
    if (coach?.type === "text") {
      // Portrait box → fall back to X as glyph height proxy.
      expect(coach.geometry.size).toBeCloseTo(0.73, 3);
    }
    const team = result.blueprint.nodes.find((n) => n.name === "DETROIT_IRONHAWKS");
    if (team?.type === "text") {
      // Landscape box → keep the legacy Y-as-height mapping (no regression).
      expect(team.geometry.size).toBeCloseTo(0.23, 3);
    }
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
      version: 2,
      type: "image-sequence",
      format: "png",
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
      version: 2, type: "image-sequence", format: "png", source: "04_Game_Name_PITCH_OUT.mov",
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
      version: 2, type: "image-sequence", format: "png", source: "HotLogo.mov",
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

  describe("texture-resolution diagnostics", () => {
    // The user's "image is in Media but doesn't render in scene" reports
    // need three things to debug: (1) which TextureLayers exist, (2) what
    // each one resolved to, and (3) what's missing on disk with the
    // original XML reference preserved. These tests lock in that contract.
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><Resources>
<Texture Id="tex-home" Filename="home_player.png"/>
<TextureLayer Id="LY-HOME"><TextureMappingOption Texture="tex-home"/></TextureLayer>
<TextureLayer Id="LY-MISS"><TextureMappingOption Texture="ProjectResource\\BASE_GRADIENT.png"/></TextureLayer>
</Resources><SceneLayer><SceneNode><Children>
<Quad Id="q-home" Name="HomePlayerPic">
  <Primitive><FaceMappingList>
    <NamedBaseFaceMapping TextureLayerId="LY-HOME"/>
  </FaceMappingList></Primitive>
</Quad>
<Quad Id="q-miss" Name="MissingTexQuad">
  <Primitive><FaceMappingList>
    <NamedBaseFaceMapping TextureLayerId="LY-MISS"/>
  </FaceMappingList></Primitive>
</Quad>
</Children></SceneNode></SceneLayer></Scene>`;

    it("resolves a TextureLayer to its filename via the Texture resource Id", () => {
      const homeAsset: ImageAsset = {
        name: "home_player.png", mimeType: "image/png",
        src: "blob:home", width: 256, height: 256,
      };
      const result = parseW3D(xml, {
        sceneName: "Test",
        textures: new Map([["home_player.png", homeAsset]]),
      });
      const homeNode = result.blueprint.nodes.find((n) => n.name === "HomePlayerPic");
      expect(homeNode?.type).toBe("image");
      if (homeNode?.type === "image") {
        expect(homeNode.image.name).toBe("home_player.png");
        expect(homeNode.image.mimeType).toBe("image/png");
      }
    });

    it("emits a per-ref warning preserving the ProjectResource\\ path for missing textures", () => {
      const homeAsset: ImageAsset = {
        name: "home_player.png", mimeType: "image/png",
        src: "blob:home", width: 256, height: 256,
      };
      const result = parseW3D(xml, {
        sceneName: "Test",
        textures: new Map([["home_player.png", homeAsset]]),
      });
      const missingWarn = result.warnings.filter((w) => w.startsWith("Missing texture resource:"));
      expect(missingWarn.length).toBe(1);
      expect(missingWarn[0]).toContain("ProjectResource\\BASE_GRADIENT.png");
    });

    it("persists textureDiagnostics into metadata.w3d for __r3Dump consumption", () => {
      const homeAsset: ImageAsset = {
        name: "home_player.png", mimeType: "image/png",
        src: "blob:home", width: 256, height: 256,
      };
      const result = parseW3D(xml, {
        sceneName: "Test",
        textures: new Map([["home_player.png", homeAsset]]),
      });
      const md = result.blueprint.metadata as { w3d?: { textureDiagnostics?: {
        textureResources: Record<string, string>;
        textureLayers: Array<{ id: string; originalRef: string | null; resolvedFilename: string | null }>;
        missingTextureRefs: string[];
      } } } | undefined;
      const diag = md?.w3d?.textureDiagnostics;
      expect(diag).toBeDefined();
      // <Texture Id="tex-home"> shows up in resources.
      expect(diag?.textureResources["tex-home"]).toBe("home_player.png");
      // Both layers are catalogued; one resolved, one didn't.
      const homeLayer = diag?.textureLayers.find((l) => l.id === "ly-home");
      expect(homeLayer?.resolvedFilename).toBe("home_player.png");
      expect(homeLayer?.originalRef).toBe("tex-home");
      const missLayer = diag?.textureLayers.find((l) => l.id === "ly-miss");
      expect(missLayer?.originalRef).toBe("ProjectResource\\BASE_GRADIENT.png");
      // missingTextureRefs surfaces the missing path so the dump shows it.
      expect(diag?.missingTextureRefs).toContain("ProjectResource\\BASE_GRADIENT.png");
    });
  });

  describe("W3D preview-state flatten pre-pass", () => {
    // The W3D engine writes "animation-start" attribute values verbatim into
    // the XML. R3 Designer compensates by evaluating Timeline "In" at the
    // <Timeline PreviewMarker> frame before showing the rest state. 3Forge
    // mirrors that by mutating the parsed DOM with the values at the
    // preview frame, so the downstream walker sees the visual rest state
    // directly. Tests below lock in:
    //   - ExportProperty Text/Texture/Emissive/Enabled overrides
    //   - Last keyframe ≤ PreviewMarker is the value applied
    //   - Animation keyframes win over ExportProperty for the same property
    //   - Disabled ExportProperty rows are ignored
    //   - flattenPreviewState=false escapes the pre-pass (legacy behaviour)

    it("ExportProperty PropertyName=Text overrides <GeometryOptions Text>", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<TextureText Id="t-team" Name="TeamLabel">
  <GeometryOptions HasTextBox="True" Text="PLACEHOLDER">
    <TextBoxSize X="6.39" Y="0.23"/>
  </GeometryOptions>
</TextureText>
</Children></SceneNode>
<ExportManagerProperties><ExportList Name="vTeam">
  <ExportProperty Enable="True" PropertyName="Text" Type="String"
    Value="DETROIT IRONHAWKS" ControllableId="t-team" UpdateMode="Instantly"/>
</ExportList></ExportManagerProperties>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const node = result.blueprint.nodes.find((n) => n.name === "TeamLabel");
      expect(node?.type).toBe("text");
      if (node?.type === "text") {
        expect(node.geometry.text).toBe("DETROIT IRONHAWKS");
      }
    });

    it("ExportProperty PropertyName=TextureMappingOption.Texture rebinds the layer", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><Resources>
  <Texture Id="tex-default" Filename="placeholder.png"/>
  <Texture Id="tex-real" Filename="IronHawks.png"/>
  <TextureLayer Id="lyr-logo">
    <TextureMappingOption Texture="tex-default"/>
  </TextureLayer>
</Resources><SceneLayer><SceneNode><Children>
<Quad Id="q-logo" Name="Logo">
  <GeometryOptions><Size X="1" Y="1"/></GeometryOptions>
  <Primitive><FaceMappingList>
    <NamedBaseFaceMapping TextureLayerId="lyr-logo"/>
  </FaceMappingList></Primitive>
</Quad>
</Children></SceneNode>
<ExportManagerProperties><ExportList Name="vLogo">
  <ExportProperty Enable="True" PropertyName="TextureMappingOption.Texture"
    Type="Texture" Value="tex-real" ControllableId="lyr-logo" UpdateMode="Instantly"/>
</ExportList></ExportManagerProperties>
</SceneLayer></Scene>`;
      const real: ImageAsset = { name: "IronHawks.png", mimeType: "image/png", src: "blob:real", width: 64, height: 64 };
      const placeholder: ImageAsset = { name: "placeholder.png", mimeType: "image/png", src: "blob:ph", width: 1, height: 1 };
      const result = parseW3D(xml, {
        textures: new Map([
          ["IronHawks.png", real],
          ["placeholder.png", placeholder],
        ]),
      });
      const node = result.blueprint.nodes.find((n) => n.name === "Logo");
      expect(node?.type).toBe("image");
      if (node?.type === "image") {
        expect(node.image.name).toBe("IronHawks.png");
      }
    });

    it("picks the numeric-max FrameNumber ≤ PreviewMarker, regardless of XML document order", () => {
      // Real LINEUP_LEFT case: NAME_01 Transform.Position.XProp has keyframes
      // written in XML in this order: 220, 255, 175, 140. Picking the LAST
      // one in XML order (140 → 0.35) is wrong — we want the numeric max ≤
      // PreviewMarker, which is 255 → 0.37.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children>
<Group Id="n1" Name="NameSlot"><NodeTransform><Position X="0"/></NodeTransform></Group>
</Children></SceneNode>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="t1" MaxFrames="800" PreviewMarker="799">
    <KeyFrameAnimationController AnimatedProperty="Transform.Position.XProp" ControllableId="n1">
      <KeyFrame FrameNumber="220" Value="0.69" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="255" Value="0.37" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="175" Value="0.69" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="140" Value="0.35" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const node = result.blueprint.nodes.find((n) => n.name === "NameSlot");
      // 255 is the numeric max ≤ 799 → value should be 0.37, not 0.35
      // (which would be the case if we picked XML-last instead of numeric-max).
      expect(node?.transform.position.x).toBeCloseTo(0.37, 3);
    });

    it("splits comma-separated 'x,y,z' triples for uniform Transform.Scale / Transform.Position", () => {
      // Real LINEUP_LEFT case: NAME_01 Transform.Scale at frame 255 carries
      // Value="0.75,0.75,0.75". Without per-axis splitting the parser ends
      // up trying to read "0.75,0.75,0.75" as one number → NaN → fallback.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children>
<Group Id="n1" Name="UniformScale"><NodeTransform><Scale X="1" Y="1" Z="1"/></NodeTransform></Group>
</Children></SceneNode>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="t1" MaxFrames="800" PreviewMarker="799">
    <KeyFrameAnimationController AnimatedProperty="Transform.Scale" ControllableId="n1">
      <KeyFrame FrameNumber="140" Value="0,0,1" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="255" Value="0.75,0.75,0.75" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const node = result.blueprint.nodes.find((n) => n.name === "UniformScale");
      expect(node?.transform.scale.x).toBeCloseTo(0.75, 3);
      expect(node?.transform.scale.y).toBeCloseTo(0.75, 3);
      expect(node?.transform.scale.z).toBeCloseTo(0.75, 3);
    });

    it("picks the last keyframe at-or-before PreviewMarker, not the first", () => {
      // Quad whose Position.XProp animates 0 → 5 over frames 0–200 (the
      // value at PreviewMarker=180 should land between the 100 and 200
      // keyframes — we take "at-or-before" so the 100 keyframe value wins).
      // Using XProp avoids the 2D-mode Y/Z flip so the assertion stays
      // a clean 3 rather than -3.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children>
<Quad Id="q1" Name="Slider">
  <NodeTransform><Position X="0" Y="0" Z="0"/></NodeTransform>
</Quad>
</Children></SceneNode>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="t1" IsLoop="False" MaxFrames="200" PreviewMarker="180">
    <KeyFrameAnimationController AnimatedProperty="Transform.Position.XProp" ControllableId="q1">
      <KeyFrame FrameNumber="0" Value="0" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="100" Value="3" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="200" Value="5" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const node = result.blueprint.nodes.find((n) => n.name === "Slider");
      expect(node?.transform.position.x).toBeCloseTo(3, 3);
    });

    it("animation keyframe at PreviewMarker overrides ExportProperty for the same target", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children>
<TextureText Id="t1" Name="Label">
  <GeometryOptions HasTextBox="True" Text="XML">
    <TextBoxSize X="2" Y="0.3"/>
  </GeometryOptions>
</TextureText>
</Children></SceneNode>
<ExportManagerProperties>
  <ExportProperty Enable="True" PropertyName="Alpha" Type="Float"
    Value="1" ControllableId="t1" UpdateMode="Instantly"/>
</ExportManagerProperties>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="t1tl" MaxFrames="100" PreviewMarker="100">
    <KeyFrameAnimationController AnimatedProperty="Alpha" ControllableId="t1">
      <KeyFrame FrameNumber="0" Value="1" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="50" Value="0" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const node = result.blueprint.nodes.find((n) => n.name === "Label");
      // Keyframe at frame 50 (value 0) is the last ≤ PreviewMarker=100 →
      // material.opacity should land at 0, not the export-property's 1.
      expect(node?.type).toBe("text");
      if (node && node.type !== "group") {
        expect(node.material.opacity).toBe(0);
      }
    });

    it("ignores ExportProperty rows where Enable='False'", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<TextureText Id="t1" Name="Label">
  <GeometryOptions HasTextBox="True" Text="ORIGINAL"><TextBoxSize X="2" Y="0.3"/></GeometryOptions>
</TextureText>
</Children></SceneNode>
<ExportManagerProperties>
  <ExportProperty Enable="False" PropertyName="Text" Type="String"
    Value="OVERRIDE" ControllableId="t1" UpdateMode="Instantly"/>
</ExportManagerProperties>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const node = result.blueprint.nodes.find((n) => n.name === "Label");
      if (node?.type === "text") {
        expect(node.geometry.text).toBe("ORIGINAL");
      }
    });

    it("flattenPreviewState=false skips the pre-pass entirely (legacy escape hatch)", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<TextureText Id="t1" Name="Label">
  <GeometryOptions HasTextBox="True" Text="RAW_XML"><TextBoxSize X="2" Y="0.3"/></GeometryOptions>
</TextureText>
</Children></SceneNode>
<ExportManagerProperties>
  <ExportProperty Enable="True" PropertyName="Text" Type="String"
    Value="FLATTENED" ControllableId="t1" UpdateMode="Instantly"/>
</ExportManagerProperties>
</SceneLayer></Scene>`;
      const result = parseW3D(xml, { flattenPreviewState: false });
      const node = result.blueprint.nodes.find((n) => n.name === "Label");
      if (node?.type === "text") {
        expect(node.geometry.text).toBe("RAW_XML");
      }
    });

    it("Size.XProp keyframe at PreviewMarker overrides the XML <Size X> attribute", () => {
      // Real LINEUP_LEFT case: BASE_MAIN has Size X=0 at frame 0 (mask is
      // zero-width before the intro plays) and grows via Size.XProp keyframes.
      // Without flatten, the parser saw the X=0 starting value and rendered
      // a degenerate mask that clipped nothing.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children>
<Quad Id="q1" Name="GrowingBar" IsMask="True">
  <GeometryOptions><Size X="0" Y="1"/></GeometryOptions>
</Quad>
</Children></SceneNode>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="t1tl" MaxFrames="200" PreviewMarker="150">
    <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="q1">
      <KeyFrame FrameNumber="0" Value="0" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="120" Value="7" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const mask = result.blueprint.nodes.find((n) => n.name === "GrowingBar");
      // After flatten, the rendered Size.X should be 7 (the keyframe at
      // frame 120 is the last one ≤ PreviewMarker=150). Quad geometry
      // reads from GeometryOptions/Size, so the flatten must have written
      // back into that subtree. We check the parsed geometry.width here
      // (which the createQuadNode wires from Size.X). Mask Quads enter
      // 3Forge as plane nodes so the width lives on the plane geometry.
      if (mask && mask.type === "plane") {
        expect(mask.geometry.width).toBe(7);
      } else {
        throw new Error(`expected plane mask, got ${mask?.type ?? "undefined"}`);
      }
    });

    it("Size.XProp on a quad with static Size X=0 normalizes scale.x against the post-flatten size (Phase 7 regression)", () => {
      // Real LINEUP_LEFT case: BASE_MAIN has <Size X="0"/> in the static XML
      // and animates Size.XProp from 0 (frame 50) to 7.7 (frame 97). With the
      // pre-existing flatten step, the post-flatten Size.X becomes 7.7 (last
      // keyframe ≤ PreviewMarker=799), so node.geometry.width = 7.7.
      //
      // Before Phase 7, the importer emitted raw absolute values into the
      // transform.scale.x track, so playback rendered 7.7 × 7.7 = 59.29 at
      // peak — the mask blew up offscreen. Phase 7 normalizes the track by
      // the post-flatten width so scale.x stays in [0..1] and rendered =
      // geometry.width × scale.x = 7.7 × 1 = 7.7 ✓.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children>
<Quad Id="base-main" Name="BASE_MAIN" IsMask="True">
  <GeometryOptions AlignmentX="Right"><Size X="0" Y="1.404"/></GeometryOptions>
</Quad>
</Children></SceneNode>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="in1" MaxFrames="800" PreviewMarker="799">
    <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="base-main">
      <KeyFrame FrameNumber="50" Value="0" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="97" Value="7.7" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const mask = result.blueprint.nodes.find((n) => n.name === "BASE_MAIN");
      expect(mask).toBeDefined();
      if (!mask || mask.type === "group") throw new Error("expected non-group node for BASE_MAIN");

      // Post-flatten geometry width is the W3D PreviewMarker sample.
      const g = (mask as unknown as { geometry: { width: number } }).geometry;
      expect(g.width).toBeCloseTo(7.7);

      // The In clip's transform.scale.x track exists and is normalized:
      // raw values 0 and 7.7 → 0/7.7 = 0 and 7.7/7.7 = 1.
      const inClip = result.blueprint.animation.clips.find((c) => c.name === "In");
      expect(inClip).toBeDefined();
      const scaleX = inClip!.tracks.find((t) => t.nodeId === mask.id && t.property === "transform.scale.x");
      expect(scaleX).toBeDefined();
      expect(scaleX!.keyframes).toHaveLength(2);
      expect(scaleX!.keyframes[0].value).toBeCloseTo(0);
      expect(scaleX!.keyframes[1].value).toBeCloseTo(1.0);

      // Sanity: rendered width = geometry.width × scale.x matches the W3D
      // absolute values at the keyframes.
      expect(g.width * scaleX!.keyframes[0].value).toBeCloseTo(0);
      expect(g.width * scaleX!.keyframes[1].value).toBeCloseTo(7.7);
    });

    it("Size.XProp pathological case: animation ends at 0 at PreviewMarker — promotes max |value| to geometry size", () => {
      // Hypothetical edge: a quad whose static Size is missing AND whose
      // animation evaluates to 0 at the PreviewMarker (e.g. an "Out" timeline
      // imported as the active clip). With baseSize=0, normalization would
      // divide by zero. Phase 7 promotes the largest |keyframe| to the
      // geometry size so scale stays bounded and the static rest state
      // renders the post-flatten 0 correctly.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children>
<Quad Id="q1" Name="ShrinkBar"/>
</Children></SceneNode>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="in1" MaxFrames="200" PreviewMarker="100">
    <KeyFrameAnimationController AnimatedProperty="Size.XProp" ControllableId="q1">
      <KeyFrame FrameNumber="0" Value="5" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="100" Value="0" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const bar = result.blueprint.nodes.find((n) => n.name === "ShrinkBar");
      expect(bar).toBeDefined();
      if (!bar || bar.type === "group") throw new Error("expected non-group node for ShrinkBar");
      const g = (bar as unknown as { geometry: { width: number } }).geometry;
      // Post-flatten width = 0 (PreviewMarker keyframe value). Importer
      // promotes geometry.width to max |keyframe| = 5 so the scale track
      // stays in [0..1].
      expect(g.width).toBeCloseTo(5);

      const inClip = result.blueprint.animation.clips.find((c) => c.name === "In");
      const scaleX = inClip!.tracks.find((t) => t.nodeId === bar.id && t.property === "transform.scale.x");
      expect(scaleX).toBeDefined();
      // 5/5 = 1, 0/5 = 0.
      expect(scaleX!.keyframes[0].value).toBeCloseTo(1.0);
      expect(scaleX!.keyframes[1].value).toBeCloseTo(0);
    });

    it("FlowChildren Direction='YMinus' offsets children along -Y instead of X", () => {
      // Real LINEUP_LEFT case: BENCH_LIST is
      //   <GeometryOptions LeadingSpace="-0.084" FlowChildren="True"
      //                    FlowChildrenAlignment="Trailing" Direction="YMinus" />
      // Children are TextureText rows whose dominant Y extent is the
      // TextBoxSize.Y (0.15). Stride = 0.15 + (-0.084) = 0.066 per row,
      // applied on -Y. The XML's authored X on each child must survive.
      // Note: Is2DScene="False" + no <Camera Projection> keeps Y unflipped
      // for this fixture so the assertions read the raw W3D coords directly.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>
<Group Id="bench" Name="BENCH_LIST">
  <GeometryOptions LeadingSpace="-0.084" FlowChildren="True"
                   FlowChildrenAlignment="Trailing" Direction="YMinus"/>
  <NodeTransform><Position Y="0.983"/></NodeTransform>
  <Children>
    <Group Id="bp1" Name="BENCH_PLAYER_01"><NodeTransform><Position X="2"/></NodeTransform>
      <Children><TextureText Id="bn1" Name="BENCH_NAME_01">
        <GeometryOptions HasTextBox="True" Text="A"><TextBoxSize X="0.86" Y="0.15"/></GeometryOptions>
      </TextureText></Children></Group>
    <Group Id="bp2" Name="BENCH_PLAYER_02"><NodeTransform><Position X="2"/></NodeTransform>
      <Children><TextureText Id="bn2" Name="BENCH_NAME_02">
        <GeometryOptions HasTextBox="True" Text="B"><TextBoxSize X="0.86" Y="0.15"/></GeometryOptions>
      </TextureText></Children></Group>
    <Group Id="bp3" Name="BENCH_PLAYER_03"><NodeTransform><Position X="2"/></NodeTransform>
      <Children><TextureText Id="bn3" Name="BENCH_NAME_03">
        <GeometryOptions HasTextBox="True" Text="C"><TextBoxSize X="0.86" Y="0.15"/></GeometryOptions>
      </TextureText></Children></Group>
  </Children>
</Group>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const get = (name: string) =>
        result.blueprint.nodes.find((n) => n.name === name)?.transform.position ?? null;
      // Authored X on each child is preserved (not zeroed).
      expect(get("BENCH_PLAYER_01")?.x).toBe(2);
      expect(get("BENCH_PLAYER_02")?.x).toBe(2);
      expect(get("BENCH_PLAYER_03")?.x).toBe(2);
      // Y advances on -Y by stride 0.066.
      expect(get("BENCH_PLAYER_01")?.y).toBeCloseTo(0, 3);
      expect(get("BENCH_PLAYER_02")?.y).toBeCloseTo(-0.066, 3);
      expect(get("BENCH_PLAYER_03")?.y).toBeCloseTo(-0.132, 3);
      // Diagnostics: direction + axis + alignment + childExtents surface.
      const md = result.blueprint.metadata as { w3d?: { flowLayouts?: Array<{
        direction: string; appliedAxis: string; alignment: string | null;
        childExtents: number[]; approximationWarnings: string[];
      }> } };
      const layout = md.w3d?.flowLayouts?.[0];
      expect(layout?.direction).toBe("YMinus");
      expect(layout?.appliedAxis).toBe("Y");
      expect(layout?.alignment).toBe("Trailing");
      expect(layout?.childExtents).toEqual([0.15, 0.15, 0.15]);
      // Trailing is parsed but approximated — must be reported, not silent.
      const trailingWarn = (layout?.approximationWarnings ?? []).find((w) =>
        w.includes("FlowChildrenAlignment") && w.includes("Trailing"),
      );
      expect(trailingWarn).toBeDefined();
    });

    it("FlowChildren Direction='YPlus' offsets children along +Y", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>
<Group Id="g" Name="StackDown">
  <GeometryOptions LeadingSpace="0" FlowChildren="True" Direction="YPlus"/>
  <Children>
    <Quad Id="q1" Name="A"><GeometryOptions><Size X="1" Y="1"/></GeometryOptions></Quad>
    <Quad Id="q2" Name="B"><GeometryOptions><Size X="1" Y="1"/></GeometryOptions></Quad>
    <Quad Id="q3" Name="C"><GeometryOptions><Size X="1" Y="1"/></GeometryOptions></Quad>
  </Children>
</Group>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const get = (n: string) =>
        result.blueprint.nodes.find((nd) => nd.name === n)?.transform.position ?? null;
      expect(get("A")?.y).toBe(0);
      expect(get("B")?.y).toBe(1);
      expect(get("C")?.y).toBe(2);
      // X axis untouched.
      expect(get("A")?.x).toBe(0);
      expect(get("B")?.x).toBe(0);
      expect(get("C")?.x).toBe(0);
    });

    it("FlowChildren Direction='XMinus' offsets children along -X", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>
<Group Id="g" Name="StackLeft">
  <GeometryOptions LeadingSpace="0" FlowChildren="True" Direction="XMinus"/>
  <Children>
    <Quad Id="q1" Name="A"><GeometryOptions><Size X="2" Y="1"/></GeometryOptions></Quad>
    <Quad Id="q2" Name="B"><GeometryOptions><Size X="2" Y="1"/></GeometryOptions></Quad>
  </Children>
</Group>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const get = (n: string) =>
        result.blueprint.nodes.find((nd) => nd.name === n)?.transform.position ?? null;
      expect(get("A")?.x).toBe(0);
      expect(get("B")?.x).toBe(-2);
    });

    it("FlowChildren Direction default (omitted) still flows along +X — PLAYER_01..05 regression guard", () => {
      // Same fixture as the original FlowChildren test, but with a no-op
      // change to the XML: omitting Direction must keep the legacy X+
      // behaviour so PLAYER_NN don't suddenly stack on Y or X-.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<Group Id="players" Name="PLAYERS">
  <GeometryOptions LeadingSpace="-1.26" FlowChildren="True"/>
  <Children>
    <Group Id="p1" Name="P_01">
      <Children><Quad Id="pq1" Name="PHOTO_01"><GeometryOptions><Size X="2.3"/></GeometryOptions></Quad></Children></Group>
    <Group Id="p2" Name="P_02">
      <Children><Quad Id="pq2" Name="PHOTO_02"><GeometryOptions><Size X="2.3"/></GeometryOptions></Quad></Children></Group>
  </Children>
</Group>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const get = (n: string) =>
        result.blueprint.nodes.find((nd) => nd.name === n)?.transform.position ?? null;
      expect(get("P_01")?.x).toBeCloseTo(0, 3);
      expect(get("P_02")?.x).toBeCloseTo(1.04, 3);
      expect(get("P_01")?.y).toBe(0);
      expect(get("P_02")?.y).toBe(0);
    });

    it("FlowChildren=True on a Group lays children out side-by-side along X", () => {
      // Real LINEUP_LEFT case: PLAYERS group has
      //   <GeometryOptions LeadingSpace="-1.26" FlowChildren="True" />
      // Children PLAYER_01..05 have same X=0 + different Z values; without
      // FlowChildren they all stack at the same screen X.
      // Each player subtree contains a Photo Quad with Size X="2.3" — that's
      // the dominant card width the flow uses.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<Group Id="players" Name="PLAYERS">
  <GeometryOptions LeadingSpace="-1.26" FlowChildren="True"/>
  <NodeTransform><Position X="0"/></NodeTransform>
  <Children>
    <Group Id="p1" Name="P_01"><NodeTransform><Position X="0" Y="-3.5" Z="0"/></NodeTransform>
      <Children><Quad Id="pq1" Name="PHOTO_01"><GeometryOptions><Size X="2.3" Y="2.3"/></GeometryOptions></Quad></Children></Group>
    <Group Id="p2" Name="P_02"><NodeTransform><Position X="0" Y="-3.5" Z="-5"/></NodeTransform>
      <Children><Quad Id="pq2" Name="PHOTO_02"><GeometryOptions><Size X="2.3" Y="2.3"/></GeometryOptions></Quad></Children></Group>
    <Group Id="p3" Name="P_03"><NodeTransform><Position X="0" Y="-3.5" Z="-10"/></NodeTransform>
      <Children><Quad Id="pq3" Name="PHOTO_03"><GeometryOptions><Size X="2.3" Y="2.3"/></GeometryOptions></Quad></Children></Group>
    <Group Id="p4" Name="P_04"><NodeTransform><Position X="0" Y="-3.5" Z="-15"/></NodeTransform>
      <Children><Quad Id="pq4" Name="PHOTO_04"><GeometryOptions><Size X="2.3" Y="2.3"/></GeometryOptions></Quad></Children></Group>
    <Group Id="p5" Name="P_05"><NodeTransform><Position X="0" Y="-3.5" Z="-20"/></NodeTransform>
      <Children><Quad Id="pq5" Name="PHOTO_05"><GeometryOptions><Size X="2.3" Y="2.3"/></GeometryOptions></Quad></Children></Group>
  </Children>
</Group>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const xs = ["P_01", "P_02", "P_03", "P_04", "P_05"].map((n) =>
        result.blueprint.nodes.find((nd) => nd.name === n)?.transform.position.x ?? null,
      );
      // child widths = 2.3, leadingSpace = -1.26 → stride = 1.04
      // offsets: [0, 1.04, 2.08, 3.12, 4.16]
      expect(xs[0]).toBeCloseTo(0, 3);
      expect(xs[1]).toBeCloseTo(1.04, 3);
      expect(xs[2]).toBeCloseTo(2.08, 3);
      expect(xs[3]).toBeCloseTo(3.12, 3);
      expect(xs[4]).toBeCloseTo(4.16, 3);
      // All five distinct (the whole point):
      expect(new Set(xs).size).toBe(5);
    });

    it("does not move children of groups WITHOUT FlowChildren='True'", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<Group Id="row" Name="Row">
  <GeometryOptions LeadingSpace="-1.26"/>
  <Children>
    <Group Id="a" Name="A"><NodeTransform><Position X="0"/></NodeTransform>
      <Children><Quad Id="qa" Name="QA"><GeometryOptions><Size X="2"/></GeometryOptions></Quad></Children></Group>
    <Group Id="b" Name="B"><NodeTransform><Position X="0"/></NodeTransform>
      <Children><Quad Id="qb" Name="QB"><GeometryOptions><Size X="2"/></GeometryOptions></Quad></Children></Group>
  </Children>
</Group>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const a = result.blueprint.nodes.find((n) => n.name === "A");
      const b = result.blueprint.nodes.find((n) => n.name === "B");
      // Both stay at X=0 — no flow rule fired.
      expect(a?.transform.position.x).toBe(0);
      expect(b?.transform.position.x).toBe(0);
    });

    it("preserves explicit child Position.X by adding the flow offset on top", () => {
      // PLAYER_02 in LINEUP_LEFT has an explicit X — verify the flow adds
      // the slot offset rather than overwriting the authored value.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<Group Id="row" Name="Row">
  <GeometryOptions LeadingSpace="-1" FlowChildren="True"/>
  <Children>
    <Group Id="a" Name="A"><NodeTransform><Position X="0"/></NodeTransform>
      <Children><Quad Id="qa" Name="QA"><GeometryOptions><Size X="3"/></GeometryOptions></Quad></Children></Group>
    <Group Id="b" Name="B"><NodeTransform><Position X="0.5"/></NodeTransform>
      <Children><Quad Id="qb" Name="QB"><GeometryOptions><Size X="3"/></GeometryOptions></Quad></Children></Group>
  </Children>
</Group>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const a = result.blueprint.nodes.find((n) => n.name === "A");
      const b = result.blueprint.nodes.find((n) => n.name === "B");
      // A: 0 + 0 = 0; B: 0.5 + (3 + -1) = 0.5 + 2 = 2.5
      expect(a?.transform.position.x).toBeCloseTo(0, 3);
      expect(b?.transform.position.x).toBeCloseTo(2.5, 3);
    });

    it("falls back to width=1 when a child subtree has no positive <Size X>", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<Group Id="row" Name="Row">
  <GeometryOptions LeadingSpace="0" FlowChildren="True"/>
  <Children>
    <Group Id="a" Name="EmptyA"><NodeTransform><Position X="0"/></NodeTransform></Group>
    <Group Id="b" Name="EmptyB"><NodeTransform><Position X="0"/></NodeTransform></Group>
    <Group Id="c" Name="EmptyC"><NodeTransform><Position X="0"/></NodeTransform></Group>
  </Children>
</Group>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const xs = ["EmptyA", "EmptyB", "EmptyC"].map((n) =>
        result.blueprint.nodes.find((nd) => nd.name === n)?.transform.position.x ?? null,
      );
      // Each empty subtree gets the fallback width of 1, leadingSpace=0.
      expect(xs).toEqual([0, 1, 2]);
      // Approximation warning surfaced for each:
      const md = result.blueprint.metadata as { w3d?: { flowLayouts?: Array<{ approximationWarnings: string[] }> } };
      const warns = md.w3d?.flowLayouts?.[0].approximationWarnings ?? [];
      expect(warns.length).toBe(3);
    });

    it("persists flowLayouts + flowByNodeId on metadata.w3d for __r3Dump consumption", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<Group Id="row" Name="Row">
  <GeometryOptions LeadingSpace="-0.5" FlowChildren="True"/>
  <Children>
    <Group Id="a" Name="A"><NodeTransform><Position X="0"/></NodeTransform>
      <Children><Quad Id="qa" Name="QA"><GeometryOptions><Size X="2"/></GeometryOptions></Quad></Children></Group>
    <Group Id="b" Name="B"><NodeTransform><Position X="0"/></NodeTransform>
      <Children><Quad Id="qb" Name="QB"><GeometryOptions><Size X="2"/></GeometryOptions></Quad></Children></Group>
  </Children>
</Group>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const md = result.blueprint.metadata as { w3d?: {
        flowLayouts?: Array<{
          parentName: string; leadingSpace: number;
          childOrder: string[]; childWidths: number[]; computedOffsets: number[];
        }>;
        flowByNodeId?: Record<string, { parentName: string; index: number; offset: number }>;
      } };
      const layouts = md.w3d?.flowLayouts ?? [];
      expect(layouts.length).toBe(1);
      expect(layouts[0].parentName).toBe("Row");
      expect(layouts[0].leadingSpace).toBe(-0.5);
      expect(layouts[0].childOrder).toEqual(["A", "B"]);
      expect(layouts[0].childWidths).toEqual([2, 2]);
      expect(layouts[0].computedOffsets).toEqual([0, 1.5]);
      // flowByNodeId — keyed by 3Forge node ids. Verify B's entry has index=1.
      const a = result.blueprint.nodes.find((n) => n.name === "A");
      const b = result.blueprint.nodes.find((n) => n.name === "B");
      const byNode = md.w3d?.flowByNodeId ?? {};
      expect(byNode[a!.id]?.index).toBe(0);
      expect(byNode[b!.id]?.index).toBe(1);
      expect(byNode[b!.id]?.offset).toBeCloseTo(1.5, 3);
    });

    it("populates TextNode.geometry.alignmentX/Y and constrainMethod from W3D GeometryOptions", () => {
      // Real LINEUP_LEFT examples: PLAYER_LAST_NAME_01 / PLAYER_NUMBER_01 /
      // BENCH_NAME_01 / COACH_FUNCTION all set explicit AlignmentX/Y plus
      // ConstrainMethod="Width". The renderer uses these to translate the
      // generated TextGeometry inside the TextBoxSize-defined rectangle.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<TextureText Id="t-left" Name="LeftCentered">
  <GeometryOptions AlignmentX="Left" AlignmentY="Center" ConstrainMethod="Width"
                   HasTextBox="True" Text="STEPHENS">
    <TextBoxSize X="0.38" Y="0.33"/>
  </GeometryOptions>
</TextureText>
<TextureText Id="t-center" Name="CenterCenter">
  <GeometryOptions AlignmentX="Center" AlignmentY="Center" ConstrainMethod="Width"
                   HasTextBox="True" Text="5">
    <TextBoxSize X="0.08" Y="0.19"/>
  </GeometryOptions>
</TextureText>
<TextureText Id="t-right" Name="RightTop">
  <GeometryOptions AlignmentX="Right" AlignmentY="Top"
                   HasTextBox="True" Text="EX">
    <TextBoxSize X="1" Y="1"/>
  </GeometryOptions>
</TextureText>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const left = result.blueprint.nodes.find((n) => n.name === "LeftCentered");
      const center = result.blueprint.nodes.find((n) => n.name === "CenterCenter");
      const right = result.blueprint.nodes.find((n) => n.name === "RightTop");
      if (left?.type === "text") {
        expect(left.geometry.alignmentX).toBe("Left");
        expect(left.geometry.alignmentY).toBe("Center");
        expect(left.geometry.constrainMethod).toBe("Width");
      } else throw new Error("expected text node");
      if (center?.type === "text") {
        expect(center.geometry.alignmentX).toBe("Center");
        expect(center.geometry.alignmentY).toBe("Center");
      }
      if (right?.type === "text") {
        expect(right.geometry.alignmentX).toBe("Right");
        expect(right.geometry.alignmentY).toBe("Top");
      }
    });

    it("ignores AlignmentX/Y values outside the known enum (defensive)", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<TextureText Id="t1" Name="Bogus">
  <GeometryOptions AlignmentX="BottomRight" AlignmentY="Random" HasTextBox="True" Text="X">
    <TextBoxSize X="1" Y="1"/>
  </GeometryOptions>
</TextureText>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const node = result.blueprint.nodes.find((n) => n.name === "Bogus");
      if (node?.type === "text") {
        expect(node.geometry.alignmentX).toBeUndefined();
        expect(node.geometry.alignmentY).toBeUndefined();
      }
    });

    it("records FontStyle id on the text node and the resource map on metadata.w3d", () => {
      // R3 broadcast scenes carry <TextureTextFontStyle Id="…" Name="FS_xx"
      // FontName="Obviously Cond" Type="Bold" …> in Resources. The
      // TextureText references the style by GUID; the renderer doesn't
      // (yet) swap fonts, but the diagnostic surface resolves the id back
      // to the FontName/Type so the operator can see the author intent.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><Resources>
  <TextureTextFontStyle Id="fs-abc" Name="FS_03" FontName="Obviously Cond"
    Type="Bold" Kerning="0" WordWrap="False"
    HorizontalDirection="LeftToRight" VerticalDirection="TopToBottom"/>
</Resources><SceneLayer><SceneNode><Children>
<TextureText Id="t1" Name="HeroLabel">
  <GeometryOptions HasTextBox="True" Text="X" FontStyle="FS-ABC">
    <TextBoxSize X="1" Y="1"/>
  </GeometryOptions>
</TextureText>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const node = result.blueprint.nodes.find((n) => n.name === "HeroLabel");
      if (node?.type === "text") {
        expect(node.geometry.fontStyleId).toBe("fs-abc");
      } else throw new Error("expected text node");
      const md = result.blueprint.metadata as { w3d?: { textFontStyles?: Record<string, {
        name: string | null; fontName: string | null; type: string | null;
      }> } };
      const fs = md.w3d?.textFontStyles?.["fs-abc"];
      expect(fs?.name).toBe("FS_03");
      expect(fs?.fontName).toBe("Obviously Cond");
      expect(fs?.type).toBe("Bold");
    });

    it("populates TextNode.geometry.maxWidth/maxHeight when HasTextBox=True", () => {
      // Real LINEUP_LEFT case: PLAYER_LAST_NAME_NN has a TextBoxSize that
      // the W3D engine fits the player surname into. The renderer reads
      // these to scale down the generated TextGeometry instead of letting
      // the player's name overflow the card.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<TextureText Id="t-name" Name="PLAYER_LAST_NAME_01">
  <GeometryOptions ConstrainMethod="Width" HasTextBox="True" AlignmentX="Center" Text="STEPHENS">
    <TextBoxSize X="1.2" Y="0.4"/>
  </GeometryOptions>
</TextureText>
<TextureText Id="t-free" Name="FreeText">
  <GeometryOptions HasTextBox="False" Text="UNBOUNDED"/>
</TextureText>
</Children></SceneNode></SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const bounded = result.blueprint.nodes.find((n) => n.name === "PLAYER_LAST_NAME_01");
      const free = result.blueprint.nodes.find((n) => n.name === "FreeText");
      if (bounded?.type === "text") {
        expect(bounded.geometry.hasTextBox).toBe(true);
        expect(bounded.geometry.maxWidth).toBeCloseTo(1.2, 3);
        expect(bounded.geometry.maxHeight).toBeCloseTo(0.4, 3);
      } else {
        throw new Error("expected text node");
      }
      // Free-flow text (HasTextBox=False) must NOT have a max set — the
      // renderer should leave its size alone.
      if (free?.type === "text") {
        expect(free.geometry.hasTextBox).toBeUndefined();
        expect(free.geometry.maxWidth).toBeUndefined();
        expect(free.geometry.maxHeight).toBeUndefined();
      }
    });

    it("flattens Transform.Skew.YProp keyframes into NodeTransform/Skew (W3D diagonal-card scenario)", () => {
      // Real LINEUP_LEFT case: SHADOW_SMALL2 / diagonal card masks animate
      // Transform.Skew.YProp during the intro. Before this support the
      // controller landed in `unsupportedProperties` and cards rendered
      // as upright rectangles instead of diagonals.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children>
<Quad Id="diag" Name="DiagonalCard">
  <NodeTransform/>
  <GeometryOptions><Size X="2" Y="1"/></GeometryOptions>
</Quad>
</Children></SceneNode>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="t1" MaxFrames="200" PreviewMarker="150">
    <KeyFrameAnimationController AnimatedProperty="Transform.Skew.YProp" ControllableId="diag">
      <KeyFrame FrameNumber="0" Value="0" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="100" Value="20" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const card = result.blueprint.nodes.find((n) => n.name === "DiagonalCard");
      // Frame 100 is the last keyframe ≤ PreviewMarker=150 → skew.y = 20.
      expect(card?.transform.skew?.y).toBe(20);
      // Diagnostics: not in unsupportedProperties any more.
      const md = result.blueprint.metadata as { w3d?: { previewFlatten?: { unsupportedProperties: string[] } } };
      expect(md.w3d?.previewFlatten?.unsupportedProperties ?? []).not.toContain("Transform.Skew.YProp");
    });

    it("flattens Transform.Skew.XProp and Transform.Skew (uniform 'x,y,z') variants", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children>
<Quad Id="qx" Name="XSkew"><NodeTransform/></Quad>
<Quad Id="qu" Name="UniSkew"><NodeTransform/></Quad>
</Children></SceneNode>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="t1" MaxFrames="100" PreviewMarker="100">
    <KeyFrameAnimationController AnimatedProperty="Transform.Skew.XProp" ControllableId="qx">
      <KeyFrame FrameNumber="50" Value="15" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
    <KeyFrameAnimationController AnimatedProperty="Transform.Skew" ControllableId="qu">
      <KeyFrame FrameNumber="50" Value="5,10,0" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const xskew = result.blueprint.nodes.find((n) => n.name === "XSkew");
      const uskew = result.blueprint.nodes.find((n) => n.name === "UniSkew");
      expect(xskew?.transform.skew?.x).toBe(15);
      expect(uskew?.transform.skew?.x).toBe(5);
      expect(uskew?.transform.skew?.y).toBe(10);
      expect(uskew?.transform.skew?.z).toBe(0);
    });

    it("freezeAtPreviewMarker=false opts out of the flatten pre-pass (alias of flattenPreviewState=false)", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>
<TextureText Id="t1" Name="Label">
  <GeometryOptions HasTextBox="True" Text="RAW"><TextBoxSize X="2" Y="0.3"/></GeometryOptions>
</TextureText>
</Children></SceneNode>
<ExportManagerProperties>
  <ExportProperty Enable="True" PropertyName="Text" Type="String"
    Value="FROZEN" ControllableId="t1" UpdateMode="Instantly"/>
</ExportManagerProperties>
</SceneLayer></Scene>`;
      const result = parseW3D(xml, { freezeAtPreviewMarker: false });
      const node = result.blueprint.nodes.find((n) => n.name === "Label");
      if (node?.type === "text") expect(node.geometry.text).toBe("RAW");
    });

    it("persists previewFlatten stats into metadata.w3d for __r3Dump consumption", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Scene Is2DScene="True"><SceneLayer>
<SceneNode><Children><Quad Id="q1" Name="Q"/></Children></SceneNode>
<ExportManagerProperties>
  <ExportProperty Enable="True" PropertyName="Alpha" Type="Float"
    Value="0.5" ControllableId="q1" UpdateMode="Instantly"/>
</ExportManagerProperties>
<Timelines Format="HD1080i50">
  <Timeline Name="In" Id="t1tl" MaxFrames="50" PreviewMarker="40">
    <KeyFrameAnimationController AnimatedProperty="Transform.Position.XProp" ControllableId="q1">
      <KeyFrame FrameNumber="0" Value="0" LeftType="Linear" RightType="Linear"/>
      <KeyFrame FrameNumber="30" Value="2" LeftType="Linear" RightType="Linear"/>
    </KeyFrameAnimationController>
  </Timeline>
</Timelines>
</SceneLayer></Scene>`;
      const result = parseW3D(xml);
      const md = result.blueprint.metadata as { w3d?: { previewFlatten?: {
        clipName: string | null; frame: number;
        appliedControllers: number; appliedExportProperties: number;
        unsupportedProperties: string[]; changedNodeCount: number;
      } } } | undefined;
      const pf = md?.w3d?.previewFlatten;
      expect(pf).toBeDefined();
      expect(pf?.clipName).toBe("In");
      expect(pf?.frame).toBe(40);
      expect(pf?.appliedControllers).toBeGreaterThanOrEqual(1);
      expect(pf?.appliedExportProperties).toBeGreaterThanOrEqual(1);
      expect(pf?.changedNodeCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Phase 6: animated property mappings (Size / Skew / compound Position)", () => {
    // Hand-crafted minimal scene — one Quad with animated Size.YProp,
    // Transform.Skew.YProp, and a compound Transform.Position controller.
    // Uses ControllableId-driven targeting like the real importer and a
    // single "In" timeline so PreviewMarker / fps detection stay sane.
    const buildMinimalScene = (controllers: string): string => `<?xml version="1.0" encoding="utf-8"?>
<Scene Name="MinimalPhase6" Is2DScene="True">
  <SceneLayer Name="Default">
    <CameraManager>
      <Camera Name="Camera" />
    </CameraManager>
    <SceneNode Name="RootNode">
      <Children>
        <Quad Id="quad-1" Name="Box1">
          <NodeTransform>
            <Position X="0" Y="0" Z="0" />
            <Rotation X="0" Y="0" Z="0" />
            <Scale X="1" Y="1" Z="1" />
          </NodeTransform>
        </Quad>
      </Children>
    </SceneNode>
  </SceneLayer>
  <Timelines Format="HD1080p50">
    <Timeline Name="In" MaxFrames="200" PreviewMarker="100">
      ${controllers}
    </Timeline>
  </Timelines>
</Scene>`;

    it("maps Size.YProp to a transform.scale.y track, normalized by post-flatten geometry.height", () => {
      // W3D Size.YProp values are absolute geometry sizes at each keyframe.
      // The renderer multiplies geometry.height by transform.scale.y, so the
      // importer divides each track value by the post-flatten geometry size
      // — the rendered output (height × scale) still equals the W3D value.
      const xml = buildMinimalScene(`
        <KeyFrameAnimationController ControllableId="quad-1" AnimatedProperty="Size.YProp">
          <KeyFrame FrameNumber="0" Value="1" />
          <KeyFrame FrameNumber="100" Value="2.5" />
        </KeyFrameAnimationController>
      `);
      const result = parseW3D(xml, { sceneName: "MinimalPhase6" });
      const inClip = result.blueprint.animation.clips.find((c) => c.name === "In");
      expect(inClip).toBeDefined();
      const sizeTrack = inClip!.tracks.find((t) => t.property === "transform.scale.y");
      expect(sizeTrack).toBeDefined();
      expect(sizeTrack!.keyframes).toHaveLength(2);
      // Post-flatten height = 2.5 (the PreviewMarker=100 sample). Normalized
      // track values: 1/2.5 = 0.4, 2.5/2.5 = 1.0. Rendered (height × scale):
      // 2.5 × 0.4 = 1.0 at frame 0, 2.5 × 1.0 = 2.5 at frame 100 — matches
      // the W3D absolute values.
      const quad = result.blueprint.nodes.find((n) => n.name === "Box1");
      expect(quad).toBeDefined();
      if (quad && quad.type !== "group") {
        const g = (quad as unknown as { geometry: { height: number } }).geometry;
        expect(g.height).toBeCloseTo(2.5);
      }
      expect(sizeTrack!.keyframes[0].value).toBeCloseTo(0.4);
      expect(sizeTrack!.keyframes[1].value).toBeCloseTo(1.0);
      // Should NOT show up in the importer's "no track mapping" warnings.
      expect(result.warnings.find((w) => w.includes('Size.YProp'))).toBeUndefined();
    });

    it("maps Transform.Skew.YProp to a transform.skew.y track and seeds node.transform.skew", () => {
      const xml = buildMinimalScene(`
        <KeyFrameAnimationController ControllableId="quad-1" AnimatedProperty="Transform.Skew.YProp">
          <KeyFrame FrameNumber="0" Value="0" />
          <KeyFrame FrameNumber="50" Value="15" />
        </KeyFrameAnimationController>
      `);
      const result = parseW3D(xml, { sceneName: "MinimalPhase6" });
      const inClip = result.blueprint.animation.clips.find((c) => c.name === "In");
      const skewTrack = inClip!.tracks.find((t) => t.property === "transform.skew.y");
      expect(skewTrack).toBeDefined();
      expect(skewTrack!.keyframes).toHaveLength(2);
      expect(skewTrack!.keyframes[1].value).toBeCloseTo(15);
      // Static skew must be seeded so the runtime skewLayer mounts. (The
      // flatten pre-pass legitimately overwrites .y with the PreviewMarker
      // keyframe value — we only assert the field exists and the un-animated
      // axes default to 0, which is what proves the seeding ran.)
      const quad = result.blueprint.nodes.find((n) => n.name === "Box1");
      expect(quad?.transform.skew).toBeDefined();
      expect(quad?.transform.skew?.x).toBe(0);
      expect(quad?.transform.skew?.z).toBe(0);
    });

    it("fans Transform.Position compound out to x/y/z, decoding CSV vector values", () => {
      const xml = buildMinimalScene(`
        <KeyFrameAnimationController ControllableId="quad-1" AnimatedProperty="Transform.Position">
          <KeyFrame FrameNumber="0" Value="0,0,0" />
          <KeyFrame FrameNumber="100" Value="1.7,0.5,-3" />
        </KeyFrameAnimationController>
      `);
      const result = parseW3D(xml, { sceneName: "MinimalPhase6" });
      const inClip = result.blueprint.animation.clips.find((c) => c.name === "In");
      const xTrack = inClip!.tracks.find((t) => t.property === "transform.position.x");
      const yTrack = inClip!.tracks.find((t) => t.property === "transform.position.y");
      const zTrack = inClip!.tracks.find((t) => t.property === "transform.position.z");
      expect(xTrack).toBeDefined();
      expect(yTrack).toBeDefined();
      expect(zTrack).toBeDefined();
      expect(xTrack!.keyframes[1].value).toBeCloseTo(1.7);
      // Y axis: importer applies a Y-flip ONLY for the per-axis Transform.Position.YProp
      // map entry; the compound path goes through decodeCompoundKeyframeAxis
      // and is not flipped, matching the legacy compound-Scale precedent.
      expect(yTrack!.keyframes[1].value).toBeCloseTo(0.5);
      expect(zTrack!.keyframes[1].value).toBeCloseTo(-3);
    });

    it("falls back to broadcast-to-all-axes when a compound Transform.Position keyframe ships a single number", () => {
      const xml = buildMinimalScene(`
        <KeyFrameAnimationController ControllableId="quad-1" AnimatedProperty="Transform.Position">
          <KeyFrame FrameNumber="0" Value="0" />
          <KeyFrame FrameNumber="100" Value="2" />
        </KeyFrameAnimationController>
      `);
      const result = parseW3D(xml, { sceneName: "MinimalPhase6" });
      const inClip = result.blueprint.animation.clips.find((c) => c.name === "In");
      const xTrack = inClip!.tracks.find((t) => t.property === "transform.position.x");
      const yTrack = inClip!.tracks.find((t) => t.property === "transform.position.y");
      const zTrack = inClip!.tracks.find((t) => t.property === "transform.position.z");
      expect(xTrack!.keyframes[1].value).toBeCloseTo(2);
      expect(yTrack!.keyframes[1].value).toBeCloseTo(2);
      expect(zTrack!.keyframes[1].value).toBeCloseTo(2);
    });
  });
});
