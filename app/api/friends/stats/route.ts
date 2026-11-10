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
 * повертаються з /api/user/sync. Readonly-агрегування по referrals.
 *
 * Агрегація робиться в SQL (get_referral_stats), а НЕ сумуванням рядків у JS:
 * PostgREST віддає максимум 1000 рядків за запит (db_max_rows), тож у
 * рефовода з >1000 рефералів сума по "першій тисячі" показувала 0.01 TON
 * замість реальних 0.408, а лічильник друзів впирався в 1000.
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

    const { data, error } = await admin.rpc("get_referral_stats", { p_user_id: profile.id }).single();

    if (error) {
      throw new ApiError(500, `failed to load referral stats: ${error.message}`);
    }
    if (!data) throw new ApiError(500, "get_referral_stats returned no data");

    // Number(): bigint/numeric з RPC — число в JSON, але не покладаємось на це
    // мовчки, бо рядок тут зламав би суми на екрані (конкатенація замість додавання).
    const response: ReferralStatsResponse = {
      friends_count: Number(data.friends_count),
      total_earned: Number(data.total_earned),
      pending_reward: Number(data.pending_reward),
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
