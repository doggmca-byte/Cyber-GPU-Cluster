import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import type { AdminAmbassadorStatItem, AdminAmbassadorStatsResponse } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Аналітика по кожному амбасадору: скільки рефералів запросив, скільки з них
 * зробили хоча б 1 реальний депозит, і на яку суму сумарно. "Реальний депозит"
 * = transactions.type = 'deposit' AND status = 'completed' — навмисно НЕ
 * включає type = 'admin_grant' (ручні нарахування з /api/admin/grants), тому
 * жодного додаткового is_manual-фільтра тут не треба: типи вже розділені.
 *
 * Ручна агрегація в JS через admin-клієнт (RLS все одно блокує прямий доступ
 * з клієнта) — той самий підхід, що й /api/friends/stats, окремого RPC не
 * потребує, бо все read-only.
 */
export async function GET() {
  try {
    await requireAdminAuth();

    const admin = createAdminClient();

    const { data: ambassadors, error: ambassadorsError } = await admin
      .from("profiles")
      .select("id, telegram_id, username, first_name")
      .eq("is_ambassador", true)
      .order("telegram_id", { ascending: true });

    if (ambassadorsError) {
      throw new ApiError(500, `failed to load ambassadors: ${ambassadorsError.message}`);
    }

    const ambassadorIds = (ambassadors ?? []).map((a) => a.id);

    if (ambassadorIds.length === 0) {
      return NextResponse.json({ items: [] } satisfies AdminAmbassadorStatsResponse);
    }

    const { data: referrals, error: referralsError } = await admin
      .from("referrals")
      .select("referrer_id, referee_id")
      .in("referrer_id", ambassadorIds);

    if (referralsError) {
      throw new ApiError(500, `failed to load referrals: ${referralsError.message}`);
    }

    const refereeIds = [...new Set((referrals ?? []).map((r) => r.referee_id))];

    const depositSumByUser = new Map<string, number>();
    if (refereeIds.length > 0) {
      const { data: deposits, error: depositsError } = await admin
        .from("transactions")
        .select("user_id, amount")
        .eq("type", "deposit")
        .eq("status", "completed")
        .in("user_id", refereeIds);

      if (depositsError) {
        throw new ApiError(500, `failed to load deposits: ${depositsError.message}`);
      }

      for (const tx of deposits ?? []) {
        depositSumByUser.set(tx.user_id, (depositSumByUser.get(tx.user_id) ?? 0) + tx.amount);
      }
    }

    const refereesByAmbassador = new Map<string, string[]>();
    for (const r of referrals ?? []) {
      const list = refereesByAmbassador.get(r.referrer_id) ?? [];
      list.push(r.referee_id);
      refereesByAmbassador.set(r.referrer_id, list);
    }

    const items: AdminAmbassadorStatItem[] = (ambassadors ?? []).map((a) => {
      const referees = refereesByAmbassador.get(a.id) ?? [];
      let withDeposit = 0;
      let totalDeposit = 0;
      for (const refereeId of referees) {
        const sum = depositSumByUser.get(refereeId) ?? 0;
        if (sum > 0) withDeposit += 1;
        totalDeposit += sum;
      }

      return {
        telegram_id: a.telegram_id,
        username: a.username,
        first_name: a.first_name,
        referred_count: referees.length,
        referred_with_deposit_count: withDeposit,
        total_real_deposit_ton: totalDeposit,
      };
    });

    const response: AdminAmbassadorStatsResponse = { items };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
