import { describe, expect, it } from "vitest";
import { detectSceneMode, parseW3D } from "./w3d";
import type { ImageAsset } from "../types";
import testSceneXml from "../../test/fixtures/w3d/TestScene.w3d?raw";
import gameNameFsXml from "../../test/fixtures/w3d/GameName_FS.w3d?raw";

function parseDoc(xml: string): Element {
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

describe("detectSceneMode", () => {
  it("respects Is2DScene='True'", () => {
    const sceneEl = parseDoc('<Scene Is2DScene="True"><SceneLayer/></Scene>');
    const decision = detectSceneMode(sceneEl);
    expect(decision.mode).toBe("2d");
    expect(decision.source).toBe("Is2DScene-attr");
  });

  it("respects Is2DScene='False'", () => {
    const sceneEl = parseDoc('<Scene Is2DScene="False"><SceneLayer/></Scene>');
    const decision = detectSceneMode(sceneEl);
    expect(decision.mode).toBe("3d");
    expect(decision.source).toBe("Is2DScene-attr");
  });

  it("falls back to 3D when a Mesh primitive is present and Is2DScene missing", () => {
    const sceneEl = parseDoc('<Scene><SceneLayer><Mesh Id="x"/></SceneLayer></Scene>');
    const decision = detectSceneMode(sceneEl);
    expect(decision.mode).toBe("3d");
    expect(decision.source).toBe("heuristic-3d");
    expect(decision.reason).toContain("Mesh");
  });

  it("falls back to 3D when only a DirectionalLight is present", () => {
    const sceneEl = parseDoc('<Scene><SceneLayer><DirectionalLight Id="x"/></SceneLayer></Scene>');
    expect(detectSceneMode(sceneEl).mode).toBe("3d");
  });

  it("falls back to 3D when the camera sits off the XY plane", () => {
    const sceneEl = parseDoc(
      '<Scene><SceneLayer><CameraManager><Camera><Position Z="-22"/></Camera></CameraManager><Quad Id="q"/></SceneLayer></Scene>',
    );
    const decision = detectSceneMode(sceneEl);
    expect(decision.mode).toBe("3d");
    expect(decision.reason).toContain("camera Z");
  });

  it("falls back to 2D when only Quads/Disks/TextureTexts and no off-plane camera", () => {
    const sceneEl = parseDoc('<Scene><SceneLayer><Quad Id="q"/><TextureText Id="t"/></SceneLayer></Scene>');
    expect(detectSceneMode(sceneEl).mode).toBe("2d");
  });
});

describe("parseW3D engine + sceneMode wiring", () => {
  it("imports TestScene as a 3D scene with engine settings populated", () => {
    const result = parseW3D(testSceneXml, { sceneName: "TestScene" });
    expect(result.blueprint.sceneMode).toBe("3d");
    // Background colour from SceneLayer.BackgroundColor=-16777216 → opaque black.
    expect(result.blueprint.engine?.background?.type).toBe("color");
    if (result.blueprint.engine?.background?.type === "color") {
      expect(result.blueprint.engine.background.color.toLowerCase()).toBe("#000000");
    }
    // Camera info exists (TestScene declares <Camera> without explicit position).
    expect(result.blueprint.engine?.camera?.mode).toBe("perspective");
  });

  it("imports GameName_FS as a 2D scene because the _FS suffix flags fullscreen", () => {
    // Folder-name conventions outrank Is2DScene — GameName_FS has
    // Is2DScene="False" in the XML but the _FS suffix means broadcast
    // intends an orthographic fullscreen layout.
    const result = parseW3D(gameNameFsXml, { sceneName: "GameName_FS" });
    expect(result.blueprint.sceneMode).toBe("2d");
    const cam = result.blueprint.engine?.camera;
    expect(cam?.mode).toBe("orthographic");
  });

  it("respects sceneModeOverride=2d for callers that need legacy behaviour", () => {
    const result = parseW3D(gameNameFsXml, { sceneName: "GameName_FS", sceneModeOverride: "2d" });
    expect(result.blueprint.sceneMode).toBe("2d");
  });

  it("aggregates DirectionalLight warnings into a single line when there are several", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<DirectionalLight Id="l1" Name="Top1"/>' +
      '<DirectionalLight Id="l2" Name="Top2"/>' +
      '<DirectionalLight Id="l3" Name="Top3"/>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const lightWarnings = result.warnings.filter((w) => w.includes("DirectionalLight"));
    expect(lightWarnings.length).toBe(1);
    expect(lightWarnings[0]).toMatch(/Skipped 3 <DirectionalLight>/);
  });

  it("imports Box primitives as box nodes with the authored size", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Box Id="b1" Name="MyBox"><GeometryOptions><Size X="2" Y="3" Z="4"/></GeometryOptions></Box>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const box = result.blueprint.nodes.find((n) => n.name === "MyBox");
    expect(box?.type).toBe("box");
    if (box?.type === "box") {
      expect(box.geometry.width).toBe(2);
      expect(box.geometry.height).toBe(3);
      expect(box.geometry.depth).toBe(4);
    }
  });

  it("imports Cone primitives as cylinder nodes with radiusTop=0", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Cone Id="c1" Name="Tip"><GeometryOptions Radius="1.5" Height="3"/></Cone>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const cone = result.blueprint.nodes.find((n) => n.name === "Tip");
    expect(cone?.type).toBe("cylinder");
    if (cone?.type === "cylinder") {
      expect(cone.geometry.radiusTop).toBe(0);
      expect(cone.geometry.radiusBottom).toBeCloseTo(1.5);
      expect(cone.geometry.height).toBeCloseTo(3);
    }
  });

  it("imports Mesh primitives as box placeholders and warns about the missing loader", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Mesh Id="m1" Name="HeroMesh" MeshId="abc"/>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const placeholder = result.blueprint.nodes.find((n) => n.name === "HeroMesh");
    expect(placeholder?.type).toBe("box");
    expect(result.warnings.some((w) => w.includes("<Mesh>"))).toBe(true);
  });

  it("registers mesh placeholders in shadow.meshPlaceholderNodeIds for the renderer to hide", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Mesh Id="m1" Name="HeroMesh"/>' +
      '<Quad Id="q1" Name="Banner"/>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const placeholder = result.blueprint.nodes.find((n) => n.name === "HeroMesh");
    expect(placeholder).toBeDefined();
    const w3d = result.blueprint.metadata?.w3d as { meshPlaceholderNodeIds?: string[] };
    expect(w3d?.meshPlaceholderNodeIds).toBeDefined();
    expect(w3d.meshPlaceholderNodeIds).toContain(placeholder!.id);
    // Quads should NOT be in the placeholder list — only mesh stand-ins are hidden.
    const quad = result.blueprint.nodes.find((n) => n.name === "Banner");
    expect(w3d.meshPlaceholderNodeIds).not.toContain(quad!.id);
  });

  it("walks BasicPrimitive containers so their nested Meshes survive the import", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<BasicPrimitive Id="bp1" Name="Container">' +
      '  <Children><Mesh Id="m1" Name="ChildMesh"/></Children>' +
      "</BasicPrimitive>" +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    expect(result.blueprint.nodes.some((n) => n.name === "Container")).toBe(true);
    expect(result.blueprint.nodes.some((n) => n.name === "ChildMesh")).toBe(true);
  });
});

describe("detectSceneMode folder-name override", () => {
  function decide(name: string, attr?: "True" | "False") {
    const xml = attr
      ? `<Scene Is2DScene="${attr}"><SceneLayer/></Scene>`
      : "<Scene><SceneLayer/></Scene>";
    return detectSceneMode(parseDoc(xml), name);
  }

  it("forces 2d when the name ends in _FS", () => {
    const decision = decide("GameName_FS", "False");
    expect(decision.mode).toBe("2d");
    expect(decision.source).toBe("name-2d");
  });

  it("forces 2d for _Fullscreen and _Overlay variants", () => {
    expect(decide("Live_Fullscreen").mode).toBe("2d");
    expect(decide("Score_Overlay").mode).toBe("2d");
    expect(decide("Bug_2D").mode).toBe("2d");
  });

  it("forces 3d when the name starts with AR_", () => {
    expect(decide("AR_GAMEINTRO", "True").mode).toBe("3d");
    expect(decide("AR_TACTIC").mode).toBe("3d");
  });

  it("falls back to Is2DScene when the name is neutral", () => {
    expect(decide("MyScene", "True").mode).toBe("2d");
    expect(decide("MyScene", "False").mode).toBe("3d");
  });
});

describe("ExportProperty parsing", () => {
  it("collects exposedProperties with type coercion and ControllableId binding", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      "<Scene><SceneLayer/><ExportManagerProperties><ExportList>" +
      '<ExportProperty Id="p1" Name="Player Name" PropertyName="player_name" Type="String" Value="Stephens" ControllableId="ABC-123" UpdateMode="OnTake"/>' +
      '<ExportProperty Id="p2" Name="Score" PropertyName="score" Type="Float" Value="42.5" ControllableId="DEF-456"/>' +
      '<ExportProperty Id="p3" Name="Visible" PropertyName="visible" Type="Bool" Value="True"/>' +
      '<ExportProperty Id="p4" Name="Tint" PropertyName="tint" Type="ColorInt" Value="-65536"/>' +
      "</ExportList></ExportManagerProperties></Scene>";
    const result = parseW3D(xml);
    const props = result.blueprint.exposedProperties ?? [];
    expect(props.length).toBe(4);
    const player = props.find((p) => p.id === "player_name");
    expect(player?.type).toBe("string");
    expect(player?.defaultValue).toBe("Stephens");
    expect(player?.controllableId).toBe("abc-123");
    expect(player?.updateMode).toBe("OnTake");
    const score = props.find((p) => p.id === "score");
    expect(score?.type).toBe("number");
    expect(score?.defaultValue).toBe(42.5);
    const visible = props.find((p) => p.id === "visible");
    expect(visible?.type).toBe("boolean");
    expect(visible?.defaultValue).toBe(true);
    const tint = props.find((p) => p.id === "tint");
    expect(tint?.type).toBe("color");
    // -65536 = 0xFFFF0000 = red.
    expect(tint?.defaultValue).toBe("#ff0000");
  });

  it("preserves all attributes in raw[] for forward-compat", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene><SceneLayer/><ExportProperty Id="p1" Name="X" PropertyName="x" Type="String" Value="v" CustomThing="hello"/></Scene>';
    const result = parseW3D(xml);
    const prop = result.blueprint.exposedProperties?.[0];
    expect(prop?.raw?.CustomThing).toBe("hello");
  });
});

describe("Lights metadata", () => {
  it("captures DirectionalLight pose and intensity into importMetadata.lights", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<DirectionalLight Id="L1" Name="Top1">' +
      '  <GeometryOptions><Intensity Value="0.8"/><BaseMaterial Diffuse="ff0000"/></GeometryOptions>' +
      '  <NodeTransform><Position Y="3"/><Rotation X="45"/></NodeTransform>' +
      "</DirectionalLight>" +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const lights = result.blueprint.importMetadata?.lights ?? [];
    expect(lights.length).toBe(1);
    expect(lights[0].name).toBe("Top1");
    expect(lights[0].intensity).toBeCloseTo(0.8);
    expect(lights[0].color?.toLowerCase()).toBe("#ff0000");
    expect(lights[0].position?.y).toBeCloseTo(3);
    expect(lights[0].rotation?.x).toBeCloseTo(45);
  });
});

describe("Camera metadata", () => {
  it("preserves IsTracked, TrackingCamera, RenderTarget, AspectRatio and FieldofViewX", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><CameraManager>' +
      '<Camera Id="C1" Name="Cam1" FieldofViewY="50" FieldofViewX="80" AspectRatio="1.78" IsTracked="True" TrackingCamera="Cam0" RenderTarget="Output 1">' +
      '<Position Z="-10"/></Camera>' +
      "</CameraManager></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const meta = result.blueprint.engine?.camera?.metadata;
    expect(meta?.isTracked).toBe(true);
    expect(meta?.trackingCamera).toBe("Cam0");
    expect(meta?.renderTarget).toBe("Output 1");
    expect(meta?.aspectRatio).toBeCloseTo(1.78);
    expect(meta?.fovX).toBeCloseTo(80);
    expect(meta?.sourceId).toBe("c1");
    expect(meta?.sourceName).toBe("Cam1");
  });
});

describe("Multi-mask + IsInvertedMask", () => {
  it("resolves a list of MaskId references into maskIds[]", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>' +
      '<Quad Id="m1" Name="MaskA" IsMask="True"/>' +
      '<Quad Id="m2" Name="MaskB" IsMask="True"/>' +
      '<Quad Id="q1" Name="Target" MaskId="m1;m2"/>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const target = result.blueprint.nodes.find((n) => n.name === "Target");
    expect(target?.maskIds?.length).toBe(2);
    expect(target?.maskId).toBe(target?.maskIds?.[0]);
  });

  it("flags IsInvertedMask='True' on the target node", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>' +
      '<Quad Id="m1" Name="MaskA" IsMask="True"/>' +
      '<Quad Id="q1" Name="Target" MaskId="m1" IsInvertedMask="True"/>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const target = result.blueprint.nodes.find((n) => n.name === "Target");
    expect(target?.maskInverted).toBe(true);
  });

  it("captures MaskProperties attributes into shadow data", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="True"><SceneLayer><SceneNode><Children>' +
      '<Quad Id="q1" Name="Target">' +
      '<MaskProperties IsColoredMask="True" DisableBinaryAlpha="True"/>' +
      "</Quad></Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const target = result.blueprint.nodes.find((n) => n.name === "Target");
    const w3d = result.blueprint.metadata?.w3d as { maskProperties?: Record<string, Record<string, string>> };
    expect(w3d.maskProperties?.[target!.id]?.IsColoredMask).toBe("True");
    expect(w3d.maskProperties?.[target!.id]?.DisableBinaryAlpha).toBe("True");
  });
});

describe("TextureMappingOption sampling", () => {
  it("reads wrap, filter, offset and scale onto material.textureOptions", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><Resources>' +
      '<Texture Id="tx1" Filename="logo.png"/>' +
      '<TextureLayer Id="LY1">' +
      '<TextureMappingOption Texture="tx1" TextureAddressModeU="Clamp" TextureAddressModeV="Wrap" TextureFilteringMag="Anisotropic" TextureFilteringMin="Linear">' +
      '<Offset X="0.25" Y="0.5"/>' +
      '<Scale X="2" Y="3"/>' +
      "</TextureMappingOption></TextureLayer>" +
      "</Resources><SceneLayer><SceneNode><Children>" +
      '<Quad Id="q1" Name="Logo">' +
      "<Primitive><FaceMappingList>" +
      '<NamedBaseFaceMapping TextureLayerId="LY1"/>' +
      "</FaceMappingList></Primitive></Quad>" +
      "</Children></SceneNode></SceneLayer></Scene>";
    const textures = new Map<string, ImageAsset>();
    textures.set("logo.png", { name: "logo.png", mimeType: "image/png", src: "x", width: 1, height: 1 });
    const result = parseW3D(xml, { textures });
    const node = result.blueprint.nodes.find((n) => n.name === "Logo");
    expect(node?.type).toBe("image");
    if (node?.type === "image") {
      const opts = node.material.textureOptions;
      expect(opts?.wrapU).toBe("clamp");
      expect(opts?.wrapV).toBe("repeat");
      expect(opts?.magFilter).toBe("anisotropic");
      expect(opts?.minFilter).toBe("linear");
      expect(opts?.offsetU).toBeCloseTo(0.25);
      // Y-axis is negated to convert R3's downward-V → Three's upward-V.
      expect(opts?.offsetV).toBeCloseTo(-0.5);
      expect(opts?.repeatU).toBeCloseTo(2);
      expect(opts?.repeatV).toBeCloseTo(3);
    }
  });
});

describe("Design-view Enable promotion", () => {
  it("imports Enable='False' nodes as visible=true so the user can see them", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Group Id="g1" Name="HELPERS" Enable="False"><Children>' +
      '<Quad Id="q1" Name="Floor"/>' +
      "</Children></Group>" +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const helpers = result.blueprint.nodes.find((n) => n.name === "HELPERS");
    expect(helpers?.visible).toBe(true);
    const w3d = result.blueprint.metadata?.w3d as { initialDisabledNodeIds?: string[] };
    expect(w3d.initialDisabledNodeIds).toContain(helpers!.id);
  });

  it("does not flag visible-by-default nodes as initially disabled", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Quad Id="q1" Name="Visible"/>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const w3d = result.blueprint.metadata?.w3d as { initialDisabledNodeIds?: string[] };
    expect(w3d.initialDisabledNodeIds).toBeUndefined();
  });
});

describe("Per-node Alpha attribute", () => {
  it("applies <Quad Alpha='0.25'> to material.opacity and forces transparent", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Quad Id="q1" Name="Shadow" Alpha="0.25"/>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const node = result.blueprint.nodes.find((n) => n.name === "Shadow");
    expect(node?.type).toBe("plane");
    if (node && node.type === "plane") {
      expect(node.material.opacity).toBeCloseTo(0.25);
      expect(node.material.transparent).toBe(true);
    }
  });

  it("multiplies onto an already-translucent BaseMaterial instead of overwriting", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      "<Scene><Resources>" +
      '<BaseMaterial Id="bm1" HasDiffuse="True" Diffuse="ffffff" Alpha="0.5"/>' +
      "</Resources><SceneLayer><SceneNode><Children>" +
      '<Quad Id="q1" Name="Combined" Alpha="0.5">' +
      "<Primitive><FaceMappingList>" +
      '<NamedBaseFaceMapping MaterialId="bm1"/>' +
      "</FaceMappingList></Primitive></Quad>" +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const node = result.blueprint.nodes.find((n) => n.name === "Combined");
    if (node && node.type === "plane") {
      // 0.5 (BaseMaterial) * 0.5 (Quad attr) = 0.25
      expect(node.material.opacity).toBeCloseTo(0.25);
    }
  });

  it("ignores missing Alpha attribute (preserves BaseMaterial opacity)", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Quad Id="q1" Name="Solid"/>' +
      "</Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const node = result.blueprint.nodes.find((n) => n.name === "Solid");
    if (node && node.type === "plane") {
      expect(node.material.opacity).toBe(1);
    }
  });
});

describe("Text size from TextBoxSize", () => {
  it("uses TextBoxSize.Y as the glyph height when present", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<TextureText Id="t1" Name="Big">' +
      '<GeometryOptions HasTextBox="True" Text="5"><TextBoxSize X="0.08" Y="0.19"/></GeometryOptions>' +
      "</TextureText></Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const node = result.blueprint.nodes.find((n) => n.name === "Big");
    if (node && node.type === "text") {
      expect(node.geometry.size).toBeCloseTo(0.19);
    }
  });

  it("falls back to a small default when HasTextBox is False", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<TextureText Id="t1" Name="Free">' +
      '<GeometryOptions HasTextBox="False" Text="v"/>' +
      "</TextureText></Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const node = result.blueprint.nodes.find((n) => n.name === "Free");
    if (node && node.type === "text") {
      expect(node.geometry.size).toBeCloseTo(0.1);
    }
  });

  it("imports GeometryText (3D extruded) with the authored Extrusion", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<GeometryText Id="g1" Name="Title">' +
      '<GeometryOptions HasTextBox="True" Text="IRONHAWKS" Extrusion="0.1"><TextBoxSize Y="0.5"/></GeometryOptions>' +
      "</GeometryText></Children></SceneNode></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const node = result.blueprint.nodes.find((n) => n.name === "Title");
    expect(node?.type).toBe("text");
    if (node && node.type === "text") {
      expect(node.geometry.size).toBeCloseTo(0.5);
      expect(node.geometry.depth).toBeCloseTo(0.1);
      expect(node.geometry.text).toBe("IRONHAWKS");
    }
  });
});

describe("Uniform Transform.Scale animation", () => {
  it("fans a Transform.Scale controller out to scale.x/y/z tracks", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Quad Id="q1" Name="Pulse"/>' +
      "</Children></SceneNode>" +
      '<Timelines Format="HD1080i50">' +
      '<Timeline Id="T1" Name="In" MaxFrames="50">' +
      '<KeyFrameAnimationController ControllableId="q1" AnimatedProperty="Transform.Scale">' +
      '<KeyFrame Id="K1" FrameNumber="0" Value="0.5"/>' +
      '<KeyFrame Id="K2" FrameNumber="20" Value="1"/>' +
      "</KeyFrameAnimationController></Timeline></Timelines></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const clip = result.blueprint.animation.clips.find((c) => c.name === "In");
    expect(clip?.tracks.length).toBe(3);
    const paths = clip?.tracks.map((t) => t.property).sort();
    expect(paths).toEqual(["transform.scale.x", "transform.scale.y", "transform.scale.z"]);
    // Every fan-out track should carry the same keyframe values.
    for (const track of clip?.tracks ?? []) {
      expect(track.keyframes.map((kf) => kf.value)).toEqual([0.5, 1]);
    }
  });
});

describe("Alpha animation track", () => {
  it("maps W3D Alpha controllers onto material.opacity tracks", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Quad Id="q1" Name="Fade"/>' +
      "</Children></SceneNode>" +
      '<Timelines Format="HD1080i50">' +
      '<Timeline Id="T1" Name="In" MaxFrames="50">' +
      '<KeyFrameAnimationController ControllableId="q1" AnimatedProperty="Alpha">' +
      '<KeyFrame Id="K1" FrameNumber="0" Value="0"/>' +
      '<KeyFrame Id="K2" FrameNumber="25" Value="1"/>' +
      "</KeyFrameAnimationController></Timeline></Timelines></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const clip = result.blueprint.animation.clips.find((c) => c.name === "In");
    expect(clip).toBeDefined();
    const track = clip?.tracks[0];
    expect(track?.property).toBe("material.opacity");
    expect(track?.keyframes.length).toBe(2);
    expect(track?.keyframes[0].value).toBeCloseTo(0);
    expect(track?.keyframes[1].value).toBeCloseTo(1);
  });
});

describe("Transform.Rotation.Y legacy spelling", () => {
  it("treats `Transform.Rotation.Y` (no .Prop) as an alias for transform.rotation.y", () => {
    // AR_GAMEINTRO / AR_TACTIC emit a handful of rotation Y controllers
    // without the canonical `.Prop` suffix. Without the alias these
    // controllers fell back to the "no track mapping" warning bucket and
    // were dropped from the imported blueprint entirely.
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Scene Is2DScene="False"><SceneLayer><SceneNode><Children>' +
      '<Quad Id="q1" Name="Spinner"/>' +
      "</Children></SceneNode>" +
      '<Timelines Format="HD1080i50">' +
      '<Timeline Id="T1" Name="In" MaxFrames="50">' +
      '<KeyFrameAnimationController ControllableId="q1" AnimatedProperty="Transform.Rotation.Y">' +
      '<KeyFrame Id="K1" FrameNumber="0" Value="0"/>' +
      '<KeyFrame Id="K2" FrameNumber="50" Value="3.14159"/>' +
      "</KeyFrameAnimationController></Timeline></Timelines></SceneLayer></Scene>";
    const result = parseW3D(xml);
    const clip = result.blueprint.animation.clips.find((c) => c.name === "In");
    expect(clip?.tracks.length).toBe(1);
    expect(clip?.tracks[0].property).toBe("transform.rotation.y");
    expect(clip?.tracks[0].keyframes.map((kf) => kf.value)).toEqual([0, 3.14159]);
    // The alias must not also fire the "no track mapping" warning.
    const skipWarning = result.warnings.find(
      (w) => w.includes("AnimatedProperty") && w.includes("Transform.Rotation.Y"),
    );
    expect(skipWarning).toBeUndefined();
  });
});
