import { useCallback, useEffect, useRef, useState } from "react";

interface IntroSplashProps {
  /** Called once the splash has fully faded out (mount the app behind it meanwhile). */
  onFinish: () => void;
}

// The logo SVG's own keyframes settle at ~1.8s; hold a touch longer, then fade.
const HOLD_MS = 2500;
const REDUCED_HOLD_MS = 600;
const FADE_MS = 450;
const SKIP_FADE_MS = 260;

/**
 * App-opening splash: plays the animated 3Forge logo over a dark, faintly
 * glowing backdrop, then fades to reveal the app. Auto-dismisses when the logo
 * animation finishes and can be skipped with a click/tap. Honors
 * `prefers-reduced-motion` by holding only briefly.
 */
export function IntroSplash({ onFinish }: IntroSplashProps) {
  const [leaving, setLeaving] = useState(false);
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    onFinish();
  }, [onFinish]);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const holdMs = reduceMotion ? REDUCED_HOLD_MS : HOLD_MS;
    const holdTimer = window.setTimeout(() => setLeaving(true), holdMs);
    const doneTimer = window.setTimeout(finish, holdMs + FADE_MS);
    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(doneTimer);
    };
  }, [finish]);

  const handleSkip = useCallback(() => {
    if (finishedRef.current) {
      return;
    }
    setLeaving(true);
    window.setTimeout(finish, SKIP_FADE_MS);
  }, [finish]);

  return (
    <div
      className={`intro-splash${leaving ? " is-leaving" : ""}`}
      role="presentation"
      aria-hidden="true"
      onClick={handleSkip}
    >
      <div className="intro-splash__glow" />
      <img
        className="intro-splash__logo"
        src="/assets/web/logo_anim.svg"
        alt="3Forge"
        draggable={false}
      />
    </div>
  );
}
