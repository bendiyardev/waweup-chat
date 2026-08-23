"use client";

import * as React from "react";
import { Globe, Moon, Sun, SunMoon } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { useTheme, type ThemeMode } from "@/components/theme/theme-provider";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

const THEME_ORDER: ThemeMode[] = ["light", "dark", "system"];

/**
 * Compact language select + theme cycle button. Used on the home footer and
 * inside the room admin sheet.
 */
export function PreferenceControls({ className }: { className?: string }) {
  const { locale, setLocale, d } = useI18n();
  const { mode, setMode } = useTheme();

  const themeLabel =
    mode === "light"
      ? d.common.themeLight
      : mode === "dark"
        ? d.common.themeDark
        : d.common.themeSystem;

  const cycleTheme = () => {
    const next =
      THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length] ??
      "system";
    setMode(next);
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <label className="relative inline-flex items-center">
        <span className="sr-only">{d.common.language}</span>
        <Globe
          aria-hidden
          className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
        />
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          aria-label={d.common.language}
          className="h-8 appearance-none rounded-[8px] border border-border bg-surface pl-7 pr-2 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus:outline-none"
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_NAMES[code]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={cycleTheme}
        aria-label={`${d.common.theme}: ${themeLabel}`}
        title={`${d.common.theme}: ${themeLabel}`}
        className="flex h-8 items-center gap-1.5 rounded-[8px] border border-border bg-surface px-2 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
      >
        {mode === "light" ? (
          <Sun className="size-3.5" aria-hidden />
        ) : mode === "dark" ? (
          <Moon className="size-3.5" aria-hidden />
        ) : (
          <SunMoon className="size-3.5" aria-hidden />
        )}
        {themeLabel}
      </button>
    </div>
  );
}
