import { createDefaultAnimation } from "./animation";
import aiBlueprintGuide from "./aiBlueprintGuide.md?raw";
import { createNode, ROOT_NODE_ID } from "./state";
import type { BoxNode, ComponentBlueprint, CylinderNode, EditorNode, PlaneNode, SphereNode, TextNode, TransformSpec } from "./types";

type AiPrimitiveType = "box" | "sphere" | "cylinder" | "plane" | "text";

export interface AiPrimitiveSpec {
  type: AiPrimitiveType;
  name: string;
  color: string;
  opacity: number;
  position: Partial<TransformSpec["position"]>;
  rotation: Partial<TransformSpec["rotation"]>;
  scale: Partial<TransformSpec["scale"]>;
  width?: number | null;
  height?: number | null;
  depth?: number | null;
  radius?: number | null;
  radiusTop?: number | null;
  radiusBottom?: number | null;
  text?: string | null;
  size?: number | null;
}

export interface AiSceneSpec {
  componentName: string;
  objects: AiPrimitiveSpec[];
}

export type AiProvider = "openai" | "openrouter" | "gemini" | "groq";

export interface GenerateBlueprintOptions {
  apiKey: string;
  prompt: string;
  provider?: AiProvider;
  model?: string;
  currentBlueprint?: ComponentBlueprint;
}

export interface AiBlueprintResult {
  blueprint: ComponentBlueprint;
  sceneSpec: AiSceneSpec;
  sceneSpecJson: string;
  rawText: string;
}

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_OBJECTS = 28;

export const AI_PROVIDER_OPTIONS: Array<{ provider: AiProvider; label: string; defaultModel: string; keyLabel: string; keyPlaceholder: string }> = [
  { provider: "openrouter", label: "OpenRouter Free", defaultModel: "openrouter/free", keyLabel: "OpenRouter API key", keyPlaceholder: "sk-or-..." },
  { provider: "gemini", label: "Gemini Free", defaultModel: "gemini-2.5-flash", keyLabel: "Gemini API key", keyPlaceholder: "AIza..." },
  { provider: "groq", label: "Groq Free", defaultModel: "openai/gpt-oss-20b", keyLabel: "Groq API key", keyPlaceholder: "gsk_..." },
  { provider: "openai", label: "OpenAI", defaultModel: "gpt-4.1-mini", keyLabel: "OpenAI API key", keyPlaceholder: "sk-..." },
];

const AI_SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["componentName", "objects"],
  properties: {
    componentName: { type: "string" },
    objects: {
      type: "array",
      minItems: 1,
      maxItems: MAX_OBJECTS,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "name",
          "color",
          "opacity",
          "position",
          "rotation",
          "scale",
          "width",
          "height",
          "depth",
          "radius",
          "radiusTop",
          "radiusBottom",
          "text",
          "size",
        ],
        properties: {
          type: { type: "string", enum: ["box", "sphere", "cylinder", "plane", "text"] },
          name: { type: "string" },
          color: { type: "string" },
          opacity: { type: "number" },
          position: createVec3Schema(),
          rotation: createVec3Schema(),
          scale: createVec3Schema(),
          width: { type: ["number", "null"] },
          height: { type: ["number", "null"] },
          depth: { type: ["number", "null"] },
          radius: { type: ["number", "null"] },
          radiusTop: { type: ["number", "null"] },
          radiusBottom: { type: ["number", "null"] },
          text: { type: ["string", "null"] },
          size: { type: ["number", "null"] },
        },
      },
    },
  },
} as const;

export async function generateBlueprint({ apiKey, prompt, provider = "openrouter", model }: GenerateBlueprintOptions): Promise<ComponentBlueprint> {
  const result = await generateBlueprintResult({ apiKey, prompt, provider, model });
  return result.blueprint;
}

export async function generateBlueprintResult({ apiKey, prompt, provider = "openrouter", model }: GenerateBlueprintOptions): Promise<AiBlueprintResult> {
  const selectedModel = model?.trim() || getDefaultModel(provider);
  const scene = await generateSceneSpec({ apiKey, prompt, provider, model: selectedModel });
  return createAiBlueprintResult(scene);
}

export async function editBlueprintWithAI({ apiKey, prompt, provider = "openrouter", model, currentBlueprint }: GenerateBlueprintOptions): Promise<ComponentBlueprint> {
  const result = await editBlueprintWithAIResult({ apiKey, prompt, provider, model, currentBlueprint });
  return result.blueprint;
}

export async function editBlueprintWithAIResult({ apiKey, prompt, provider = "openrouter", model, currentBlueprint }: GenerateBlueprintOptions): Promise<AiBlueprintResult> {
  if (!currentBlueprint) {
    return generateBlueprintResult({ apiKey, prompt, provider, model });
  }

  const selectedModel = model?.trim() || getDefaultModel(provider);
  const currentScene = createAiSceneFromBlueprint(currentBlueprint);
  const editPrompt = [
    "Edit the current 3Forge scene according to the user request.",
    "Keep existing objects, colors, names, and composition unless the request asks to change them.",
    "Return the full updated scene spec, not a patch.",
    "",
    "Current scene spec:",
    JSON.stringify(currentScene),
    "",
    "User edit request:",
    prompt,
  ].join("\n");
  const scene = await generateSceneSpec({ apiKey, prompt: editPrompt, provider, model: selectedModel });
  return createAiBlueprintResult(scene);
}

export async function generateBlueprintWithOpenAI(options: Omit<GenerateBlueprintOptions, "provider">): Promise<ComponentBlueprint> {
  return generateBlueprint({ ...options, provider: "openai" });
}

async function generateSceneSpec(options: Required<Pick<GenerateBlueprintOptions, "apiKey" | "prompt" | "provider" | "model">>): Promise<AiSceneSpec> {
  if (options.provider === "openai") {
    return generateOpenAiSceneSpec(options);
  }

  if (options.provider === "gemini") {
    return generateGeminiSceneSpec(options);
  }

  return generateChatCompletionsSceneSpec(options);
}

async function generateOpenAiSceneSpec({ apiKey, prompt, model }: Required<Pick<GenerateBlueprintOptions, "apiKey" | "prompt" | "model">>): Promise<AiSceneSpec> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                createSystemPrompt(),
                "Attached guide:",
                aiBlueprintGuide,
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "three_forge_scene",
          strict: true,
          schema: AI_SCENE_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI request failed (${response.status}). ${detail}`);
  }

  const payload = await response.json() as unknown;
  return parseAiSceneSpec(payload);
}

async function generateChatCompletionsSceneSpec({ apiKey, prompt, provider, model }: Required<Pick<GenerateBlueprintOptions, "apiKey" | "prompt" | "provider" | "model">>): Promise<AiSceneSpec> {
  const response = await fetch(provider === "groq" ? GROQ_CHAT_URL : OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(provider === "openrouter" ? {
        "HTTP-Referer": window.location.origin,
        "X-Title": "3Forge",
      } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: createSystemPrompt() },
        { role: "system", content: `Attached 3Forge guide:\n\n${aiBlueprintGuide}` },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "three_forge_scene",
          strict: provider === "groq",
          schema: AI_SCENE_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (provider === "openrouter" && response.status === 404 && model !== "openrouter/free") {
      return generateChatCompletionsSceneSpec({
        apiKey,
        prompt,
        provider,
        model: "openrouter/free",
      });
    }
    throw new Error(`${getProviderLabel(provider)} request failed (${response.status}). ${detail}`);
  }

  const payload = await response.json() as unknown;
  return parseAiSceneSpec(payload);
}

async function generateGeminiSceneSpec({ apiKey, prompt, model }: Required<Pick<GenerateBlueprintOptions, "apiKey" | "prompt" | "model">>): Promise<AiSceneSpec> {
  const response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: `${createSystemPrompt()}\n\nAttached 3Forge guide:\n\n${aiBlueprintGuide}\n\nUser request: ${prompt}` },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: AI_SCENE_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini request failed (${response.status}). ${detail}`);
  }

  const payload = await response.json() as unknown;
  return parseAiSceneSpec(payload);
}

export function createBlueprintFromAiScene(spec: AiSceneSpec): ComponentBlueprint {
  const root = createNode("group", null, ROOT_NODE_ID);
  root.name = "Component Root";

  const nodes: EditorNode[] = [root];
  const objects = spec.objects.slice(0, MAX_OBJECTS);

  for (const object of objects) {
    const node = createNode(object.type, ROOT_NODE_ID);
    node.name = sanitizeName(object.name, node.name);
    node.transform.position = {
      x: clampNumber(object.position.x, -10, 10, 0),
      y: clampNumber(object.position.y, -10, 10, 0),
      z: clampNumber(object.position.z, -10, 10, 0),
    };
    node.transform.rotation = {
      x: clampNumber(object.rotation.x, -Math.PI * 2, Math.PI * 2, 0),
      y: clampNumber(object.rotation.y, -Math.PI * 2, Math.PI * 2, 0),
      z: clampNumber(object.rotation.z, -Math.PI * 2, Math.PI * 2, 0),
    };
    node.transform.scale = {
      x: clampNumber(object.scale.x, 0.05, 20, 1),
      y: clampNumber(object.scale.y, 0.05, 20, 1),
      z: clampNumber(object.scale.z, 0.05, 20, 1),
    };

    node.material.color = normalizeColor(object.color);
    node.material.opacity = clampNumber(object.opacity, 0.05, 1, 1);
    node.material.transparent = node.material.opacity < 1;

    applyGeometry(node, object);
    nodes.push(node);
  }

  return {
    version: 1,
    componentName: sanitizeName(spec.componentName, "AI Generated Model"),
    fonts: [],
    materials: [],
    images: [],
    nodes,
    animation: createDefaultAnimation(),
  };
}

export function createAiBlueprintResult(sceneSpec: AiSceneSpec, rawText = JSON.stringify(sceneSpec, null, 2)): AiBlueprintResult {
  return {
    blueprint: createBlueprintFromAiScene(sceneSpec),
    sceneSpec,
    sceneSpecJson: JSON.stringify(sceneSpec, null, 2),
    rawText,
  };
}

export function createAiSceneFromBlueprint(blueprint: ComponentBlueprint): AiSceneSpec {
  return {
    componentName: blueprint.componentName,
    objects: blueprint.nodes.flatMap((node): AiPrimitiveSpec[] => {
      if (node.type === "group" || node.type === "image" || node.type === "circle") {
        return [];
      }

      const createBase = (type: AiPrimitiveType) => ({
        type,
        name: node.name,
        color: node.material.color,
        opacity: node.material.opacity,
        position: node.transform.position,
        rotation: node.transform.rotation,
        scale: node.transform.scale,
        width: null,
        height: null,
        depth: null,
        radius: null,
        radiusTop: null,
        radiusBottom: null,
        text: null,
        size: null,
      }) satisfies AiPrimitiveSpec;

      switch (node.type) {
        case "box":
          {
            const base = createBase("box");
            return [{ ...base, width: node.geometry.width, height: node.geometry.height, depth: node.geometry.depth }];
          }
        case "sphere":
          {
            const base = createBase("sphere");
            return [{ ...base, radius: node.geometry.radius }];
          }
        case "cylinder":
          {
            const base = createBase("cylinder");
            return [{ ...base, radiusTop: node.geometry.radiusTop, radiusBottom: node.geometry.radiusBottom, height: node.geometry.height }];
          }
        case "plane":
          {
            const base = createBase("plane");
            return [{ ...base, width: node.geometry.width, height: node.geometry.height }];
          }
        case "text":
          {
            const base = createBase("text");
            return [{ ...base, text: node.geometry.text, size: node.geometry.size, depth: node.geometry.depth }];
          }
      }

      return [];
    }).slice(0, MAX_OBJECTS),
  };
}

function parseAiSceneSpec(payload: unknown): AiSceneSpec {
  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error("The model did not return a scene specification.");
  }

  const parsed = JSON.parse(outputText) as Partial<AiSceneSpec>;
  if (!parsed.componentName || !Array.isArray(parsed.objects) || parsed.objects.length === 0) {
    throw new Error("The model returned an incomplete scene specification.");
  }

  return parsed as AiSceneSpec;
}

export function parseAiSceneSpecJson(sceneSpecJson: string): AiSceneSpec {
  const parsed = JSON.parse(sceneSpecJson) as Partial<AiSceneSpec>;
  if (!parsed.componentName || !Array.isArray(parsed.objects) || parsed.objects.length === 0) {
    throw new Error("Invalid AI scene JSON.");
  }
  return parsed as AiSceneSpec;
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string") {
    return direct;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const content = (choice as { message?: { content?: unknown } }).message?.content;
      if (typeof content === "string") {
        return content;
      }
    }
  }

  const candidates = (payload as { candidates?: unknown }).candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const parts = (candidate as { content?: { parts?: unknown } }).content?.parts;
      if (!Array.isArray(parts)) {
        continue;
      }
      for (const part of parts) {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") {
          return text;
        }
      }
    }
  }

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return "";
  }

  for (const item of output) {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const entry of content) {
      const text = (entry as { text?: unknown }).text;
      if (typeof text === "string") {
        return text;
      }
    }
  }

  return "";
}

function createSystemPrompt(): string {
  return [
    "You generate compact 3D scene specifications for 3Forge.",
    "Use only primitive objects: box, sphere, cylinder, plane, and text.",
    "Build recognizable models from multiple simple primitives.",
    "Keep objects centered near the origin and sized for a 6x6x6 viewport.",
    "Use radians for rotations.",
    "Follow the attached Markdown guide as the source of truth for composition, rotations, colors, naming, and JSON shape.",
    "Return only JSON matching the provided schema.",
  ].join(" ");
}

function createVec3Schema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["x", "y", "z"],
    properties: {
      x: { type: "number" },
      y: { type: "number" },
      z: { type: "number" },
    },
  } as const;
}

function getDefaultModel(provider: AiProvider): string {
  return AI_PROVIDER_OPTIONS.find((entry) => entry.provider === provider)?.defaultModel ?? AI_PROVIDER_OPTIONS[0].defaultModel;
}

function getProviderLabel(provider: AiProvider): string {
  return AI_PROVIDER_OPTIONS.find((entry) => entry.provider === provider)?.label ?? provider;
}

function applyGeometry(node: EditorNode, spec: AiPrimitiveSpec): void {
  switch (node.type) {
    case "box":
      (node as BoxNode).geometry.width = clampNumber(spec.width, 0.05, 10, 1);
      (node as BoxNode).geometry.height = clampNumber(spec.height, 0.05, 10, 1);
      (node as BoxNode).geometry.depth = clampNumber(spec.depth, 0.05, 10, 1);
      break;
    case "sphere":
      (node as SphereNode).geometry.radius = clampNumber(spec.radius, 0.05, 5, 0.5);
      break;
    case "cylinder":
      (node as CylinderNode).geometry.radiusTop = clampNumber(spec.radiusTop, 0.01, 5, 0.5);
      (node as CylinderNode).geometry.radiusBottom = clampNumber(spec.radiusBottom, 0.01, 5, 0.5);
      (node as CylinderNode).geometry.height = clampNumber(spec.height, 0.05, 10, 1);
      break;
    case "plane":
      (node as PlaneNode).geometry.width = clampNumber(spec.width, 0.05, 10, 1);
      (node as PlaneNode).geometry.height = clampNumber(spec.height, 0.05, 10, 1);
      break;
    case "text":
      (node as TextNode).geometry.text = (spec.text ?? "").trim() || spec.name || "Text";
      (node as TextNode).geometry.size = clampNumber(spec.size, 0.05, 3, 0.35);
      (node as TextNode).geometry.depth = clampNumber(spec.depth, 0, 1, 0.06);
      break;
    case "group":
    case "image":
      break;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function normalizeColor(value: unknown): string {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())) {
    return value.trim();
  }
  return "#8df0ff";
}

function sanitizeName(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : fallback;
}
