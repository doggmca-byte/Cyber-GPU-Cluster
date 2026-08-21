import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartAttemptRequestBody {
  initData?: string;
  purpose?: string;
}

const SUPPORTED_PURPOSES = new Set(["partner_ad_watch"]);

/**
 * Крок ПЕРЕД показом Monetag-реклами (лише коли ротація showByProvider
 * реально обере Monetag — lib/ads/rewardedAd.ts showRewardedAdRotatingWithProvider):
 * заводимо pending-рядок, id якого стає ymid, переданим у
 * window.show_11600101({ymid}). Реальне зарахування відбувається ЛИШЕ в
 * /api/ads/monetag-postback після підтвердження від сервера Monetag —
 * цей роут нічого не нараховує.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<StartAttemptRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");
    if (!body.purpose || !SUPPORTED_PURPOSES.has(body.purpose)) {
      throw new ApiError(400, "unsupported purpose");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data: attempt, error } = await admin
      .from("ad_verification_attempts")
      .insert({ user_id: profile.id, purpose: body.purpose, provider: "monetag" })
      .select("id")
      .single();

    if (error) throw new ApiError(500, `failed to create attempt: ${error.message}`);

    return NextResponse.json({ ymid: attempt.id });
  } catch (error) {
    return handleRouteError(error);
  }
}
