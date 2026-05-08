import type { ModelAsset } from "./types";

export const MAX_MODEL_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_MODEL_FILE_SIZE_LABEL = "25 MB";
export const MODEL_FILE_TOO_LARGE_MESSAGE = `Model is too large. Maximum supported size is ${MAX_MODEL_FILE_SIZE_LABEL}.`;

export function isModelFile(file: File): boolean {
  return /\.(glb|gltf)$/i.test(file.name)
    || file.type === "model/gltf-binary"
    || file.type === "model/gltf+json";
}

export async function modelFileToAsset(file: File): Promise<ModelAsset> {
  if (!isModelFile(file)) {
    throw new Error("Unsupported model file.");
  }

  if (file.size > MAX_MODEL_FILE_SIZE_BYTES) {
    throw new Error(MODEL_FILE_TOO_LARGE_MESSAGE);
  }

  const src = await readFileAsDataUrl(file);
  const format = file.name.toLowerCase().endsWith(".gltf") ? "gltf" : "glb";

  return {
    id: "",
    name: file.name || (format === "gltf" ? "Model.gltf" : "Model.glb"),
    mimeType: file.type || (format === "gltf" ? "model/gltf+json" : "model/gltf-binary"),
    src,
    format,
    originalFileName: file.name || undefined,
    source: "imported",
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read model file."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid model file result."));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });
}
