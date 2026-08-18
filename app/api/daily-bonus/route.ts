import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { DAILY_BONUS_REWARD_TON } from "@/lib/constants/economy";
import type { DailyBonusStatusResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StatusRequestBody {
  initData?: string;
}

/**
 * ТЗ називає цей ендпоінт GET /api/daily-bonus — як і /api/tasks
 * (app/api/tasks/route.ts), реалізовано як POST з initData у тілі: initData
 * несе HMAC-підпис Telegram, і його не варто класти у query string
 * (URL-логи/кеші), а GET-запит з JSON-тілом не є стандартною практикою.
 *
 * Доступність рахується тут ЖИВЦЕМ (без окремого RPC) лише для UI (таймер,
 * стан кнопки) — джерело правди все одно claim_daily_bonus, яка перевіряє той
 * самий кулдаун атомарно під FOR UPDATE в момент самого клейму.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<StatusRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const now = new Date();
    const { canClaim, cooldownSeconds } = computeDailyBonusStatus(profile.last_daily_bonus_at, now);

    const response: DailyBonusStatusResponse = {
      can_claim: canClaim,
      cooldown_seconds: cooldownSeconds,
      reward_amount: DAILY_BONUS_REWARD_TON,
      last_claim_at: profile.last_daily_bonus_at,
      server_time: now.toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Дзеркалить умову доступності з claim_daily_bonus (SQL, supabase/migrations/
 * 20260818120000_daily_bonus.sql): бонус доступний, щойно минуло >= 24 год з
 * останнього клейму АБО настав новий календарний день UTC — те з двох, що
 * настає РАНІШЕ.
 */
function computeDailyBonusStatus(
  lastClaimAt: string | null,
  now: Date,
): { canClaim: boolean; cooldownSeconds: number } {
  if (!lastClaimAt) return { canClaim: true, cooldownSeconds: 0 };

  const last = new Date(lastClaimAt);
  const next24h = last.getTime() + 24 * 60 * 60 * 1000;
  const nextUtcMidnight = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate() + 1);
  const nextAvailableMs = Math.min(next24h, nextUtcMidnight);

  if (now.getTime() >= nextAvailableMs) return { canClaim: true, cooldownSeconds: 0 };

  return {
    canClaim: false,
    cooldownSeconds: Math.ceil((nextAvailableMs - now.getTime()) / 1000),
  };
}
