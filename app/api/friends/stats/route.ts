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
  // Скільки з приведених рефералів реально пройшли свій перший цикл збору
  // (referrals.has_reached_threshold = true) — той самий прапорець, що й
  // ambassador-онбординговий gate (lib/constants/economy.ts
  // AMBASSADOR_MIN_ACTIVE_REFERRALS, check_ambassador_withdrawal_gate) —
  // тому WithdrawModal показує прогрес амбасадора саме за цим полем, без
  // окремого запиту.
  active_friends_count: number;
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
      .select("pending_reward, total_earned, has_reached_threshold")
      .eq("referrer_id", profile.id);

    if (error) {
      throw new ApiError(500, `failed to load referrals: ${error.message}`);
    }

    const rows = referrals ?? [];
    const response: ReferralStatsResponse = {
      friends_count: rows.length,
      active_friends_count: rows.filter((r) => r.has_reached_threshold).length,
      total_earned: rows.reduce((sum, r) => sum + r.total_earned, 0),
      pending_reward: rows.reduce((sum, r) => sum + r.pending_reward, 0),
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
