import { useEffect, useState } from "react";
import { endTask, startTask, useActiveTasks } from "../hooks/useAsyncTask";

export function LoadingOverlay() {
  const tasks = useActiveTasks();
  const blocking = tasks.find((task) => task.blocking);

  if (!blocking) {
    return null;
  }

  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-overlay__card">
        <div className="loading-overlay__spinner" aria-hidden="true">
          <span className="loading-overlay__ring" />
          <span className="loading-overlay__ring loading-overlay__ring--alt" />
        </div>
        <p className="loading-overlay__label">{blocking.label}</p>
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

export function LoadingPreviewDock() {
  const [visible, setVisible] = useState(() => import.meta.env.MODE !== "test");

  useEffect(() => {
    if (!visible || import.meta.env.MODE === "test") {
      return;
    }
    const id = startTask("Status bar loader · live preview");
    return () => {
      endTask(id);
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <div className="loading-preview-dock" role="note" aria-label="Loading animations preview">
      <div className="loading-preview-dock__head">
        <span className="loading-preview-dock__title">Loading preview</span>
        <button
          type="button"
          className="loading-preview-dock__close"
          onClick={() => setVisible(false)}
          aria-label="Hide loading preview"
          title="Hide loading preview"
        >
          x
        </button>
      </div>
      <div className="loading-preview-dock__row">
        <div className="loading-preview-dock__spinner" aria-hidden="true">
          <span className="loading-overlay__ring" />
          <span className="loading-overlay__ring loading-overlay__ring--alt" />
        </div>
        <div className="loading-preview-dock__col">
          <span className="loading-preview-dock__caption">Blocking overlay</span>
          <span className="loading-preview-dock__hint">Used for Save / Open / Import JSON</span>
        </div>
      </div>
      <div className="loading-preview-dock__row">
        <span className="statusbar-progress__pulse" aria-hidden="true">
          <span className="statusbar-progress__pulse-bar" />
        </span>
        <div className="loading-preview-dock__col">
          <span className="loading-preview-dock__caption">Status bar loader</span>
          <span className="loading-preview-dock__hint">Visible at the bottom while active</span>
        </div>
      </div>
    </div>
  );
}
