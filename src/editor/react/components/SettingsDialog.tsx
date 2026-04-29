import { Modal } from "./Modal";
import { THEME_PRESETS } from "../hooks/useTheme";
import type { ThemeId } from "../hooks/useTheme";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeId;
  onChangeTheme: (theme: ThemeId) => void;
}

export function SettingsDialog({ isOpen, onClose, theme, onChangeTheme }: SettingsDialogProps) {
  return (
    <Modal title="Settings" isOpen={isOpen} onClose={onClose}>
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
