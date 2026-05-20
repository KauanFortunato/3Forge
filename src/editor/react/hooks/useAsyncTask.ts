import { useCallback, useSyncExternalStore } from "react";

export interface ActiveTask {
  id: string;
  label: string;
  blocking: boolean;
  startedAt: number;
  estimatedDurationMs?: number;
  progress?: number;
  detail?: string;
}

interface TaskOptions {
  blocking?: boolean;
  estimatedDurationMs?: number;
}

export interface TaskProgressUpdate {
  label?: string;
  progress?: number | null;
  detail?: string;
  estimatedDurationMs?: number;
}

export interface TaskProgressReporter {
  update: (update: TaskProgressUpdate) => void;
}

let nextId = 0;
let active: ActiveTask[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ActiveTask[] {
  return active;
}

export function startTask(label: string, options: TaskOptions = {}): string {
  const id = `task-${++nextId}`;
  active = [...active, {
    id,
    label,
    blocking: Boolean(options.blocking),
    startedAt: Date.now(),
    estimatedDurationMs: options.estimatedDurationMs,
  }];
  emit();
  return id;
}

export function endTask(id: string): void {
  const next = active.filter((task) => task.id !== id);
  if (next.length === active.length) {
    return;
  }
  active = next;
  emit();
}

export function updateTask(id: string, update: TaskProgressUpdate): void {
  const next = active.map((task) => {
    if (task.id !== id) {
      return task;
    }
    return {
      ...task,
      ...update,
      progress: update.progress === undefined
        ? task.progress
        : update.progress === null
          ? undefined
        : Math.max(0, Math.min(1, update.progress)),
    };
  });
  active = next;
  emit();
}

export async function runTask<T>(
  label: string,
  fn: (task: TaskProgressReporter) => Promise<T> | T,
  options: TaskOptions = {},
): Promise<T> {
  const id = startTask(label, options);
  const reporter: TaskProgressReporter = {
    update: (update) => updateTask(id, update),
  };
  try {
    return await fn(reporter);
  } finally {
    endTask(id);
  }
}

export function useActiveTasks(): ActiveTask[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAsyncTask(): <T>(
  label: string,
  fn: (task: TaskProgressReporter) => Promise<T> | T,
  options?: TaskOptions,
) => Promise<T> {
  return useCallback((label, fn, options) => runTask(label, fn, options), []);
}
