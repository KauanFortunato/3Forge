import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createDefaultFontAsset } from "./fonts";
import { exportBlueprintToJson, generateTypeScriptComponent } from "./exports";
import { createAnimationClip, createAnimationKeyframe, createAnimationTrack } from "./animation";
import { createNode, ROOT_NODE_ID } from "./state";
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
});
