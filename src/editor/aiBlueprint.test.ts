import { afterEach, describe, expect, it, vi } from "vitest";
import { AiBlueprintDebugError, createAiBlueprintResult, createAiSceneFromBlueprint, createBlueprintFromAiScene, generateBlueprintResult, isAiSceneSpec, parseAiSceneSpecJson } from "./aiBlueprint";
import { createDefaultBlueprint, EditorStore, ROOT_NODE_ID } from "./state";

describe("aiBlueprint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts an AI primitive scene into a loadable blueprint", () => {
    const blueprint = createBlueprintFromAiScene({
      componentName: "Test Drone",
      objects: [
        {
          type: "box",
          name: "Body",
          color: "#3366ff",
          opacity: 1,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          width: 1.8,
          height: 0.35,
          depth: 0.8,
          radius: null,
          radiusTop: null,
          radiusBottom: null,
          text: null,
          size: null,
        },
        {
          type: "sphere",
          name: "Light",
          color: "#00ffff",
          opacity: 0.8,
          position: { x: 0, y: 0.05, z: 0.45 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          width: null,
          height: null,
          depth: null,
          radius: 0.18,
          radiusTop: null,
          radiusBottom: null,
          text: null,
          size: null,
        },
      ],
    });

    const store = new EditorStore();
    store.loadBlueprint(blueprint);

    expect(blueprint.componentName).toBe("Test Drone");
    expect(blueprint.nodes).toHaveLength(3);
    expect(blueprint.nodes[0].id).toBe(ROOT_NODE_ID);
    expect(store.getSnapshot().nodes.map((node) => node.name)).toContain("Body");
  });

  it("summarizes the current blueprint as an AI-editable scene spec", () => {
    const blueprint = createDefaultBlueprint();
    const scene = createAiSceneFromBlueprint(blueprint);

    expect(scene.componentName).toBe(blueprint.componentName);
    expect(scene.objects.length).toBeGreaterThan(0);
    expect(scene.objects.every((object) => object.type !== "box" || typeof object.width === "number")).toBe(true);
    expect(scene.objects.some((object) => object.name === "Hero Panel")).toBe(true);
  });

  it("keeps AI scene JSON available for chat review and later apply", () => {
    const result = createAiBlueprintResult({
      componentName: "Chat Scene",
      objects: [
        {
          type: "box",
          name: "Panel",
          color: "#7c3aed",
          opacity: 1,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          width: 1,
          height: 1,
          depth: 1,
          radius: null,
          radiusTop: null,
          radiusBottom: null,
          text: null,
          size: null,
        },
      ],
    });

    expect(result.blueprint.componentName).toBe("Chat Scene");
    expect(result.sceneSpecJson).toContain("Chat Scene");
    expect(parseAiSceneSpecJson(result.sceneSpecJson).objects[0].name).toBe("Panel");
    expect(isAiSceneSpec(result.sceneSpec)).toBe(true);
  });

  it("accepts AI scene JSON wrapped in a Markdown code fence", () => {
    const scene = parseAiSceneSpecJson(`\`\`\`json
{
  "componentName": "Fenced Scene",
  "objects": [
    {
      "type": "box",
      "name": "Panel",
      "color": "#7c3aed",
      "opacity": 1,
      "position": { "x": 0, "y": 0, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale": { "x": 1, "y": 1, "z": 1 },
      "width": 1,
      "height": 1,
      "depth": 1,
      "radius": null,
      "radiusTop": null,
      "radiusBottom": null,
      "text": null,
      "size": null
    }
  ]
}
\`\`\``);

    expect(scene.componentName).toBe("Fenced Scene");
    expect(scene.objects[0].name).toBe("Panel");
  });

  it("keeps the executed model returned by chat-completion providers", async () => {
    const sceneSpec = {
      componentName: "OpenRouter Scene",
      objects: [
        {
          type: "box",
          name: "Panel",
          color: "#7c3aed",
          opacity: 1,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          width: 1,
          height: 1,
          depth: 1,
          radius: null,
          radiusTop: null,
          radiusBottom: null,
          text: null,
          size: null,
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "google/gemini-2.5-flash-lite",
        choices: [
          {
            message: {
              content: JSON.stringify(sceneSpec),
            },
          },
        ],
      }),
    } as Response);

    const result = await generateBlueprintResult({
      apiKey: "sk-or-test",
      prompt: "same prompt",
      provider: "openrouter",
      model: "openrouter/free",
    });

    expect(result.executedModel).toBe("google/gemini-2.5-flash-lite");
    expect(result.sceneSpec.componentName).toBe("OpenRouter Scene");
  });

  it("keeps the raw model output when generated JSON is invalid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "openai/gpt-oss-120b:free",
        choices: [
          {
            message: {
              content: "{ invalid json",
            },
          },
        ],
      }),
    } as Response);

    await expect(generateBlueprintResult({
      apiKey: "sk-or-test",
      prompt: "same prompt",
      provider: "openrouter",
      model: "openai/gpt-oss-120b:free",
    })).rejects.toMatchObject({
      name: "AiBlueprintDebugError",
      rawText: "{ invalid json",
      executedModel: "openai/gpt-oss-120b:free",
    } satisfies Partial<AiBlueprintDebugError>);
  });
});
