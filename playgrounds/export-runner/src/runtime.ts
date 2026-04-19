import type { Group } from "three";

export interface ExportRunnerComponentInstance {
  group: Group;
  build: () => Promise<void> | void;
  dispose: () => void;
  getClipNames?: () => string[];
  play?: (clipName?: string) => Promise<unknown> | unknown;
  pause?: () => Promise<void> | void;
  restart?: (clipName?: string) => Promise<unknown> | unknown;
  reverse?: (clipName?: string) => Promise<unknown> | unknown;
  stop?: () => Promise<void> | void;
  seek?: (frame: number, clipName?: string) => Promise<void> | void;
  createTimeline?: (clipName?: string) => Promise<unknown> | unknown;
  playClip?: (clipName: string) => Promise<unknown> | unknown;
}

export interface ExportRunnerComponentConstructor {
  new (options?: Record<string, unknown>): ExportRunnerComponentInstance;
}

export interface ResolvedExportedComponent {
  exportName: string;
  constructor: ExportRunnerComponentConstructor;
}

export interface GeneratedModuleEntry {
  fileName: string;
  modulePath: string;
  importModule: () => Promise<Record<string, unknown>>;
}

export interface RunnerAnimationCapabilities {
  canPlay: boolean;
  canPause: boolean;
  canRestart: boolean;
  canReverse: boolean;
  canStop: boolean;
  canSeek: boolean;
  canCreateTimeline: boolean;
  canPlayClip: boolean;
  clipNames: string[];
}

export function discoverGeneratedModules(
  moduleImporters: Record<string, () => Promise<Record<string, unknown>>>,
): GeneratedModuleEntry[] {
  return Object.entries(moduleImporters)
    .filter(([modulePath]) => !modulePath.endsWith(".test.ts") && !modulePath.endsWith(".d.ts"))
    .map(([modulePath, importModule]) => ({
      fileName: toDisplayFileName(modulePath),
      modulePath,
      importModule,
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

export function resolveExportedComponent(moduleRecord: Record<string, unknown>): ResolvedExportedComponent | null {
  for (const [exportName, candidate] of Object.entries(moduleRecord)) {
    if (!isExportRunnerConstructor(candidate)) {
      continue;
    }

    return {
      exportName,
      constructor: candidate,
    };
  }

  return null;
}

export function getAnimationCapabilities(instance: ExportRunnerComponentInstance | null): RunnerAnimationCapabilities {
  return {
    canPlay: typeof instance?.play === "function",
    canPause: typeof instance?.pause === "function",
    canRestart: typeof instance?.restart === "function",
    canReverse: typeof instance?.reverse === "function",
    canStop: typeof instance?.stop === "function",
    canSeek: typeof instance?.seek === "function",
    canCreateTimeline: typeof instance?.createTimeline === "function",
    canPlayClip: typeof instance?.playClip === "function",
    clipNames: typeof instance?.getClipNames === "function" ? instance.getClipNames() : [],
  };
}

function isExportRunnerConstructor(candidate: unknown): candidate is ExportRunnerComponentConstructor {
  if (typeof candidate !== "function") {
    return false;
  }

  const prototype = candidate.prototype as Partial<ExportRunnerComponentInstance> | undefined;
  return typeof prototype?.build === "function" && typeof prototype?.dispose === "function";
}

function toDisplayFileName(modulePath: string): string {
  const normalizedPath = modulePath.replace(/^\.\/generated\//, "");
  return normalizedPath.replace(/\.ts$/, "");
}
