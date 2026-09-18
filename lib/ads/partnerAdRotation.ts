/**
 * Строга 3-позиційна ротація САМЕ для кнопки "Дивитись рекламу"
 * (PartnerAdsCard, purpose=partner_ad_watch) — 1.GigaPub 2.AdsGram 3.TADS,
 * по колу, рівно один майданчик на клік, БЕЗ фолбеку на наступного, якщо в
 * поточного немає інвентарю (на відміну від showRewardedAdRotating у
 * rewardedAd.ts, який навмисно пробує ВСІХ підряд для надійності показу).
 *
 * Monetag звідси прибрано свідомо. Кожен партнерський перегляд коштує нам
 * 0.001 TON нагороди гравцю — це ~$1.35 на тисячу показів; Monetag за весь
 * час приніс $2 на 6623 покази, тобто $0.30 на тисячу. Єдиний майданчик, що
 * стабільно працював у мінус. У безкоштовних flows (щоденний бонус, квота
 * виводу) він лишається: там показ нам не коштує нічого, і навіть така
 * ставка — чистий плюс.
 *
 * Окремий localStorage-ключ від rewardedAd.ts (той лишається для
 * daily_bonus_watch/withdraw_ad_watch — там TADS не бере участі: його
 * S2S-вебхук жорстко прив'язаний лише до purpose='partner_ad_watch', той
 * самий принцип, що й AdsGram, див. app/api/ads/tads-postback).
 *
 * TADS у цій ротації — окремий випадок: на відміну від решти трьох немає
 * show()-виклику "на вимогу" з проміс-результатом "переглянуто/ні" — банер
 * TADS уже постійно змонтований у власному контейнері (TadsBannerCard) і
 * чекає на РЕАЛЬНИЙ клік користувача по самій рекламній творчій одиниці.
 * Симулювати клік програмно НЕ можна (проти правил рекламних мереж, ризик
 * бану акаунта за фрод-кліки) — тому на позиції "tads" ротації кнопка не
 * відкриває нічого сама, а лише підказує натиснути банер нижче.
 */
export type PartnerAdSlot = "gigapub" | "adsgram" | "tads";

const PARTNER_AD_ORDER: readonly PartnerAdSlot[] = ["gigapub", "adsgram", "tads"];
// v3, бо позиція у старому ключі рахувалась по чотирьох слотах — зі зміною
// довжини вона б'є не в ту саму мережу, що очікує гравець.
const ROTATION_STORAGE_KEY = "cgc_partner_ad_rotation_v3";

/**
 * Скільки пропускати мережу, яка щойно відповіла "реклами немає".
 *
 * Без цього порожня мережа отримувала свою третину кліків і щоразу
 * показувала гравцеві "No ads available" — так AdsGram, що кілька годин
 * поспіль не мав інвентарю, робив непрацюючою третину натискань кнопки.
 * Правило "одна мережа на клік" лишається: ми не показуємо другу рекламу
 * в тому ж кліку, а лише не віддаємо наступні кліки мережі, яка точно порожня.
 */
const NO_FILL_COOLDOWN_MS = 15 * 60 * 1000;
const NO_FILL_STORAGE_KEY = "cgc_partner_ad_no_fill";

function readNoFill(): Partial<Record<PartnerAdSlot, number>> {
  try {
    return JSON.parse(window.localStorage.getItem(NO_FILL_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Позначає мережу як порожню на NO_FILL_COOLDOWN_MS. */
export function markPartnerAdNoFill(slot: PartnerAdSlot): void {
  if (typeof window === "undefined") return;
  try {
    const state = readNoFill();
    state[slot] = Date.now();
    window.localStorage.setItem(NO_FILL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage недоступний — просто не пам'ятаємо, це не критично.
  }
}

function isCoolingDown(slot: PartnerAdSlot, state: Partial<Record<PartnerAdSlot, number>>): boolean {
  const at = state[slot];
  return typeof at === "number" && Date.now() - at < NO_FILL_COOLDOWN_MS;
}

export function nextPartnerAdSlot(): PartnerAdSlot {
  if (typeof window === "undefined") return PARTNER_AD_ORDER[0];

  let index = 0;
  try {
    index = Number(window.localStorage.getItem(ROTATION_STORAGE_KEY)) || 0;
  } catch {
    // localStorage недоступний — просто не персистимо позицію між сесіями.
  }

  // Беремо першу мережу по колу, що не на паузі. Якщо на паузі всі —
  // повертаємо звичайну чергу: краще спробувати, ніж не показати нічого.
  const noFill = readNoFill();
  let offset = 0;
  while (offset < PARTNER_AD_ORDER.length && isCoolingDown(PARTNER_AD_ORDER[(index + offset) % PARTNER_AD_ORDER.length], noFill)) {
    offset += 1;
  }
  if (offset === PARTNER_AD_ORDER.length) offset = 0;

  try {
    window.localStorage.setItem(ROTATION_STORAGE_KEY, String(index + offset + 1));
  } catch {
    // ignore
  }

  return PARTNER_AD_ORDER[(index + offset) % PARTNER_AD_ORDER.length];
}
