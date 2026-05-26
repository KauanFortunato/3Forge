import {
  FastForwardIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  SkipBackIcon,
  SkipForwardIcon,
  StopIcon,
} from "./icons";

export interface PlaybackToolbarProps {
  isPlaying: boolean;
  currentFrame: number;
  durationFrames: number;
  onPlayToggle: () => void;
  onStop: () => void;
  onRewind: () => void;
  onFastForward: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
}

export function PlaybarGroup(props: PlaybackToolbarProps) {
  const {
    isPlaying,
    currentFrame,
    durationFrames,
    onPlayToggle,
    onStop,
    onRewind,
    onFastForward,
    onSkipBack,
    onSkipForward,
  } = props;

  return (
    <div className="playbar" role="group" aria-label="Playback controls">
      <button
        type="button"
        className="ibtn"
        onClick={onSkipBack}
        aria-label="Skip to start"
        title="Skip to start"
      >
        <SkipBackIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className="ibtn"
        onClick={onRewind}
        aria-label="Rewind"
        title="Rewind"
      >
        <RewindIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className={`ibtn${isPlaying ? " is-active" : ""}`}
        onClick={onPlayToggle}
        aria-label={isPlaying ? "Pause" : "Play"}
        aria-pressed={isPlaying}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <PauseIcon width={12} height={12} /> : <PlayIcon width={12} height={12} />}
      </button>
      <button
        type="button"
        className="ibtn playbar__btn--danger"
        onClick={onStop}
        aria-label="Stop"
        title="Stop"
      >
        <StopIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className="ibtn"
        onClick={onFastForward}
        aria-label="Fast forward"
        title="Fast forward"
      >
        <FastForwardIcon width={12} height={12} />
      </button>
      <button
        type="button"
        className="ibtn"
        onClick={onSkipForward}
        aria-label="Skip to end"
        title="Skip to end"
      >
        <SkipForwardIcon width={12} height={12} />
      </button>
      <span className="playbar__sep" aria-hidden="true" />
      <span className="playbar__frame" aria-label="Current frame">
        <strong>{String(currentFrame).padStart(3, "0")}</strong>
        <span className="playbar__counter-sep">/</span>
        <span>{String(durationFrames).padStart(3, "0")}</span>
      </span>
    </div>
  );
}
