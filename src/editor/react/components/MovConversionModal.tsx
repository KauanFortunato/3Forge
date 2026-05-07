import { useState } from "react";
import { Modal } from "./Modal";
import type { MovClassification } from "../../import/w3dFolder";

export interface MovConversionResult {
  converted: string[];
  skipped: string[];
  failed: { filename: string; error: string }[];
  sequenceJsonPaths: string[];
  warnings: string[];
}

export interface MovConvertError {
  code: string;
  message?: string;
  manualPathAllowed?: boolean;
  installHint?: string;
}

export interface MovConversionModalProps {
  isOpen: boolean;
  classification: MovClassification;
  projectName: string;
  isDevMode: boolean;
  conversionResult?: MovConversionResult;
  lastError?: MovConvertError;
  onConvert: (req: { projectName: string } | { folderPath: string }) => void;
  onImportWithoutConverting: () => void;
  onCancel: () => void;
}

export function MovConversionModal(props: MovConversionModalProps) {
  const {
    isOpen, classification, projectName, isDevMode,
    conversionResult, lastError,
    onConvert, onImportWithoutConverting, onCancel,
  } = props;
  const [folderPath, setFolderPath] = useState("");
  const [showCli, setShowCli] = useState(false);
  const showManualInput = lastError?.code === "PROJECT_PATH_NOT_FOUND" && lastError.manualPathAllowed === true;
  const cliCommand = `node scripts/convert-w3d-mov-to-sequence.mjs "<folder path>"`;
  if (!isOpen) return null;
  if (classification.withoutSequence.length === 0) return null;

  const handleConvertClick = () => {
    if (!isDevMode) { setShowCli(true); return; }
    if (showManualInput && folderPath) { onConvert({ folderPath }); return; }
    onConvert({ projectName });
  };

  const copyCli = async () => {
    try { await navigator.clipboard?.writeText(cliCommand); }
    catch { /* operator can copy by hand */ }
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="MOV videos detected" size="wide">
      <p>
        This project contains {classification.withoutSequence.length} .mov video asset
        {classification.withoutSequence.length === 1 ? "" : "s"}. MOV files may not play
        correctly in the browser, especially with professional codecs or transparency.
        3Forge can convert them to PNG image sequences for better compatibility and
        alpha-safe playback. This may increase project size.
      </p>

      <ul className="mov-conv-list">
        {classification.withSequence.map((s) => (
          <li key={s.videoName}>
            <span className="mov-conv-name">{s.videoName}</span>
            <span className="badge badge--ok">sequence ready</span>
          </li>
        ))}
        {classification.withoutSequence.map((s) => (
          <li key={s.videoName}>
            <span className="mov-conv-name">{s.videoName}</span>
            <span className="badge badge--warn">no sequence</span>
          </li>
        ))}
      </ul>

      {conversionResult && (
        <div className="mov-conv-result">
          <h3>Converted ({conversionResult.converted.length})</h3>
          <ul>{conversionResult.converted.map((f) => <li key={f}>{f}</li>)}</ul>
          <h3>Skipped ({conversionResult.skipped.length})</h3>
          <ul>{conversionResult.skipped.map((f) => <li key={f}>{f} — already had sequence.json</li>)}</ul>
          <h3>Failed ({conversionResult.failed.length})</h3>
          <ul>
            {conversionResult.failed.map((f) => (
              <li key={f.filename} className="mov-conv-failed">
                {f.filename}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showManualInput && (
        <div className="mov-conv-manual">
          <label htmlFor="mov-conv-folder">Folder path on disk</label>
          <input
            id="mov-conv-folder"
            type="text"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            placeholder='C:\Users\you\R3\Projects\GameName_FS'
          />
          <small>R3_PROJECTS_ROOT did not resolve; paste the absolute folder path.</small>
        </div>
      )}

      {lastError?.code === "FFMPEG_NOT_INSTALLED" && (
        <div className="mov-conv-error">
          <strong>ffmpeg not installed.</strong>
          <pre>{lastError.installHint}</pre>
          <button type="button" onClick={onImportWithoutConverting}>Continue without converting</button>
        </div>
      )}

      {showCli && (
        <div className="mov-conv-cli">
          <p>Run this in a terminal where ffmpeg is on PATH, then re-import:</p>
          <pre>{cliCommand}</pre>
          <button type="button" onClick={copyCli}>Copy command</button>
        </div>
      )}

      <div className="modal__actions">
        <button type="button" onClick={handleConvertClick}>Convert and Import</button>
        <button type="button" onClick={onImportWithoutConverting}>Import Without Converting</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}
