import { describe, expect, it } from "vitest";
import { parseW3DSceneMetadata } from "./w3d";

const SCENE_3D_HEAD = `<?xml version="1.0" encoding="utf-8"?>
<Scene Id="2c17f491-a3b3-4302-82eb-77c4c0932ec7" Name="LINEUP_LEFT" Version="3.6.0.*" Is2DScene="False" IsChroma="False" ConvertedScene="False">
  <SceneLayer Name="LINEUP_LEFT" Id="0500c732-4bc1-4187-8e77-64e7ccd84d62" BackgroundColor="-16777216" RenderOrder="1">
    <CameraManager>
      <Camera Id="0BD8383A-A75C-4876-8F11-4767B41C7FED" Name="Camera" Projection="Ortographic" TrackingCamera="Cam0">
        <Position Y="-4.423593E-06" Z="-101.1555" />
        <Extensions />
      </Camera>
    </CameraManager>
  </SceneLayer>
</Scene>`;

const SCENE_2D_NO_CAMERA = `<?xml version="1.0" encoding="utf-8"?>
<Scene Name="OverlayCard" Is2DScene="True">
  <SceneLayer Name="OverlayCard" BackgroundColor="-16711936" RenderOrder="0" />
</Scene>`;

describe("parseW3DSceneMetadata", () => {
  it("reads scene name, mode, background and orthographic camera from a 3D scene", () => {
    const { blueprint, warnings } = parseW3DSceneMetadata(SCENE_3D_HEAD);

    expect(warnings).toHaveLength(0);
    expect(blueprint.componentName).toBe("LINEUP_LEFT");
    // Is2DScene="False" but Projection="Ortographic" → 2D viewport (locked,
    // letterboxed). The W3D engine renders these as broadcast cards.
    expect(blueprint.sceneSettings?.mode).toBe("2d");
    expect(blueprint.sceneSettings?.backgroundColor).toBe("#000000");
    expect(blueprint.engine?.background).toEqual({ type: "color", color: "#000000", alpha: 1 });
    expect(blueprint.engine?.camera?.mode).toBe("orthographic");
    expect(blueprint.engine?.camera?.position?.z).toBeCloseTo(-101.1555, 3);
    expect(blueprint.engine?.camera?.metadata?.trackingCamera).toBe("Cam0");
    expect(blueprint.engine?.camera?.metadata?.isTracked).toBe(true);
    expect(blueprint.engine?.camera?.metadata?.sourceId).toBe("0bd8383a-a75c-4876-8f11-4767b41c7fed");
    expect(blueprint.importMetadata?.source).toBe("w3d");
    // Node tree intentionally empty in Phase C — only the default root group.
    expect(blueprint.nodes.length).toBeLessThanOrEqual(1);
  });

  it("stays in 3D mode when Is2DScene is False AND camera is perspective", () => {
    const xml = `<?xml version="1.0"?>
<Scene Name="Spatial" Is2DScene="False">
  <SceneLayer BackgroundColor="-1">
    <CameraManager>
      <Camera Projection="Perspective"><Position Z="-30" /></Camera>
    </CameraManager>
  </SceneLayer>
</Scene>`;
    const { blueprint } = parseW3DSceneMetadata(xml);

    expect(blueprint.sceneSettings?.mode).toBe("3d");
    expect(blueprint.engine?.camera?.mode).toBe("perspective");
  });

  it("flips to 2D scene mode when Is2DScene is True", () => {
    const { blueprint } = parseW3DSceneMetadata(SCENE_2D_NO_CAMERA);

    expect(blueprint.sceneSettings?.mode).toBe("2d");
    expect(blueprint.componentName).toBe("OverlayCard");
    expect(blueprint.engine?.camera).toBeUndefined();
    expect(blueprint.engine?.background?.type).toBe("color");
    expect((blueprint.engine?.background as { color: string }).color).toBe("#00ff00");
  });

  it("throws on XML without a Scene root", () => {
    expect(() =>
      parseW3DSceneMetadata(`<?xml version="1.0"?><NotAScene Name="x" />`),
    ).toThrowError(/no <Scene>/i);
  });

  it("throws on malformed XML", () => {
    expect(() => parseW3DSceneMetadata("<Scene><<<")).toThrowError(/invalid w3d xml/i);
  });

  it("warns on unparseable BackgroundColor but still imports", () => {
    const xml = `<?xml version="1.0"?>
<Scene Name="x" Is2DScene="False">
  <SceneLayer BackgroundColor="not-a-number" />
</Scene>`;
    const { warnings, blueprint } = parseW3DSceneMetadata(xml);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/BackgroundColor/);
    // Fell back to default
    expect(blueprint.sceneSettings?.backgroundColor).toBe("#25272c");
  });
});
