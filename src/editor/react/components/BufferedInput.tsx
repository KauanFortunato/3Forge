import { useEffect, useRef, useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent } from "react";

interface BufferedInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onCommit: (value: string) => void;
  /**
   * Bump this number to imperatively focus the input (e.g. right after a new
   * project is created so the user can immediately name it). The initial value
   * `0`/`undefined` is ignored so the field is not stolen on first mount.
   */
  focusSignal?: number;
  /** When true, the text is selected (not just focused) on a focus signal. */
  selectOnFocusSignal?: boolean;
}

export function BufferedInput({
  value,
  onCommit,
  focusSignal,
  selectOnFocusSignal = false,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}: BufferedInputProps) {
  const [draft, setDraft] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isFocused) {
      setDraft(value);
    }
  }, [isFocused, value]);

  useEffect(() => {
    if (!focusSignal) {
      return;
    }

    const input = inputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    if (selectOnFocusSignal) {
      input.select();
    }
  }, [focusSignal, selectOnFocusSignal]);

  const handleCommit = () => {
    setIsFocused(false);
    onCommit(draft);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      setDraft(value);
      event.currentTarget.blur();
      return;
    }

    onKeyDown?.(event);
  };

  return (
    <input
      {...props}
      ref={inputRef}
      value={draft}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        handleCommit();
        onBlur?.(event);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
