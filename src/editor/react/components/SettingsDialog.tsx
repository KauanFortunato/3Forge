import { Modal } from "./Modal";
import { THEME_PRESETS } from "../hooks/useTheme";
import type { ThemeId } from "../hooks/useTheme";
import type { SceneCanvasSize, SceneMode, SceneSettings } from "../../types";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeId;
  onChangeTheme: (theme: ThemeId) => void;
  sceneSettings?: SceneSettings;
  onChangeSceneSettings?: (patch: {
    backgroundColor?: string;
    mode?: SceneMode;
    canvas?: Partial<SceneCanvasSize>;
    lighting?: Partial<SceneSettings["lighting"]>;
    toneMapping?: Partial<SceneSettings["toneMapping"]>;
    shadows?: Partial<SceneSettings["shadows"]>;
  }) => void;
}

export function SettingsDialog({ isOpen, onClose, theme, onChangeTheme, sceneSettings, onChangeSceneSettings }: SettingsDialogProps) {
  return (
    <Modal title="Settings" isOpen={isOpen} onClose={onClose}>
      {sceneSettings && onChangeSceneSettings ? (
        <section className="settings-section">
          <header className="settings-section__hd">
            <h3 className="settings-section__title">Scene</h3>
            <p className="settings-section__sub">Viewport and exported scene defaults for lighting, tone mapping, and shadows.</p>
          </header>

          <div className="settings-grid">
            <label className="settings-field">
              <span className="settings-field__label">Background</span>
              <input
                className="settings-field__input settings-field__input--color"
                type="color"
                value={sceneSettings.backgroundColor}
                onChange={(event) => onChangeSceneSettings({ backgroundColor: event.currentTarget.value })}
              />
            </label>
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
          </div>

          <div className="settings-row">
            <span className="settings-field__label">Camera</span>
            <div className="settings-segmented" aria-label="Camera projection">
              {[
                ["2d", "Orthographic"],
                ["3d", "Perspective"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`settings-segmented__button${sceneSettings.mode === value ? " is-active" : ""}`}
                  onClick={() => onChangeSceneSettings({ mode: value as SceneMode })}
                  title={value === "2d"
                    ? "Locked centered camera, no zoom or pan, scene letterboxed to canvas aspect"
                    : "Free perspective camera with orbit/zoom"}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-grid">
            <label className="settings-field">
              <span className="settings-field__label">Canvas width</span>
              <input
                className="settings-field__input"
                type="number"
                min={1}
                step={1}
                value={sceneSettings.canvas.width}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next) && next >= 1) {
                    onChangeSceneSettings({ canvas: { width: Math.round(next) } });
                  }
                }}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field__label">Canvas height</span>
              <input
                className="settings-field__input"
                type="number"
                min={1}
                step={1}
                value={sceneSettings.canvas.height}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next) && next >= 1) {
                    onChangeSceneSettings({ canvas: { height: Math.round(next) } });
                  }
                }}
              />
            </label>
          </div>

          <div className="settings-row">
            <span className="settings-field__label">Tone Mapping</span>
            <div className="settings-segmented" aria-label="Tone Mapping">
              {[
                ["none", "None"],
                ["linear", "Linear"],
                ["acesFilmic", "ACES"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`settings-segmented__button${sceneSettings.toneMapping.type === value ? " is-active" : ""}`}
                  onClick={() => onChangeSceneSettings({ toneMapping: { type: value as SceneSettings["toneMapping"]["type"] } })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
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
        </section>
      ) : null}

      <section className="settings-section">
        <header className="settings-section__hd">
          <h3 className="settings-section__title">Theme</h3>
          <p className="settings-section__sub">Pick how the editor looks. Your choice is saved on this device.</p>
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
    </Modal>
  );
}
