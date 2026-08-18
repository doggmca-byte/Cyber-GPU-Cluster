/**
 * GigaPub SDK (App ID 7784) — другий rewarded-провайдер поряд із Monetag
 * SDK (lib/ads/monetag.ts). Скрипт підключається у app/layout.tsx
 * (<Script src="https://ad.gigapub.tech/script?id=7784" strategy="afterInteractive">)
 * і реєструє window.showGiga. За рішенням продукту обидва rewarded-покази
 * йдуть ПОСЛІДОВНО перед клеймом/нарахуванням (спершу GigaPub, потім
 * Monetag) — бекенд-запит виконується лише якщо ОБИДВА проміси
 * резолвнулись успішно.
 */
declare global {
  interface Window {
    showGiga?: () => Promise<void>;
  }
}

/**
 * Показує GigaPub rewarded-рекламу і резолвиться в true лише після
 * успішного завершення промісу SDK. Повертає false, якщо SDK ще не
 * завантажений, реклама закрита достроково, або показ завершився помилкою.
 */
export async function showGigaRewardedAd(): Promise<boolean> {
  if (typeof window === "undefined" || typeof window.showGiga !== "function") {
    return false;
  }

  try {
    await window.showGiga();
    return true;
  } catch {
    return false;
  }
}
