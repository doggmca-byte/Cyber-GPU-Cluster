import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import type { WithdrawalHistoryItem, WithdrawalHistoryResponse, WithdrawalStatus } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WithdrawalHistoryRequestBody {
  initData?: string;
}

interface WithdrawPayload {
  net_payout?: number;
  destination_address?: string;
  rejection_reason?: string;
  last_payout_error?: string;
}

const HISTORY_LIMIT = 20;

/**
 * Історія власних заявок на вивід користувача (Fix для "нема відображення
 * заявок на вивід" — раніше єдиним сигналом був одноразовий toast одразу
 * після сабміту в WithdrawModal, після чого статус (approved/rejected/
 * застряг у processing) було неможливо дізнатись з клієнта).
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<WithdrawalHistoryRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .from("transactions")
      .select("id, amount, fee, status, payload, tx_hash, created_at")
      .eq("user_id", profile.id)
      .eq("type", "withdraw")
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    if (error) {
      throw new ApiError(500, `failed to load withdrawal history: ${error.message}`);
    }

    const items: WithdrawalHistoryItem[] = (data ?? []).map((t) => {
      const payload = (t.payload ?? {}) as WithdrawPayload;
      const requestedAmount = Math.abs(t.amount);

      return {
        transaction_id: t.id,
        requested_amount: requestedAmount,
        fee: t.fee,
        net_payout: payload.net_payout ?? requestedAmount - t.fee,
        destination_address: payload.destination_address ?? "",
        status: t.status as WithdrawalStatus,
        rejection_reason: payload.rejection_reason ?? null,
        payout_tx_hash: t.status === "completed" ? t.tx_hash : null,
        created_at: t.created_at,
      };
    });

    const response: WithdrawalHistoryResponse = { items };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
