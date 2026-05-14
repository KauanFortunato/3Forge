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

  const tabs: Array<{ id: SettingsTab; label: string; description: string; icon: ReactNode; disabled?: boolean }> = [
    { id: "scene", label: "Scene", description: "Lighting, exposure, shadows", icon: <GeometryIcon width={14} height={14} />, disabled: !canEditScene },
    { id: "hdr", label: "HDR Preview", description: "Material response test", icon: <MaterialIcon width={14} height={14} />, disabled: !canEditScene },
    { id: "theme", label: "Theme", description: "Editor appearance", icon: <SettingsIcon width={14} height={14} /> },
  ];

  return (
    <Modal title="Settings" isOpen={isOpen} onClose={onClose} size="wide">
      <div className="settings-dialog">
        <aside className="settings-rail">
          <div className="settings-rail__brand">
            <span className="settings-rail__brand-icon"><SettingsIcon width={15} height={15} /></span>
            <span>
              <span className="settings-rail__eyebrow">3Forge</span>
              <span className="settings-rail__title">Config</span>
            </span>
          </div>
          <div className="settings-tabs" role="tablist" aria-label="Settings sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-label={tab.label}
                aria-selected={activeTab === tab.id}
                className={`settings-tabs__button${activeTab === tab.id ? " is-active" : ""}`}
                disabled={tab.disabled}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="settings-tabs__icon" aria-hidden="true">{tab.icon}</span>
                <span className="settings-tabs__copy">
                  <span className="settings-tabs__label">{tab.label}</span>
                  <span className="settings-tabs__desc">{tab.description}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="settings-dialog__body">
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
              className={`settings-section settings-section--fill${activeTab === "hdr" ? "" : " settings-section--hidden"}`}
              aria-hidden={activeTab !== "hdr"}
            >
              <header className="settings-section__hd settings-section__hd--hero">
                <span className="settings-section__icon" aria-hidden="true"><MaterialIcon width={16} height={16} /></span>
                <span>
                  <h3 className="settings-section__title">HDR Preview</h3>
                  <p className="settings-section__sub">Orbit a live material rig before applying environment response to the scene.</p>
                </span>
              </header>

              <div className="settings-hdr-layout">
                <div className="settings-hdr-stage">
                  <div className="settings-hdr-stage__bar">
                    <span className="settings-hdr-stage__chip">Orbit preview</span>
                    <span className="settings-hdr-stage__meta">{selectedPreviewHdr?.name ?? "No HDR selected"}</span>
                  </div>
                  <HdrEnvironmentPreview
                    hdrAsset={selectedPreviewHdr}
                    intensity={hdrDraft.intensity}
                    exposure={hdrDraft.exposure}
                    toneMapping={hdrDraft.toneMapping}
                    isActive={activeTab === "hdr"}
                  />
                </div>

                <div className="settings-hdr-panel">
                  <div className="settings-hdr-panel__hd">
                    <span className="settings-control-cluster__title">Preview Controls</span>
                    <span className="settings-hdr-panel__state">{formatToneMapping(hdrDraft.toneMapping)}</span>
                  </div>
                  <label className="settings-field">
                    <span className="settings-field__label">Environment</span>
                    <select
                      className="settings-field__input"
                      value={hdrDraft.hdrAssetId ?? ""}
                      onChange={(event) => {
                        const hdrAssetId = event.currentTarget.value || null;
                        setHdrDraft((draft) => ({
                          ...draft,
                          hdrAssetId,
                        }));
                      }}
                    >
                      <option value="">None</option>
                      {hdrAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>{asset.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field__label">Env Intensity</span>
                    <input
                      className="settings-field__input"
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={hdrDraft.intensity}
                      onChange={(event) => {
                        const intensity = Number(event.currentTarget.value);
                        setHdrDraft((draft) => ({
                          ...draft,
                          intensity,
                        }));
                      }}
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field__label">Exposure</span>
                    <input
                      className="settings-field__input"
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={hdrDraft.exposure}
                      onChange={(event) => {
                        const exposure = Number(event.currentTarget.value);
                        setHdrDraft((draft) => ({
                          ...draft,
                          exposure,
                        }));
                      }}
                    />
                  </label>

                  <div className="settings-stack">
                    <span className="settings-field__label">Tone Mapping</span>
                    <ToneMappingControl
                      value={hdrDraft.toneMapping}
                      onChange={(type) => setHdrDraft((draft) => ({ ...draft, toneMapping: type }))}
                    />
                  </div>

                  <div className="settings-actions">
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
    <section className="settings-section">
      <header className="settings-section__hd settings-section__hd--hero">
        <span className="settings-section__icon" aria-hidden="true"><GeometryIcon width={16} height={16} /></span>
        <span>
          <h3 className="settings-section__title">Scene</h3>
          <p className="settings-section__sub">Viewport and exported scene defaults for lighting, tone mapping, and shadows.</p>
        </span>
      </header>

      <div className="settings-summary" aria-label="Scene settings summary">
        <span className="settings-summary__item">
          <span className="settings-summary__label">ENV</span>
          <span className="settings-summary__value">{sceneSettings.environment.type === "hdr" ? "HDR" : "None"}</span>
        </span>
        <span className="settings-summary__item">
          <span className="settings-summary__label">EXPOSURE</span>
          <span className="settings-summary__value">{sceneSettings.toneMapping.exposure.toFixed(1)}</span>
        </span>
        <span className="settings-summary__item">
          <span className="settings-summary__label">TONE</span>
          <span className="settings-summary__value">{formatToneMapping(sceneSettings.toneMapping.type)}</span>
        </span>
        <span className="settings-summary__item">
          <span className="settings-summary__label">SHADOWS</span>
          <span className="settings-summary__value">{sceneSettings.shadows.enabled ? sceneSettings.shadows.type : "Off"}</span>
        </span>
      </div>

      <div className="settings-control-cluster">
        <div className="settings-control-cluster__hd">
          <span className="settings-control-cluster__title">Environment</span>
          {onImportHdr ? (
            <button type="button" className="tbtn" onClick={onImportHdr}>
              Import HDR
            </button>
          ) : null}
        </div>
        <div className="settings-grid settings-grid--environment">
        <label className="settings-field">
          <span className="settings-field__label">Environment</span>
          <select
            className="settings-field__input"
            value={sceneSettings.environment.type === "hdr" ? sceneSettings.environment.hdrAssetId ?? "" : ""}
            onChange={(event) => {
              const hdrAssetId = event.currentTarget.value || null;
              onChangeSceneSettings({
                environment: {
                  type: hdrAssetId ? "hdr" : "none",
                  hdrAssetId,
                },
              });
            }}
          >
            <option value="">None</option>
            {hdrAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.name}</option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Env Intensity</span>
          <input
            className="settings-field__input"
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={sceneSettings.environment.intensity}
            onChange={(event) => onChangeSceneSettings({ environment: { intensity: Number(event.currentTarget.value) } })}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Background</span>
          <input
            className="settings-field__input settings-field__input--color"
            type="color"
            value={sceneSettings.backgroundColor}
            onChange={(event) => onChangeSceneSettings({ backgroundColor: event.currentTarget.value })}
          />
        </label>
        </div>
      </div>

      <div className="settings-control-cluster">
        <div className="settings-control-cluster__hd">
          <span className="settings-control-cluster__title">Lighting</span>
        </div>
        <div className="settings-grid">
        <label className="settings-field">
          <span className="settings-field__label">Ambient</span>
          <input
            className="settings-field__input"
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={sceneSettings.lighting.ambientIntensity}
            onChange={(event) => onChangeSceneSettings({ lighting: { ambientIntensity: Number(event.currentTarget.value) } })}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">Key Light</span>
          <input
            className="settings-field__input"
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

      <div className="settings-control-cluster">
        <div className="settings-control-cluster__hd">
          <span className="settings-control-cluster__title">Render Response</span>
        </div>
        <div className="settings-grid settings-grid--render">
          <label className="settings-field">
            <span className="settings-field__label">Exposure</span>
            <input
              className="settings-field__input"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={sceneSettings.toneMapping.exposure}
              onChange={(event) => onChangeSceneSettings({ toneMapping: { exposure: Number(event.currentTarget.value) } })}
            />
          </label>
          <div className="settings-stack settings-stack--span">
            <span className="settings-field__label">Tone Mapping</span>
            <ToneMappingControl
              value={sceneSettings.toneMapping.type}
              onChange={(type) => onChangeSceneSettings({ toneMapping: { type } })}
            />
          </div>
          <div className="settings-stack settings-stack--span">
            <span className="settings-field__label">Shadow Type</span>
            <div className="settings-row settings-row--compact">
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={sceneSettings.shadows.enabled}
                  onChange={(event) => onChangeSceneSettings({ shadows: { enabled: event.currentTarget.checked } })}
                />
                <span>Shadows</span>
              </label>
              <div className="settings-segmented" aria-label="Shadow Type">
                {[
                  ["basic", "Basic"],
                  ["pcf", "PCF"],
                  ["pcfSoft", "Soft"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`settings-segmented__button${sceneSettings.shadows.type === value ? " is-active" : ""}`}
                    onClick={() => onChangeSceneSettings({ shadows: { type: value as SceneSettings["shadows"]["type"] } })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ThemeSettingsPanel({ theme, onChangeTheme }: { theme: ThemeId; onChangeTheme: (theme: ThemeId) => void }) {
  return (
    <section className="settings-section">
      <header className="settings-section__hd settings-section__hd--hero">
        <span className="settings-section__icon" aria-hidden="true"><SettingsIcon width={16} height={16} /></span>
        <span>
          <h3 className="settings-section__title">Theme</h3>
          <p className="settings-section__sub">Pick how the editor looks. Your choice is saved on this device.</p>
        </span>
      </header>

      <div className="settings-theme-grid">
        {THEME_PRESETS.map((preset) => {
          const isActive = preset.id === theme;
          return (
            <button
              key={preset.id}
              type="button"
              className={`settings-theme-tile${isActive ? " is-active" : ""}`}
              onClick={() => onChangeTheme(preset.id)}
              aria-pressed={isActive}
              aria-label={`Use ${preset.label} theme`}
              title={preset.label}
            >
              <span
                className="settings-theme-tile__preview"
                aria-hidden="true"
                style={{ background: preset.preview.bg }}
              >
                <span
                  className="settings-theme-tile__chip"
                  style={{ background: preset.preview.surface, borderColor: preset.preview.surface }}
                >
                  <span
                    className="settings-theme-tile__bar"
                    style={{ background: preset.preview.text, opacity: 0.18 }}
                  />
                  <span
                    className="settings-theme-tile__bar settings-theme-tile__bar--short"
                    style={{ background: preset.preview.text, opacity: 0.32 }}
                  />
                  <span
                    className="settings-theme-tile__dot"
                    style={{ background: preset.preview.accent }}
                  />
                </span>
              </span>
              <span className="settings-theme-tile__meta">
                <span className="settings-theme-tile__label">{preset.label}</span>
                <span className="settings-theme-tile__desc">{preset.description}</span>
              </span>
              {isActive ? <span className="settings-theme-tile__active" aria-hidden="true">●</span> : null}
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

function ToneMappingControl({
  value,
  onChange,
}: {
  value: SceneSettings["toneMapping"]["type"];
  onChange: (value: SceneSettings["toneMapping"]["type"]) => void;
}) {
  return (
    <div className="settings-segmented" aria-label="Tone Mapping">
      {[
        ["none", "None"],
        ["linear", "Linear"],
        ["acesFilmic", "ACES"],
      ].map(([toneMapping, label]) => (
        <button
          key={toneMapping}
          type="button"
          className={`settings-segmented__button${value === toneMapping ? " is-active" : ""}`}
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
