/**
 * AdsGram SDK (Reward-блок) — третій rewarded-провайдер поряд із Monetag
 * (lib/ads/monetag.ts) та GigaPub (lib/ads/gigapub.ts). Скрипт підключається
 * у app/layout.tsx (<Script src="https://sad.adsgram.ai/js/sad.min.js">) і
 * реєструє window.Adsgram. На відміну від обох інших провайдерів, AdsGram
 * реально підтверджує показ через S2S postback — їхній сервер сам б'є по
 * Reward URL (app/api/ads/adsgram-postback) з telegramId, коли стався
 * реальний reward-евент. Тут — лише клієнтський показ; фактичне нарахування
 * відбувається виключно в постбек-роуті, як і в Monetag-флоу.
 *
 * blockId — з дашборду AdsGram (ad-блок типу "Reward" для платформи
 * "Cyber GPU Cluster"), заданий через NEXT_PUBLIC_ADSGRAM_BLOCK_ID. Якщо
 * змінна не задана, showAdsgramRewardedAd() одразу повертає false — ротація
 * (lib/ads/rewardedAd.ts) просто пропускає AdsGram і йде далі, безпечно.
 */
declare global {
  interface Window {
    Adsgram?: {
      init(params: { blockId: string; debug?: boolean }): AdsgramController;
    };
  }
}

interface AdsgramShowResult {
  done: boolean;
  description: string;
  state: "load" | "render" | "playing" | "destroy";
  error: boolean;
}

interface AdsgramController {
  show(): Promise<AdsgramShowResult>;
}

const ADSGRAM_BLOCK_ID = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID ?? "";

// init() потрібно викликати лише раз на blockId (документація AdsGram:
// повторний init з тим самим blockId повертає той самий AdController) —
// кешуємо, а не створюємо новий контролер на кожен показ.
let cachedController: AdsgramController | null = null;

function getController(): AdsgramController | null {
  if (typeof window === "undefined" || !ADSGRAM_BLOCK_ID || typeof window.Adsgram?.init !== "function") {
    return null;
  }

  if (!cachedController) {
    cachedController = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
  }

  return cachedController;
}

/**
 * Показує AdsGram rewarded-рекламу. Резолвиться в true лише якщо юзер
 * реально додивився до кінця (result.done === true) — це НЕ те саме, що
 * підтвердження нарахування (те приходить окремо, асинхронно, через
 * postback). Повертає false, якщо SDK/blockId не готові, показ закрито
 * достроково, чи сталась помилка.
 */
export async function showAdsgramRewardedAd(): Promise<boolean> {
  const controller = getController();
  if (!controller) return false;

  try {
    const result = await controller.show();
    return result.done === true;
  } catch {
    return false;
  }
}
