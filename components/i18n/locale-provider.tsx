"use client";

import * as React from "react";
import {
  DICTIONARIES,
  fmt,
  LOCALES,
  pluralForm,
  type Dictionary,
  type Locale,
} from "@/lib/i18n/dictionaries";

const STORAGE_KEY = "wawe-locale";
const COOKIE_KEY = "wawe-locale";

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** The full typed dictionary for the active locale. */
  d: Dictionary;
  fmt: typeof fmt;
  /** Picks the right plural form for a count in the active locale. */
  plural: (
    n: number,
    forms: { one: string; few: string; many: string },
  ) => string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const value = React.useContext(I18nContext);
  if (!value) throw new Error("useI18n outside LocaleProvider");
  return value;
}

function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

function persist(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage may be blocked; the cookie below is the fallback.
  }
  try {
    document.cookie = `${COOKIE_KEY}=${locale}; path=/; max-age=31536000; samesite=strict`;
  } catch {
    // Ignore.
  }
}

export function LocaleProvider({
  initialLocale,
  hadCookie,
  children,
}: {
  /** Locale resolved server-side from the preference cookie (SSR-safe). */
  initialLocale: Locale;
  /** Whether the preference cookie existed (skip browser auto-detection). */
  hadCookie: boolean;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);

  // First visit only: adopt the browser language, then persist it.
  React.useEffect(() => {
    if (hadCookie) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
    if (isLocale(stored)) {
      setLocaleState(stored);
      persist(stored);
      return;
    }
    const nav = (navigator.language || "").toLowerCase();
    const detected: Locale = nav.startsWith("tr")
      ? "tr"
      : nav.startsWith("ru")
        ? "ru"
        : "en";
    setLocaleState(detected);
    persist(detected);
  }, [hadCookie]);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    persist(next);
    document.documentElement.lang = next;
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = React.useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      d: DICTIONARIES[locale],
      fmt,
      plural: (n, forms) => fmt(forms[pluralForm(locale, n)], { n }),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
