import { isPromoActive, type PromoState } from "./promo";

/**
 * Юбилейна акція "1 місяць Cyber GPU Cluster" (-15% на все обладнання, 7 діб).
 *
 * Параметри акції (знижка, старт, кінець, список рівнів) живуть у БД —
 * promo_campaigns, міграція 20260921120000_anniversary_promo.sql, — а не тут:
 * час вирішує сервер (now()), тож підкручений годинник пристрою нічого не
 * дає, а після ends_at buy_gpu сам списує повну ціну. Клієнт лише впізнає
 * цю акцію за slug, щоб показати святкову плашку.
 */
export const ANNIVERSARY_PROMO_SLUG = "anniversary_1_month";

export function isAnniversaryPromo(promo: PromoState | null): boolean {
  return promo?.slug === ANNIVERSARY_PROMO_SLUG;
}

/**
 * Чи діє юбілейна акція на момент nowMs. nowMs — за шкалою часу СЕРВЕРА
 * (Date.now() + clockOffsetMs з UserDataProvider), вікно бере з promo.
 */
export function isAnniversaryActive(promo: PromoState | null, nowMs: number): boolean {
  return isAnniversaryPromo(promo) && isPromoActive(promo, nowMs);
}
