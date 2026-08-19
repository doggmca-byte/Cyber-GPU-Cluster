import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { AdminGrantResponse } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GrantRequestBody {
  telegram_id?: number;
  amount?: number;
}

/**
 * Ручне нарахування TON на game_balance користувача за telegram_id
 * (admin_grant_balance RPC, 20260819130000_ambassadors_manual_grants_and_exchange_referral.sql).
 * Маркується is_manual: true на боці RPC — навмисно НЕ викликає
 * process_successful_deposit, тому НЕ нараховує 5% реф-revshare і НЕ рахується
 * в "реальні депозити рефералів" (Адмінка → "Статистика амбасадорів",
 * /api/admin/ambassadors/stats відбирає лише type = 'deposit').
 */
export async function POST(request: Request) {
  try {
    const admin_identity = await requireAdminAuth();

    const body = await readJsonBody<GrantRequestBody>(request);
    const telegramId = body.telegram_id;
    if (typeof telegramId !== "number" || !Number.isFinite(telegramId) || telegramId <= 0) {
      throw new ApiError(400, "telegram_id must be a positive number");
    }
    if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
      throw new ApiError(400, "amount must be a positive number");
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, telegram_id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (profileError) {
      throw new ApiError(500, `failed to load profile: ${profileError.message}`);
    }
    if (!profile) {
      throw new ApiError(404, "профіль не знайдено — користувач ще не відкривав застосунок");
    }

    const { data, error } = await admin
      .rpc("admin_grant_balance", {
        p_admin_telegram_id: admin_identity.telegramId,
        p_user_id: profile.id,
        p_amount: body.amount,
      })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "admin_grant_balance returned no data");

    const response: AdminGrantResponse = {
      telegram_id: profile.telegram_id,
      amount: body.amount,
      game_balance: data.game_balance,
      withdrawable_balance: data.withdrawable_balance,
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
