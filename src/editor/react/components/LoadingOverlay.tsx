import { useActiveTasks } from "../hooks/useAsyncTask";

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
