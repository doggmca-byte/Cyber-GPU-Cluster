import { LOCALE_TAG, type LanguageCode } from "./languages";

/**
 * Форматує число під обрану мову (роздільники розрядів локале-специфічні),
 * але ЗАВЖДИ латинськими цифрами (-u-nu-latn) — для фінансового застосунку
 * читабельність сум важливіша за автентичну нумерацію локалі (напр. ar-SA за
 * замовчуванням показав би східноарабські цифри ٠١٢, що для TON/HASH сум
 * лише плутає, а не допомагає).
 */
export function formatNumber(
  lang: LanguageCode,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(`${LOCALE_TAG[lang]}-u-nu-latn`, options).format(value);
}
