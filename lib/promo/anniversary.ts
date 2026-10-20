import { isPromoActive, type PromoState } from "./promo";

/**
 * Ювілейні акції Cyber GPU Cluster ("1 місяць" — -15% на 7 діб, "2 місяці" —
 * -15% на 1 добу, ...).
 *
 * Параметри акції (знижка, старт, кінець, список рівнів) живуть у БД —
 * promo_campaigns, міграції 20260921120000_anniversary_promo.sql,
 * 20261020000000_anniversary_2_months_promo.sql, — а не тут: час вирішує
 * сервер (now()), тож підкручений годинник пристрою нічого не дає, а після
 * ends_at buy_gpu сам списує повну ціну. Клієнт лише впізнає ювілейну акцію
 * за slug, щоб показати святкову плашку з потрібною кількістю місяців.
 */
const ANNIVERSARY_MONTHS_BY_SLUG: Record<string, number> = {
  anniversary_1_month: 1,
  anniversary_2_months: 2,
};

/** Скільки місяців святкує ця акція; null — якщо це не ювілейна акція. */
export function anniversaryMonths(promo: PromoState | null): number | null {
  return (promo && ANNIVERSARY_MONTHS_BY_SLUG[promo.slug]) ?? null;
}

export function isAnniversaryPromo(promo: PromoState | null): boolean {
  return anniversaryMonths(promo) !== null;
}

/**
 * Чи діє ювілейна акція на момент nowMs. nowMs — за шкалою часу СЕРВЕРА
 * (Date.now() + clockOffsetMs з UserDataProvider), вікно бере з promo.
 */
export function isAnniversaryActive(promo: PromoState | null, nowMs: number): boolean {
  return isAnniversaryPromo(promo) && isPromoActive(promo, nowMs);
}
