import { afterEach, describe, expect, it, vi } from "vitest";
import { AiBlueprintDebugError, createAiBlueprintResult, createAiSceneFromBlueprint, createBlueprintFromAiAnimationPatch, createBlueprintFromAiScene, generateBlueprintResult, isAiAnimationPatch, isAiSceneSpec, parseAiBlueprintJson, parseAiSceneSpecJson } from "./aiBlueprint";
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
    expect(scene.objects.every((object) => object.materialType && object.side)).toBe(true);
  });

  it("applies material settings and preserves reusable assets when converting AI edits", () => {
    const baseBlueprint = createDefaultBlueprint();
    baseBlueprint.images.push({
      id: "image-checker",
      name: "Checker",
      mimeType: "image/png",
      src: "data:image/png;base64,test",
      width: 64,
      height: 64,
    });

    const blueprint = createBlueprintFromAiScene({
      componentName: "Material Scene",
      objects: [
        {
          type: "plane",
          name: "Textured Sign",
          color: "#ffffff",
          opacity: 0.85,
          materialType: "physical",
          side: "double",
          mapImageId: "image-checker",
          emissive: "#5ad3ff",
          emissiveIntensity: 1.5,
          roughness: 0.12,
          metalness: 0.2,
          transmission: 0.35,
          thickness: 0.4,
          clearcoat: 0.8,
          clearcoatRoughness: 0.1,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          width: 1.8,
          height: 1,
          depth: null,
          radius: null,
          radiusTop: null,
          radiusBottom: null,
          text: null,
          size: null,
        },
      ],
    }, { baseBlueprint });

    const sign = blueprint.nodes.find((node) => node.name === "Textured Sign");

    expect(blueprint.images.some((image) => image.id === "image-checker")).toBe(true);
    expect(sign?.type).toBe("plane");
    if (!sign || sign.type === "group") {
      throw new Error("Expected converted material node.");
    }
    expect(sign.material.type).toBe("physical");
    expect(sign.material.side).toBe("double");
    expect(sign.material.mapImageId).toBe("image-checker");
    expect(sign.material.emissive).toBe("#5ad3ff");
    expect(sign.material.roughness).toBe(0.12);
    expect(sign.material.transmission).toBe(0.35);
    expect(sign.material.clearcoat).toBe(0.8);
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

  it("maps AI scene animation object names to generated node ids", () => {
    const blueprint = createBlueprintFromAiScene({
      componentName: "Animated Panel",
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
      animation: {
        activeClipId: "clip-main",
        clips: [
          {
            id: "clip-main",
            name: "Main",
            fps: 24,
            durationFrames: 48,
            tracks: [
              {
                id: "track-panel-y",
                objectName: "Panel",
                property: "transform.position.y",
                keyframes: [
                  { id: "key-0", frame: 0, value: 0, ease: "easeInOut" },
                  { id: "key-24", frame: 24, value: 1, ease: "bounceOut" },
                ],
              },
            ],
          },
        ],
      },
    });

    const panel = blueprint.nodes.find((node) => node.name === "Panel");
    expect(blueprint.animation.activeClipId).toBe("clip-main");
    expect(blueprint.animation.clips[0]?.tracks[0]?.nodeId).toBe(panel?.id);
    expect(blueprint.animation.clips[0]?.tracks[0]?.keyframes[1]?.ease).toBe("bounceOut");
  });

  it("applies an animation-only AI patch to an existing blueprint", () => {
    const baseBlueprint = createDefaultBlueprint();
    const target = baseBlueprint.nodes.find((node) => node.name === "Hero Panel");
    const patched = createBlueprintFromAiAnimationPatch({
      animation: {
        activeClipId: "clip-main",
        clips: [
          {
            id: "clip-main",
            name: "Main",
            fps: 24,
            durationFrames: 48,
            tracks: [
              {
                id: "track-panel-y",
                targetName: "Hero Panel",
                property: "transform.position.y",
                keyframes: [
                  { id: "key-0", frame: 0, value: 0, ease: "easeInOut" },
                  { id: "key-24", frame: 24, value: 0.5, ease: "backOut" },
                ],
              },
            ],
          },
        ],
      },
    }, baseBlueprint);

    expect(patched.nodes).toHaveLength(baseBlueprint.nodes.length);
    expect(patched.animation.activeClipId).toBe("clip-main");
    expect(patched.animation.clips[0]?.tracks[0]?.nodeId).toBe(target?.id);
    expect(patched.animation.clips[0]?.tracks[0]?.keyframes[1]?.ease).toBe("backOut");
  });

  it("parses animation-only AI JSON separately from scene specs", () => {
    const parsed = parseAiBlueprintJson(JSON.stringify({
      animation: {
        activeClipId: null,
        clips: [],
      },
    }));

    expect(isAiAnimationPatch(parsed)).toBe(true);
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

  it("enables reasoning for OpenRouter chat-completion providers", async () => {
    const sceneSpec = {
      componentName: "Reasoning Scene",
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
      animation: {
        activeClipId: null,
        clips: [],
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "openai/gpt-oss-120b:free",
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
      prompt: "make a panel",
      provider: "openrouter",
      model: "openai/gpt-oss-120b:free",
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as { reasoning?: { enabled?: boolean }; stream?: boolean };
    expect(body.reasoning).toEqual({ enabled: true });
    expect(body.stream).toBeUndefined();
    expect(result.sceneSpec.componentName).toBe("Reasoning Scene");
  });

  it("sends a single leading system message for chat-completion providers", async () => {
    const sceneSpec = {
      componentName: "Local Scene",
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "local-model",
        choices: [
          {
            message: {
              content: JSON.stringify(sceneSpec),
            },
          },
        ],
      }),
    } as Response);

    await generateBlueprintResult({
      apiKey: "local",
      prompt: "make a panel",
      provider: "openrouter",
      model: "local-model",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(body.messages[0].content).toContain("Attached 3Forge guide:");
  });

  it("uses a custom local chat-completions URL without OpenRouter headers", async () => {
    const sceneSpec = {
      componentName: "Local Scene",
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "qwen-local",
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
      apiKey: "",
      prompt: "make a panel",
      provider: "local",
      model: "qwen-local",
      localUrl: "http://127.0.0.1:8001/v1/chat/completions",
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8001/v1/chat/completions");
    expect(headers.Authorization).toBeUndefined();
    expect(headers["HTTP-Referer"]).toBeUndefined();
    expect(headers["X-Title"]).toBeUndefined();
    expect(result.executedModel).toBe("qwen-local");
  });

  it("includes compact chat context in chat-completion prompts", async () => {
    const sceneSpec = {
      componentName: "Context Scene",
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "openrouter/free",
        choices: [
          {
            message: {
              content: JSON.stringify(sceneSpec),
            },
          },
        ],
      }),
    } as Response);

    await generateBlueprintResult({
      apiKey: "sk-or-test",
      prompt: "make that warmer",
      provider: "openrouter",
      model: "openrouter/free",
      chatContext: {
        lastSceneSpecJson: "{\"componentName\":\"Previous Scene\",\"objects\":[]}",
        diffSummaries: ["added 1, changed 2, removed 0; changed: Shade (color)"],
      },
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[1].content).toContain("Recent diff summaries:");
    expect(body.messages[1].content).toContain("added 1, changed 2, removed 0");
    expect(body.messages[1].content).toContain("Last generated JSON:");
    expect(body.messages[1].content).toContain("Previous Scene");
    expect(body.messages[1].content).toContain("Current user request:\nmake that warmer");
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
