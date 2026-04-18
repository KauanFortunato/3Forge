import { exportBlueprintToJson } from "./exports";
import type { ComponentBlueprint } from "./types";

export type FilePermissionStatus = PermissionState | "unsupported";
export type SaveProjectResult =
  | { status: "saved"; handle: BrowserFileSystemFileHandle }
  | { status: "cancelled" }
  | { status: "permission-denied" }
  | { status: "unsupported" }
  | { status: "failed"; error: unknown };

export interface BrowserFileWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserFileSystemFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserFileWritable>;
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
}

interface BrowserWindowLike {
  showOpenFilePicker?: (options?: unknown) => Promise<BrowserFileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<BrowserFileSystemFileHandle>;
}

export function supportsFileSystemAccess(windowObject: BrowserWindowLike = window as unknown as BrowserWindowLike): boolean {
  return typeof windowObject.showOpenFilePicker === "function" && typeof windowObject.showSaveFilePicker === "function";
}

export async function openBlueprintWithPicker(windowObject: BrowserWindowLike = window as unknown as BrowserWindowLike): Promise<{
  handle: BrowserFileSystemFileHandle;
  blueprint: unknown;
  fileName: string;
} | null> {
  if (!supportsFileSystemAccess(windowObject)) {
    return null;
  }

  let handles: BrowserFileSystemFileHandle[] | undefined;
  try {
    handles = await windowObject.showOpenFilePicker?.({
      multiple: false,
      excludeAcceptAllOption: false,
      types: [{
        description: "3Forge Blueprint",
        accept: {
          "application/json": [".json"],
        },
      }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }

    throw error;
  }

  const handle = handles?.[0];
  if (!handle) {
    return null;
  }

  const file = await handle.getFile();
  return {
    handle,
    blueprint: await readBlueprintFromFile(file),
    fileName: file.name,
  };
}

export async function readBlueprintFromFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

export function getBlueprintFileName(componentName: string): string {
  const trimmedName = componentName.trim();
  return `${trimmedName.length > 0 ? trimmedName : "3forge-component"}.json`;
}

export async function queryFilePermission(
  handle: BrowserFileSystemFileHandle,
  mode: "read" | "readwrite" = "readwrite",
): Promise<FilePermissionStatus> {
  if (typeof handle.queryPermission !== "function") {
    return "unsupported";
  }

  try {
    return await handle.queryPermission({ mode });
  } catch {
    return "unsupported";
  }
}

export async function requestFilePermission(
  handle: BrowserFileSystemFileHandle,
  mode: "read" | "readwrite" = "readwrite",
): Promise<FilePermissionStatus> {
  if (typeof handle.requestPermission !== "function") {
    return "unsupported";
  }

  try {
    return await handle.requestPermission({ mode });
  } catch {
    return "unsupported";
  }
}

export async function ensureFilePermission(
  handle: BrowserFileSystemFileHandle,
  mode: "read" | "readwrite" = "readwrite",
): Promise<FilePermissionStatus> {
  const currentPermission = await queryFilePermission(handle, mode);
  if (currentPermission === "granted") {
    return "granted";
  }

  if (currentPermission === "denied") {
    return "denied";
  }

  const requestedPermission = await requestFilePermission(handle, mode);
  return requestedPermission === "unsupported" ? currentPermission : requestedPermission;
}

export async function saveBlueprintToExistingHandle(
  blueprint: ComponentBlueprint,
  handle: BrowserFileSystemFileHandle,
): Promise<SaveProjectResult> {
  const permission = await ensureFilePermission(handle, "readwrite");
  if (permission === "denied") {
    return { status: "permission-denied" };
  }

  if (permission === "unsupported") {
    return { status: "unsupported" };
  }

  try {
    const writable = await handle.createWritable();
    await writable.write(exportBlueprintToJson(blueprint));
    await writable.close();
    return { status: "saved", handle };
  } catch (error) {
    return { status: "failed", error };
  }
}

export async function saveBlueprintAs(
  blueprint: ComponentBlueprint,
  suggestedName: string,
  windowObject: BrowserWindowLike = window as unknown as BrowserWindowLike,
): Promise<SaveProjectResult> {
  if (!supportsFileSystemAccess(windowObject)) {
    return { status: "unsupported" };
  }

  try {
    const handle = await windowObject.showSaveFilePicker?.({
      suggestedName,
      types: [{
        description: "3Forge Blueprint",
        accept: {
          "application/json": [".json"],
        },
      }],
    });

    if (!handle) {
      return { status: "cancelled" };
    }

    return await saveBlueprintToExistingHandle(blueprint, handle);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "cancelled" };
    }

    return { status: "failed", error };
  }
}
