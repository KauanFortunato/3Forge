import { useState } from "react";
import { Modal } from "./Modal";
import type { MovClassification } from "../../import/w3dFolder";
import type { SequenceFormat, SequenceFallbackReason } from "../../types";

export interface MovConvertedFile {
  mov: string;
  format: SequenceFormat;
  fallbackReason: SequenceFallbackReason | null;
  frameCount: number;
  fps: number;
  alpha: boolean;
}

export interface MovConversionResult {
  converted: MovConvertedFile[];
  skipped: string[];
  failed: { filename: string; error: string }[];
  sequenceJsonPaths: string[];
  warnings: string[];
}

function reasonText(r: SequenceFallbackReason): string {
  switch (r) {
    case "webp_encoder_unavailable": return "WebP encoder unavailable in this build";
    case "webp_validation_failed": return "WebP validation failed";
  }
}

export interface MovConvertError {
  code: string;
  message?: string;
  manualPathAllowed?: boolean;
  installHint?: string;
}

export interface MovConvertProgress {
  /** Name of the .mov currently being converted. */
  current: string;
  /** 1-based index of the .mov currently being converted. */
  index: number;
  /** Total number of .mov files queued. */
  total: number;
}

export type MovModalPhase =
  | { kind: "ask" }
  | { kind: "converting"; progress: MovConvertProgress }
  | { kind: "installing" }
  | { kind: "done" }
  | { kind: "error"; reason: "no-backend" | "ffmpeg-missing" | "decode-failed" | "install-failed" | "unknown" };

export interface MovConversionModalProps {
  isOpen: boolean;
  classification: MovClassification;
  projectName: string;
  isDevMode: boolean;
  /** New: drives which simplified UI to show. Defaults to "ask" for legacy callers. */
  phase?: MovModalPhase;
  conversionResult?: MovConversionResult;
  lastError?: MovConvertError;
  onConvert: (req: { projectName: string } | { folderPath: string }) => void;
  onImportWithoutConverting: () => void;
  onCancel: () => void;
  /** New: called when user clicks Cancel during the converting phase. */
  onAbort?: () => void;
  /** New: called when user clicks Retry during the error phase. */
  onRetry?: () => void;
  /** New: called when user clicks "Instalar e converter" in the ffmpeg-missing error. */
  onInstall?: () => void;
}

const ERROR_TEXT: Record<string, string> = {
  "no-backend": "Não foi possível contactar o conversor local. Podes importar sem conversão.",
  "ffmpeg-missing": "Ferramenta de conversão (ffmpeg) não está instalada. Podes instalar agora ou importar sem conversão.",
  "decode-failed": "Não foi possível converter este vídeo. Podes importar sem conversão ou tentar novamente.",
  "install-failed": "A instalação automática falhou. Podes importar sem conversão ou tentar novamente.",
  "unknown": "Não foi possível converter este vídeo. Podes importar sem conversão.",
};

export function MovConversionModal(props: MovConversionModalProps) {
  const {
    isOpen, classification, projectName, isDevMode,
    phase = { kind: "ask" } as MovModalPhase,
    conversionResult, lastError,
    onConvert, onImportWithoutConverting, onCancel, onAbort, onRetry, onInstall,
  } = props;
  const [folderPath, setFolderPath] = useState("");
  const [showCli, setShowCli] = useState(false);

  if (!isOpen) return null;

  // ---------- "converting" phase: minimal progress UI ----------
  if (phase.kind === "converting") {
    const { current, index, total } = phase.progress;
    const label = total > 1
      ? `A converter vídeo ${index}/${total}…`
      : "A converter media…";
    return (
      <Modal isOpen={isOpen} onClose={onAbort ?? onCancel} title="A preparar import" size="wide">
        <p>{label}</p>
        <p className="mov-conv-current"><code>{current}</code></p>
        <progress max={total} value={Math.max(0, index - 1)} style={{ width: "100%" }} />
        <div className="modal__actions">
          <button type="button" onClick={onAbort ?? onCancel}>Cancel</button>
        </div>
      </Modal>
    );
  }

  // ---------- "installing" phase: shown while npm install runs in the backend ----------
  if (phase.kind === "installing") {
    return (
      <Modal isOpen={isOpen} onClose={onAbort ?? onCancel} title="A preparar import" size="wide">
        <p>A instalar ferramenta de conversão…</p>
        <p className="mov-conv-current"><small>Este passo pode demorar até um minuto.</small></p>
        <progress style={{ width: "100%" }} />
        <div className="modal__actions">
          <button type="button" onClick={onAbort ?? onCancel}>Cancel</button>
        </div>
      </Modal>
    );
  }

  // ---------- "error" phase: simple message + recovery options ----------
  if (phase.kind === "error") {
    const text = ERROR_TEXT[phase.reason] ?? ERROR_TEXT.unknown;
    const showInstall = phase.reason === "ffmpeg-missing" && Boolean(onInstall);
    const showRetry = Boolean(onRetry) && phase.reason !== "no-backend";
    return (
      <Modal isOpen={isOpen} onClose={onCancel} title="Conversão indisponível" size="wide">
        <p>{text}</p>
        <div className="modal__actions">
          {showInstall && (
            <button type="button" onClick={onInstall}>Instalar e converter</button>
          )}
          {showRetry && phase.reason !== "ffmpeg-missing" && (
            <button type="button" onClick={onRetry}>Tentar novamente</button>
          )}
          <button type="button" onClick={onImportWithoutConverting}>Import Without Converting</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </Modal>
    );
  }

  // ---------- "done" phase: per-file format/reason copy ----------
  if (phase.kind === "done") {
    return (
      <Modal isOpen={isOpen} onClose={onCancel} title="Conversion complete" size="wide">
        <div className="mov-conv-final">
          {conversionResult?.converted.map((c) => (
            <div key={c.mov} className="mov-conv-final__row">
              <code>{c.mov}</code>
              <div>
                Converted to {c.format === "webp" ? "WebP" : "PNG"} sequence &middot; {c.frameCount} frames @ {c.fps}fps &middot; {c.alpha ? "alpha" : "no alpha"}
              </div>
              {c.fallbackReason ? (
                <div className="mov-conv-final__reason">
                  Reason: {reasonText(c.fallbackReason)}
                </div>
              ) : null}
            </div>
          ))}
          {conversionResult && conversionResult.failed.length > 0 && (
            <div className="mov-conv-result__failed">
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
        </div>
        <div className="modal__actions">
          <button type="button" onClick={onCancel}>Close</button>
        </div>
      </Modal>
    );
  }

  // ---------- "ask" phase (legacy, kept as fallback for browsers without
  // FSA or for explicit retries from error phase) ----------
  if (classification.withoutSequence.length === 0) return null;
  const showManualInput = lastError?.code === "PROJECT_PATH_NOT_FOUND" && lastError.manualPathAllowed === true;
  const cliCommand = `node scripts/convert-w3d-mov-to-sequence.mjs "<folder path>"`;

  const readyCount = classification.withSequence.length;
  const needsCount = classification.withoutSequence.length;
  const isMixMode = readyCount > 0 && needsCount > 0;
  const titleText = needsCount > 0
    ? "MOV videos detected — conversion needed"
    : "MOV videos detected";

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
    <Modal isOpen={isOpen} onClose={onCancel} title={titleText} size="wide">
      <p>
        {isMixMode ? (
          <>
            This project contains {readyCount} MOV asset{readyCount === 1 ? "" : "s"}
            {" "}with PNG sequences ready and {needsCount} that still need conversion.
            {" "}MOV files may not play correctly in the browser, especially with
            professional codecs or transparency. Click <strong>Convert and Import</strong>
            {" "}to convert the remaining {needsCount} now.
          </>
        ) : (
          <>
            This project contains {needsCount} .mov video asset
            {needsCount === 1 ? "" : "s"}. MOV files may not play correctly in the
            browser, especially with professional codecs or transparency. 3Forge
            can convert them to PNG image sequences for better compatibility and
            alpha-safe playback. This may increase project size.
          </>
        )}
      </p>

      <ul className="mov-conv-list">
        {classification.withSequence.map((s) => (
          <li key={s.videoName}>
            <span className="mov-conv-name">{s.videoName}</span>
            <span className="mov-conv-sep"> — </span>
            <span className="badge badge--ok">sequence ready</span>
          </li>
        ))}
        {classification.withoutSequence.map((s) => (
          <li key={s.videoName}>
            <span className="mov-conv-name">{s.videoName}</span>
            <span className="mov-conv-sep"> — </span>
            <span className="badge badge--warn">no sequence</span>
          </li>
        ))}
      </ul>

      {conversionResult && (
        <div className="mov-conv-result">
          <h3>Converted ({conversionResult.converted.length})</h3>
          <ul>{conversionResult.converted.map((f) => <li key={f.mov}>{f.mov}</li>)}</ul>
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
