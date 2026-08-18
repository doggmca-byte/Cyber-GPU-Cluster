/**
 * Monetag Direct Link — окремий (від rewarded SDK у lib/ads/monetag.ts)
 * монетизаційний канал: звичайне відкриття URL, без промісу
 * завершення/винагороди. Використовується ПОРЯД із showRewardedAd, а не
 * замість нього — жоден бекенд-виклик не повинен гейтитись на успіх цієї
 * функції (немає сигналу "переглянуто", лише факт відкриття посилання).
 */

/**
 * Відкриває Monetag Direct Link (NEXT_PUBLIC_MONETAG_DIRECT_LINK) із
 * token1=<userId> для атрибуції показу конкретному користувачу. У Telegram
 * Mini App — через WebApp.openLink (лишається у Telegram-контексті), інакше
 * — window.open у нову вкладку. Тихо нічого не робить, якщо посилання не
 * налаштоване (env не задано) або викликано поза браузером (SSR).
 */
export function openDirectAdLink(userId?: string | number): void {
  if (typeof window === "undefined") return;

  const directLink = process.env.NEXT_PUBLIC_MONETAG_DIRECT_LINK;
  if (!directLink) return;

  const url = `${directLink}?token1=${userId ?? ""}`;

  if (window.Telegram?.WebApp?.openLink) {
    window.Telegram.WebApp.openLink(url);
  } else {
    window.open(url, "_blank");
  }
}
