import { describe, expect, test } from "vitest";
import { parseResources } from "./resources";

function wrapResources(inner: string): string {
  return `<?xml version="1.0"?><Scene>${inner}</Scene>`;
}

describe("parseResources (skeleton)", () => {
  test("returns empty registry when no Resources element", () => {
    const { registry, warnings } = parseResources(wrapResources(""));
    expect(registry.baseMaterials.size).toBe(0);
    expect(registry.textures.size).toBe(0);
    expect(registry.textureLayers.size).toBe(0);
    expect(warnings).toEqual([]);
  });

  test("returns empty registry with empty Resources", () => {
    const { registry } = parseResources(wrapResources("<Resources/>"));
    expect(registry.baseMaterials.size).toBe(0);
  });
});

describe("parseResources — BaseMaterial", () => {
  test("parses PRIMARY emissive material", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <BaseMaterial Name="PRIMARY" Id="650321e5-70d4-427e-93a6-e97105e40feb"
          HasEmissive="True" HasDiffuse="False"
          Emissive="663087" Diffuse="ffffff" Alpha="1"
          HasAmbient="False" HasSpecular="False" Ambient="ffffff" Specular="ffffff"
          SpecularPower="50" Lock="False" FolderPath=""/>
      </Resources>
    `));
    const mat = registry.baseMaterials.get("650321e5-70d4-427e-93a6-e97105e40feb")!;
    expect(mat).toBeDefined();
    expect(mat.name).toBe("PRIMARY");
    expect(mat.hasEmissive).toBe(true);
    expect(mat.hasDiffuse).toBe(false);
    expect(mat.emissive).toBe("663087");
    expect(mat.alpha).toBe(1);
  });

  test("parses diffuse-only material (BaseMaterial default)", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <BaseMaterial Name="BaseMaterial" Id="fb537d4c-212e-4c78-88c6-1fa4e5f8cfaa"
          HasEmissive="False" HasDiffuse="True"
          Emissive="ffffff" Diffuse="ffffff" Alpha="1"
          HasAmbient="False" HasSpecular="False" Ambient="ffffff" Specular="ffffff"
          SpecularPower="50" Lock="False" FolderPath=""/>
      </Resources>
    `));
    const mat = registry.baseMaterials.get("fb537d4c-212e-4c78-88c6-1fa4e5f8cfaa")!;
    expect(mat.hasEmissive).toBe(false);
    expect(mat.hasDiffuse).toBe(true);
    expect(mat.diffuse).toBe("ffffff");
  });

  test("alpha parsed as number", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <BaseMaterial Name="SEMI" Id="semi-id"
          HasEmissive="True" HasDiffuse="False"
          Emissive="663087" Diffuse="ffffff" Alpha="0.5"
          HasAmbient="False" HasSpecular="False" Ambient="ffffff" Specular="ffffff"
          SpecularPower="50" Lock="False" FolderPath=""/>
      </Resources>
    `));
    const mat = registry.baseMaterials.get("semi-id")!;
    expect(mat.alpha).toBeCloseTo(0.5, 5);
  });

  test("multiple materials indexed by Id", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <BaseMaterial Name="PRIMARY" Id="id-a" HasEmissive="True" HasDiffuse="False" Emissive="663087" Diffuse="ffffff" Alpha="1" HasAmbient="False" HasSpecular="False" Ambient="ffffff" Specular="ffffff" SpecularPower="50" Lock="False" FolderPath=""/>
        <BaseMaterial Name="SECONDARY" Id="id-b" HasEmissive="True" HasDiffuse="False" Emissive="fdcc71" Diffuse="ffffff" Alpha="1" HasAmbient="False" HasSpecular="False" Ambient="ffffff" Specular="ffffff" SpecularPower="50" Lock="False" FolderPath=""/>
      </Resources>
    `));
    expect(registry.baseMaterials.size).toBe(2);
    expect(registry.baseMaterials.get("id-b")?.name).toBe("SECONDARY");
    expect(registry.baseMaterials.get("id-b")?.emissive).toBe("fdcc71");
  });
});

describe("parseResources — Texture", () => {
  test("parses Filename attribute (not FileName)", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <Texture Name="BASKETBALL_BACKGROUND.png" Id="70c60b5e-4b04-4f47-ab28-512287f6ca51"
          Filename="BASKETBALL_BACKGROUND.png" FolderPath=""/>
      </Resources>
    `));
    const tex = registry.textures.get("70c60b5e-4b04-4f47-ab28-512287f6ca51")!;
    expect(tex).toBeDefined();
    expect(tex.filename).toBe("BASKETBALL_BACKGROUND.png");
    expect(tex.name).toBe("BASKETBALL_BACKGROUND.png");
  });

  test("preserves FolderPath", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <Texture Name="foo.png" Id="id-1" Filename="foo.png" FolderPath="images/players"/>
      </Resources>
    `));
    expect(registry.textures.get("id-1")?.folderPath).toBe("images/players");
  });

  test("multiple textures indexed by Id", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <Texture Name="A.png" Id="id-a" Filename="A.png" FolderPath=""/>
        <Texture Name="B.png" Id="id-b" Filename="B.png" FolderPath=""/>
      </Resources>
    `));
    expect(registry.textures.size).toBe(2);
    expect(registry.textures.get("id-b")?.filename).toBe("B.png");
  });

  test("Texture with no Filename attribute yields empty string filename, no crash", () => {
    const { registry, warnings } = parseResources(wrapResources(`
      <Resources>
        <Texture Name="ghost.png" Id="ghost-id" FolderPath=""/>
      </Resources>
    `));
    const tex = registry.textures.get("ghost-id")!;
    expect(tex).toBeDefined();
    expect(tex.filename).toBe("");
    // Either warns or silently stores empty — either is acceptable
    // The key requirement: no crash, texture is still indexed
  });
});

describe("parseResources — TextureLayer", () => {
  test("BACKGROUND: textureGuid and keyType=AlphaKey", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <TextureLayer Name="BACKGROUND" Id="3c257629-9381-48f4-a4de-5e126593f44e"
          TextureBlending="Multiply" Lock="False" FolderPath="">
          <TextureMappingOption Texture="70c60b5e-4b04-4f47-ab28-512287f6ca51"
            KeyType="AlphaKey" IsEmissive="False" UseMipMapping="True"
            ColorShaping="Shaped" Interlaced="False" PremultiplyColor="0" Reflectivity="0"
            ReleaseVideoOnFillTag="False" TextureAddressModeU="Clamp" TextureAddressModeV="Clamp"
            TextureFilteringMag="Anisotropic" TextureFilteringMin="Anisotropic"
            TextureFilteringMip="Anisotropic" TextureStretchOption="Fill" Type="2" WrappingMethod="1"/>
          <TextureLayerEffects/>
        </TextureLayer>
      </Resources>
    `));
    const tl = registry.textureLayers.get("3c257629-9381-48f4-a4de-5e126593f44e")!;
    expect(tl).toBeDefined();
    expect(tl.name).toBe("BACKGROUND");
    expect(tl.textureBlending).toBe("Multiply");
    expect(tl.mapping?.textureGuid).toBe("70c60b5e-4b04-4f47-ab28-512287f6ca51");
    expect(tl.mapping?.keyType).toBe("AlphaKey");
    expect(tl.mapping?.keyGuid).toBeUndefined();
    expect(tl.mapping?.isEmissive).toBe(false);
    expect(tl.mapping?.useMipMapping).toBe(true);
  });

  test("LOGO: IsEmissive=True", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <TextureLayer Name="LOGO" Id="logo-id" TextureBlending="Multiply" Lock="False" FolderPath="">
          <TextureMappingOption Texture="73ec4fb6-816f-437c-ba93-d7d1b84a2b30"
            KeyType="AlphaKey" IsEmissive="True" UseMipMapping="True"
            ColorShaping="Shaped" Interlaced="False" PremultiplyColor="0" Reflectivity="0"
            ReleaseVideoOnFillTag="False" TextureAddressModeU="Clamp" TextureAddressModeV="Clamp"
            TextureFilteringMag="Anisotropic" TextureFilteringMin="Anisotropic"
            TextureFilteringMip="Anisotropic" TextureStretchOption="Fill" Type="2" WrappingMethod="1"/>
        </TextureLayer>
      </Resources>
    `));
    const tl = registry.textureLayers.get("logo-id")!;
    expect(tl.mapping?.isEmissive).toBe(true);
    expect(tl.mapping?.textureGuid).toBe("73ec4fb6-816f-437c-ba93-d7d1b84a2b30");
  });

  test("dynamic slot: no Texture GUID → mapping.textureGuid undefined, no crash", () => {
    const { registry, warnings } = parseResources(wrapResources(`
      <Resources>
        <TextureLayer Name="PHOTO_01" Id="photo-01-id" TextureBlending="Multiply" Lock="False" FolderPath="">
          <TextureMappingOption KeyType="AlphaKey" IsEmissive="False" UseMipMapping="False"
            ColorShaping="Shaped" Interlaced="False" PremultiplyColor="0" Reflectivity="0"
            ReleaseVideoOnFillTag="False" TextureAddressModeU="Clamp" TextureAddressModeV="Clamp"
            TextureFilteringMag="Anisotropic" TextureFilteringMin="Anisotropic"
            TextureFilteringMip="Anisotropic" TextureStretchOption="Fill" Type="2" WrappingMethod="1"/>
        </TextureLayer>
      </Resources>
    `));
    const tl = registry.textureLayers.get("photo-01-id")!;
    expect(tl).toBeDefined();
    expect(tl.mapping?.textureGuid).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test("Scale and Rotation preserved as metadata", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <TextureLayer Name="FF_MAIN" Id="ff-main-id" TextureBlending="Normal" Lock="False" FolderPath="">
          <TextureMappingOption IsEmissive="False" UseMipMapping="False"
            ColorShaping="Shaped" Interlaced="False" PremultiplyColor="0" Reflectivity="0"
            ReleaseVideoOnFillTag="False" TextureAddressModeU="Clamp" TextureAddressModeV="Clamp"
            TextureStretchOption="Fill" Type="2" WrappingMethod="1"/>
          <Scale X="2.0" Y="1.5"/>
          <Rotation Z="45"/>
        </TextureLayer>
      </Resources>
    `));
    const tl = registry.textureLayers.get("ff-main-id")!;
    expect(tl.scale).toEqual({ x: 2, y: 1.5 });
    expect(tl.rotationDeg).toBe(45);
  });

  test("Offset, OffsetKey, ScaleKey preserved as metadata", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <TextureLayer Name="PHOTO_TEST" Id="photo-test-id" TextureBlending="Normal" Lock="False" FolderPath="">
          <TextureMappingOption IsEmissive="False" UseMipMapping="False"
            ColorShaping="Shaped" Interlaced="False" PremultiplyColor="0" Reflectivity="0"
            ReleaseVideoOnFillTag="False" TextureAddressModeU="Clamp" TextureAddressModeV="Clamp"
            TextureStretchOption="Fill" Type="2" WrappingMethod="1"/>
          <Offset X="0.1" Y="0.2"/>
          <OffsetKey X="0.05" Y="0.0"/>
          <ScaleKey X="1.1" Y="1.0"/>
        </TextureLayer>
      </Resources>
    `));
    const tl = registry.textureLayers.get("photo-test-id")!;
    expect(tl.offset).toEqual({ x: 0.1, y: 0.2 });
    expect(tl.offsetKey).toEqual({ x: 0.05, y: 0 });
    expect(tl.scaleKey).toEqual({ x: 1.1, y: 1 });
  });

  test("TextureLayer without TextureMappingOption → mapping undefined, no crash", () => {
    const { registry, warnings } = parseResources(wrapResources(`
      <Resources>
        <TextureLayer Name="NONE" Id="none-id" TextureBlending="Normal" Lock="False" FolderPath="">
          <TextureLayerEffects/>
        </TextureLayer>
      </Resources>
    `));
    const tl = registry.textureLayers.get("none-id")!;
    expect(tl).toBeDefined();
    expect(tl.mapping).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test("TextureBlending preserved as string", () => {
    const { registry } = parseResources(wrapResources(`
      <Resources>
        <TextureLayer Name="BG" Id="bg-id" TextureBlending="Multiply" Lock="False" FolderPath="">
          <TextureMappingOption IsEmissive="False" UseMipMapping="False"
            ColorShaping="Shaped" Interlaced="False" PremultiplyColor="0" Reflectivity="0"
            ReleaseVideoOnFillTag="False" TextureAddressModeU="Clamp" TextureAddressModeV="Clamp"
            TextureStretchOption="Fill" Type="2" WrappingMethod="1"/>
        </TextureLayer>
      </Resources>
    `));
    expect(registry.textureLayers.get("bg-id")?.textureBlending).toBe("Multiply");
  });
});

export { wrapResources };
