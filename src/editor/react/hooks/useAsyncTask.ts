import { useCallback, useSyncExternalStore } from "react";

export interface ActiveTask {
  id: string;
  label: string;
  blocking: boolean;
  startedAt: number;
}

interface TaskOptions {
  blocking?: boolean;
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
  active = [...active, { id, label, blocking: Boolean(options.blocking), startedAt: Date.now() }];
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

export function updateTask(id: string, label: string): void {
  let changed = false;
  active = active.map((task) => {
    if (task.id !== id || task.label === label) {
      return task;
    }
    changed = true;
    return { ...task, label };
  });
  if (changed) {
    emit();
  }
}

export async function runTask<T>(
  label: string,
  fn: (setLabel: (next: string) => void) => Promise<T> | T,
  options: TaskOptions = {},
): Promise<T> {
  const id = startTask(label, options);
  try {
    return await fn((next) => updateTask(id, next));
  } finally {
    endTask(id);
  }
}

export function useActiveTasks(): ActiveTask[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAsyncTask(): <T>(label: string, fn: () => Promise<T> | T, options?: TaskOptions) => Promise<T> {
  return useCallback((label, fn, options) => runTask(label, fn, options), []);
}
