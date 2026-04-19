declare module "node:crypto" {
  export function randomUUID(): string;
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "node:url" {
  export function pathToFileURL(path: string): URL;
}

declare module "*.mjs";
