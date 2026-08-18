/**
 * Monetag SDK (zone 11600101) — обгортка над window.show_11600101, який
 * підключається через <Script data-sdk="show_11600101" data-zone="11600101"
 * src="//libtl.com/sdk.js"> у app/layout.tsx (strategy="afterInteractive").
 *
 * SDK викликає window.show_11600101 без аргументу для Rewarded Interstitial
 * і з параметром "pop" для Rewarded Popup. Проміс резолвиться лише якщо
 * користувач фактично переглянув/провзаємодіяв з рекламою; він реджектиться
 * (або функція відсутня, якщо SDK-скрипт ще не завантажився / заблокований
 * adblock'ом) — саме тому showRewardedAd повертає boolean, а не кидає далі.
 */
declare global {
  interface Window {
    show_11600101?: (param?: string | object) => Promise<void>;
  }
}

/**
 * Показує рекламу Monetag і резолвиться в true лише після успішного
 * завершення промісу SDK (реклама переглянута/взаємодія відбулась).
 * Повертає false, якщо SDK ще не завантажений, реклама закрита достроково,
 * або показ завершився помилкою — виклик бекенду (claim/watch) не повинен
 * відбуватись у цьому випадку.
 */
export async function showRewardedAd(type?: "pop" | "interstitial"): Promise<boolean> {
  if (typeof window === "undefined" || typeof window.show_11600101 !== "function") {
    return false;
  }

  try {
    await window.show_11600101(type === "pop" ? "pop" : undefined);
    return true;
  } catch {
    return false;
  }
}
