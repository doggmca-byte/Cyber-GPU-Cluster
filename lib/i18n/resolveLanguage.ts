import { DEFAULT_LANGUAGE, isSupportedLanguage, type LanguageCode } from "./languages";

/**
 * Той самий алгоритм, що й detectInitialLanguage у LanguageProvider.tsx
 * (мовна частина коду до дефіса, напр. "en-US" -> "en"), але без залежності
 * від window/localStorage — для серверного контексту (напр. cron-розсилка
 * сповіщень profiles.telegram_language_code, де живого Telegram WebApp
 * контексту вже нема, лише збережений при /api/user/sync рядок).
 */
export function resolveLanguage(rawLanguageCode: string | null | undefined): LanguageCode {
  if (!rawLanguageCode) return DEFAULT_LANGUAGE;
  const normalized = rawLanguageCode.toLowerCase().split("-")[0];
  return isSupportedLanguage(normalized) ? normalized : DEFAULT_LANGUAGE;
}
