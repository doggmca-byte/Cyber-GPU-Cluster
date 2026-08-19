import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { PartnerAdWatchResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PartnerAdWatchRequestBody {
  initData?: string;
}

/**
 * Партнерська реклама в Центрі Завдань (вкладка "Партнери") — на відміну від
 * /api/ads/watch (лічильник квоти виводу) цей роут одразу кредитує TON на
 * withdrawable_balance, тож захищений денним лімітом на рівні RPC
 * (record_partner_ad_watch, 20260819170000_partner_ad_watch_reward.sql).
 * Клієнт (PartnerAdsCard) викликає роут лише після успішного резолву
 * showRewardedAdRotating (GigaPub/Monetag) — так само як WatchAdButton,
 * без криптографічного доказу перегляду від провайдера.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<PartnerAdWatchRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("record_partner_ad_watch", { p_user_id: profile.id })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "record_partner_ad_watch returned no data");

    const response: PartnerAdWatchResponse = {
      partner_ads_watched_today: data.partner_ads_watched_today,
      daily_limit: data.daily_limit,
      reward_amount: data.reward_amount,
      withdrawable_balance: data.withdrawable_balance,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
