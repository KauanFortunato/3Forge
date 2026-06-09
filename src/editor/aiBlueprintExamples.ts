import type { AiPrimitiveSpec, AiSceneSpec } from "./aiBlueprint";

/**
 * Curated, hand-verified few-shot examples for the 3Forge scene generator.
 *
 * The attached Markdown guide teaches the rules; these examples teach the
 * *shape and quality* of correct output. They are injected into the prompt
 * (the most relevant ones, see {@link buildExamplesBlock}) so weaker free
 * models can mirror a known-good composition instead of guessing.
 *
 * Every example is checked to: be centered near the origin, keep connected
 * parts touching, fill every schema-required field, and (when animated) use
 * only supported animated properties with valid, sorted keyframes.
 */

export type AiExampleMode = "create" | "animate-existing";

export interface AiBlueprintExample {
  id: string;
  title: string;
  /** Lowercase tokens matched against the user prompt for relevance. */
  keywords: string[];
  mode: AiExampleMode;
  userPrompt: string;
  /** A full scene spec, or a Mode B animation-only patch. */
  output: AiSceneSpec | { animation: unknown };
}

/**
 * Fills every schema-required primitive field so example specs stay short and
 * readable in source while still serializing to a complete object. Unused
 * fields become `null`, exactly like real model output must.
 */
function prim(
  spec: Partial<AiPrimitiveSpec> & Pick<AiPrimitiveSpec, "type" | "name">,
): AiPrimitiveSpec {
  return {
    type: spec.type,
    name: spec.name,
    color: spec.color ?? "#cccccc",
    opacity: spec.opacity ?? 1,
    materialType: spec.materialType ?? "standard",
    side: spec.side ?? null,
    mapImageId: spec.mapImageId ?? null,
    emissive: spec.emissive ?? null,
    emissiveIntensity: spec.emissiveIntensity ?? null,
    roughness: spec.roughness ?? null,
    metalness: spec.metalness ?? null,
    transmission: spec.transmission ?? null,
    thickness: spec.thickness ?? null,
    clearcoat: spec.clearcoat ?? null,
    clearcoatRoughness: spec.clearcoatRoughness ?? null,
    position: { x: 0, y: 0, z: 0, ...spec.position },
    rotation: { x: 0, y: 0, z: 0, ...spec.rotation },
    scale: { x: 1, y: 1, z: 1, ...spec.scale },
    origin: spec.origin ?? null,
    width: spec.width ?? null,
    height: spec.height ?? null,
    depth: spec.depth ?? null,
    radius: spec.radius ?? null,
    radiusTop: spec.radiusTop ?? null,
    radiusBottom: spec.radiusBottom ?? null,
    tube: spec.tube ?? null,
    arc: spec.arc ?? null,
    text: spec.text ?? null,
    size: spec.size ?? null,
  };
}

const noAnimation = { activeClipId: null, clips: [] };

export const AI_BLUEPRINT_EXAMPLES: AiBlueprintExample[] = [
  {
    id: "monitor",
    title: "Desktop monitor (clean composition, emissive screen)",
    keywords: ["monitor", "screen", "display", "tv", "computer", "pc", "desktop"],
    mode: "create",
    userPrompt: "a desktop computer monitor",
    output: {
      componentName: "Desktop Monitor",
      objects: [
        prim({ type: "box", name: "Screen Body", color: "#1c1f26", roughness: 0.6, metalness: 0.1, width: 2.2, height: 1.3, depth: 0.12, position: { y: 0.45 } }),
        prim({ type: "plane", name: "Screen Glow", color: "#0a1622", materialType: "standard", side: "double", emissive: "#fafafa", emissiveIntensity: 1.4, roughness: 0.4, metalness: 0.1, width: 2.0, height: 1.1, position: { y: 0.45, z: 0.07 } }),
        prim({ type: "box", name: "Stand Neck", color: "#2a2e36", roughness: 0.5, metalness: 0.3, width: 0.16, height: 0.5, depth: 0.16, position: { y: -0.45 } }),
        prim({ type: "box", name: "Stand Base", color: "#2a2e36", roughness: 0.5, metalness: 0.3, width: 0.9, height: 0.08, depth: 0.5, position: { y: -0.74 } }),
        prim({ type: "sphere", name: "Power Light", color: "#ff0000", emissive: "#ff0000", emissiveIntensity: 2.5, radius: 0.02, position: { x: 0.96, y: -0.15, z: 0.08 } }),
      ],
      animation: noAnimation,
    },
  },
  {
    id: "robot",
    title: "Articulated robot (posed arms, torus-ring hands, tapered feet)",
    keywords: ["robot", "android", "bot", "character", "mech", "droid", "humanoid"],
    mode: "create",
    userPrompt: "a friendly little robot",
    output: {
      componentName: "Friendly Robot",
      objects: [
        prim({ type: "box", name: "Body", color: "#3a7bd5", roughness: 0.45, metalness: 0.2, width: 1.1, height: 1.3, depth: 0.7, position: { y: 0.1 } }),
        prim({ type: "box", name: "Head", color: "#4f8ff0", roughness: 0.45, metalness: 0.2, width: 0.8, height: 0.7, depth: 0.7, position: { y: 1.1 } }),
        prim({ type: "sphere", name: "Right Eye", color: "#ffffff", emissive: "#5ad3ff", emissiveIntensity: 2, radius: 0.1, position: { x: -0.2, y: 1.12, z: 0.4 } }),
        prim({ type: "sphere", name: "Left Eye", color: "#ffffff", emissive: "#5ad3ff", emissiveIntensity: 2, radius: 0.1, position: { x: 0.2, y: 1.12, z: 0.4 } }),
        prim({ type: "cylinder", name: "Right Arm", color: "#2c5fa8", roughness: 0.5, metalness: 0.3, radiusTop: 0.12, radiusBottom: 0.12, height: 0.9, position: { x: -0.871, y: 0.613 }, rotation: { z: -2.077 } }),
        prim({ type: "torus", name: "Right Hand", color: "#3a7bd5", side: "double", roughness: 0.4, metalness: 0.1, radius: 0.2, tube: 0.04, arc: 3.2, scale: { z: 3.7 }, position: { x: -1.34, y: 0.889, z: -0.015 }, rotation: { x: -0.03, y: -0.068, z: -1.994 } }),
        prim({ type: "cylinder", name: "Left Arm", color: "#2c5fa8", roughness: 0.5, metalness: 0.3, radiusTop: 0.12, radiusBottom: 0.12, height: 0.9, position: { x: 0.783, y: 0.186 }, rotation: { z: 0.704 } }),
        prim({ type: "torus", name: "Left Hand", color: "#3a7bd5", side: "double", roughness: 0.4, metalness: 0.1, radius: 0.2, tube: 0.04, arc: 3.2, scale: { z: 3.7 }, position: { x: 1.113, y: -0.204, z: 0.004 }, rotation: { x: 0.069, y: -0.026, z: 0.628 } }),
        prim({ type: "cylinder", name: "Left Leg", color: "#2c5fa8", roughness: 0.5, metalness: 0.3, radiusTop: 0.15, radiusBottom: 0.15, height: 0.7, position: { x: 0.3, y: -0.85 } }),
        prim({ type: "cylinder", name: "Left Foot", color: "#3a7bd5", roughness: 0.5, metalness: 0.3, radiusTop: 0.15, radiusBottom: 0.3, height: 0.2, position: { x: 0.3, y: -1.3 } }),
        prim({ type: "cylinder", name: "Right Leg", color: "#2c5fa8", roughness: 0.5, metalness: 0.3, radiusTop: 0.15, radiusBottom: 0.15, height: 0.7, position: { x: -0.3, y: -0.85 } }),
        prim({ type: "cylinder", name: "Right Foot", color: "#3a7bd5", roughness: 0.5, metalness: 0.3, radiusTop: 0.15, radiusBottom: 0.3, height: 0.2, position: { x: -0.3, y: -1.3 } }),
        prim({ type: "sphere", name: "Chest Light", color: "#ffd166", emissive: "#ffd166", emissiveIntensity: 2.5, radius: 0.12, position: { y: 0.2, z: 0.4 } }),
        prim({ type: "cylinder", name: "Antenna", color: "#cccccc", roughness: 0.4, metalness: 0.6, radiusTop: 0.03, radiusBottom: 0.03, height: 0.3, position: { y: 1.55 } }),
        prim({ type: "sphere", name: "Antenna Tip", color: "#ff5d73", emissive: "#ff5d73", emissiveIntensity: 2.5, radius: 0.07, position: { y: 1.72 } }),
      ],
      animation: noAnimation,
    },
  },
  {
    id: "car",
    title: "Simple car (wheels as rotated cylinders, headlights)",
    keywords: ["car", "vehicle", "truck", "automobile", "auto", "racecar"],
    mode: "create",
    userPrompt: "a simple toy car",
    output: {
      componentName: "Toy Car",
      objects: [
        prim({ type: "box", name: "Chassis", color: "#e63946", roughness: 0.35, metalness: 0.2, clearcoat: 0, width: 2.2, height: 0.4, depth: 1.0, position: { y: 0.05 } }),
        prim({ type: "box", name: "Cabin", color: "#f1a0a8", roughness: 0.3, metalness: 0.2, width: 1.2, height: 0.45, depth: 0.9, position: { y: 0.45 } }),
        prim({ type: "cylinder", name: "Wheel Front Left", color: "#1b1b1f", roughness: 0.8, metalness: 0, radiusTop: 0.28, radiusBottom: 0.28, height: 0.2, rotation: { y: 1.5708, z: 1.5708 }, position: { x: -0.7, y: -0.2, z: 0.46 } }),
        prim({ type: "cylinder", name: "Wheel Front Right", color: "#1b1b1f", roughness: 0.8, metalness: 0, radiusTop: 0.28, radiusBottom: 0.28, height: 0.2, rotation: { y: 1.5708, z: 1.5708 }, position: { x: -0.7, y: -0.2, z: -0.46 } }),
        prim({ type: "cylinder", name: "Wheel Rear Left", color: "#1b1b1f", roughness: 0.8, metalness: 0, radiusTop: 0.28, radiusBottom: 0.28, height: 0.2, rotation: { y: 1.5708, z: 1.5708 }, position: { x: 0.7, y: -0.2, z: 0.46 } }),
        prim({ type: "cylinder", name: "Wheel Rear Right", color: "#1b1b1f", roughness: 0.8, metalness: 0, radiusTop: 0.28, radiusBottom: 0.28, height: 0.2, rotation: { y: 1.5708, z: 1.5708 }, position: { x: 0.7, y: -0.2, z: -0.46 } }),
        prim({ type: "sphere", name: "Headlight Left", color: "#fff6cc", emissive: "#fff2b0", emissiveIntensity: 2, radius: 0.1, position: { x: -1.1, y: 0.05, z: 0.3 } }),
        prim({ type: "sphere", name: "Headlight Right", color: "#fff6cc", emissive: "#fff2b0", emissiveIntensity: 2, radius: 0.1, position: { x: -1.1, y: 0.05, z: -0.3 } }),
      ],
      animation: noAnimation,
    },
  },
  {
    id: "table",
    title: "Furniture (table top resting exactly on four legs)",
    keywords: ["table", "desk", "chair", "furniture", "stool", "bench"],
    mode: "create",
    userPrompt: "a wooden table",
    output: {
      componentName: "Wooden Table",
      objects: [
        prim({ type: "box", name: "Table Top", color: "#9c6b3f", roughness: 0.7, metalness: 0, width: 2.0, height: 0.12, depth: 1.2, position: { y: 0.5 } }),
        prim({ type: "cylinder", name: "Leg Front Left", color: "#7a5230", roughness: 0.75, metalness: 0, radiusTop: 0.08, radiusBottom: 0.08, height: 0.9, position: { x: -0.85, y: 0.0, z: 0.5 } }),
        prim({ type: "cylinder", name: "Leg Front Right", color: "#7a5230", roughness: 0.75, metalness: 0, radiusTop: 0.08, radiusBottom: 0.08, height: 0.9, position: { x: 0.85, y: 0.0, z: 0.5 } }),
        prim({ type: "cylinder", name: "Leg Back Left", color: "#7a5230", roughness: 0.75, metalness: 0, radiusTop: 0.08, radiusBottom: 0.08, height: 0.9, position: { x: -0.85, y: 0.0, z: -0.5 } }),
        prim({ type: "cylinder", name: "Leg Back Right", color: "#7a5230", roughness: 0.75, metalness: 0, radiusTop: 0.08, radiusBottom: 0.08, height: 0.9, position: { x: 0.85, y: 0.0, z: -0.5 } }),
      ],
      animation: noAnimation,
    },
  },
  {
    id: "neon-sign",
    title: "Neon sign (dark board, bright emissive text)",
    keywords: ["neon", "sign", "glow", "led", "lamp", "light", "billboard"],
    mode: "create",
    userPrompt: "a neon OPEN sign",
    output: {
      componentName: "Neon Open Sign",
      objects: [
        prim({ type: "box", name: "Sign Board", color: "#15161c", roughness: 0.8, metalness: 0.1, width: 2.4, height: 1.2, depth: 0.15, position: { y: 0 } }),
        prim({ type: "box", name: "Frame", color: "#2a2c36", roughness: 0.6, metalness: 0.4, width: 2.6, height: 1.4, depth: 0.1, position: { y: 0, z: -0.04 } }),
        prim({ type: "text", name: "Neon Text", color: "#ff3df0", materialType: "standard", emissive: "#ff3df0", emissiveIntensity: 5, roughness: 0.3, metalness: 0.1, text: "OPEN", size: 0.5, depth: 0.08, position: { x: 0, y: 0, z: 0.12 } }),
      ],
      animation: noAnimation,
    },
  },
  {
    id: "glass-display",
    title: "Glass material (physical transmission on a pedestal)",
    keywords: ["glass", "crystal", "transparent", "gem", "diamond", "bottle", "orb"],
    mode: "create",
    userPrompt: "a glass orb on a stand",
    output: {
      componentName: "Glass Orb",
      objects: [
        prim({ type: "cylinder", name: "Pedestal", color: "#2a2e36", roughness: 0.5, metalness: 0.4, radiusTop: 0.5, radiusBottom: 0.6, height: 0.3, position: { y: -0.7 } }),
        prim({ type: "sphere", name: "Glass Orb", color: "#cfeaff", materialType: "physical", side: "double", opacity: 0.45, transmission: 0.85, thickness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.08, roughness: 0.05, metalness: 0, radius: 0.6, position: { y: 0.05 } }),
        prim({ type: "sphere", name: "Inner Core", color: "#7c44de", emissive: "#7c44de", emissiveIntensity: 2, radius: 0.16, position: { y: 0.05 } }),
      ],
      animation: noAnimation,
    },
  },
  {
    id: "propeller",
    title: "Animated spin (two blades in a cross, each rotating around its own center)",
    keywords: ["propeller", "fan", "spin", "spinner", "rotor", "turbine", "blade", "loading"],
    mode: "create",
    userPrompt: "a spinning propeller",
    output: {
      componentName: "Spinning Propeller",
      objects: [
        prim({ type: "cylinder", name: "Mount", color: "#cd7f32", roughness: 0.4, metalness: 0.6, radiusTop: 0.12, radiusBottom: 0.16, height: 0.2, position: { z: -0.292 }, rotation: { x: 1.5708 } }),
        prim({ type: "sphere", name: "Hub", color: "#cd7f32", roughness: 0.4, metalness: 0.6, radius: 0.18, position: { z: -0.452 } }),
        prim({ type: "box", name: "Blade_1", color: "#cd7f32", roughness: 0.4, metalness: 0.6, width: 1.9, height: 0.22, depth: 0.02, position: { z: -0.467 }, rotation: { z: 1.5708 } }),
        prim({ type: "box", name: "Blade_2", color: "#cd7f32", roughness: 0.4, metalness: 0.6, width: 1.9, height: 0.22, depth: 0.02, position: { z: -0.467 } }),
      ],
      animation: {
        activeClipId: "clip-spin",
        clips: [
          {
            id: "clip-spin",
            name: "Spin",
            fps: 24,
            durationFrames: 50,
            tracks: [
              {
                id: "track-blade2-rotation-z",
                objectName: "Blade_2",
                property: "transform.rotation.z",
                keyframes: [
                  { id: "key-blade2-rz-0", frame: 0, value: 0, ease: "linear" },
                  { id: "key-blade2-rz-50", frame: 50, value: 6.2832, ease: "linear" },
                ],
              },
              {
                id: "track-blade1-rotation-z",
                objectName: "Blade_1",
                property: "transform.rotation.z",
                keyframes: [
                  { id: "key-blade1-rz-0", frame: 0, value: 1.5708, ease: "linear" },
                  { id: "key-blade1-rz-50", frame: 50, value: 7.8540, ease: "linear" },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: "bouncing-ball",
    title: "Animated jump (position.y + squash/stretch anchored to the floor via origin)",
    keywords: ["jump", "bounce", "hop", "ball", "bouncing", "squash", "boing"],
    mode: "create",
    userPrompt: "a bouncing ball",
    output: {
      componentName: "Bouncing Ball",
      objects: [
        prim({ type: "sphere", name: "Ball", color: "#ff5d73", roughness: 0.4, metalness: 0, radius: 0.5, origin: { x: "center", y: "bottom", z: "center" }, position: { y: -1 } }),
        prim({ type: "cylinder", name: "Floor", color: "#2a2e36", roughness: 0.9, metalness: 0, radiusTop: 1.2, radiusBottom: 1.2, height: 0.08, position: { y: 0 } }),
      ],
      animation: {
        activeClipId: "clip-bounce",
        clips: [
          {
            id: "clip-bounce",
            name: "Bounce",
            fps: 24,
            durationFrames: 72,
            tracks: [
              {
                id: "track-ball-position-y",
                objectName: "Ball",
                property: "transform.position.y",
                keyframes: [
                  { id: "key-ball-y-0", frame: 0, value: 0, ease: "easeInOut" },
                  { id: "key-ball-y-18", frame: 18, value: 1.6, ease: "easeInOut" },
                  { id: "key-ball-y-38", frame: 38, value: 0, ease: "easeInOut" },
                  { id: "key-ball-y-54", frame: 54, value: 1.6, ease: "easeInOut" },
                  { id: "key-ball-y-72", frame: 72, value: 0, ease: "easeInOut" },
                ],
              },
              {
                id: "track-ball-scale-y",
                objectName: "Ball",
                property: "transform.scale.y",
                keyframes: [
                  { id: "key-ball-sy-0", frame: 0, value: 1, ease: "easeInOut" },
                  { id: "key-ball-sy-6", frame: 6, value: 1.1, ease: "easeInOut" },
                  { id: "key-ball-sy-14", frame: 14, value: 1, ease: "easeInOut" },
                  { id: "key-ball-sy-28", frame: 28, value: 1.172, ease: "easeInOut" },
                  { id: "key-ball-sy-38", frame: 38, value: 0.85, ease: "easeInOut" },
                  { id: "key-ball-sy-42", frame: 42, value: 1.1, ease: "easeInOut" },
                  { id: "key-ball-sy-50", frame: 50, value: 1, ease: "easeInOut" },
                  { id: "key-ball-sy-63", frame: 63, value: 1.172, ease: "easeInOut" },
                  { id: "key-ball-sy-72", frame: 72, value: 1, ease: "easeInOut" },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: "existing-jump-patch",
    title: "Existing blueprint animation patch (Mode B, nodeId targets only)",
    keywords: ["existing", "current", "selected", "this", "same", "patch"],
    mode: "animate-existing",
    userPrompt: "make the selected character do a smooth jump",
    output: {
      animation: {
        activeClipId: "clip-smooth-jump",
        clips: [
          {
            id: "clip-smooth-jump",
            name: "Smooth Jump",
            fps: 24,
            durationFrames: 96,
            tracks: [
              {
                id: "track-root-position-y",
                nodeId: "<id-from-node-map>",
                property: "transform.position.y",
                keyframes: [
                  { id: "key-root-y-0", frame: 0, value: 0, ease: "easeInOut" },
                  { id: "key-root-y-12", frame: 12, value: -0.12, ease: "easeOut" },
                  { id: "key-root-y-42", frame: 42, value: 0.55, ease: "easeOut" },
                  { id: "key-root-y-60", frame: 60, value: 0, ease: "easeIn" },
                  { id: "key-root-y-96", frame: 96, value: 0, ease: "easeInOut" },
                ],
              },
            ],
          },
        ],
      },
    },
  },
];

const EXISTING_INTENT = [
  "same scene", "current blueprint", "existing blueprint", "current scene",
  "selected", "animate this", "this model", "this component", "keep this",
  "mesmo", "atual", "existente", "selecion", "esse", "este",
];

const ANIMATION_INTENT = [
  "anim", "rotat", "spin", "jump", "bounc", "hop", "move", "moving", "loop",
  "blink", "flicker", "gir", "pul", "mov", "balan",
];

function includesAny(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

/**
 * Picks the most relevant examples for a prompt. Existing-blueprint patches
 * only surface when the request reads like an edit to an existing scene; for
 * fresh creation requests they are excluded so the model is not nudged toward
 * the wrong output mode.
 */
export function selectRelevantExamples(
  userPrompt: string,
  options: { count?: number; preferExistingBlueprint?: boolean } = {},
): AiBlueprintExample[] {
  const count = Math.max(1, options.count ?? 2);
  const text = userPrompt.toLowerCase();
  const wantsExisting = options.preferExistingBlueprint || includesAny(text, EXISTING_INTENT);
  const wantsAnimation = includesAny(text, ANIMATION_INTENT);

  const scored = AI_BLUEPRINT_EXAMPLES
    .filter((example) => (example.mode === "animate-existing" ? wantsExisting : true))
    .map((example, index) => {
      let score = example.keywords.reduce((total, keyword) => (text.includes(keyword) ? total + 2 : total), 0);
      if (wantsAnimation && (example.mode === "animate-existing" || hasAnimation(example))) {
        score += 1;
      }
      // Stable, slight preference toward the original ordering on ties.
      return { example, score, index };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const selected: AiBlueprintExample[] = [];

  if (wantsExisting) {
    const patch = AI_BLUEPRINT_EXAMPLES.find((example) => example.mode === "animate-existing");
    if (patch) {
      selected.push(patch);
    }
  }

  for (const { example } of scored) {
    if (selected.length >= count) {
      break;
    }
    if (!selected.includes(example)) {
      selected.push(example);
    }
  }

  if (selected.every((example) => scoreless(example, text) && !wantsExisting)) {
    return fallbackExamples(count, wantsAnimation);
  }

  return selected.slice(0, count);
}

function hasAnimation(example: AiBlueprintExample): boolean {
  const animation = (example.output as { animation?: { clips?: unknown[] } }).animation;
  return Array.isArray(animation?.clips) && animation.clips.length > 0;
}

function scoreless(example: AiBlueprintExample, text: string): boolean {
  return example.keywords.every((keyword) => !text.includes(keyword));
}

function fallbackExamples(count: number, wantsAnimation: boolean): AiBlueprintExample[] {
  const ids = wantsAnimation ? ["propeller", "monitor"] : ["monitor", "robot"];
  const picked = ids
    .map((id) => AI_BLUEPRINT_EXAMPLES.find((example) => example.id === id))
    .filter((example): example is AiBlueprintExample => Boolean(example));
  return picked.slice(0, count);
}

/**
 * Builds the prompt fragment that carries the selected examples. Returns an
 * empty string when no example is relevant, so callers can append it blindly.
 */
export function buildExamplesBlock(
  userPrompt: string,
  options: { count?: number; preferExistingBlueprint?: boolean } = {},
): string {
  const examples = selectRelevantExamples(userPrompt, options);
  if (examples.length === 0) {
    return "";
  }

  const blocks = examples.map((example) => {
    const header = example.mode === "animate-existing"
      ? `Example (${example.title}) — nodeId values shown are placeholders; use real ids from the node map`
      : `Example (${example.title})`;
    return [
      header,
      `User request: ${example.userPrompt}`,
      "Correct JSON output:",
      JSON.stringify(example.output),
    ].join("\n");
  });

  return [
    "Reference examples below are verified, correct 3Forge outputs. Study their JSON shape, centering, connected parts, color contrast, and animation structure.",
    "Do not copy them literally or reuse their names; adapt the technique to the user request and obey the attached guide and schema.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}
