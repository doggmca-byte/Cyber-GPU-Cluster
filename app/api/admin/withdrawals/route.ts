import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import type { AdminWithdrawalItem, AdminWithdrawalsListResponse } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WithdrawPayload {
  net_payout?: number;
  destination_address?: string;
}

export async function GET() {
  try {
    await requireAdminAuth();

    const admin = createAdminClient();

    const { data: pendingTx, error: txError } = await admin
      .from("transactions")
      .select("id, user_id, amount, fee, payload, created_at")
      .eq("type", "withdraw")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (txError) {
      throw new ApiError(500, `failed to load withdrawals: ${txError.message}`);
    }

    const userIds = [...new Set((pendingTx ?? []).map((t) => t.user_id))];

    const { data: profiles, error: profilesError } =
      userIds.length > 0
        ? await admin.from("profiles").select("id, telegram_id, username, first_name").in("id", userIds)
        : { data: [], error: null };

    if (profilesError) {
      throw new ApiError(500, `failed to load profiles: ${profilesError.message}`);
    }

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    const items: AdminWithdrawalItem[] = (pendingTx ?? []).map((t) => {
      const profile = profileById.get(t.user_id);
      const payload = (t.payload ?? {}) as WithdrawPayload;
      const requestedAmount = Math.abs(t.amount);

      return {
        transaction_id: t.id,
        telegram_id: profile?.telegram_id ?? 0,
        username: profile?.username ?? null,
        first_name: profile?.first_name ?? null,
        requested_amount: requestedAmount,
        fee: t.fee,
        net_payout: payload.net_payout ?? requestedAmount - t.fee,
        destination_address: payload.destination_address ?? "",
        created_at: t.created_at,
      };
    });

    const response: AdminWithdrawalsListResponse = { items };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
