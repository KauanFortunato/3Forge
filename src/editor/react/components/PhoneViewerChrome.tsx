import type { ChangeEvent } from "react";
import type { AnimationClip, ViewMode } from "../../types";
import { FrameIcon, ViewRenderedIcon, ViewSolidIcon } from "./icons";

interface PhoneViewerHeaderProps {
  projectName: string;
  sourceLabel: string;
  viewMode: ViewMode;
  onFrame: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onExit: () => void;
}

export function PhoneViewerHeader({
  projectName,
  sourceLabel,
  viewMode,
  onFrame,
  onViewModeChange,
  onExit,
}: PhoneViewerHeaderProps) {
  return (
    <section className="phone-header">
      <div className="phone-header__meta">
        <p className="phone-header__eyebrow">Phone viewer</p>
        <h1 className="phone-header__title">{projectName}</h1>
        <p className="phone-header__subtitle">{sourceLabel}</p>
      </div>

      <div className="phone-header__actions">
        <button
          type="button"
          className="ibtn"
          onClick={onFrame}
          aria-label="Frame selection"
          title="Frame selection"
        >
          <FrameIcon width={13} height={13} />
        </button>

        <div className="tgroup">
          <button
            type="button"
            className={`ibtn${viewMode === "solid" ? " is-active" : ""}`}
            onClick={() => onViewModeChange("solid")}
            aria-label="Solid view"
            title="Solid view"
          >
            <ViewSolidIcon width={13} height={13} />
          </button>
          <button
            type="button"
            className={`ibtn${viewMode === "rendered" ? " is-active" : ""}`}
            onClick={() => onViewModeChange("rendered")}
            aria-label="Rendered view"
            title="Rendered view"
          >
            <ViewRenderedIcon width={13} height={13} />
          </button>
        </div>

        <button
          type="button"
          className="tbtn is-ghost"
          onClick={onExit}
          aria-label="Exit project"
        >
          Exit
        </button>
      </div>
    </section>
  );
}

interface PhonePlaybackBarProps {
  clips: AnimationClip[];
  activeClipId: string | null;
  currentFrame: number;
  isPlaying: boolean;
  onSelectClip: (clipId: string) => void;
  onPlayToggle: () => void;
  onStop: () => void;
  onFrameChange: (frame: number) => void;
}

export function PhonePlaybackBar({
  clips,
  activeClipId,
  currentFrame,
  isPlaying,
  onSelectClip,
  onPlayToggle,
  onStop,
  onFrameChange,
}: PhonePlaybackBarProps) {
  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? clips[0] ?? null;
  const durationFrames = activeClip?.durationFrames ?? 0;

  if (!activeClip) {
    return (
      <section className="phone-playback">
        <div className="phone-playback__meta">
          <p className="phone-playback__eyebrow">Animation</p>
          <p className="phone-playback__empty">
            No animation clips. Use tablet or desktop to author timelines.
          </p>
        </div>
      </section>
    );
  }

  const handleFrameInput = (event: ChangeEvent<HTMLInputElement>) => {
    onFrameChange(Number(event.currentTarget.value));
  };

  return (
    <section className="phone-playback">
      <div className="phone-playback__top">
        <div className="phone-playback__meta">
          <p className="phone-playback__eyebrow">Animation</p>
          <select
            className="phone-playback__clip"
            value={activeClip.id}
            onChange={(event) => onSelectClip(event.currentTarget.value)}
            aria-label="Animation clip"
          >
            {clips.map((clip) => (
              <option key={clip.id} value={clip.id}>{clip.name}</option>
            ))}
          </select>
        </div>

        <div className="phone-playback__controls">
          <button
            type="button"
            className={`tbtn is-ghost${isPlaying ? " is-primary" : ""}`}
            onClick={onPlayToggle}
            aria-label={isPlaying ? "Pause animation" : "Play animation"}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="tbtn is-ghost"
            onClick={onStop}
            aria-label="Stop animation"
          >
            Stop
          </button>
        </div>
      </div>

      <div className="phone-playback__scrubber">
        <span className="phone-playback__frame-label">0f</span>
        <input
          className="phone-playback__slider"
          type="range"
          min={0}
          max={Math.max(durationFrames, 0)}
          step={1}
          value={Math.min(currentFrame, Math.max(durationFrames, 0))}
          onChange={handleFrameInput}
          aria-label="Animation progress"
        />
        <span className="phone-playback__frame-label">{`${Math.min(currentFrame, durationFrames)}f / ${durationFrames}f`}</span>
      </div>
    </section>
  );
}
