import { NextResponse } from "next/server";
import { Address } from "@ton/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { WithdrawResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WithdrawRequestBody {
  initData?: string;
  amount?: number;
  destination_address?: string;
}

/**
 * Створює заявку на вивід TON зі статусом 'pending' (request_withdrawal у БД).
 * Кошти резервуються одразу (списуються з withdrawable_balance) — фактична
 * відправка TON на destination_address і позначення транзакції
 * 'completed'/'failed' відбувається поза межами цього роута (адмін-процес/
 * воркер, не реалізований у цьому етапі).
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<WithdrawRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const amount = body.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new ApiError(400, "amount must be a positive number");
    }

    if (!body.destination_address || body.destination_address.trim().length === 0) {
      throw new ApiError(400, "destination_address is required");
    }

    let destinationAddress: string;
    try {
      // валідація формату TON-адреси (кине помилку на некоректний checksum/формат)
      destinationAddress = Address.parse(body.destination_address.trim()).toString();
    } catch {
      throw new ApiError(400, "destination_address is not a valid TON address");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("request_withdrawal", {
        p_user_id: profile.id,
        p_amount: amount,
        p_destination_address: destinationAddress,
      })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "request_withdrawal returned no data");

    const response: WithdrawResponse = {
      transaction_id: data.transaction_id,
      requested_amount: data.requested_amount,
      fee_charged: data.fee_charged,
      net_payout: data.net_payout,
      destination_address: data.destination_address,
      withdrawable_balance: data.withdrawable_balance,
      withdrawal_quota: data.withdrawal_quota,
      ads_watched_since_withdraw: data.ads_watched_since_withdraw,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
