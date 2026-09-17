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

export function nextPartnerAdSlot(): PartnerAdSlot {
  if (typeof window === "undefined") return PARTNER_AD_ORDER[0];

  let index = 0;
  try {
    index = Number(window.localStorage.getItem(ROTATION_STORAGE_KEY)) || 0;
  } catch {
    // localStorage недоступний — просто не персистимо позицію між сесіями.
  }

  try {
    window.localStorage.setItem(ROTATION_STORAGE_KEY, String(index + 1));
  } catch {
    // ignore
  }

  return PARTNER_AD_ORDER[index % PARTNER_AD_ORDER.length];
}
