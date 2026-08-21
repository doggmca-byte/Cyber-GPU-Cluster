import { showRewardedAd } from "./monetag";
import { showGigaRewardedAd } from "./gigapub";
import { showAdsgramRewardedAd } from "./adsgram";

export type RewardedProvider = "gigapub" | "monetag" | "adsgram";

const PROVIDER_ORDER: readonly RewardedProvider[] = ["gigapub", "monetag", "adsgram"];
const ROTATION_STORAGE_KEY = "cgc_ad_provider_rotation";

// Чия черга йти першим — зберігаємо в localStorage, а не в змінній модуля,
// щоб чергування тримало лад між перезавантаженнями сторінки/сесіями, а не
// скидалось на "завжди перший у списку" при кожному новому монтуванні
// DailyBonusModal/WatchAdButton/PartnerAdsCard.
function rotatedProviderOrder(): RewardedProvider[] {
  if (typeof window === "undefined") return [...PROVIDER_ORDER];

  let index = 0;
  try {
    index = Number(window.localStorage.getItem(ROTATION_STORAGE_KEY)) || 0;
  } catch {
    // localStorage може бути недоступний (приватний режим, заборонено в
    // WebView) — просто не чергуємо між сесіями, це не критично.
  }

  try {
    window.localStorage.setItem(ROTATION_STORAGE_KEY, String(index + 1));
  } catch {
    // ignore
  }

  const start = index % PROVIDER_ORDER.length;
  return [...PROVIDER_ORDER.slice(start), ...PROVIDER_ORDER.slice(0, start)];
}

function showByProvider(provider: RewardedProvider): Promise<boolean> {
  if (provider === "gigapub") return showGigaRewardedAd();
  if (provider === "monetag") return showRewardedAd();
  return showAdsgramRewardedAd();
}

/**
 * Показує Rewarded Interstitial, чергуючи трьох провайдерів (GigaPub /
 * Monetag / AdsGram SDK) від виклику до виклику замість того, щоб завжди
 * пробувати одного й того ж першим. Усі три — лише повноцінний внутрішній
 * банер/відео, що закривається в самому Telegram WebApp; жодного переходу в
 * зовнішній браузер (Rewarded Popup / Direct Link) з цієї функції не
 * викликається.
 *
 * show*RewardedAd НІКОЛИ не кидають — вони повертають false у будь-якому
 * "немає реклами" сценарії (SDK ще не завантажився, нема інвентарю в
 * провайдера, показ закрито достроково). Тож якщо провайдер, чия зараз
 * черга, повернув false, пробуємо наступного за списком — true повертається,
 * якщо БУДЬ-ЯКИЙ з трьох показав рекламу успішно; false лише якщо
 * провалились усі (і тоді бекенд-клейм/інкремент не викликати).
 */
export async function showRewardedAdRotating(): Promise<boolean> {
  for (const provider of rotatedProviderOrder()) {
    if (await showByProvider(provider)) return true;
  }
  return false;
}

export interface RewardedAdWithProviderResult {
  watched: boolean;
  /** Хто саме показав — null, якщо watched: false (жоден провайдер не спрацював). */
  provider: RewardedProvider | null;
}

/**
 * Той самий алгоритм чергування, що й showRewardedAdRotating, але для
 * flows, де нарахування залежить від ТОГО, ХТО саме показав рекламу
 * (наразі — PartnerAdsCard/record_partner_ad_watch): Monetag передає
 * monetagYmid у SDK-виклик (server-side S2S-підтвердження через
 * /api/ads/monetag-postback), AdsGram підтверджує через власний Reward URL
 * postback (app/api/ads/adsgram-postback, кореляція по telegramId, без
 * потреби в токені спроби з нашого боку) — GigaPub і далі на клієнтській
 * довірі (немає жодного S2S-механізму, підтверджено їхньою ж документацією).
 * Викликач сам вирішує, що робити з кожним provider — тут лише сирий факт
 * "хто показав".
 */
export async function showRewardedAdRotatingWithProvider(monetagYmid: string): Promise<RewardedAdWithProviderResult> {
  for (const provider of rotatedProviderOrder()) {
    const shown = provider === "monetag" ? await showRewardedAd(monetagYmid) : await showByProvider(provider);
    if (shown) return { watched: true, provider };
  }
  return { watched: false, provider: null };
}
