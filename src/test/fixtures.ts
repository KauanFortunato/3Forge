import { createAnimationKeyframe, createAnimationTrack } from "../editor/animation";
import { createDefaultBlueprint, createNode, ROOT_NODE_ID } from "../editor/state";
import { createTransparentImageAsset } from "../editor/images";
import { createMaterialSpec } from "../editor/materials";
import type { ComponentBlueprint, EditableBinding } from "../editor/types";

export function createBlueprintFixture(): ComponentBlueprint {
  const blueprint = createDefaultBlueprint();
  const panel = blueprint.nodes.find((node) => node.id !== ROOT_NODE_ID && node.type === "box");
  const headline = blueprint.nodes.find((node) => node.type === "text");

  if (panel) {
    panel.editable["transform.position.x"] = createBinding(panel.name, "transform.position.x", "Panel X", "number");
  }

  if (headline) {
    headline.editable["material.opacity"] = createBinding(headline.name, "material.opacity", "Headline Opacity", "number");
  }

  const image = createNode("image", ROOT_NODE_ID);
  image.name = "Hero Image";
  image.geometry.width = 2.4;
  image.geometry.height = 1.4;
  image.image = createTransparentImageAsset();
  image.material = createMaterialSpec("#ffffff", "basic");
  image.editable["material.visible"] = createBinding(image.name, "material.visible", "Image Visible", "boolean");

  blueprint.nodes.push(image);

  const activeClip = blueprint.animation.clips[0] ?? {
    id: "clip-1",
    name: "main",
    fps: 24,
    durationFrames: 120,
    tracks: [],
  };

  if (!blueprint.animation.clips[0]) {
    blueprint.animation.clips.push(activeClip);
    blueprint.animation.activeClipId = activeClip.id;
  }

  if (panel) {
    const track = createAnimationTrack(panel.id, "transform.position.x");
    track.keyframes.push(createAnimationKeyframe(0, panel.transform.position.x));
    track.keyframes.push(createAnimationKeyframe(24, panel.transform.position.x + 0.5));
    activeClip.tracks.push(track);
  }

  return blueprint;
}

function createBinding(nodeName: string, path: string, label: string, type: EditableBinding["type"]): EditableBinding {
  return {
    path,
    key: `${nodeName.toLowerCase().replace(/\s+/g, "")}${label.toLowerCase().replace(/\s+/g, "")}`,
    label,
    type,
  };
}
