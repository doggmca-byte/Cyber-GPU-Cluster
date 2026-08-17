"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dictionaries, type TranslationDictionary } from "./dictionaries";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  RTL_LANGUAGES,
  isSupportedLanguage,
  type LanguageCode,
} from "./languages";

interface LanguageContextValue {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: TranslationDictionary;
  dir: "ltr" | "rtl";
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function detectInitialLanguage(): LanguageCode {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && isSupportedLanguage(stored)) return stored;

  const telegramLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (telegramLang) {
    // Telegram присилає код виду "uk", інколи з регіоном ("en-US") — беремо
    // лише мовну частину до дефіса
    const normalized = telegramLang.toLowerCase().split("-")[0];
    if (isSupportedLanguage(normalized)) return normalized;
  }

  return DEFAULT_LANGUAGE;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Стартуємо з DEFAULT_LANGUAGE і на сервері, і при першому клієнтському
  // рендері (щоб уникнути гідратаційного розсинхрону — localStorage/Telegram
  // недоступні під час SSR), реальну мову визначаємо в ефекті одразу після
  // монтування. Короткий "флеш" англійської непомітний — його перекриває
  // ScreenSkeleton, поки триває початковий /api/user/sync.
  const [language, setLanguageState] = useState<LanguageCode>(DEFAULT_LANGUAGE);

  useEffect(() => {
    setLanguageState(detectInitialLanguage());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.documentElement.dir = RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
  }, [language]);

  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: dictionaries[language],
      dir: RTL_LANGUAGES.has(language) ? "rtl" : "ltr",
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within <LanguageProvider>");
  }
  return ctx;
}
