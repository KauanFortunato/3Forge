import { useEffect, useMemo, useRef, useState } from "react";
import { AI_PROVIDER_OPTIONS, DEFAULT_LOCAL_CHAT_URL, isAiBlueprintDebugError } from "../../aiBlueprint";
import type { AiChatContext, AiProvider } from "../../aiBlueprint";

export type AIGenerationMode = "new" | "edit";

export interface AiChatGenerationResult {
  content: string;
  sceneSpecJson: string;
  rawText: string;
  executedModel?: string;
  changes?: AiChangeSummaryInput;
}

export type AiChangeKind = "added" | "changed" | "removed";

export interface AiChangeSummaryItem {
  kind: AiChangeKind;
  label: string;
  detail?: string;
}

export interface AiChangeSummary {
  added: number;
  changed: number;
  removed: number;
  items: AiChangeSummaryItem[];
}

export type AiChangeSummaryInput = AiChangeSummary | {
  counts?: Partial<Record<AiChangeKind, number>>;
  added?: number | AiChangeSummaryItem[];
  changed?: number | AiChangeSummaryItem[];
  removed?: number | AiChangeSummaryItem[];
  items?: AiChangeSummaryItem[];
  summary?: AiChangeSummaryItem[];
  changes?: AiChangeSummaryItem[];
  entries?: AiChangeSummaryItem[];
  list?: AiChangeSummaryItem[];
  descriptions?: string[];
  labels?: string[];
  preview?: string[];
  sample?: string[];
  addedLabels?: string[];
  changedLabels?: string[];
  removedLabels?: string[];
  addedItems?: AiChangeSummaryItem[];
  changedItems?: AiChangeSummaryItem[];
  removedItems?: AiChangeSummaryItem[];
  addedPaths?: string[];
  changedPaths?: string[];
  removedPaths?: string[];
  addedNames?: string[];
  changedNames?: string[];
  removedNames?: string[];
}

interface AIGenerateDialogProps {
  isOpen: boolean;
  projectId: string;
  onGenerate: (apiKey: string, prompt: string, provider: AiProvider, model: string, mode: AIGenerationMode, localUrl?: string, chatContext?: AiChatContext) => Promise<AiChatGenerationResult>;
  onApplyScene: (sceneSpecJson: string, mode: AIGenerationMode) => Promise<void> | void;
}

interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  provider: AiProvider;
  model: string;
  executedModel?: string;
  mode: AIGenerationMode;
  content: string;
  sceneSpecJson?: string;
  rawText?: string;
  changes?: AiChangeSummary;
  status?: "ready" | "applied" | "error" | "streaming";
}

const DEFAULT_PROMPT = "A small futuristic drone with violet accent lights and four propellers";
const DEFAULT_EDIT_PROMPT = "Make the current model more polished with stronger color contrast and a few violet accent lights";
const AI_KEY_STORAGE_PREFIX = "3forge-ai-api-key";
const AI_PROVIDER_STORAGE_KEY = "3forge-ai-provider";
const AI_MODEL_STORAGE_PREFIX = "3forge-ai-model";
const AI_LOCAL_URL_STORAGE_KEY = "3forge-ai-local-url";
const AI_CHAT_STORAGE_PREFIX = "3forge-ai-chat-history-v1";
const AI_COPY_FEEDBACK_MS = 1200;
const AI_COMPOSER_MAX_HEIGHT = 132;

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getProviderKeyStorageKey(provider: AiProvider): string {
  return `${AI_KEY_STORAGE_PREFIX}-${provider}`;
}

function getProviderModelStorageKey(provider: AiProvider): string {
  return `${AI_MODEL_STORAGE_PREFIX}-${provider}`;
}

function getChatStorageKey(projectId: string): string {
  return `${AI_CHAT_STORAGE_PREFIX}:${projectId || "local"}`;
}

function readStoredProvider(): AiProvider {
  if (!canUseLocalStorage()) {
    return "openrouter";
  }

  const stored = window.localStorage.getItem(AI_PROVIDER_STORAGE_KEY);
  return AI_PROVIDER_OPTIONS.some((entry) => entry.provider === stored) ? stored as AiProvider : "openrouter";
}

function readStoredKey(provider: AiProvider): string {
  return canUseLocalStorage() ? window.localStorage.getItem(getProviderKeyStorageKey(provider)) ?? "" : "";
}

function readStoredModel(provider: AiProvider, fallback: string): string {
  return canUseLocalStorage() ? window.localStorage.getItem(getProviderModelStorageKey(provider)) ?? fallback : fallback;
}

function readStoredLocalUrl(): string {
  return canUseLocalStorage() ? window.localStorage.getItem(AI_LOCAL_URL_STORAGE_KEY) ?? DEFAULT_LOCAL_CHAT_URL : DEFAULT_LOCAL_CHAT_URL;
}

function readStoredMessages(projectId: string): AiChatMessage[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getChatStorageKey(projectId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as AiChatMessage[];
    return Array.isArray(parsed)
      ? parsed.filter(isChatMessage).map(normalizeStoredMessage)
      : [];
  } catch {
    return [];
  }
}

function isChatMessage(value: unknown): value is AiChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Partial<AiChatMessage>;
  return typeof message.id === "string"
    && (message.role === "user" || message.role === "assistant")
    && typeof message.createdAt === "number"
    && typeof message.content === "string";
}

function normalizeStoredMessage(message: AiChatMessage): AiChatMessage {
  return {
    ...message,
    status: message.status === "streaming" ? "streaming" : message.status,
    changes: normalizeChangeSummary(message.changes),
  };
}

function isChangeKind(value: unknown): value is AiChangeKind {
  return value === "added" || value === "changed" || value === "removed";
}

function normalizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeChangeItem(value: unknown, fallbackKind: AiChangeKind): AiChangeSummaryItem | null {
  if (typeof value === "string") {
    const label = value.trim();
    return label ? { kind: fallbackKind, label } : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<AiChangeSummaryItem> & {
    name?: unknown;
    path?: unknown;
    title?: unknown;
    description?: unknown;
  };
  const labelValue = typeof entry.label === "string"
    ? entry.label
    : typeof entry.name === "string"
      ? entry.name
      : typeof entry.path === "string"
        ? entry.path
        : typeof entry.title === "string"
          ? entry.title
          : typeof entry.description === "string"
            ? entry.description
            : "";
  const label = labelValue.trim();
  if (!label) {
    return null;
  }

  return {
    kind: isChangeKind(entry.kind) ? entry.kind : fallbackKind,
    label,
    detail: typeof entry.detail === "string" && entry.detail.trim() ? entry.detail.trim() : undefined,
  };
}

function normalizeChangeItems(values: unknown, fallbackKind: AiChangeKind): AiChangeSummaryItem[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((entry) => normalizeChangeItem(entry, fallbackKind))
    .filter((entry): entry is AiChangeSummaryItem => Boolean(entry));
}

function getArrayCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function normalizeChangeSummary(value: unknown): AiChangeSummary | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const summary = value as AiChangeSummaryInput & Record<string, unknown> & {
    counts?: Partial<Record<AiChangeKind, number>>;
  };
  const counts = "counts" in summary ? summary.counts : undefined;
  const addedItems = [
    ...normalizeChangeItems(summary.added, "added"),
    ...normalizeChangeItems(summary.addedItems, "added"),
    ...normalizeChangeItems(summary.addedLabels, "added"),
    ...normalizeChangeItems(summary.addedPaths, "added"),
    ...normalizeChangeItems(summary.addedNames, "added"),
  ];
  const changedItems = [
    ...normalizeChangeItems(summary.changed, "changed"),
    ...normalizeChangeItems(summary.changedItems, "changed"),
    ...normalizeChangeItems(summary.changedLabels, "changed"),
    ...normalizeChangeItems(summary.changedPaths, "changed"),
    ...normalizeChangeItems(summary.changedNames, "changed"),
  ];
  const removedItems = [
    ...normalizeChangeItems(summary.removed, "removed"),
    ...normalizeChangeItems(summary.removedItems, "removed"),
    ...normalizeChangeItems(summary.removedLabels, "removed"),
    ...normalizeChangeItems(summary.removedPaths, "removed"),
    ...normalizeChangeItems(summary.removedNames, "removed"),
  ];
  const items = [
    ...normalizeChangeItems(summary.items, "changed"),
    ...normalizeChangeItems(summary.summary, "changed"),
    ...normalizeChangeItems(summary.changes, "changed"),
    ...normalizeChangeItems(summary.entries, "changed"),
    ...normalizeChangeItems(summary.list, "changed"),
    ...normalizeChangeItems(summary.descriptions, "changed"),
    ...normalizeChangeItems(summary.labels, "changed"),
    ...normalizeChangeItems(summary.preview, "changed"),
    ...normalizeChangeItems(summary.sample, "changed"),
    ...addedItems,
    ...changedItems,
    ...removedItems,
  ].slice(0, 5);
  const added = normalizeCount(counts?.added ?? (typeof summary.added === "number" ? summary.added : getArrayCount(summary.added)) ?? addedItems.length);
  const changed = normalizeCount(counts?.changed ?? (typeof summary.changed === "number" ? summary.changed : getArrayCount(summary.changed)) ?? changedItems.length);
  const removed = normalizeCount(counts?.removed ?? (typeof summary.removed === "number" ? summary.removed : getArrayCount(summary.removed)) ?? removedItems.length);

  if (added + changed + removed === 0 && items.length === 0) {
    return undefined;
  }

  return { added, changed, removed, items };
}

function createMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getProviderInitials(provider: AiProvider): string {
  switch (provider) {
    case "openrouter":
      return "OR";
    case "local":
      return "LC";
    case "gemini":
      return "G";
    case "groq":
      return "GR";
    case "openai":
      return "AI";
  }
}

function formatMessageTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function getMessageModelLabel(message: AiChatMessage): string {
  if (message.role !== "assistant") {
    return message.model;
  }

  return message.executedModel?.trim() || "Executed model unavailable";
}

function shouldShowRawResponse(message: AiChatMessage): boolean {
  return Boolean(message.rawText)
    && (message.status === "error" || message.rawText !== message.sceneSpecJson);
}

function createChatContext(messages: AiChatMessage[]): AiChatContext | undefined {
  const readyAssistantMessages = messages.filter((message) => (
    message.role === "assistant" && (message.status === "ready" || message.status === "applied")
  ));
  const lastSceneSpecJson = [...readyAssistantMessages].reverse().find((message) => message.sceneSpecJson)?.sceneSpecJson;
  const diffSummaries = readyAssistantMessages
    .filter((message) => message.changes)
    .slice(-4)
    .map((message) => formatChangeSummary(message))
    .filter((summary) => summary.length > 0);

  if (!lastSceneSpecJson && diffSummaries.length === 0) {
    return undefined;
  }

  return {
    lastSceneSpecJson,
    diffSummaries,
  };
}

function formatChangeSummary(message: AiChatMessage): string {
  if (!message.changes) {
    return "";
  }

  const counts = `added ${message.changes.added}, changed ${message.changes.changed}, removed ${message.changes.removed}`;
  const items = message.changes.items
    .map((item) => `${item.kind}: ${item.label}${item.detail ? ` (${item.detail})` : ""}`)
    .join("; ");
  return items ? `${counts}; ${items}` : counts;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function AIGenerateDialog({ isOpen, projectId, onGenerate, onApplyScene }: AIGenerateDialogProps) {
  const initialProvider = useMemo(() => readStoredProvider(), []);
  const initialProviderOption = AI_PROVIDER_OPTIONS.find((entry) => entry.provider === initialProvider) ?? AI_PROVIDER_OPTIONS[0];
  const [provider, setProvider] = useState<AiProvider>(initialProvider);
  const selectedProvider = AI_PROVIDER_OPTIONS.find((entry) => entry.provider === provider) ?? AI_PROVIDER_OPTIONS[0];
  const [apiKey, setApiKey] = useState(() => readStoredKey(initialProvider));
  const [model, setModel] = useState(() => readStoredModel(initialProvider, initialProviderOption.defaultModel));
  const [mode, setMode] = useState<AIGenerationMode>("edit");
  const [draft, setDraft] = useState(DEFAULT_EDIT_PROMPT);
  const [localUrl, setLocalUrl] = useState(readStoredLocalUrl);
  const [shouldSaveKey, setShouldSaveKey] = useState(() => apiKey.trim().length > 0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<AiChatMessage[]>(() => readStoredMessages(projectId));
  const [copiedJsonMessageId, setCopiedJsonMessageId] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const isLocalProvider = provider === "local";
  const canSend = (isLocalProvider || apiKey.trim().length > 0)
    && draft.trim().length > 0
    && model.trim().length > 0
    && (!isLocalProvider || localUrl.trim().length > 0)
    && !isGenerating;

  useEffect(() => {
    setMessages(readStoredMessages(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const historyElement = historyRef.current;
    if (!historyElement) {
      return;
    }
    if (typeof historyElement.scrollTo === "function") {
      historyElement.scrollTo({ top: historyElement.scrollHeight });
    } else {
      historyElement.scrollTop = historyElement.scrollHeight;
    }
  }, [isOpen, messages.length, isGenerating, messages]);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    window.localStorage.setItem(getChatStorageKey(projectId), JSON.stringify(messages));
  }, [messages, projectId]);

  useEffect(() => {
    const input = composerInputRef.current;
    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, AI_COMPOSER_MAX_HEIGHT)}px`;
    input.style.overflowY = input.scrollHeight > AI_COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }, [draft, isOpen]);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
  }, []);

  function completeAssistantMessage(messageId: string, message: AiChatMessage) {
    setMessages((current) => current.map((entry) => (
      entry.id === messageId ? { ...message, id: messageId } : entry
    )));
  }

  function persistPreferences() {
    if (!canUseLocalStorage()) {
      return;
    }

    window.localStorage.setItem(AI_PROVIDER_STORAGE_KEY, provider);
    window.localStorage.setItem(getProviderModelStorageKey(provider), model.trim());
    window.localStorage.setItem(AI_LOCAL_URL_STORAGE_KEY, localUrl.trim() || DEFAULT_LOCAL_CHAT_URL);

    if (shouldSaveKey) {
      window.localStorage.setItem(getProviderKeyStorageKey(provider), apiKey.trim());
    } else {
      window.localStorage.removeItem(getProviderKeyStorageKey(provider));
    }
  }

  async function handleSubmit() {
    if (!canSend) {
      return;
    }

    persistPreferences();
    const prompt = draft.trim();
    const chatContext = createChatContext(messages);
    const userMessage: AiChatMessage = {
      id: createMessageId(),
      role: "user",
      createdAt: Date.now(),
      provider,
      model: model.trim(),
      mode,
      content: prompt,
    };
    const assistantMessageId = createMessageId();
    const pendingAssistantMessage: AiChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      createdAt: Date.now(),
      provider,
      model: model.trim(),
      mode,
      content: "",
      status: "streaming",
    };
    setMessages((current) => [...current, userMessage, pendingAssistantMessage]);
    setDraft("");
    setIsGenerating(true);

    try {
      const result = await onGenerate(
        apiKey.trim(),
        prompt,
        provider,
        model.trim(),
        mode,
        isLocalProvider ? localUrl.trim() : undefined,
        chatContext,
      );
      const assistantMessage: AiChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        createdAt: Date.now(),
        provider,
        model: model.trim(),
        executedModel: result.executedModel,
        mode,
        content: result.content,
        sceneSpecJson: result.sceneSpecJson,
        rawText: result.rawText,
        changes: normalizeChangeSummary(result.changes),
        status: "ready",
      };
      completeAssistantMessage(assistantMessageId, assistantMessage);
    } catch (error) {
      const content = error instanceof Error ? error.message : "Unable to generate a response.";
      completeAssistantMessage(assistantMessageId, {
        id: assistantMessageId,
        role: "assistant",
        createdAt: Date.now(),
        provider,
        model: model.trim(),
        executedModel: isAiBlueprintDebugError(error) ? error.executedModel : undefined,
        mode,
        content,
        rawText: isAiBlueprintDebugError(error) ? error.rawText : undefined,
        status: "error",
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleApply(message: AiChatMessage) {
    if (!message.sceneSpecJson || message.status === "applied") {
      return;
    }

    await onApplyScene(message.sceneSpecJson, message.mode);
    setMessages((current) => current.map((entry) => (
      entry.id === message.id ? { ...entry, status: "applied" } : entry
    )));
  }

  function handleProviderChange(nextProvider: AiProvider) {
    const nextOption = AI_PROVIDER_OPTIONS.find((entry) => entry.provider === nextProvider);
    const nextKey = readStoredKey(nextProvider);
    setProvider(nextProvider);
    setModel(readStoredModel(nextProvider, nextOption?.defaultModel ?? ""));
    setApiKey(nextKey);
    setShouldSaveKey(nextKey.length > 0);
  }

  if (!isOpen) {
    return null;
  }

  async function handleCopyJson(message: AiChatMessage) {
    if (!message.sceneSpecJson) {
      return;
    }

    await copyTextToClipboard(message.sceneSpecJson);
    setCopiedJsonMessageId(message.id);
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopiedJsonMessageId((current) => current === message.id ? null : current);
      copyFeedbackTimerRef.current = null;
    }, AI_COPY_FEEDBACK_MS);
  }

  return (
    <div className="ai-chat-window">
      <header className="ai-chat-header">
        <div className="ai-chat-header__avatar" aria-hidden="true">
          {getProviderInitials(provider)}
        </div>
        <div className="ai-chat-header__identity">
          <span className="ai-chat-header__name">{selectedProvider.label}</span>
          <span className="ai-chat-header__model">{model || "No model selected"}</span>
        </div>
        <div className="ai-chat-header__mode">
          {mode === "edit" ? "Editing current project" : "Creating new model"}
        </div>
        <button
          type="button"
          className={`ai-chat-header__config${isSettingsOpen ? " is-active" : ""}`}
          onClick={() => setIsSettingsOpen((value) => !value)}
          aria-expanded={isSettingsOpen}
          aria-controls="ai-settings-panel"
        >
          Config
        </button>
      </header>

      {isSettingsOpen ? (
        <section id="ai-settings-panel" className="ai-settings-panel" aria-label="AI configuration">
          <div className="ai-settings-panel__hd">
            <span>AI configuration</span>
            <span className="ai-settings-panel__meta">{`${selectedProvider.label} / ${model || "No model"}`}</span>
          </div>
          <div className="ai-dialog__grid">
            <div className="ai-mode" role="tablist" aria-label="AI generation mode">
              <button
                type="button"
                className={`ai-mode__option${mode === "edit" ? " is-active" : ""}`}
                onClick={() => {
                  setMode("edit");
                  setDraft(DEFAULT_EDIT_PROMPT);
                }}
                role="tab"
                aria-selected={mode === "edit"}
              >
                Edit Current
              </button>
              <button
                type="button"
                className={`ai-mode__option${mode === "new" ? " is-active" : ""}`}
                onClick={() => {
                  setMode("new");
                  setDraft(DEFAULT_PROMPT);
                }}
                role="tab"
                aria-selected={mode === "new"}
              >
                New Model
              </button>
            </div>

            <label className="ai-field">
              <span className="ai-field__label">Provider</span>
              <select
                className="ai-field__input"
                value={provider}
                onChange={(event) => handleProviderChange(event.target.value as AiProvider)}
              >
                {AI_PROVIDER_OPTIONS.map((entry) => (
                  <option key={entry.provider} value={entry.provider}>{entry.label}</option>
                ))}
              </select>
            </label>

            <label className="ai-field">
              <span className="ai-field__label">{selectedProvider.keyLabel}</span>
              <input
                className="ai-field__input"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={selectedProvider.keyPlaceholder}
                autoComplete="off"
              />
            </label>

            {isLocalProvider ? (
              <label className="ai-field ai-field--wide">
                <span className="ai-field__label">Local API URL</span>
                <input
                  className="ai-field__input"
                  type="url"
                  value={localUrl}
                  onChange={(event) => setLocalUrl(event.target.value)}
                  placeholder={DEFAULT_LOCAL_CHAT_URL}
                  autoComplete="off"
                />
              </label>
            ) : null}

            <label className="ai-save-key">
              <input
                type="checkbox"
                checked={shouldSaveKey}
                onChange={(event) => setShouldSaveKey(event.target.checked)}
              />
              <span>Save this API key locally on this browser</span>
            </label>

            <label className="ai-field">
              <span className="ai-field__label">Model</span>
              <input
                className="ai-field__input"
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
        </section>
      ) : null}

      <div ref={historyRef} className="ai-chat-history" aria-label="AI chat history">
        <div className="ai-chat-row ai-chat-row--assistant">
          <div className="ai-chat-message ai-chat-message--assistant">
            <div className="ai-chat-message__text">
              Tell me what to change in this project. I will return a JSON plan you can inspect and apply.
            </div>
          </div>
        </div>

        {messages.map((message) => (
          <div key={message.id} className={`ai-chat-row ai-chat-row--${message.role}`}>
            <article
              className={`ai-chat-message ai-chat-message--${message.role}${message.status === "error" ? " is-error" : ""}${message.status === "streaming" ? " is-streaming" : ""}`}
              data-status={message.status}
            >
              <div className="ai-chat-message__text">{message.content}</div>
              {message.status === "streaming" && !message.content ? (
                <div className="ai-chat-typing" aria-label="AI is typing">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              {message.changes ? (
                <section className="ai-change-summary" aria-label="Changes">
                  <div className="ai-change-summary__header">
                    <span className="ai-change-summary__title">Changes</span>
                    <span className="ai-change-summary__counts">
                      {renderChangeCount("added", message.changes.added)}
                      {renderChangeCount("changed", message.changes.changed)}
                      {renderChangeCount("removed", message.changes.removed)}
                    </span>
                  </div>
                  {message.changes.items.length > 0 ? (
                    <ul className="ai-change-summary__list">
                      {message.changes.items.map((item, index) => (
                        <li key={`${item.kind}-${item.label}-${index}`} className={`ai-change-summary__item ai-change-summary__item--${item.kind}`}>
                          <span className="ai-change-summary__item-kind">{item.kind}</span>
                          <span className="ai-change-summary__item-label">{item.label}</span>
                          {item.detail ? <span className="ai-change-summary__item-detail">{item.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}
              {message.sceneSpecJson ? (
                <details className="ai-chat-json">
                  <summary>View JSON</summary>
                  <div className="ai-chat-json__toolbar">
                    <button
                      type="button"
                      className="tbtn"
                      onClick={() => { void handleCopyJson(message); }}
                    >
                      {copiedJsonMessageId === message.id ? "Copied" : "Copy JSON"}
                    </button>
                  </div>
                  <pre>{message.sceneSpecJson}</pre>
                </details>
              ) : null}
              {shouldShowRawResponse(message) ? (
                <details className="ai-chat-json">
                  <summary>View raw response</summary>
                  <pre>{message.rawText}</pre>
                </details>
              ) : null}
              {message.sceneSpecJson ? (
                <div className="ai-chat-message__actions">
                  <button
                    type="button"
                    className="tbtn is-primary"
                    onClick={() => { void handleApply(message); }}
                    disabled={message.status === "applied"}
                  >
                    {message.status === "applied" ? "Applied" : "Apply"}
                  </button>
                </div>
              ) : null}
              <footer className="ai-chat-message__meta">
                <span>{formatMessageTime(message.createdAt)}</span>
                {message.status === "streaming" ? <span>writing</span> : null}
                {message.role === "assistant" ? <span>{AI_PROVIDER_OPTIONS.find((entry) => entry.provider === message.provider)?.label ?? message.provider}</span> : null}
                {message.role === "assistant" ? <span title={`Requested: ${message.model}`}>{getMessageModelLabel(message)}</span> : null}
              </footer>
            </article>
          </div>
        ))}

        {isGenerating && !messages.some((message) => message.status === "streaming") ? (
          <div className="ai-chat-row ai-chat-row--assistant">
            <div className="ai-chat-message ai-chat-message--assistant">
              <div className="ai-chat-status">Thinking through scene changes</div>
              <div className="ai-chat-typing" aria-label="AI is typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="ai-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <textarea
          ref={composerInputRef}
          className="ai-chat-composer__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a request..."
          rows={1}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit();
            }
          }}
          autoFocus
        />
        <button type="submit" className="ai-chat-composer__send" disabled={!canSend}>
          Send
        </button>
      </form>
    </div>
  );
}

function renderChangeCount(label: AiChangeKind, value: number) {
  return (
    <span className={`ai-change-summary__count ai-change-summary__count--${label}`}>
      <strong>{value}</strong>
      {label}
    </span>
  );
}
