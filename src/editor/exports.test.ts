import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createDefaultFontAsset } from "./fonts";
import { exportBlueprintToJson, generateTypeScriptComponent } from "./exports";
import { createAnimationClip, createAnimationKeyframe, createAnimationTrack } from "./animation";
import {
  createDefaultBlueprint,
  createDefaultSceneSettings,
  createNode,
  EditorStore,
  getPropertyDefinitions,
  ROOT_NODE_ID,
  toCamelCase,
} from "./state";
import { createBlueprintFixture } from "../test/fixtures";

describe("exports", () => {
  it("serializes blueprints as stable formatted JSON", () => {
    const blueprint = createBlueprintFixture();
    const json = exportBlueprintToJson(blueprint);

    expect(json).toContain('\n  "componentName":');
    expect(JSON.parse(json)).toEqual(blueprint);
  });

  it("generates TypeScript that loads external GLB model assets", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Model Export";
    blueprint.models = [{
      id: "model-ship",
      name: "Ship.glb",
      mimeType: "model/gltf-binary",
      src: "data:model/gltf-binary;base64,c2hpcA==",
      format: "glb",
    }];
    blueprint.nodes.push({
      id: "ship-node",
      name: "Hero Ship",
      type: "model",
      parentId: null,
      visible: true,
      transform: {
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0.1, y: 0.2, z: 0.3 },
        scale: { x: 2, y: 2, z: 2 },
      },
      origin: { x: "center", y: "center", z: "center" },
      editable: {},
      modelId: "model-ship",
    } as never);

    const output = generateTypeScriptComponent(blueprint, {
      modelAssetPathsById: {
        "model-ship": "./assets/models/ship.glb",
      },
    });
    const transpiled = ts.transpileModule(output, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
      reportDiagnostics: true,
    });

    expect(output).toContain('import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";');
    expect(output).toContain('const heroShipModelData = "./assets/models/ship.glb" as const;');
    expect(output).toContain("const gltfLoader = new GLTFLoader();");
    expect(output).toContain("gltfLoader.loadAsync(heroShipModelData)");
    expect(output).toContain("const heroShip = heroShipGltf.scene.clone(true) as Group;");
    expect(output).toContain("heroShip.position.set(1, 2, 3);");
    expect(output).toContain("heroShip.scale.set(2, 2, 2);");
    expect(transpiled.diagnostics ?? []).toEqual([]);
  });

  it("generates TypeScript that loads external USDZ model assets via USDLoader", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Usdz Export";
    blueprint.models = [{
      id: "model-rocket",
      name: "Rocket.usdz",
      mimeType: "model/vnd.usdz+zip",
      src: "data:model/vnd.usdz+zip;base64,cm9ja2V0",
      format: "usdz",
    }];
    blueprint.nodes.push({
      id: "rocket-node",
      name: "Hero Rocket",
      type: "model",
      parentId: null,
      visible: true,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      origin: { x: "center", y: "center", z: "center" },
      editable: {},
      modelId: "model-rocket",
    } as never);

    const output = generateTypeScriptComponent(blueprint, {
      modelAssetPathsById: {
        "model-rocket": "./assets/models/rocket.usdz",
      },
    });

    expect(output).toContain('import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";');
    expect(output).toContain("const usdLoader = new USDLoader();");
    expect(output).toContain("usdLoader.loadAsync(");
    expect(output).toContain(".clone(true) as Group");
    expect(output).not.toContain(".scene.clone(true)");
    expect(output).not.toContain("gltfLoader.loadAsync");
    expect(output).not.toContain("GLTFLoader");
  });

  it("generates TypeScript that loads both GLB and USDZ assets, each with its matching loader", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Mixed Export";
    blueprint.models = [
      {
        id: "model-ship",
        name: "Ship.glb",
        mimeType: "model/gltf-binary",
        src: "data:model/gltf-binary;base64,c2hpcA==",
        format: "glb",
      },
      {
        id: "model-rocket",
        name: "Rocket.usdz",
        mimeType: "model/vnd.usdz+zip",
        src: "data:model/vnd.usdz+zip;base64,cm9ja2V0",
        format: "usdz",
      },
    ];
    blueprint.nodes.push({
      id: "ship-node",
      name: "Hero Ship",
      type: "model",
      parentId: null,
      visible: true,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      origin: { x: "center", y: "center", z: "center" },
      editable: {},
      modelId: "model-ship",
    } as never);
    blueprint.nodes.push({
      id: "rocket-node",
      name: "Hero Rocket",
      type: "model",
      parentId: null,
      visible: true,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      origin: { x: "center", y: "center", z: "center" },
      editable: {},
      modelId: "model-rocket",
    } as never);

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toContain('import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";');
    expect(output).toContain('import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";');
    expect(output).toContain("const gltfLoader = new GLTFLoader();");
    expect(output).toContain("const usdLoader = new USDLoader();");
    expect(output).toContain("gltfLoader.loadAsync(");
    expect(output).toContain("usdLoader.loadAsync(");
    expect(output).toContain("const heroShip = heroShipGltf.scene.clone(true) as Group;");
    expect(output).toContain("const heroRocket = heroRocketGltf.clone(true) as Group;");
  });

  it("generates a TypeScript component that covers runtime bindings, assets, fonts, and animation", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Hero Banner";
    const groupNode = createNode("group", null, "group-1");
    groupNode.name = "Panel Group";
    groupNode.pivotOffset = { x: -1.5, y: 0.75, z: 2 };
    blueprint.nodes.push(groupNode);

    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    const textNode = blueprint.nodes.find((node) => node.type === "text");
    const imageNode = blueprint.nodes.find((node) => node.type === "image");

    expect(panel).toBeTruthy();
    expect(textNode).toBeTruthy();
    expect(imageNode).toBeTruthy();

    panel!.editable = {
      "transform.position.x": {
        path: "transform.position.x",
        key: "panelOffsetX",
        label: "Panel Offset X",
        type: "number",
      },
    };
    textNode!.editable = {
      "material.opacity": {
        path: "material.opacity",
        key: "headlineOpacity",
        label: "Headline Opacity",
        type: "number",
      },
    };
    textNode!.fontId = createDefaultFontAsset().id;
    imageNode!.editable = {
      visible: {
        path: "visible",
        key: "heroImageVisible",
        label: "Hero Image Visible",
        type: "boolean",
      },
    };

    const output = generateTypeScriptComponent(blueprint);
    const transpiled = ts.transpileModule(output, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
      reportDiagnostics: true,
    });

    expect(output).toContain('export interface HeroBannerOptions');
    expect(output).toContain("panelOffsetX?: number;");
    expect(output).toContain("headlineOpacity?: number;");
    expect(output).toContain("heroImageVisible?: boolean;");
    expect(output).toContain('import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";');
    expect(output).toContain('import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";');
    expect(output).toContain("const textureLoader = new TextureLoader();");
    expect(output).toContain("interface AnimationPlaybackResult");
    expect(output).toContain("public createTimeline");
    expect(output).toContain("public async playClip");
    expect(output).toContain("public async restart");
    expect(output).toContain("public async reverse");
    expect(output).toContain("public async pause");
    expect(output).toContain("public async stop");
    expect(output).toContain("public async seek");
    expect(output).toContain("public getClipNames()");
    expect(output).toContain("nodeRefs = new Map");
    expect(output).toContain("timelineCache = new Map");
    expect(output).toContain("pendingPlayback");
    expect(output).toContain("const animationClipDefinitions");
    expect(output).toContain("private beginPlayback");
    expect(output).toContain("new MeshBasicMaterial");
    expect(output).toContain("new TextGeometry");
    expect(output).toContain("const panelGroup = new Group();");
    expect(output).toContain("const panelGroupContent = new Group();");
    expect(output).toContain("panelGroupContent.position.set(-1.5, 0.75, 2);");
    expect(output).not.toContain("buildTimelineForClip");
    expect(output).not.toContain("repeat: -1");
    expect(transpiled.diagnostics ?? []).toEqual([]);
  });

  it("serializes animation metadata once for multi-clip exports", () => {
    const blueprint = createBlueprintFixture();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");

    expect(panel).toBeTruthy();

    const secondaryClip = createAnimationClip("secondary", {
      fps: 30,
      durationFrames: 90,
      tracks: [],
    });

    const secondaryTrack = createAnimationTrack(panel!.id, "transform.rotation.z");
    secondaryTrack.keyframes.push(createAnimationKeyframe(0, 0));
    secondaryTrack.keyframes.push(createAnimationKeyframe(45, 0.5, "easeOut"));
    secondaryTrack.keyframes.push(createAnimationKeyframe(90, -0.25, "easeInOut"));
    secondaryClip.tracks.push(secondaryTrack);
    blueprint.animation.clips.push(secondaryClip);

    const output = generateTypeScriptComponent(blueprint);
    const animationDefinitionsCount = output.match(/const animationClipDefinitions/g)?.length ?? 0;
    const timelineCacheCount = output.match(/timelineCache = new Map/g)?.length ?? 0;

    expect(animationDefinitionsCount).toBe(1);
    expect(timelineCacheCount).toBe(1);
    expect(output).toContain('"secondary": {');
    expect(output).toContain('durationFrames: 90');
    expect(output).toContain('ease: "power2.out"');
    expect(output).toContain('ease: "power2.inOut"');
  });

  it("preserves frame 0 as the first exported animation keyframe", () => {
    const blueprint = createBlueprintFixture();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    expect(panel).toBeTruthy();
    if (!panel) {
      throw new Error("Expected panel node.");
    }

    const clip = createAnimationClip("frame-zero", {
      fps: 24,
      durationFrames: 48,
      tracks: [],
    });
    const track = createAnimationTrack(panel.id, "transform.position.x");
    track.keyframes.push(createAnimationKeyframe(0, 2, "linear"));
    track.keyframes.push(createAnimationKeyframe(24, 4, "easeOut"));
    clip.tracks.push(track);
    blueprint.animation = {
      activeClipId: clip.id,
      clips: [clip],
    };

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toContain("firstKeyframeAt: 0");
    expect(output).toContain("timeline.set(owner, { [track.key]: track.initialValue }, track.firstKeyframeAt);");
    expect(output).toContain("at: 0");
  });

  it("emits discrete visible animation tracks against wrapper node visibility", () => {
    const blueprint = createBlueprintFixture();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");

    expect(panel).toBeTruthy();

    const clip = createAnimationClip("visible", {
      fps: 24,
      durationFrames: 24,
      tracks: [],
    });
    const visibleTrack = createAnimationTrack(panel!.id, "visible");
    panel!.visible = false;
    visibleTrack.keyframes.push(createAnimationKeyframe(12, 1, "linear"));
    visibleTrack.keyframes.push(createAnimationKeyframe(24, 0, "easeOut"));
    clip.tracks.push(visibleTrack);
    blueprint.animation.clips.push(clip);

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toContain("function resolveAnimatedVisibility(value: number): boolean");
    expect(output).toContain("function getAnimatedVisibilityMesh(node: Group | Mesh): Mesh | null");
    expect(output).toContain('if (track.target === "visible") {');
    expect(output).toContain("firstKeyframeAt: 0.5");
    expect(output).toContain("timeline.set(node, { visible: resolveAnimatedVisibility(track.initialValue) }, track.firstKeyframeAt);");
    expect(output).toContain("const mesh = getAnimatedVisibilityMesh(node);");
    expect(output).toContain("timeline.set(mesh, { visible: resolveAnimatedVisibility(track.initialValue) }, track.firstKeyframeAt);");
    expect(output).toContain("timeline.set(node, { visible: resolveAnimatedVisibility(segment.value) }, segment.at + segment.duration);");
    expect(output).toContain("timeline.set(mesh, { visible: resolveAnimatedVisibility(segment.value) }, segment.at + segment.duration);");
    expect(output).toContain(`${toCamelCase(panel!.name)}.visible = false;`);
    expect(output).toContain('target: "visible"');
    expect(output).toContain('key: "value"');
  });

  it("uses editable root visibility bindings in exported options and runtime assignment", () => {
    const blueprint = createBlueprintFixture();
    const rootNode = createNode("group", null, ROOT_NODE_ID);
    rootNode.name = "Component Root";
    for (const node of blueprint.nodes) {
      if (node.parentId === null) {
        node.parentId = ROOT_NODE_ID;
      }
    }
    blueprint.nodes.unshift(rootNode);

    expect(rootNode).toBeTruthy();

    rootNode.visible = false;
    rootNode.editable = {
      ...rootNode.editable,
      visible: {
        path: "visible",
        key: "rootVisible",
        label: "Root Visible",
        type: "boolean",
      },
    };

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toContain("rootVisible?: boolean;");
    expect(output).toContain("rootVisible: false,");
    expect(output).toContain("root.visible = this.options.rootVisible;");
  });

  it("emits true literals for default castShadow and receiveShadow on mesh nodes", () => {
    const blueprint = createDefaultBlueprint();
    const output = generateTypeScriptComponent(blueprint);

    expect(output).toMatch(/Mesh\.castShadow = true;/);
    expect(output).toMatch(/Mesh\.receiveShadow = true;/);
    expect(output).not.toMatch(/Mesh\.castShadow = false;/);
    expect(output).not.toMatch(/Mesh\.receiveShadow = false;/);
  });

  it("emits false literals for castShadow when material overrides it", () => {
    const blueprint = createDefaultBlueprint();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    expect(panel).toBeTruthy();
    if (!panel || panel.type === "group") {
      throw new Error("Expected box node.");
    }
    panel.material.castShadow = false;

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toContain("Mesh.castShadow = false;");
    expect(output).toContain("Mesh.receiveShadow = true;");
  });

  it("emits castShadow/receiveShadow true for default image nodes (no longer hardcoded false)", () => {
    const blueprint = createBlueprintFixture();
    const imageNode = blueprint.nodes.find((node) => node.type === "image");
    expect(imageNode).toBeTruthy();
    if (!imageNode || imageNode.type !== "image") {
      throw new Error("Expected image node.");
    }
    // MaterialSpec default is true/true; lock in NEW behavior (was hardcoded false before)
    expect(imageNode.material.castShadow).toBe(true);
    expect(imageNode.material.receiveShadow).toBe(true);

    const output = generateTypeScriptComponent(blueprint);

    // At least one mesh (the image) should cast & receive shadows
    expect(output).toMatch(/heroImageMesh\.castShadow = true;/);
    expect(output).toMatch(/heroImageMesh\.receiveShadow = true;/);
  });

  it("uses editable material.castShadow and material.receiveShadow bindings in exported options and runtime assignment", () => {
    const blueprint = createBlueprintFixture();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");

    expect(panel).toBeTruthy();
    if (!panel || panel.type === "group") {
      throw new Error("Expected box node.");
    }

    panel.editable = {
      ...panel.editable,
      "material.castShadow": {
        path: "material.castShadow",
        key: "castsShadow",
        label: "Casts Shadow",
        type: "boolean",
      },
      "material.receiveShadow": {
        path: "material.receiveShadow",
        key: "receivesShadow",
        label: "Receives Shadow",
        type: "boolean",
      },
    };

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toContain("castsShadow?: boolean;");
    expect(output).toContain("receivesShadow?: boolean;");
    expect(output).toMatch(/\.castShadow = this\.options\.castsShadow;/);
    expect(output).toMatch(/\.receiveShadow = this\.options\.receivesShadow;/);
  });

  it("excludes muted tracks from generated animation definitions", () => {
    const blueprint = createBlueprintFixture();
    const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
    expect(panel).toBeTruthy();
    if (!panel) {
      throw new Error("Expected panel node.");
    }

    const clip = blueprint.animation.clips[0];
    expect(clip).toBeTruthy();

    const mutedTrack = createAnimationTrack(panel.id, "transform.rotation.z");
    mutedTrack.keyframes.push(createAnimationKeyframe(0, 0, "linear"));
    mutedTrack.keyframes.push(createAnimationKeyframe(24, 7.77, "linear"));
    mutedTrack.muted = true;
    clip.tracks.push(mutedTrack);

    const output = generateTypeScriptComponent(blueprint);

    // Muted keyframe value must not appear anywhere in the timeline construction code.
    expect(output).not.toContain("7.77");
    // Muted-track property axis (rotation.z) should not appear as a target in the definitions.
    const rotationTargetCount = (output.match(/target: "rotation"/g) ?? []).length;
    expect(rotationTargetCount).toBe(0);
  });

  it("emits MeshPhysicalMaterial with physical-only options when a node uses type=physical", () => {
    const blueprint = createBlueprintFixture();
    const box = blueprint.nodes.find((node) => node.type === "box");
    expect(box).toBeTruthy();
    if (box) {
      box.material.type = "physical";
      box.material.side = "back";
      box.material.transmission = 0.6;
      box.material.ior = 1.45;
      box.material.clearcoat = 0.4;
      box.material.reflectivity = 0.7;
      box.material.iridescence = 0.25;
      box.material.iridescenceIOR = 1.8;
      box.material.iridescenceThicknessRangeStart = 120;
      box.material.iridescenceThicknessRangeEnd = 360;
      box.material.sheen = 0.35;
      box.material.sheenRoughness = 0.45;
      box.material.sheenColor = "#223344";
      box.material.specularIntensity = 0.55;
      box.material.specularColor = "#abcdef";
      box.material.attenuationDistance = 12;
      box.material.attenuationColor = "#fedcba";
      box.material.dispersion = 0.1;
      box.material.anisotropy = 0.3;
    }

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toMatch(/^import \{[^}]*BackSide[^}]*MeshPhysicalMaterial[^}]*type Side[^}]*\} from "three";/m);
    expect(output).toContain("function resolveMaterialSide(side: string): Side");
    expect(output).toContain("new MeshPhysicalMaterial");
    expect(output).toContain('side: resolveMaterialSide("back")');
    expect(output).toContain("transmission: 0.6");
    expect(output).toContain("ior: 1.45");
    expect(output).toContain("clearcoat: 0.4");
    expect(output).toContain("reflectivity: 0.7");
    expect(output).toContain("iridescence: 0.25");
    expect(output).toContain("iridescenceIOR: 1.8");
    expect(output).toContain("iridescenceThicknessRange: [120, 360]");
    expect(output).toContain("sheen: 0.35");
    expect(output).toContain("sheenRoughness: 0.45");
    expect(output).toContain('sheenColor: "#223344"');
    expect(output).toContain("specularIntensity: 0.55");
    expect(output).toContain('specularColor: "#abcdef"');
    expect(output).toContain("attenuationDistance: 12");
    expect(output).toContain('attenuationColor: "#fedcba"');
    expect(output).toContain("dispersion: 0.1");
    expect(output).toContain("anisotropy: 0.3");
  });

  it("emits editable material.side bindings through a side resolver", () => {
    const blueprint = createBlueprintFixture();
    const box = blueprint.nodes.find((node) => node.type === "box");
    expect(box).toBeTruthy();
    if (!box) {
      throw new Error("Expected box node.");
    }

    box.material.side = "double";
    box.editable["material.side"] = {
      path: "material.side",
      key: "panelSide",
      label: "Panel Side",
      type: "string",
    };

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toContain("panelSide?: string;");
    expect(output).toContain('panelSide: "double",');
    expect(output).toContain("side: resolveMaterialSide(this.options.panelSide)");
    expect(output).toMatch(/^import \{[^}]*BackSide[^}]*DoubleSide[^}]*FrontSide[^}]*type Side[^}]*\} from "three";/m);
  });

  it("emits material texture maps from reusable image assets", () => {
    const blueprint = createBlueprintFixture();
    blueprint.images.push({
      id: "image-grid",
      name: "Grid Texture",
      mimeType: "image/png",
      src: "data:image/png;base64,texture",
      width: 16,
      height: 16,
    });
    const box = blueprint.nodes.find((node) => node.type === "box");
    expect(box).toBeTruthy();
    if (!box) {
      throw new Error("Expected mesh node.");
    }
    box.material.mapImageId = "image-grid";

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toMatch(/^import \{[^}]*SRGBColorSpace[^}]*TextureLoader[^}]*\} from "three";/m);
    expect(output).toContain('const gridTextureImageData = "data:image/png;base64,texture" as const;');
    expect(output).toContain("textureLoader.loadAsync(gridTextureImageData)");
    expect(output).toContain("map: gridTextureTexture");
  });

  it("emits MeshToonMaterial with the emissive option when a node uses type=toon", () => {
    const blueprint = createBlueprintFixture();
    const box = blueprint.nodes.find((node) => node.type === "box");
    expect(box).toBeTruthy();
    if (box) {
      box.material.type = "toon";
      box.material.emissive = "#112233";
    }

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toMatch(/^import \{[^}]*MeshToonMaterial[^}]*\} from "three";/m);
    expect(output).toContain("new MeshToonMaterial");
    expect(output).toContain('emissive: "#112233"');
    expect(output).not.toContain("transmission:");
  });

  it("emits MeshLambertMaterial when a node uses type=lambert", () => {
    const blueprint = createBlueprintFixture();
    const box = blueprint.nodes.find((node) => node.type === "box");
    if (box) {
      box.material.type = "lambert";
    }
    const output = generateTypeScriptComponent(blueprint);
    expect(output).toMatch(/^import \{[^}]*MeshLambertMaterial[^}]*\} from "three";/m);
    expect(output).toContain("new MeshLambertMaterial");
    expect(output).not.toContain("specular:");
  });

  it("emits MeshPhongMaterial with specular and shininess when a node uses type=phong", () => {
    const blueprint = createBlueprintFixture();
    const box = blueprint.nodes.find((node) => node.type === "box");
    if (box) {
      box.material.type = "phong";
      box.material.specular = "#ff8800";
      box.material.shininess = 65;
    }
    const output = generateTypeScriptComponent(blueprint);
    expect(output).toMatch(/^import \{[^}]*MeshPhongMaterial[^}]*\} from "three";/m);
    expect(output).toContain("new MeshPhongMaterial");
    expect(output).toContain('specular: "#ff8800"');
    expect(output).toContain("shininess: 65");
  });

  it("emits MeshNormalMaterial when a node uses type=normal", () => {
    const blueprint = createBlueprintFixture();
    const box = blueprint.nodes.find((node) => node.type === "box");
    if (box) {
      box.material.type = "normal";
    }
    const output = generateTypeScriptComponent(blueprint);
    expect(output).toMatch(/^import \{[^}]*MeshNormalMaterial[^}]*\} from "three";/m);
    expect(output).toContain("new MeshNormalMaterial");
  });

  it("emits MeshDepthMaterial when a node uses type=depth", () => {
    const blueprint = createBlueprintFixture();
    const box = blueprint.nodes.find((node) => node.type === "box");
    if (box) {
      box.material.type = "depth";
      box.material.depthPacking = "rgba";
    }
    const output = generateTypeScriptComponent(blueprint);
    expect(output).toMatch(/^import \{[^}]*BasicDepthPacking[^}]*MeshDepthMaterial[^}]*RGBADepthPacking[^}]*\} from "three";/m);
    expect(output).toContain("new MeshDepthMaterial");
    expect(output).toContain("function resolveDepthPacking(depthPacking: string)");
    expect(output).toContain('depthPacking: resolveDepthPacking("rgba")');
  });
});

describe("export after property clipboard", () => {
  function updateProperty(
    store: EditorStore,
    nodeId: string,
    path: string,
    value: string | number | boolean,
  ): void {
    const node = store.getNode(nodeId);
    if (!node) {
      throw new Error(`node ${nodeId} not found`);
    }
    const definition = getPropertyDefinitions(node).find((def) => def.path === path);
    if (!definition) {
      throw new Error(`definition for "${path}" not found on ${nodeId}`);
    }
    store.updateNodeProperty(nodeId, definition, value);
  }

  function updateMultiple(
    store: EditorStore,
    nodeIds: string[],
    path: string,
    value: string | number | boolean,
  ): void {
    const node = store.getNode(nodeIds[0]);
    if (!node) {
      throw new Error(`node ${nodeIds[0]} not found`);
    }
    const definition = getPropertyDefinitions(node).find((def) => def.path === path);
    if (!definition) {
      throw new Error(`definition for "${path}" not found on ${nodeIds[0]}`);
    }
    store.updateNodesProperty(nodeIds, definition, value);
  }

  function meshNameFor(store: EditorStore, nodeId: string): string {
    const node = store.getNode(nodeId);
    if (!node) {
      throw new Error(`node ${nodeId} not found`);
    }
    return `${toCamelCase(node.name)}Mesh`;
  }

  it("paste 'material' from standard source onto basic target emits MeshStandardMaterial with copied PBR values and castShadow=false", () => {
    const store = new EditorStore(createDefaultBlueprint());

    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    store.updateNodeName(boxAId, "Source Box");
    const boxA = store.getNode(boxAId);
    if (!boxA || boxA.type !== "box") throw new Error("expected box A");
    boxA.material.type = "standard";
    boxA.material.emissive = "#abcdef";
    boxA.material.roughness = 0.85;
    boxA.material.metalness = 0.65;
    boxA.material.castShadow = false;

    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    store.updateNodeName(boxBId, "Target Box");
    const boxB = store.getNode(boxBId);
    if (!boxB || boxB.type !== "box") throw new Error("expected box B");
    boxB.material.type = "basic";
    boxB.material.emissive = "#000000";
    boxB.material.roughness = 0.4;
    boxB.material.metalness = 0.1;
    boxB.material.castShadow = true;

    store.selectNode(boxAId);
    const clipboard = store.capturePropertiesFromSelection();
    expect(clipboard).not.toBeNull();

    store.selectNode(boxBId);
    // Scope "material" carries PBR + common material fields; "shadow" is a
    // sibling scope, so we apply it separately to mirror a real "Paste Special
    // -> Material" followed by "Paste Special -> Shadow Flags" user flow.
    const materialReport = store.applyPropertiesToSelection("material");
    expect(materialReport.applied).toBeGreaterThan(0);
    const shadowReport = store.applyPropertiesToSelection("shadow");
    expect(shadowReport.applied).toBeGreaterThan(0);

    const boxBAfter = store.getNode(boxBId);
    if (!boxBAfter || boxBAfter.type !== "box") throw new Error("expected box B after");
    expect(boxBAfter.material.type).toBe("standard");
    expect(boxBAfter.material.emissive).toBe("#abcdef");
    expect(boxBAfter.material.roughness).toBeCloseTo(0.85, 5);
    expect(boxBAfter.material.metalness).toBeCloseTo(0.65, 5);
    expect(boxBAfter.material.castShadow).toBe(false);

    const output = generateTypeScriptComponent(store.blueprint);
    const meshB = meshNameFor(store, boxBId);

    // B must now emit MeshStandardMaterial (the paste promoted the material type).
    const bMaterialBlockRegex = new RegExp(
      `const ${meshB.replace("Mesh", "Material")} = new (MeshStandardMaterial|MeshBasicMaterial)\\(\\{ ([^}]+) \\}\\);`,
    );
    const match = output.match(bMaterialBlockRegex);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("MeshStandardMaterial");
    expect(match![2]).toContain(`emissive: "#abcdef"`);
    expect(match![2]).toContain(`roughness: 0.85`);
    expect(match![2]).toContain(`metalness: 0.65`);

    // castShadow = false must be emitted as a literal on B.
    expect(output).toContain(`${meshB}.castShadow = false;`);

    // Imports must include MeshStandardMaterial now that B is standard.
    expect(output).toMatch(/^import \{[^}]*MeshStandardMaterial[^}]*\} from "three";/m);

    // Round-trip JSON: export -> parse -> re-import -> re-export must match.
    const json1 = exportBlueprintToJson(store.blueprint);
    const reimported = new EditorStore(JSON.parse(json1));
    const json2 = exportBlueprintToJson(reimported.blueprint);
    expect(json2).toBe(json1);
  });

  it("multi-edit material.color via updateNodesProperty lands on all three boxes in the export", () => {
    const store = new EditorStore(createDefaultBlueprint());

    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    const boxCId = store.insertNode("box", ROOT_NODE_ID);
    store.updateNodeName(boxAId, "Multi A");
    store.updateNodeName(boxBId, "Multi B");
    store.updateNodeName(boxCId, "Multi C");

    // Baseline: all three share the createNode default box color "#4bd6ff".
    for (const id of [boxAId, boxBId, boxCId]) {
      const n = store.getNode(id);
      if (!n || n.type === "group") throw new Error("expected non-group");
      expect(n.material.color).toBe("#4bd6ff");
    }

    updateMultiple(store, [boxAId, boxBId, boxCId], "material.color", "#112233");

    for (const id of [boxAId, boxBId, boxCId]) {
      const n = store.getNode(id);
      if (!n || n.type === "group") throw new Error("expected non-group");
      expect(n.material.color).toBe("#112233");
    }

    const output = generateTypeScriptComponent(store.blueprint);
    const matches = output.match(/color: "#112233"/g) ?? [];
    // One match per box material block. The default blueprint itself has a
    // "Hero Panel" box whose color is #7c44de, so it must NOT show #112233.
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(output).toContain("#7c44de");
  });

  it("multi-edit castShadow=false on two targets persists through JSON round-trip and emits false literals", () => {
    const store = new EditorStore(createDefaultBlueprint());

    const boxAId = store.insertNode("box", ROOT_NODE_ID);
    const boxBId = store.insertNode("box", ROOT_NODE_ID);
    store.updateNodeName(boxAId, "Shadow A");
    store.updateNodeName(boxBId, "Shadow B");

    updateMultiple(store, [boxAId, boxBId], "material.castShadow", false);

    const boxAAfter = store.getNode(boxAId);
    const boxBAfter = store.getNode(boxBId);
    if (
      !boxAAfter || !boxBAfter ||
      boxAAfter.type === "group" || boxBAfter.type === "group"
    ) {
      throw new Error("expected both non-group");
    }
    expect(boxAAfter.material.castShadow).toBe(false);
    expect(boxBAfter.material.castShadow).toBe(false);

    const output = generateTypeScriptComponent(store.blueprint);
    const meshA = meshNameFor(store, boxAId);
    const meshB = meshNameFor(store, boxBId);
    expect(output).toContain(`${meshA}.castShadow = false;`);
    expect(output).toContain(`${meshB}.castShadow = false;`);

    // JSON round-trip must preserve castShadow=false on both.
    const json = exportBlueprintToJson(store.blueprint);
    const reimported = new EditorStore(JSON.parse(json));
    const rA = reimported.getNode(boxAId);
    const rB = reimported.getNode(boxBId);
    if (!rA || !rB || rA.type === "group" || rB.type === "group") {
      throw new Error("expected both non-group on reimport");
    }
    expect(rA.material.castShadow).toBe(false);
    expect(rB.material.castShadow).toBe(false);

    // Re-exporting must still emit false literals — not hardcoded true.
    const reoutput = generateTypeScriptComponent(reimported.blueprint);
    const rMeshA = meshNameFor(reimported, boxAId);
    const rMeshB = meshNameFor(reimported, boxBId);
    expect(reoutput).toContain(`${rMeshA}.castShadow = false;`);
    expect(reoutput).toContain(`${rMeshB}.castShadow = false;`);
  });

  it("paste 'material' onto a node with an editable material.color binding preserves the binding and emits this.options.<key>", () => {
    const store = new EditorStore(createDefaultBlueprint());

    const boundBoxId = store.insertNode("box", ROOT_NODE_ID);
    store.updateNodeName(boundBoxId, "Bound Box");
    const boundBox = store.getNode(boundBoxId);
    if (!boundBox || boundBox.type !== "box") throw new Error("expected bound box");
    boundBox.material.color = "#aa00aa";
    boundBox.editable["material.color"] = {
      path: "material.color",
      key: "panelColor",
      label: "Panel Color",
      type: "color",
    };

    const sourceBoxId = store.insertNode("box", ROOT_NODE_ID);
    store.updateNodeName(sourceBoxId, "Source Box 2");
    updateProperty(store, sourceBoxId, "material.color", "#00ff00");

    store.selectNode(sourceBoxId);
    store.capturePropertiesFromSelection();

    store.selectNode(boundBoxId);
    store.applyPropertiesToSelection("material");

    // Binding must still exist with the same key/label/type — paste only
    // writes the underlying value, never the editable map.
    const boundAfter = store.getNode(boundBoxId);
    if (!boundAfter || boundAfter.type !== "box") throw new Error("expected bound box after");
    const binding = boundAfter.editable["material.color"];
    expect(binding).toBeTruthy();
    expect(binding.key).toBe("panelColor");
    expect(binding.label).toBe("Panel Color");
    expect(binding.type).toBe("color");

    // The underlying material color was updated...
    expect(boundAfter.material.color).toBe("#00ff00");

    // ...but the TS export must reference the binding, NOT the literal.
    const output = generateTypeScriptComponent(store.blueprint);
    const meshBound = meshNameFor(store, boundBoxId);
    const boundMaterialLineRegex = new RegExp(
      `const ${meshBound.replace("Mesh", "Material")}(?:StandardConfig|BasicConfig)?[^\\n]*color: this\\.options\\.panelColor`,
    );
    // The material line for the bound box should read color via this.options.panelColor.
    expect(output).toMatch(boundMaterialLineRegex);

    // And the options interface must expose the binding key.
    expect(output).toContain("panelColor?: ColorRepresentation;");

    // The bound box must NOT inline the pasted literal color on its own material line.
    // We scan only the bound box's material block to avoid false positives from
    // the source box (whose color is legitimately #00ff00 as a literal).
    const boundBlockStart = output.indexOf(`const ${meshBound.replace("Mesh", "Material")}`);
    expect(boundBlockStart).toBeGreaterThan(-1);
    const boundBlockEnd = output.indexOf(");", boundBlockStart);
    const boundBlock = output.slice(boundBlockStart, boundBlockEnd);
    expect(boundBlock).not.toContain(`color: "#00ff00"`);
    expect(boundBlock).toContain("color: this.options.panelColor");
  });

  it("paste geometry.width via plane->image alias emits the copied width on the image's PlaneGeometry", () => {
    const store = new EditorStore(createDefaultBlueprint());

    const planeId = store.insertNode("plane", ROOT_NODE_ID);
    store.updateNodeName(planeId, "Source Plane");
    updateProperty(store, planeId, "geometry.width", 3.75);

    const imageId = store.insertNode("image", ROOT_NODE_ID);
    store.updateNodeName(imageId, "Target Image");
    // Force a distinct starting width so the test distinguishes pre/post paste.
    updateProperty(store, imageId, "geometry.width", 1.25);

    const imageBefore = store.getNode(imageId);
    if (!imageBefore || imageBefore.type !== "image") throw new Error("expected image before");
    expect(imageBefore.geometry.width).toBeCloseTo(1.25, 5);

    store.selectNode(planeId);
    store.capturePropertiesFromSelection();

    store.selectNode(imageId);
    const report = store.applyPropertiesToSelection("geometry");
    expect(report.applied).toBeGreaterThan(0);

    const imageAfter = store.getNode(imageId);
    if (!imageAfter || imageAfter.type !== "image") throw new Error("expected image after");
    expect(imageAfter.geometry.width).toBeCloseTo(3.75, 5);

    const output = generateTypeScriptComponent(store.blueprint);
    const imageMesh = meshNameFor(store, imageId);
    const imageGeomVar = imageMesh.replace("Mesh", "Geometry");
    // The image uses PlaneGeometry(width, height); width must now be 3.75.
    const geomLineRegex = new RegExp(
      `const ${imageGeomVar} = new PlaneGeometry\\(3\\.75, `,
    );
    expect(output).toMatch(geomLineRegex);
  });

  it("exports advanced sphere and cylinder segment geometry", () => {
    const store = new EditorStore(createDefaultBlueprint());

    const sphereId = store.insertNode("sphere", ROOT_NODE_ID);
    store.updateNodeName(sphereId, "Segmented Sphere");
    updateProperty(store, sphereId, "geometry.widthSegments", 12);
    updateProperty(store, sphereId, "geometry.heightSegments", 6);
    updateProperty(store, sphereId, "geometry.phiStart", 0.5);
    updateProperty(store, sphereId, "geometry.phiLength", 2.5);
    updateProperty(store, sphereId, "geometry.thetaStart", 0.25);
    updateProperty(store, sphereId, "geometry.thetaLength", 1.5);

    const cylinderId = store.insertNode("cylinder", ROOT_NODE_ID);
    store.updateNodeName(cylinderId, "Segmented Cylinder");
    updateProperty(store, cylinderId, "geometry.radialSegments", 9);
    updateProperty(store, cylinderId, "geometry.heightSegments", 4);
    updateProperty(store, cylinderId, "geometry.thetaStart", 0.75);
    updateProperty(store, cylinderId, "geometry.thetaLength", 3.25);

    const output = generateTypeScriptComponent(store.blueprint);

    expect(output).toContain("new SphereGeometry(0.7, Math.max(3, Math.round(12)), Math.max(2, Math.round(6)), 0.5, 2.5, 0.25, 1.5);");
    expect(output).toContain("new CylinderGeometry(0.5, 0.5, 1.4, Math.max(3, Math.round(9)), Math.max(1, Math.round(4)), false, 0.75, 3.25);");

    const reimported = new EditorStore(JSON.parse(exportBlueprintToJson(store.blueprint)));
    const sphere = reimported.getNode(sphereId);
    const cylinder = reimported.getNode(cylinderId);

    if (!sphere || sphere.type !== "sphere") throw new Error("expected reimported sphere");
    if (!cylinder || cylinder.type !== "cylinder") throw new Error("expected reimported cylinder");

    expect(sphere.geometry.widthSegments).toBe(12);
    expect(sphere.geometry.thetaLength).toBe(1.5);
    expect(cylinder.geometry.radialSegments).toBe(9);
    expect(cylinder.geometry.thetaLength).toBe(3.25);
  });

  it("exports core Three.js geometry node types", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const types = [
      "cone",
      "capsule",
      "ring",
      "torus",
      "torusKnot",
      "dodecahedron",
      "icosahedron",
      "octahedron",
      "tetrahedron",
    ] as const;

    for (const type of types) {
      store.insertNode(type, ROOT_NODE_ID);
    }

    const output = generateTypeScriptComponent(store.blueprint);

    expect(output).toContain("ConeGeometry");
    expect(output).toContain("CapsuleGeometry");
    expect(output).toContain("RingGeometry");
    expect(output).toContain("TorusGeometry");
    expect(output).toContain("TorusKnotGeometry");
    expect(output).toContain("DodecahedronGeometry");
    expect(output).toContain("IcosahedronGeometry");
    expect(output).toContain("OctahedronGeometry");
    expect(output).toContain("TetrahedronGeometry");
    expect(output).toContain("new ConeGeometry(");
    expect(output).toContain("new CapsuleGeometry(");
    expect(output).toContain("new RingGeometry(");
    expect(output).toContain("new TorusGeometry(");
    expect(output).toContain("new TorusKnotGeometry(");
    expect(output).toContain("new DodecahedronGeometry(");
    expect(output).toContain("new IcosahedronGeometry(");
    expect(output).toContain("new OctahedronGeometry(");
    expect(output).toContain("new TetrahedronGeometry(");
  });

  it("exports scene settings metadata for runtime consumers", () => {
    const blueprint = createDefaultBlueprint();
    blueprint.sceneSettings = {
      ...createDefaultSceneSettings(),
      backgroundColor: "#101820",
      toneMapping: { type: "linear", exposure: 1.4 },
      shadows: { enabled: false, type: "pcf" },
    };

    const output = generateTypeScriptComponent(blueprint);

    expect(output).toContain("export const sceneSettings = ");
    expect(output).toContain('"backgroundColor": "#101820"');
    expect(output).toContain('"type": "linear"');
    expect(output).toContain('"enabled": false');
  });

  it("exports packaged HDR environment path in scene settings metadata", () => {
    const blueprint = createDefaultBlueprint();
    blueprint.hdrs = [{
      id: "studio",
      name: "Studio.hdr",
      mimeType: "image/vnd.radiance",
      src: "data:image/vnd.radiance;base64,aGRy",
    }];
    blueprint.sceneSettings = {
      ...createDefaultSceneSettings(),
      environment: {
        type: "hdr",
        hdrAssetId: "studio",
        intensity: 1.6,
      },
    };

    const output = generateTypeScriptComponent(blueprint, {
      hdrAssetPathsById: {
        studio: "./assets/environments/studio.hdr",
      },
    });

    expect(output).toContain('"type": "hdr"');
    expect(output).toContain('"hdrAssetId": "studio"');
    expect(output).toContain('"hdrAssetPath": "./assets/environments/studio.hdr"');
  });
});
