import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { HdrEnvironmentPreview } from "./HdrEnvironmentPreview";
import { GeometryIcon, MaterialIcon, SettingsIcon } from "./icons";
import { Modal } from "./Modal";
import { THEME_PRESETS } from "../hooks/useTheme";
import type { ThemeId } from "../hooks/useTheme";
import type { HdrAsset, SceneSettings } from "../../types";

type SettingsTab = "scene" | "hdr" | "theme";

interface HdrPreviewDraft {
  hdrAssetId: string | null;
  intensity: number;
  exposure: number;
  toneMapping: SceneSettings["toneMapping"]["type"];
}

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeId;
  onChangeTheme: (theme: ThemeId) => void;
  sceneSettings?: SceneSettings;
  hdrAssets?: HdrAsset[];
  onImportHdr?: () => void;
  onChangeSceneSettings?: (patch: {
    backgroundColor?: string;
    environment?: Partial<SceneSettings["environment"]>;
    lighting?: Partial<SceneSettings["lighting"]>;
    toneMapping?: Partial<SceneSettings["toneMapping"]>;
    shadows?: Partial<SceneSettings["shadows"]>;
  }) => void;
}

export function SettingsDialog({
  isOpen,
  onClose,
  theme,
  onChangeTheme,
  sceneSettings,
  hdrAssets = [],
  onImportHdr,
  onChangeSceneSettings,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("scene");
  const [hdrDraft, setHdrDraft] = useState<HdrPreviewDraft>(() => createHdrDraft(sceneSettings));
  const [hasOpenedHdrPreview, setHasOpenedHdrPreview] = useState(false);
  const wasOpenRef = useRef(false);
  const canEditScene = Boolean(sceneSettings && onChangeSceneSettings);
  const selectedPreviewHdr = useMemo(
    () => hdrAssets.find((asset) => asset.id === hdrDraft.hdrAssetId) ?? null,
    [hdrAssets, hdrDraft.hdrAssetId],
  );

  useEffect(() => {
    const didOpen = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (didOpen) {
      setActiveTab(sceneSettings && onChangeSceneSettings ? "scene" : "theme");
      setHasOpenedHdrPreview(false);
    }
  }, [isOpen, onChangeSceneSettings, sceneSettings]);

  useEffect(() => {
    if (activeTab === "hdr") {
      setHasOpenedHdrPreview(true);
    }
  }, [activeTab]);

  useEffect(() => {
    if (isOpen) {
      setHdrDraft(createHdrDraft(sceneSettings));
    }
  }, [isOpen, sceneSettings]);

  const applyHdrPreviewToScene = () => {
    if (!onChangeSceneSettings) {
      return;
    }

    onChangeSceneSettings({
      environment: {
        type: hdrDraft.hdrAssetId ? "hdr" : "none",
        hdrAssetId: hdrDraft.hdrAssetId,
        intensity: hdrDraft.intensity,
      },
      toneMapping: {
        type: hdrDraft.toneMapping,
        exposure: hdrDraft.exposure,
      },
    });
  };

  const tabs: Array<{ id: SettingsTab; label: string; icon: ReactNode; disabled?: boolean }> = [
    { id: "scene", label: "Scene", icon: <GeometryIcon width={14} height={14} />, disabled: !canEditScene },
    { id: "hdr", label: "HDR Preview", icon: <MaterialIcon width={14} height={14} />, disabled: !canEditScene },
    { id: "theme", label: "Theme", icon: <SettingsIcon width={14} height={14} /> },
  ];

  return (
    <Modal title="Settings" isOpen={isOpen} onClose={onClose} size="wide">
      <div className="set">
        <nav className="set-nav" role="tablist" aria-label="Settings sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-label={tab.label}
              aria-selected={activeTab === tab.id}
              className={`set-nav__item${activeTab === tab.id ? " is-active" : ""}`}
              disabled={tab.disabled}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="set-nav__icon" aria-hidden="true">{tab.icon}</span>
              <span className="set-nav__label">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="set-body">
          {activeTab === "scene" && sceneSettings && onChangeSceneSettings ? (
            <SceneSettingsPanel
              sceneSettings={sceneSettings}
              hdrAssets={hdrAssets}
              onImportHdr={onImportHdr}
              onChangeSceneSettings={onChangeSceneSettings}
            />
          ) : null}

          {hasOpenedHdrPreview && sceneSettings && onChangeSceneSettings ? (
            <section
              className={`set-panel set-panel--fill${activeTab === "hdr" ? "" : " set-panel--hidden"}`}
              aria-hidden={activeTab !== "hdr"}
            >
              <header className="set-panel__hd">
                <h3 className="set-panel__title">HDR Preview</h3>
                <p className="set-panel__sub">Orbit a live material rig before applying the environment response to the scene.</p>
              </header>

              <div className="set-hdr">
                <div className="set-hdr__stage">
                  <div className="set-hdr__bar">
                    <span className="set-hdr__chip">Orbit preview</span>
                    <span className="set-hdr__meta">{selectedPreviewHdr?.name ?? "No HDR selected"}</span>
                  </div>
                  <HdrEnvironmentPreview
                    hdrAsset={selectedPreviewHdr}
                    intensity={hdrDraft.intensity}
                    exposure={hdrDraft.exposure}
                    toneMapping={hdrDraft.toneMapping}
                    isActive={activeTab === "hdr"}
                  />
                </div>

                <div className="set-group set-hdr__controls">
                  <div className="set-group__hd">
                    <span className="set-group__title">Preview</span>
                    <span className="set-group__note">{formatToneMapping(hdrDraft.toneMapping)}</span>
                  </div>
                  <div className="set-rows">
                    <label className="set-row">
                      <span className="set-row__label">Environment</span>
                      <select
                        className="set-input"
                        value={hdrDraft.hdrAssetId ?? ""}
                        onChange={(event) => {
                          const hdrAssetId = event.currentTarget.value || null;
                          setHdrDraft((draft) => ({ ...draft, hdrAssetId }));
                        }}
                      >
                        <option value="">None</option>
                        {hdrAssets.map((asset) => (
                          <option key={asset.id} value={asset.id}>{asset.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="set-row">
                      <span className="set-row__label">Env Intensity</span>
                      <input
                        className="set-input set-input--num"
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        value={hdrDraft.intensity}
                        onChange={(event) => {
                          const intensity = Number(event.currentTarget.value);
                          setHdrDraft((draft) => ({ ...draft, intensity }));
                        }}
                      />
                    </label>

                    <label className="set-row">
                      <span className="set-row__label">Exposure</span>
                      <input
                        className="set-input set-input--num"
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        value={hdrDraft.exposure}
                        onChange={(event) => {
                          const exposure = Number(event.currentTarget.value);
                          setHdrDraft((draft) => ({ ...draft, exposure }));
                        }}
                      />
                    </label>

                    <div className="set-row set-row--stack">
                      <span className="set-row__label">Tone Mapping</span>
                      <ToneMappingControl
                        value={hdrDraft.toneMapping}
                        onChange={(type) => setHdrDraft((draft) => ({ ...draft, toneMapping: type }))}
                      />
                    </div>
                  </div>

                  <div className="set-actions">
                    {onImportHdr ? (
                      <button type="button" className="tbtn" onClick={onImportHdr}>
                        Import HDR
                      </button>
                    ) : null}
                    <button type="button" className="tbtn is-primary" onClick={applyHdrPreviewToScene}>
                      Apply to Scene
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "theme" ? (
            <ThemeSettingsPanel theme={theme} onChangeTheme={onChangeTheme} />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function SceneSettingsPanel({
  sceneSettings,
  hdrAssets,
  onImportHdr,
  onChangeSceneSettings,
}: {
  sceneSettings: SceneSettings;
  hdrAssets: HdrAsset[];
  onImportHdr?: () => void;
  onChangeSceneSettings: NonNullable<SettingsDialogProps["onChangeSceneSettings"]>;
}) {
  return (
    <section className="set-panel">
      <header className="set-panel__hd">
        <h3 className="set-panel__title">Scene</h3>
        <p className="set-panel__sub">Lighting, tone mapping and shadow defaults for the viewport and exports.</p>
      </header>

      <div className="set-group">
        <div className="set-group__hd">
          <span className="set-group__title">Environment</span>
          {onImportHdr ? (
            <button type="button" className="set-link" onClick={onImportHdr}>
              Import HDR
            </button>
          ) : null}
        </div>
        <div className="set-rows">
          <label className="set-row">
            <span className="set-row__label">Environment</span>
            <select
              className="set-input"
              value={getEnvironmentSelectValue(sceneSettings)}
              onChange={(event) => {
                onChangeSceneSettings({ environment: parseEnvironmentSelectValue(event.currentTarget.value) });
              }}
            >
              <option value="none">None</option>
              <option value="default">Default</option>
              {hdrAssets.map((asset) => (
                <option key={asset.id} value={`hdr:${asset.id}`}>{asset.name}</option>
              ))}
            </select>
          </label>

          <label className="set-row">
            <span className="set-row__label">Env Intensity</span>
            <input
              className="set-input set-input--num"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={sceneSettings.environment.intensity}
              onChange={(event) => onChangeSceneSettings({ environment: { intensity: Number(event.currentTarget.value) } })}
            />
          </label>

          <label className="set-row">
            <span className="set-row__label">Background</span>
            <input
              className="set-input set-input--color"
              type="color"
              value={sceneSettings.backgroundColor}
              onChange={(event) => onChangeSceneSettings({ backgroundColor: event.currentTarget.value })}
            />
          </label>
        </div>
      </div>

      <div className="set-group">
        <div className="set-group__hd">
          <span className="set-group__title">Lighting</span>
        </div>
        <div className="set-rows">
          <label className="set-row">
            <span className="set-row__label">Ambient</span>
            <input
              className="set-input set-input--num"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={sceneSettings.lighting.ambientIntensity}
              onChange={(event) => onChangeSceneSettings({ lighting: { ambientIntensity: Number(event.currentTarget.value) } })}
            />
          </label>

          <label className="set-row">
            <span className="set-row__label">Key Light</span>
            <input
              className="set-input set-input--num"
              type="number"
              min={0}
              max={20}
              step={0.1}
              value={sceneSettings.lighting.directionalIntensity}
              onChange={(event) => onChangeSceneSettings({ lighting: { directionalIntensity: Number(event.currentTarget.value) } })}
            />
          </label>
        </div>
      </div>

      <div className="set-group">
        <div className="set-group__hd">
          <span className="set-group__title">Render</span>
        </div>
        <div className="set-rows">
          <label className="set-row">
            <span className="set-row__label">Exposure</span>
            <input
              className="set-input set-input--num"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={sceneSettings.toneMapping.exposure}
              onChange={(event) => onChangeSceneSettings({ toneMapping: { exposure: Number(event.currentTarget.value) } })}
            />
          </label>

          <div className="set-row set-row--stack">
            <span className="set-row__label">Tone Mapping</span>
            <ToneMappingControl
              value={sceneSettings.toneMapping.type}
              onChange={(type) => onChangeSceneSettings({ toneMapping: { type } })}
            />
          </div>

          <div className="set-row set-row--split">
            <label className="set-toggle">
              <input
                type="checkbox"
                checked={sceneSettings.shadows.enabled}
                onChange={(event) => onChangeSceneSettings({ shadows: { enabled: event.currentTarget.checked } })}
              />
              <span>Shadows</span>
            </label>
            <div className="set-segmented" aria-label="Shadow Type">
              {[
                ["basic", "Basic"],
                ["pcf", "PCF"],
                ["pcfSoft", "Soft"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`set-segmented__button${sceneSettings.shadows.type === value ? " is-active" : ""}`}
                  disabled={!sceneSettings.shadows.enabled}
                  onClick={() => onChangeSceneSettings({ shadows: { type: value as SceneSettings["shadows"]["type"] } })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ThemeSettingsPanel({ theme, onChangeTheme }: { theme: ThemeId; onChangeTheme: (theme: ThemeId) => void }) {
  return (
    <section className="set-panel">
      <header className="set-panel__hd">
        <h3 className="set-panel__title">Theme</h3>
        <p className="set-panel__sub">Pick how the editor looks. Your choice is saved on this device.</p>
      </header>

      <div className="set-theme-grid">
        {THEME_PRESETS.map((preset) => {
          const isActive = preset.id === theme;
          return (
            <button
              key={preset.id}
              type="button"
              className={`set-theme${isActive ? " is-active" : ""}`}
              onClick={() => onChangeTheme(preset.id)}
              aria-pressed={isActive}
              aria-label={`Use ${preset.label} theme`}
              title={preset.label}
            >
              <span
                className="set-theme__preview"
                aria-hidden="true"
                style={{ background: preset.preview.bg }}
              >
                <span
                  className="set-theme__chip"
                  style={{ background: preset.preview.surface, borderColor: preset.preview.surface }}
                >
                  <span className="set-theme__bar" style={{ background: preset.preview.text, opacity: 0.18 }} />
                  <span className="set-theme__bar set-theme__bar--short" style={{ background: preset.preview.text, opacity: 0.32 }} />
                  <span className="set-theme__dot" style={{ background: preset.preview.accent }} />
                </span>
              </span>
              <span className="set-theme__meta">
                <span className="set-theme__label">{preset.label}</span>
                <span className="set-theme__desc">{preset.description}</span>
              </span>
              {isActive ? <span className="set-theme__active" aria-hidden="true">●</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function formatToneMapping(type: SceneSettings["toneMapping"]["type"]): string {
  switch (type) {
    case "acesFilmic":
      return "ACES";
    case "linear":
      return "Linear";
    default:
      return "None";
  }
}

function getEnvironmentSelectValue(sceneSettings: SceneSettings): string {
  if (sceneSettings.environment.type === "default") {
    return "default";
  }
  if (sceneSettings.environment.type === "hdr" && sceneSettings.environment.hdrAssetId) {
    return `hdr:${sceneSettings.environment.hdrAssetId}`;
  }
  return "none";
}

function parseEnvironmentSelectValue(value: string): Partial<SceneSettings["environment"]> {
  if (value === "default") {
    return { type: "default", hdrAssetId: null };
  }
  if (value.startsWith("hdr:")) {
    const hdrAssetId = value.slice(4) || null;
    return {
      type: hdrAssetId ? "hdr" : "none",
      hdrAssetId,
    };
  }
  return { type: "none", hdrAssetId: null };
}

function ToneMappingControl({
  value,
  onChange,
}: {
  value: SceneSettings["toneMapping"]["type"];
  onChange: (value: SceneSettings["toneMapping"]["type"]) => void;
}) {
  return (
    <div className="set-segmented" aria-label="Tone Mapping">
      {[
        ["none", "None"],
        ["linear", "Linear"],
        ["acesFilmic", "ACES"],
      ].map(([toneMapping, label]) => (
        <button
          key={toneMapping}
          type="button"
          className={`set-segmented__button${value === toneMapping ? " is-active" : ""}`}
          onClick={() => onChange(toneMapping as SceneSettings["toneMapping"]["type"])}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function createHdrDraft(sceneSettings: SceneSettings | undefined): HdrPreviewDraft {
  return {
    hdrAssetId: sceneSettings?.environment.type === "hdr" ? sceneSettings.environment.hdrAssetId : null,
    intensity: sceneSettings?.environment.intensity ?? 1,
    exposure: sceneSettings?.toneMapping.exposure ?? 1,
    toneMapping: sceneSettings?.toneMapping.type ?? "acesFilmic",
  };
}
