import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { AdWatchResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Реальний показ триває не менше за це від відкриття спроби до її зарахування.
const MIN_ATTEMPT_AGE_MS = 10_000;
// Спроба, відкрита давно, вже не вважається "цим" показом.
const MAX_ATTEMPT_AGE_MS = 15 * 60 * 1000;
// Пауза між двома зарахованими показами одного гравця.
const MIN_GAP_BETWEEN_ADS_MS = 20_000;
// Скільки реклам для виводу можна зарахувати за добу (нормальна потреба — 20).
const MAX_ADS_PER_DAY = 60;

interface AdWatchRequestBody {
  initData?: string;
  attempt_id?: string;
}

/**
 * Зарахування реклами для квоти виводу від мереж БЕЗ серверного підтвердження
 * (GigaPub, AdsGram) — Monetag зараховується окремо через S2S-постбек.
 *
 * Це не доказ перегляду, тому тут обмеження, що роблять накрутку прямими
 * викликами повільною й обмеженою, а не безкоштовною: показ має бути прив'язаний
 * до спроби, відкритої сервером ДО нього (/api/ads/monetag/start-attempt),
 * спробу можна зарахувати лише один раз і не раніше ніж через 10 с, між
 * показами обов'язкова пауза 20 с, а за добу — не більше 60. Разом із капчею
 * й правилами самого виводу 20 реклам коштують щонайменше ~7 хв реального часу.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<AdWatchRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");
    if (!body.attempt_id || typeof body.attempt_id !== "string") {
      throw new ApiError(400, "attempt_id is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const now = Date.now();
    const { data: recent, error: recentError } = await admin
      .from("ad_verification_attempts")
      .select("confirmed_at")
      .eq("user_id", profile.id)
      .eq("purpose", "withdraw_ad_watch")
      .eq("status", "confirmed")
      .gte("confirmed_at", new Date(now - 24 * 60 * 60 * 1000).toISOString())
      .order("confirmed_at", { ascending: false })
      .limit(MAX_ADS_PER_DAY);
    if (recentError) throw new ApiError(500, `failed to load ad history: ${recentError.message}`);

    if ((recent?.length ?? 0) >= MAX_ADS_PER_DAY) throw new ApiError(429, "daily_ad_limit_reached");
    const lastAt = recent?.[0]?.confirmed_at ? Date.parse(recent[0].confirmed_at) : 0;
    if (lastAt && now - lastAt < MIN_GAP_BETWEEN_ADS_MS) throw new ApiError(429, "too_fast");

    // Атомарно "споживаємо" спробу: один показ — одне зарахування.
    const { data: claimed, error: claimError } = await admin
      .from("ad_verification_attempts")
      .update({ status: "confirmed", confirmed_at: new Date(now).toISOString(), reported_reward_event_type: "client_trust" })
      .eq("id", body.attempt_id)
      .eq("user_id", profile.id)
      .eq("purpose", "withdraw_ad_watch")
      .eq("status", "pending")
      .lte("created_at", new Date(now - MIN_ATTEMPT_AGE_MS).toISOString())
      .gte("created_at", new Date(now - MAX_ATTEMPT_AGE_MS).toISOString())
      .select("id")
      .maybeSingle();
    if (claimError) throw new ApiError(500, `failed to claim attempt: ${claimError.message}`);
    if (!claimed) throw new ApiError(400, "attempt_invalid");

    const { data, error } = await admin.rpc("record_ad_watch", { p_user_id: profile.id }).single();
    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "record_ad_watch returned no data");

    const response: AdWatchResponse = {
      ads_watched_since_withdraw: data.ads_watched_since_withdraw,
      withdrawal_quota: data.withdrawal_quota,
      server_time: new Date().toISOString(),
    };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
