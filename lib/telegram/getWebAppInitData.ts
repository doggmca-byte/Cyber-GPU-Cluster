/** Сирий рядок initData з Telegram WebApp SDK для клієнтських запитів до API. */
export function getWebAppInitData(): string | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp?.initData || null;
}
