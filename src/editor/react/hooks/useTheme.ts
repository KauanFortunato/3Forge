import { useCallback, useEffect, useState } from "react";

export type ThemeId = "dark" | "light" | "midnight";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  preview: { bg: string; surface: string; text: string; accent: string };
}

export const THEME_PRESETS: ThemeMeta[] = [
  {
    id: "dark",
    label: "Dark",
    description: "The classic studio look",
    preview: { bg: "#0e0f11", surface: "#1a1c20", text: "#e8eaee", accent: "#8b5cf6" },
  },
  {
    id: "light",
    label: "Light",
    description: "Clean and bright",
    preview: { bg: "#f5f6f8", surface: "#ffffff", text: "#1a1c20", accent: "#8b5cf6" },
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep blue night mode",
    preview: { bg: "#0a0d18", surface: "#141a2c", text: "#e6ecff", accent: "#8b5cf6" },
  },
];

const THEME_KEY = "3forge-theme";
const DEFAULT_THEME: ThemeId = "dark";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredTheme(): ThemeId {
  if (!canUseStorage()) {
    return DEFAULT_THEME;
  }
  const raw = window.localStorage.getItem(THEME_KEY);
  if (raw === "dark" || raw === "light" || raw === "midnight") {
    return raw;
  }
  return DEFAULT_THEME;
}

function applyTheme(theme: ThemeId): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
}

export interface UseThemeResult {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<ThemeId>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
    if (canUseStorage()) {
      window.localStorage.setItem(THEME_KEY, theme);
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}

export { DEFAULT_THEME };
