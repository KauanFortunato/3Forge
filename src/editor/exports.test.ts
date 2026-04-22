import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createDefaultFontAsset } from "./fonts";
import { exportBlueprintToJson, generateTypeScriptComponent } from "./exports";
import { createAnimationClip, createAnimationKeyframe, createAnimationTrack } from "./animation";
import { createDefaultBlueprint, createNode, ROOT_NODE_ID, toCamelCase } from "./state";
import { createBlueprintFixture } from "../test/fixtures";

describe("exports", () => {
  it("serializes blueprints as stable formatted JSON", () => {
    const blueprint = createBlueprintFixture();
    const json = exportBlueprintToJson(blueprint);

    expect(json).toContain('\n  "componentName":');
    expect(JSON.parse(json)).toEqual(blueprint);
  });

  it("generates a TypeScript component that covers runtime bindings, assets, fonts, and animation", () => {
    const blueprint = createBlueprintFixture();
    blueprint.componentName = "Hero Banner";
    const groupNode = createNode("group", ROOT_NODE_ID, "group-1");
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
      "material.visible": {
        path: "material.visible",
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
    const rootNode = blueprint.nodes.find((node) => node.id === ROOT_NODE_ID);

    expect(rootNode).toBeTruthy();
    if (!rootNode) {
      throw new Error("Expected root node.");
    }

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
});
