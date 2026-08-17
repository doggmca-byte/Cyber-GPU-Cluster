"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { dictionaries, type TranslationDictionary } from "@/lib/i18n/dictionaries";
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, isSupportedLanguage } from "@/lib/i18n/languages";

/**
 * Кореневий error boundary: сидить ВИЩЕ за app/(app)/layout.tsx у дереві,
 * тому коли активується (ловить помилку в будь-якому дочірньому сегменті —
 * і Mini App, і потенційно /admin), LanguageProvider вже може бути
 * розмонтований разом з рештою піддерева. Тому НЕ використовуємо
 * useTranslation() тут, а читаємо мову напряму з localStorage (той самий
 * ключ, що й LanguageProvider) — незалежно від React-контексту.
 */
export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [t, setT] = useState<TranslationDictionary>(dictionaries[DEFAULT_LANGUAGE]);

  useEffect(() => {
    console.error("[app] unhandled error:", error);

    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && isSupportedLanguage(stored)) {
      setT(dictionaries[stored]);
    }
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle size={40} className="text-red-400" />
      <h1 className="font-display text-lg font-bold">{t.errorPage.title}</h1>
      <p className="max-w-sm text-sm text-white/50">{t.errorPage.description}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple px-5 py-2.5 text-sm font-bold text-background transition active:scale-[0.98]"
      >
        {t.errorPage.retry}
      </button>
    </div>
  );
}
