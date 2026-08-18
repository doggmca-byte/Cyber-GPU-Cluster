import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import {
  DAILY_BONUS_MIN_AD_INTERACTIONS,
  DAILY_BONUS_MIN_AD_WATCH_SECONDS,
  DAILY_BONUS_REWARD_TON,
} from "@/lib/constants/economy";
import type { DailyBonusClaimResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClaimRequestBody {
  initData?: string;
  /** Кількість РІЗНИХ рекламних кнопок, натиснутих у DailyBonusModal. */
  ad_interactions?: number;
  /** Скільки секунд користувач "провів на цільовій сторінці" (той самий таймер). */
  ad_watch_seconds?: number;
}

/**
 * Клієнт (DailyBonusModal) викликає цей роут лише після успішного резолву
 * промісу Monetag SDK (showRewardedAd("pop"), lib/ads/monetag.ts). Так само,
 * як і в /api/ads/watch, Monetag не надсилає server-side callback сюди, тож
 * ad_interactions/ad_watch_seconds (UI-чекліст: 2+ різні кнопки, 5+ секунд
 * на сторінці) — це не криптографічний доказ, лише мінімальний server-side
 * гейт проти прямого виклику API без проходження UI-флоу. Реальний захист
 * від подвійного нарахування — кулдаун у claim_daily_bonus, атомарний під
 * FOR UPDATE.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ClaimRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");

    const adInteractions = body.ad_interactions ?? 0;
    const adWatchSeconds = body.ad_watch_seconds ?? 0;

    if (adInteractions < DAILY_BONUS_MIN_AD_INTERACTIONS) {
      throw new ApiError(
        400,
        `at least ${DAILY_BONUS_MIN_AD_INTERACTIONS} distinct ad interactions are required`,
      );
    }
    if (adWatchSeconds < DAILY_BONUS_MIN_AD_WATCH_SECONDS) {
      throw new ApiError(
        400,
        `must stay on the ad session for at least ${DAILY_BONUS_MIN_AD_WATCH_SECONDS} seconds`,
      );
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("claim_daily_bonus", {
        p_user_id: profile.id,
        p_reward_amount: DAILY_BONUS_REWARD_TON,
      })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "claim_daily_bonus returned no data");

    const response: DailyBonusClaimResponse = {
      reward_amount: DAILY_BONUS_REWARD_TON,
      game_balance: data.game_balance,
      withdrawable_balance: data.withdrawable_balance,
      last_daily_bonus_at: data.last_daily_bonus_at,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
