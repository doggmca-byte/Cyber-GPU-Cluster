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

interface AdWatchRequestBody {
  initData?: string;
}

/**
 * Adsgram-заглушка: реального SDK перегляду реклами тут немає, роут лише
 * фіксує факт перегляду (викликається клієнтом після завершення показу).
 * Коли підключиться реальний рекламний SDK — саме тут перевіряти його
 * server-side колбек/підпис перед нарахуванням бонусу.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<AdWatchRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("record_ad_watch", { p_user_id: profile.id })
      .single();

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
