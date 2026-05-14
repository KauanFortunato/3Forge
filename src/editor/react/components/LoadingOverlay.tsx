import { useEffect, useState } from "react";

import { useActiveTasks } from "../hooks/useAsyncTask";

function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [startedAt]);
  if (startedAt === null) return 0;
  return Math.max(0, (now - startedAt) / 1000);
}

export function LoadingOverlay() {
  const tasks = useActiveTasks();
  const blocking = tasks.find((task) => task.blocking);
  const elapsed = useElapsedSeconds(blocking?.startedAt ?? null);

  if (!blocking) {
    return null;
  }

  const estimatedSec = blocking.estimatedDurationMs !== undefined
    ? blocking.estimatedDurationMs / 1000
    : null;

  // Cap progress at 95% so the bar doesn't claim "done" before the parse
  // actually finishes — once the task ends, the overlay disappears anyway.
  const progress = estimatedSec !== null
    ? Math.min(0.95, elapsed / estimatedSec)
    : null;

  const remaining = estimatedSec !== null
    ? Math.max(0, estimatedSec - elapsed)
    : null;

  const isOverEstimate = estimatedSec !== null && elapsed > estimatedSec;

  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-overlay__card">
        <div className="loading-overlay__spinner" aria-hidden="true">
          <span className="loading-overlay__ring" />
          <span className="loading-overlay__ring loading-overlay__ring--alt" />
        </div>
        <p className="loading-overlay__label">{blocking.label}</p>
        <div
          className={`loading-overlay__bar${progress !== null ? " loading-overlay__bar--determinate" : ""}`}
          aria-hidden="true"
        >
          <span
            className="loading-overlay__bar-fill"
            style={progress !== null ? { width: `${(progress * 100).toFixed(1)}%` } : undefined}
          />
        </div>
        <p className="loading-overlay__elapsed">
          {remaining === null
            ? `${elapsed.toFixed(1)}s decorridos`
            : isOverEstimate
              ? `Quase lá... (${elapsed.toFixed(1)}s)`
              : `Faltam ~${remaining.toFixed(1)}s`}
        </p>
      </div>
    </div>
  );
}

export function StatusBarProgress() {
  const tasks = useActiveTasks();
  const top = tasks[tasks.length - 1];

  if (!top) {
    return null;
  }

  const others = tasks.length - 1;
  const label = others > 0 ? `${top.label} (+${others})` : top.label;

  return (
    <span className="statusbar-progress" role="status" aria-live="polite">
      <span className="statusbar-progress__pulse" aria-hidden="true">
        <span className="statusbar-progress__pulse-bar" />
      </span>
      <span className="statusbar-progress__label">{label}</span>
    </span>
  );
}
