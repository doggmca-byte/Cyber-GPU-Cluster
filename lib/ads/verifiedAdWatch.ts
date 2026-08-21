import type { Profile } from "@/types/api";

/**
 * Спільний клієнтський шар для трьох rewarded-ad flows застосунку, які
 * реально верифікуються через Monetag S2S postback (app/api/ads/monetag-postback):
 * партнерська реклама (TasksScreen PartnerAdsCard), реклама для щоденного
 * бонусу (DailyBonusModal) і реклама для квоти виводу (WatchAdButton). Кожен
 * flow сам вирішує, що робити з profile-полями у відповіді — тут лише
 * спільний протокол "відкрити спробу -> опитати статус".
 */
export type VerifiedAdPurpose = "partner_ad_watch" | "daily_bonus_watch" | "withdraw_ad_watch";

export type VerifiedProfileFields = Pick<
  Profile,
  | "game_balance"
  | "withdrawable_balance"
  | "withdrawal_quota"
  | "ads_watched_since_withdraw"
  | "partner_ads_watched_today"
  | "partner_ads_reset_date"
  | "last_daily_bonus_at"
>;

/**
 * Крок ПЕРЕД показом реклами — відкриває pending-рядок на бекенді
 * (ad_verification_attempts), id якого стає ymid, переданим у
 * showRewardedAdRotatingWithProvider. Повертає null при будь-якій помилці
 * (мережа, 4xx/5xx) — виклик не блокує юзера, лише вимикає верифікований
 * шлях на користь старого клієнто-довірчого фолбеку для цього конкретного
 * показу.
 */
export async function startVerifiedAttempt(initData: string, purpose: VerifiedAdPurpose): Promise<string | null> {
  try {
    const res = await fetch("/api/ads/monetag/start-attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, purpose }),
    });
    if (!res.ok) return null;
    const { ymid } = (await res.json()) as { ymid: string };
    return ymid ?? null;
  } catch {
    return null;
  }
}

const POLL_ATTEMPTS = 8;
const POLL_DELAY_MS = 2000;

export type VerifiedPollResult =
  | { kind: "confirmed"; profile: VerifiedProfileFields }
  | { kind: "rejected" }
  | { kind: "timeout" };

/**
 * Опитує статус конкретної спроби (ymid) короткими інтервалами ПІСЛЯ того,
 * як Monetag SDK резолвився (реклама показана) — реальний postback від
 * сервера Monetag (не клієнт) приходить із затримкою в кілька секунд.
 */
export async function pollVerifiedAttempt(initData: string, ymid: string): Promise<VerifiedPollResult> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));

    try {
      const res = await fetch("/api/ads/monetag/attempt-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, ymid }),
      });
      if (!res.ok) continue; // тимчасовий збій опитування — просто спробуємо ще раз наступного тику

      const data = (await res.json()) as { status: string; profile?: VerifiedProfileFields };

      if (data.status === "confirmed" && data.profile) {
        return { kind: "confirmed", profile: data.profile };
      }
      if (data.status === "rejected") return { kind: "rejected" };
      // 'pending' — тікаємо далі
    } catch {
      // мережевий збій самого запиту (не лише !res.ok) — так само не фатально,
      // просто пробуємо ще раз наступного тику.
    }
  }

  return { kind: "timeout" };
}
