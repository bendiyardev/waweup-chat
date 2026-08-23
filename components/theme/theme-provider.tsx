"use client";

import * as React from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "wawe-theme";

interface ThemeValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = React.createContext<ThemeValue | null>(null);

export function useTheme(): ThemeValue {
  const value = React.useContext(ThemeContext);
  if (!value) throw new Error("useTheme outside ThemeProvider");
  return value;
}

function apply(mode: ThemeMode): void {
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Theme state lives in localStorage; the inline nonce'd script in the layout
 * applies the class before first paint so there is never a flash of the
 * wrong theme. This provider only keeps React state in sync afterwards.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>("system");

  React.useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage blocked — stay on "system".
    }
    if (stored === "light" || stored === "dark" || stored === "system") {
      setModeState(stored);
      apply(stored);
    }
  }, []);

  // Track OS theme changes while in system mode.
  React.useEffect(() => {
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => apply("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [mode]);

  const setMode = React.useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore.
    }
    apply(next);
  }, []);

  const value = React.useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
