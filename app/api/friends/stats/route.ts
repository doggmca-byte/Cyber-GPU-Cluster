import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StatsRequestBody {
  initData?: string;
}

export interface ReferralStatsResponse {
  friends_count: number;
  total_earned: number;
  pending_reward: number;
  server_time: string;
}

/**
 * Не входив у явний список маршрутів Етапу 4, але без нього нема звідки
 * взяти дані для картки статистики на app/friends — реферальні дані не
 * повертаються з /api/user/sync. Просте readonly-агрегування по referrals,
 * тому окремого RPC не потребує (RLS усе одно блокує прямий доступ з клієнта,
 * читаємо через admin-клієнт, як і решту роутів).
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<StatsRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data: referrals, error } = await admin
      .from("referrals")
      .select("pending_reward, total_earned")
      .eq("referrer_id", profile.id);

    if (error) {
      throw new ApiError(500, `failed to load referrals: ${error.message}`);
    }

    const rows = referrals ?? [];
    const response: ReferralStatsResponse = {
      friends_count: rows.length,
      total_earned: rows.reduce((sum, r) => sum + r.total_earned, 0),
      pending_reward: rows.reduce((sum, r) => sum + r.pending_reward, 0),
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
