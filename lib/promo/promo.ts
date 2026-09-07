/**
 * Акційна знижка на обрані GPU.
 *
 * ДЖЕРЕЛО ПРАВДИ — БД: таблиця promo_campaigns + active_promo(), яку читає
 * buy_gpu тим самим now() (20260907120000_promo_campaign_and_bot_blocked.sql).
 * Клієнт цю ціну лише ВІДОБРАЖАЄ: він не передає її на бекенд і не може на
 * неї вплинути, а після ends_at сервер списує повну ціну незалежно від того,
 * що показує UI (напр. якщо у користувача підкручений системний час).
 *
 * Тут — рівно та сама формула округлення, що й у SQL: round(x, 6).
 */
export interface PromoState {
  slug: string;
  discount_percent: number;
  /** gpu_templates.level, на які діє знижка. */
  target_levels: number[];
  starts_at: string;
  ends_at: string;
}

const TON_DECIMALS = 6;

function roundTon(value: number): number {
  const factor = 10 ** TON_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Чи діє акція на момент nowMs (мілісекунди, за шкалою часу СЕРВЕРА). */
export function isPromoActive(promo: PromoState | null, nowMs: number): boolean {
  if (!promo) return false;
  const startsAt = new Date(promo.starts_at).getTime();
  const endsAt = new Date(promo.ends_at).getTime();
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) return false;
  return nowMs >= startsAt && nowMs < endsAt;
}

/** Чи діє знижка саме на цей рівень прямо зараз. */
export function isLevelDiscounted(promo: PromoState | null, level: number, nowMs: number): boolean {
  return isPromoActive(promo, nowMs) && !!promo?.target_levels.includes(level);
}

/**
 * Ціна, яку реально спише бекенд. Для неакційних рівнів і для часу поза
 * вікном акції повертає базову вартість без змін.
 */
export function effectivePrice(
  promo: PromoState | null,
  level: number,
  baseCostTon: number,
  nowMs: number,
): number {
  if (!isLevelDiscounted(promo, level, nowMs)) return baseCostTon;
  return roundTon((baseCostTon * (100 - (promo as PromoState).discount_percent)) / 100);
}

/** Скільки мілісекунд лишилось до кінця акції (0, якщо вже минула). */
export function promoMsLeft(promo: PromoState | null, nowMs: number): number {
  if (!promo) return 0;
  return Math.max(new Date(promo.ends_at).getTime() - nowMs, 0);
}

/** HH:MM:SS для зворотного відліку (години не обмежені 24). */
export function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.max(Math.floor(msLeft / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
