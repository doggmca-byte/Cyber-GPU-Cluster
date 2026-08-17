export const LANGUAGE_STORAGE_KEY = "cyber-gpu-cluster:lang";

export const SUPPORTED_LANGUAGES = ["uk", "en", "ru", "ar", "id", "es", "kk", "tr"] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: LanguageCode = "en";

// Коректний ISO 639-1 код казахської мови — "kk" (не "kz", це код КРАЇНИ,
// а не мови; Telegram у language_code завжди присилає мовний код, тому з "kz"
// автодетекція просто ніколи б не спрацювала).
export const LANGUAGE_META: Record<LanguageCode, { flag: string; nativeName: string }> = {
  uk: { flag: "🇺🇦", nativeName: "Українська" },
  en: { flag: "🇬🇧", nativeName: "English" },
  ru: { flag: "🇷🇺", nativeName: "Русский" },
  ar: { flag: "🇸🇦", nativeName: "العربية" },
  id: { flag: "🇮🇩", nativeName: "Bahasa Indonesia" },
  es: { flag: "🇪🇸", nativeName: "Español" },
  kk: { flag: "🇰🇿", nativeName: "Қазақша" },
  tr: { flag: "🇹🇷", nativeName: "Türkçe" },
};

export const RTL_LANGUAGES: ReadonlySet<LanguageCode> = new Set(["ar"]);

// BCP-47 теги для Intl.NumberFormat/toLocaleString — форматування (роздільники
// розрядів) лишається locale-специфічним, але цифри завжди примусово латинські
// (-u-nu-latn у lib/i18n/formatNumber.ts), щоб фінансові суми ніколи не
// показувались у східноарабських цифрах чи іншій незвичній нумерації.
export const LOCALE_TAG: Record<LanguageCode, string> = {
  uk: "uk-UA",
  en: "en-US",
  ru: "ru-RU",
  ar: "ar-SA",
  id: "id-ID",
  es: "es-ES",
  kk: "kk-KZ",
  tr: "tr-TR",
};

export function isSupportedLanguage(value: string): value is LanguageCode {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
