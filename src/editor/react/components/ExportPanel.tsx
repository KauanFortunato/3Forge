import { useMemo } from "react";
import type { ReactNode } from "react";
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
  const tokens = useMemo(() => tokenise(preview, exportMode), [preview, exportMode]);
  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%", minHeight: 0 }}>
      <div className="exp-hd">
        <div className="seg">
          <button
            type="button"
            className={`seg__btn${exportMode === "json" ? " is-active" : ""}`}
            onClick={() => onExportModeChange("json")}
          >
            Blueprint JSON
          </button>
          <button
            type="button"
            className={`seg__btn${exportMode === "typescript" ? " is-active" : ""}`}
            onClick={() => onExportModeChange("typescript")}
          >
            TypeScript
          </button>
        </div>

        <div className="exp-hd__spacer" />

        <button type="button" className="tbtn is-ghost" onClick={onCopy} title="Copy to clipboard">
          <CopyIcon width={12} height={12} />
          <span>Copy</span>
        </button>
        <button type="button" className="tbtn is-ghost" onClick={onDownload} title="Download file">
          <DownloadIcon width={12} height={12} />
          <span>Download</span>
        </button>
      </div>

      <pre className="exp-code">{tokens}</pre>

      {/* Hidden textarea preserves getByDisplayValue() lookups used in tests. */}
      <textarea
        readOnly
        spellCheck={false}
        value={preview}
        aria-label="Export preview"
        style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none", left: -10000, top: -10000 }}
      />
    </div>
  );
}

function tokenise(source: string, mode: ExportMode): ReactNode {
  if (!source) {
    return null;
  }

  if (mode === "json") {
    return tokeniseJson(source);
  }

  return tokeniseTypeScript(source);
}

const TS_KEYWORDS = new Set([
  "import", "from", "export", "const", "let", "var", "function", "return",
  "if", "else", "for", "while", "switch", "case", "default", "break",
  "continue", "class", "extends", "implements", "interface", "type",
  "new", "this", "super", "true", "false", "null", "undefined", "async",
  "await", "try", "catch", "finally", "throw", "as", "in", "of", "void",
  "typeof", "instanceof", "public", "private", "protected", "static",
  "readonly", "declare", "namespace", "module", "enum", "yield", "get", "set",
]);

const TS_TYPES = new Set([
  "string", "number", "boolean", "object", "any", "unknown", "never", "void",
  "Array", "Promise", "Record", "Partial", "Readonly", "Pick", "Omit",
  "Map", "Set", "Date", "RegExp",
]);

function tokeniseTypeScript(source: string): ReactNode {
  const tokens: ReactNode[] = [];
  const pattern = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[^\w\s])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(source.slice(lastIndex, match.index));
    }
    const chunk = match[0];
    if (/^\/\//.test(chunk) || /^\/\*/.test(chunk)) {
      tokens.push(<span key={`c-${key++}`} className="tok-c">{chunk}</span>);
    } else if (/^['"`]/.test(chunk)) {
      tokens.push(<span key={`s-${key++}`} className="tok-s">{chunk}</span>);
    } else if (/^\d/.test(chunk)) {
      tokens.push(<span key={`n-${key++}`} className="tok-n">{chunk}</span>);
    } else if (/^[A-Za-z_$]/.test(chunk)) {
      if (TS_KEYWORDS.has(chunk)) {
        tokens.push(<span key={`k-${key++}`} className="tok-k">{chunk}</span>);
      } else if (TS_TYPES.has(chunk) || /^[A-Z]/.test(chunk)) {
        tokens.push(<span key={`t-${key++}`} className="tok-t">{chunk}</span>);
      } else {
        const nextChar = source[match.index + chunk.length];
        if (nextChar === "(") {
          tokens.push(<span key={`f-${key++}`} className="tok-f">{chunk}</span>);
        } else {
          tokens.push(<span key={`p-${key++}`} className="tok-p">{chunk}</span>);
        }
      }
    } else {
      tokens.push(chunk);
    }
    lastIndex = match.index + chunk.length;
  }
  if (lastIndex < source.length) {
    tokens.push(source.slice(lastIndex));
  }
  return tokens;
}

function tokeniseJson(source: string): ReactNode {
  const tokens: ReactNode[] = [];
  const pattern = /("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(source.slice(lastIndex, match.index));
    }
    const chunk = match[0];
    if (/^"[\s\S]*"\s*:$/.test(chunk)) {
      const idx = chunk.lastIndexOf('"') + 1;
      const keyPart = chunk.slice(0, idx);
      const rest = chunk.slice(idx);
      tokens.push(<span key={`p-${key++}`} className="tok-p">{keyPart}</span>);
      tokens.push(rest);
    } else if (chunk === "true" || chunk === "false") {
      tokens.push(<span key={`k-${key++}`} className="tok-k">{chunk}</span>);
    } else if (chunk === "null") {
      tokens.push(<span key={`k-${key++}`} className="tok-k">{chunk}</span>);
    } else if (/^"/.test(chunk)) {
      tokens.push(<span key={`s-${key++}`} className="tok-s">{chunk}</span>);
    } else {
      tokens.push(<span key={`n-${key++}`} className="tok-n">{chunk}</span>);
    }
    lastIndex = match.index + chunk.length;
  }
  if (lastIndex < source.length) {
    tokens.push(source.slice(lastIndex));
  }
  return tokens;
}
