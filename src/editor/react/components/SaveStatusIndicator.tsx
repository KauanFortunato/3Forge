import { useEffect, useState } from "react";

export interface SaveStatusData {
  /** True while edits have not yet been flushed to browser autosave. */
  isLocalDirty: boolean;
  /** True when the project is linked to a file on the user's machine. */
  hasDiskFile: boolean;
  /** True when the linked file is out of sync with the current edits. */
  isDiskDirty: boolean;
  /** Name of the linked file, if any. */
  fileName: string | null;
  /** Timestamp of the last successful browser autosave. */
  lastLocalSaveAt: number | null;
  /** Timestamp of the last successful save to the machine. */
  lastDiskSaveAt: number | null;
}

interface SaveStatusIndicatorProps extends SaveStatusData {
  variant: "menubar" | "statusbar";
  /** Invoked when the user clicks the indicator to save a copy to their machine. */
  onSaveToDisk?: () => void;
}

type SaveTone = "saving" | "synced" | "edited" | "browser";

function resolveTone(data: SaveStatusData): SaveTone {
  if (data.isLocalDirty) {
    return "saving";
  }

  if (!data.hasDiskFile) {
    return "browser";
  }

  return data.isDiskDirty ? "edited" : "synced";
}

function formatTimeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Live save-state chip. Surfaces two distinct truths that the editor used to
 * hide behind a static "auto-save" label: whether the in-browser autosave has
 * caught up, and whether the project is actually mirrored to a file on the
 * user's machine. Manages its own clock so the "x ago" text stays fresh
 * without re-rendering the whole editor shell.
 */
export function SaveStatusIndicator({
  variant,
  isLocalDirty,
  hasDiskFile,
  isDiskDirty,
  fileName,
  lastLocalSaveAt,
  lastDiskSaveAt,
  onSaveToDisk,
}: SaveStatusIndicatorProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(intervalId);
  }, []);

  const tone = resolveTone({ isLocalDirty, hasDiskFile, isDiskDirty, fileName, lastLocalSaveAt, lastDiskSaveAt });
  const canSaveToDisk = typeof onSaveToDisk === "function" && (tone === "browser" || tone === "edited");

  const primaryLabel = (() => {
    switch (tone) {
      case "saving":
        return "Saving…";
      case "synced":
        return "Saved to file";
      case "edited":
        return "Unsaved changes";
      case "browser":
      default:
        return "Saved in browser";
    }
  })();

  const detail = (() => {
    if (variant === "menubar") {
      if (tone === "browser") {
        return "On this device only";
      }
      if (tone === "synced" && fileName) {
        return fileName;
      }
      return null;
    }

    switch (tone) {
      case "saving":
        return "Autosaving to this browser…";
      case "synced":
        return lastDiskSaveAt ? `${fileName ?? "file"} · saved ${formatTimeAgo(lastDiskSaveAt, now)}` : (fileName ?? "Saved to your machine");
      case "edited":
        return fileName ? `${fileName} is behind — click to save` : "Not saved to your machine — click to save";
      case "browser":
      default:
        return lastLocalSaveAt
          ? `Autosaved ${formatTimeAgo(lastLocalSaveAt, now)} · not on your computer yet`
          : "Not on your computer yet";
    }
  })();

  const title = canSaveToDisk
    ? (hasDiskFile ? `Save changes to ${fileName ?? "the linked file"}` : "Save a copy to your computer")
    : primaryLabel;

  const className = [
    "save-status",
    `save-status--${variant}`,
    `save-status--${tone}`,
    canSaveToDisk ? "save-status--actionable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className="save-status__dot" aria-hidden="true" />
      <span className="save-status__text">
        <span className="save-status__primary">{primaryLabel}</span>
        {detail ? <span className="save-status__detail">{detail}</span> : null}
      </span>
    </>
  );

  if (canSaveToDisk) {
    return (
      <button type="button" className={className} onClick={onSaveToDisk} title={title} aria-label={title}>
        {content}
      </button>
    );
  }

  return (
    <span className={className} title={title}>
      {content}
    </span>
  );
}
