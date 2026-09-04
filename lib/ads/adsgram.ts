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
 * Кілька блоків (не один): один AdsGram-блок може вичерпати інвентар
 * (особливо після підняття денного ліміту переглядів 20 -> 30,
 * 20260904090000_raise_partner_ad_daily_limit_to_30.sql) — тому підтримуємо
 * СПИСОК blockId (NEXT_PUBLIC_ADSGRAM_BLOCK_IDS, через кому), а не лише один
 * (NEXT_PUBLIC_ADSGRAM_BLOCK_ID — стара змінна лишається як fallback, якщо
 * список не заданий, для зворотної сумісності з уже налаштованим env).
 * Чергуємо блоки round-robin (той самий підхід, що й chergування провайдерів
 * у rewardedAd.ts, окремий localStorage-ключ) і, якщо поточний блок не має
 * реклами (show() -> done:false), пробуємо наступний блок у тому ж виклику —
 * лише коли жоден блок не спрацював, повертаємо false далі в ротацію
 * провайдерів.
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

const BLOCK_ROTATION_STORAGE_KEY = "cgc_adsgram_block_rotation";

function parseBlockIds(): string[] {
  const listRaw = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_IDS ?? "";
  const list = listRaw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (list.length > 0) return list;

  const single = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID ?? "";
  return single ? [single] : [];
}

const ADSGRAM_BLOCK_IDS = parseBlockIds();

// init() потрібно викликати лише раз на blockId (документація AdsGram:
// повторний init з тим самим blockId повертає той самий AdController) —
// кешуємо по кожному blockId окремо, а не створюємо новий контролер на
// кожен показ.
const controllerCache = new Map<string, AdsgramController>();

function getController(blockId: string): AdsgramController | null {
  if (typeof window === "undefined" || typeof window.Adsgram?.init !== "function") return null;

  let controller = controllerCache.get(blockId);
  if (!controller) {
    controller = window.Adsgram.init({ blockId });
    controllerCache.set(blockId, controller);
  }
  return controller;
}

/** Той самий алгоритм ротації, що й rotatedProviderOrder у rewardedAd.ts. */
function rotatedBlockIds(): string[] {
  if (ADSGRAM_BLOCK_IDS.length <= 1) return ADSGRAM_BLOCK_IDS;
  if (typeof window === "undefined") return ADSGRAM_BLOCK_IDS;

  let index = 0;
  try {
    index = Number(window.localStorage.getItem(BLOCK_ROTATION_STORAGE_KEY)) || 0;
  } catch {
    // localStorage може бути недоступний (приватний режим, заборонено в
    // WebView) — просто не чергуємо між сесіями, це не критично.
  }

  try {
    window.localStorage.setItem(BLOCK_ROTATION_STORAGE_KEY, String(index + 1));
  } catch {
    // ignore
  }

  const start = index % ADSGRAM_BLOCK_IDS.length;
  return [...ADSGRAM_BLOCK_IDS.slice(start), ...ADSGRAM_BLOCK_IDS.slice(0, start)];
}

async function showOneBlock(blockId: string): Promise<boolean> {
  const controller = getController(blockId);
  if (!controller) return false;

  try {
    const result = await controller.show();
    return result.done === true;
  } catch {
    return false;
  }
}

/**
 * Показує AdsGram rewarded-рекламу, перебираючи всі налаштовані блоки (у
 * ротаційному порядку), доки якийсь не покаже успішно. Резолвиться в true
 * лише якщо юзер реально додивився до кінця (result.done === true) — це НЕ
 * те саме, що підтвердження нарахування (те приходить окремо, асинхронно,
 * через postback). Повертає false, якщо жодного blockId не налаштовано,
 * SDK ще не готовий, чи жоден блок не має інвентарю/показ закрито достроково.
 */
export async function showAdsgramRewardedAd(): Promise<boolean> {
  for (const blockId of rotatedBlockIds()) {
    if (await showOneBlock(blockId)) return true;
  }
  return false;
}
