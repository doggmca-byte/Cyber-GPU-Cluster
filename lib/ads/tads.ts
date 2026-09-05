/**
 * TADS (tads.me) — четвертий рекламний провайдер поряд із Monetag/GigaPub/
 * AdsGram (lib/ads/monetag.ts, gigapub.ts, adsgram.ts), але АРХІТЕКТУРНО
 * інший: це не rewarded-відео в модалці, а Static/TGB-банер, що постійно
 * рендериться у виділеному <div> і веде на зовнішнє посилання по кліку —
 * тому НЕ входить у showRewardedAdRotating() (lib/ads/rewardedAd.ts,
 * навмисно лише "показ ізсередини застосунку без переходу назовні"), а
 * живе окремою карткою (components/tasks/TasksScreen.tsx, TadsBannerCard) з
 * власним постійним контейнером.
 *
 * Скрипт підключається у app/layout.tsx
 * (<Script src="https://w.tads.me/widget.js">) і реєструє window.tads.
 * widgetId — з кабінету tads.me (Publisher → Widgets), заданий через
 * NEXT_PUBLIC_TADS_WIDGET_ID.
 *
 * onClickReward — ЛИШЕ клієнтський сигнал "юзер клікнув банер", НЕ джерело
 * правди для нарахування (як і GigaPub/Monetag клієнтський результат) —
 * реальний кредит іде виключно через S2S webhook (app/api/ads/tads-postback),
 * підтверджений TADS_POSTBACK_SECRET у query. Тут callback лише перемикає UI
 * в стан "очікуємо підтвердження" (polling /api/user/sync, той самий підхід,
 * що й для AdsGram).
 */
declare global {
  interface Window {
    tads?: {
      init(params: {
        widgetId: string;
        type: "static" | "fullscreen";
        debug?: boolean;
        onClickReward?: () => void;
        onShowReward?: () => void;
        onAdsNotFound?: () => void;
      }): TadsController;
    };
  }
}

interface TadsController {
  loadAd(): Promise<void>;
  showAd(): Promise<void>;
}

export const TADS_WIDGET_ID = process.env.NEXT_PUBLIC_TADS_WIDGET_ID ?? "";

/** ID контейнера, у який TADS рендерить банер — формат фіксований їхнім SDK. */
export function tadsContainerId(widgetId: string): string {
  return `tads-container-${widgetId}`;
}

export interface MountTadsAdOptions {
  onClickReward: () => void;
  onAdsNotFound: () => void;
}

/**
 * Ініціалізує static/TGB-банер у контейнер tadsContainerId(TADS_WIDGET_ID)
 * (МАЄ вже бути в DOM — рендериться компонентом ДО виклику цієї функції) і
 * одразу вантажить+показує рекламу. Повертає false, якщо SDK/widgetId не
 * готові — виклик тоді просто нічого не показує (картка лишається
 * порожньою/прихованою), без винятку.
 */
export function mountTadsAd(options: MountTadsAdOptions): boolean {
  if (typeof window === "undefined" || !TADS_WIDGET_ID || typeof window.tads?.init !== "function") {
    return false;
  }

  const controller = window.tads.init({
    widgetId: TADS_WIDGET_ID,
    type: "static",
    onClickReward: options.onClickReward,
    onAdsNotFound: options.onAdsNotFound,
  });

  controller
    .loadAd()
    .then(() => controller.showAd())
    .catch(() => options.onAdsNotFound());

  return true;
}
