import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { ExchangeResponse, ExchangeTargetBalance } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExchangeRequestBody {
  initData?: string;
  hash_amount?: number;
  target_balance?: ExchangeTargetBalance;
}

// API приймає короткі імена, RPC — повні назви колонок profiles
const TARGET_COLUMN: Record<ExchangeTargetBalance, "withdrawable_balance" | "game_balance"> = {
  withdrawable: "withdrawable_balance",
  game: "game_balance",
};

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ExchangeRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const hashAmount = body.hash_amount;
    if (typeof hashAmount !== "number" || !Number.isFinite(hashAmount) || hashAmount <= 0) {
      throw new ApiError(400, "hash_amount must be a positive number");
    }

    if (!body.target_balance || !(body.target_balance in TARGET_COLUMN)) {
      throw new ApiError(400, "target_balance must be 'withdrawable' or 'game'");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("exchange_hash_to_ton", {
        p_user_id: profile.id,
        p_hash_amount: hashAmount,
        p_target_balance: TARGET_COLUMN[body.target_balance],
      })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "exchange_hash_to_ton returned no data");

    const response: ExchangeResponse = {
      hash_balance: data.hash_balance,
      game_balance: data.game_balance,
      withdrawable_balance: data.withdrawable_balance,
      ton_credited: data.ton_credited,
      fee_charged: data.fee_charged,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
