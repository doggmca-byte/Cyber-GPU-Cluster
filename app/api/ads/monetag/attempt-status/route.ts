import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AttemptStatusRequestBody {
  initData?: string;
  ymid?: string;
}

/**
 * Клієнт опитує цей роут короткими інтервалами ПІСЛЯ того, як Monetag SDK
 * резолвився (реклама показана), доки не прийде реальний postback
 * (app/api/ads/monetag-postback/route.ts) — саме він, а не клієнтський SDK,
 * є єдиним джерелом правди для нарахування. 'pending' тут не помилка —
 * postback може прийти з затримкою в кілька секунд.
 *
 * Повертає ПОВНИЙ набір полів профілю, релевантних для БУДЬ-ЯКОГО з трьох
 * purpose (partner_ad_watch/daily_bonus_watch/withdraw_ad_watch) — так
 * caller сам бере лише те поле, яке йому потрібне, а роут лишається одним
 * спільним для всіх трьох flows, а не окремим під кожен.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<AttemptStatusRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");
    if (!body.ymid) throw new ApiError(400, "ymid is required");

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data: attempt, error: attemptError } = await admin
      .from("ad_verification_attempts")
      .select("status, user_id")
      .eq("id", body.ymid)
      .maybeSingle();

    if (attemptError) throw new ApiError(500, `failed to load attempt: ${attemptError.message}`);
    if (!attempt || attempt.user_id !== profile.id) throw new ApiError(404, "unknown ymid");

    if (attempt.status !== "confirmed") {
      return NextResponse.json({ status: attempt.status });
    }

    const { data: freshProfile, error: profileError } = await admin
      .from("profiles")
      .select(
        "game_balance, withdrawable_balance, withdrawal_quota, ads_watched_since_withdraw, partner_ads_watched_today, partner_ads_reset_date, last_daily_bonus_at",
      )
      .eq("id", profile.id)
      .single();

    if (profileError) throw new ApiError(500, `failed to load updated profile: ${profileError.message}`);

    return NextResponse.json({ status: "confirmed", profile: freshProfile });
  } catch (error) {
    return handleRouteError(error);
  }
}
