import type { ExportMode } from "../ui-types";
import { CopyIcon, DownloadIcon } from "./icons";

interface ExportPanelProps {
  exportMode: ExportMode;
  preview: string;
  onExportModeChange: (mode: ExportMode) => void;
  onCopy: () => void;
  onDownload: () => void;
}

export function ExportPanel({ exportMode, preview, onExportModeChange, onCopy, onDownload }: ExportPanelProps) {
  return (
    <div className="export-stack">
      <div className="export-toolbar">
        <div className="segmented-control">
          <button
            type="button"
            className={`segmented-control__button${exportMode === "json" ? " is-active" : ""}`}
            onClick={() => onExportModeChange("json")}
          >
            Blueprint JSON
          </button>
          <button
            type="button"
            className={`segmented-control__button${exportMode === "typescript" ? " is-active" : ""}`}
            onClick={() => onExportModeChange("typescript")}
          >
            TypeScript
          </button>
        </div>

        <div className="button-row">
          <button type="button" className="tool-button tool-button--icon" onClick={onCopy} title="Copy to clipboard">
            <CopyIcon width={14} height={14} />
            <span>Copy</span>
          </button>
          <button type="button" className="tool-button tool-button--icon" onClick={onDownload} title="Download file">
            <DownloadIcon width={14} height={14} />
            <span>Download</span>
          </button>
        </div>
      </div>

      <div className="export-preview-container">
        <textarea className="export-preview" readOnly spellCheck={false} value={preview} />
      </div>
    </div>
  );
}
