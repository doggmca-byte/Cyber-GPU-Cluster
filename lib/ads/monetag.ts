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
    show_11600101?: () => Promise<void>;
  }
}

/**
 * Показує Rewarded Interstitial Monetag і резолвиться в true лише після
 * успішного завершення промісу SDK (реклама переглянута/закрита користувачем
 * зсередини застосунку). Повертає false, якщо SDK ще не завантажений, показ
 * закрито достроково, або завершився помилкою — виклик бекенду (claim/watch)
 * не повинен відбуватись у цьому випадку.
 */
export async function showRewardedAd(): Promise<boolean> {
  if (typeof window === "undefined" || typeof window.show_11600101 !== "function") {
    return false;
  }

  try {
    await window.show_11600101();
    return true;
  } catch {
    return false;
  }
}
