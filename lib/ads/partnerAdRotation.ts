/**
 * Строга 4-позиційна ротація САМЕ для кнопки "Дивитись рекламу"
 * (PartnerAdsCard, purpose=partner_ad_watch) — 1.GigaPub 2.Monetag
 * 3.AdsGram 4.TADS, по колу, рівно один майданчик на клік, БЕЗ фолбеку на
 * наступного, якщо в поточного немає інвентарю (на відміну від
 * showRewardedAdRotating у rewardedAd.ts, який навмисно пробує ВСІХ підряд
 * для надійності показу).
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
export type PartnerAdSlot = "gigapub" | "monetag" | "adsgram" | "tads";

const PARTNER_AD_ORDER: readonly PartnerAdSlot[] = ["gigapub", "monetag", "adsgram", "tads"];
const ROTATION_STORAGE_KEY = "cgc_partner_ad_rotation_v2";

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
