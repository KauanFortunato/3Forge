import { useEffect, useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent } from "react";

interface BufferedInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onCommit: (value: string) => void;
}

export function BufferedInput({ value, onCommit, onBlur, onFocus, onKeyDown, ...props }: BufferedInputProps) {
  const [draft, setDraft] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(value);
    }
  }, [isFocused, value]);

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
