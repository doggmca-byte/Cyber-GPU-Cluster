import { showRewardedAd } from "./monetag";
import { showGigaRewardedAd } from "./gigapub";

type RewardedProvider = "gigapub" | "monetag";

const ROTATION_STORAGE_KEY = "cgc_ad_provider_rotation";

// Чия черга йти першим — зберігаємо в localStorage, а не в змінній модуля,
// щоб чергування тримало лад між перезавантаженнями сторінки/сесіями, а не
// скидалось на "завжди GigaPub спочатку" при кожному новому монтуванні
// DailyBonusModal/WatchAdButton.
function nextFirstProvider(): RewardedProvider {
  if (typeof window === "undefined") return "gigapub";

  let index = 0;
  try {
    index = Number(window.localStorage.getItem(ROTATION_STORAGE_KEY)) || 0;
  } catch {
    // localStorage може бути недоступний (приватний режим, заборонено в
    // WebView) — просто не чергуємо між сесіями, це не критично.
  }

  const provider: RewardedProvider = index % 2 === 0 ? "gigapub" : "monetag";

  try {
    window.localStorage.setItem(ROTATION_STORAGE_KEY, String(index + 1));
  } catch {
    // ignore
  }

  return provider;
}

function showByProvider(provider: RewardedProvider, monetagType?: "pop" | "interstitial"): Promise<boolean> {
  return provider === "gigapub" ? showGigaRewardedAd() : showRewardedAd(monetagType);
}

/**
 * Показує rewarded-рекламу, чергуючи двох провайдерів (GigaPub / Monetag
 * SDK) від виклику до виклику замість того, щоб завжди пробувати одного й
 * того ж першим.
 *
 * showGigaRewardedAd/showRewardedAd НІКОЛИ не кидають — вони повертають
 * false у будь-якому "немає реклами" сценарії (SDK ще не завантажився, нема
 * інвентарю в провайдера, показ закрито достроково). Тож якщо провайдер,
 * чия зараз черга, повернув false, одразу пробуємо другого як fallback —
 * true повертається, якщо БУДЬ-ЯКИЙ з двох показав рекламу успішно; false
 * лише якщо провалились обидва (і тоді бекенд-клейм/інкремент не викликати).
 *
 * monetagType прокидається в Monetag SDK, коли саме він і показує рекламу
 * (GigaPub-виклик його ігнорує — showGiga() без аргументів).
 */
export async function showRewardedAdRotating(monetagType?: "pop" | "interstitial"): Promise<boolean> {
  const first = nextFirstProvider();
  const second: RewardedProvider = first === "gigapub" ? "monetag" : "gigapub";

  if (await showByProvider(first, monetagType)) return true;
  return showByProvider(second, monetagType);
}
