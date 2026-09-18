import { showRewardedAd } from "./monetag";
import { showGigaRewardedAd } from "./gigapub";
import { showAdsgramRewardedAd } from "./adsgram";

export type RewardedProvider = "gigapub" | "monetag" | "adsgram";

const PROVIDER_ORDER: readonly RewardedProvider[] = ["gigapub", "monetag", "adsgram"];
const ROTATION_STORAGE_KEY = "cgc_ad_provider_rotation";

export type VerifiedFlow = "daily_bonus" | "withdraw";

/**
 * Які мережі показують рекламу в кожному з двох "post-show" flows. Порядок —
 * це порядок спроб: наступна мережа пробується, лише якщо попередня не мала
 * реклами. Ротації тут немає навмисно — склад кожного flow вибраний руками.
 *
 * Щоденний бонус — ЛИШЕ Monetag. Показ тут нам нічого не коштує (бонус
 * фіксований, а не за перегляд), тож навіть його $0.30 з тисячі — чистий
 * дохід; а розвести мережі по flows означає, що Monetag більше не з'їдає
 * жодного платного партнерського перегляду.
 *
 * Квота виводу — ті самі мережі, що й партнерська кнопка: GigaPub, а якщо
 * в нього немає реклами — AdsGram. Порядок не випадковий: Reward URL AdsGram
 * один на весь застосунок і завжди зараховує ПАРТНЕРСЬКИЙ перегляд, тож
 * кожен показ AdsGram тут додає гравцю ще й партнерську нагороду. Ставимо
 * його другим, щоб це траплялось лише тоді, коли GigaPub нічого не віддав.
 */
const FLOW_ORDER: Record<VerifiedFlow, readonly RewardedProvider[]> = {
  daily_bonus: ["monetag"],
  withdraw: ["gigapub", "adsgram"],
};

// Чия черга йти першим — зберігаємо в localStorage, а не в змінній модуля,
// щоб чергування тримало лад між перезавантаженнями сторінки/сесіями, а не
// скидалось на "завжди перший у списку" при кожному новому монтуванні
// DailyBonusModal/WatchAdButton/PartnerAdsCard.
function rotatedProviderOrder(
  order: readonly RewardedProvider[] = PROVIDER_ORDER,
  storageKey: string = ROTATION_STORAGE_KEY,
): RewardedProvider[] {
  if (typeof window === "undefined") return [...order];

  let index = 0;
  try {
    index = Number(window.localStorage.getItem(storageKey)) || 0;
  } catch {
    // localStorage може бути недоступний (приватний режим, заборонено в
    // WebView) — просто не чергуємо між сесіями, це не критично.
  }

  try {
    window.localStorage.setItem(storageKey, String(index + 1));
  } catch {
    // ignore
  }

  const start = index % order.length;
  return [...order.slice(start), ...order.slice(0, start)];
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

export interface VerifiedFlowAdResult {
  watched: boolean;
  /** Хто саме показав — null, якщо жоден провайдер не спрацював. */
  provider: RewardedProvider | null;
  /** Токен спроби Monetag — лише якщо показ реально дістався Monetag. */
  ymid: string | null;
}

/**
 * Показ реклами для щоденного бонусу та квоти виводу.
 *
 * Ключова відмінність від попередньої версії: токен спроби Monetag
 * запитується ЛИШЕ тоді, коли черга реально дійшла до Monetag. Раніше він
 * відкривався наперед, ще до вибору провайдера, — і кожен показ, що діставався
 * іншій мережі, лишав по собі назавжди "pending" рядок в
 * ad_verification_attempts. Таких порожніх рядків набігало близько 600 на добу,
 * через що статистика показувала в Monetag 40% підтверджень замість справжніх
 * 65% і ховала за собою реальні збої.
 */
export async function showRewardedAdForVerifiedFlow(
  flow: VerifiedFlow,
  getMonetagYmid: () => Promise<string | null>,
): Promise<VerifiedFlowAdResult> {
  for (const provider of FLOW_ORDER[flow]) {
    if (provider === "monetag") {
      const ymid = await getMonetagYmid();
      // Без токена показ усе одно робимо — просто нарахування піде клієнтською
      // довірою, як було до появи S2S-верифікації.
      if (await showRewardedAd(ymid ?? undefined)) return { watched: true, provider, ymid };
      continue;
    }

    if (await showByProvider(provider)) return { watched: true, provider, ymid: null };
  }

  return { watched: false, provider: null, ymid: null };
}
