/**
 * Monetag SDK (zone 11600101) — обгортка над window.show_11600101, який
 * підключається через <Script data-sdk="show_11600101" data-zone="11600101"
 * src="//libtl.com/sdk.js"> у app/layout.tsx (strategy="afterInteractive").
 *
 * ЛИШЕ Rewarded Interstitial: window.show_11600101() без аргументу — повноцінне
 * відео/банер ВСЕРЕДИНІ Telegram WebApp, закривається хрестиком, без переходу
 * в зовнішній браузер. Формат Rewarded Popup (виклик з аргументом "pop", який
 * відкриває офер-сторінку поза застосунком) свідомо ЗАБОРОНЕНИЙ — SDK не
 * викликається з жодним параметром, тож попап технічно неможливий з цього
 * коду (продуктове рішення: користувача ніколи не можна виштовхувати з
 * Mini App при перегляді реклами).
 *
 * Проміс резолвиться лише якщо користувач фактично переглянув/провзаємодіяв з
 * рекламою; він реджектиться (або функція відсутня, якщо SDK-скрипт ще не
 * завантажився / заблокований adblock'ом) — саме тому showRewardedAd повертає
 * boolean, а не кидає далі.
 */
declare global {
  interface Window {
    show_11600101?: (options?: { ymid?: string; type?: string; requestVar?: string }) => Promise<void>;
  }
}

/**
 * Показує Rewarded Interstitial Monetag і резолвиться в true лише після
 * успішного завершення промісу SDK (реклама переглянута/закрита користувачем
 * зсередини застосунку). Повертає false, якщо SDK ще не завантажений, показ
 * закрито достроково, або завершився помилкою — виклик бекенду (claim/watch)
 * не повинен відбуватись у цьому випадку.
 *
 * ymid (опційно) — унікальний ідентифікатор спроби (app/api/ads/monetag/
 * start-attempt/route.ts), який Monetag повертає БЕЗ ЗМІН у своєму S2S
 * postback (docs.monetag.com/docs/postbacks/macroses) — так бекенд зіставляє
 * реальне підтвердження перегляду з конкретним showRewardedAd()-викликом
 * конкретного юзера. Без ymid (як і раніше) — просто client-side результат
 * без можливості server-side підтвердження.
 */
const MONETAG_ZONE = "11600101";
const MONETAG_SDK_SRC = "https://libtl.com/sdk.js";

/** Скільки чекати, поки SDK зареєструє window.show_11600101 після завантаження. */
const SDK_READY_TIMEOUT_MS = 10_000;

let sdkLoading: Promise<boolean> | null = null;

/**
 * Підвантажує SDK Monetag лише тоді, коли реклама Monetag справді потрібна.
 *
 * Раніше скрипт висів у app/layout.tsx на кожній сторінці. Навіть коли наш
 * код Monetag не викликав, гравці бачили його вікна в партнерській рекламі й
 * на кнопці виводу — звідки його вже прибрали. Тепер SDK з'являється на
 * сторінці тільки з першим показом реклами щоденного бонусу.
 *
 * Повторні виклики чекають на те саме завантаження; невдале — скидається,
 * щоб наступна спроба могла завантажити скрипт заново.
 */
function loadMonetagSdk(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (typeof window.show_11600101 === "function") return Promise.resolve(true);
  if (sdkLoading) return sdkLoading;

  sdkLoading = new Promise<boolean>((resolve) => {
    const fail = () => {
      sdkLoading = null;
      resolve(false);
    };

    const script = document.createElement("script");
    script.src = MONETAG_SDK_SRC;
    script.async = true;
    script.dataset.zone = MONETAG_ZONE;
    script.dataset.sdk = `show_${MONETAG_ZONE}`;
    script.onerror = fail;
    document.head.appendChild(script);

    // show_11600101 з'являється не в момент onload, а коли SDK сам себе
    // ініціалізує, — тому чекаємо саме на функцію, а не на подію скрипта.
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (typeof window.show_11600101 === "function") {
        window.clearInterval(timer);
        resolve(true);
      } else if (Date.now() - startedAt > SDK_READY_TIMEOUT_MS) {
        window.clearInterval(timer);
        fail();
      }
    }, 100);
  });

  return sdkLoading;
}

export async function showRewardedAd(ymid?: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!(await loadMonetagSdk())) return false;
  if (typeof window.show_11600101 !== "function") return false;

  try {
    await window.show_11600101(ymid ? { ymid } : undefined);
    return true;
  } catch {
    return false;
  }
}
