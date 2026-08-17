"use client";

import { TonConnectUIProvider } from "@tonconnect/ui-react";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import type { LanguageCode } from "@/lib/i18n/languages";

// Абсолютний URL обов'язковий — мобільні гаманці (Tonkeeper, Telegram Wallet)
// фетчать маніфест самостійно, не через відносний шлях сторінки. Задай
// NEXT_PUBLIC_APP_URL на реальний https-домен перед продакшн-деплоєм; без
// нього маніфест резолвиться відносно поточного origin (працює лише для
// тестування в тому самому браузері/WebView).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";
const MANIFEST_URL = `${APP_URL}/tonconnect-manifest.json`;

// @tonconnect/ui-react сам підтримує лише 'en' | 'ru' для власної модалки
// (перелік гаманців, підказки підключення) — це обмеження самого пакета,
// не наше. Решту мов мапимо на 'en' як найбезпечніший fallback.
const TONCONNECT_LOCALE: Record<LanguageCode, "en" | "ru"> = {
  en: "en",
  ru: "ru",
  uk: "en",
  ar: "en",
  id: "en",
  es: "en",
  kk: "en",
  tr: "en",
};

export function TonConnectProvider({ children }: { children: React.ReactNode }) {
  const { language } = useTranslation();

  return (
    <TonConnectUIProvider manifestUrl={MANIFEST_URL} language={TONCONNECT_LOCALE[language]}>
      {children}
    </TonConnectUIProvider>
  );
}
