import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import type { AdminAmbassadorStatItem, AdminAmbassadorStatsResponse } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Аналітика по кожному амбасадору — тепер повністю на боці Postgres
 * (admin_ambassador_stats(), 20260905140000_ambassador_stats_rpc_and_referral_bonus_cleanup.sql).
 *
 * РАНІШЕ рахувалось у JS: агрегація по referrals + окремі .in("user_id", [...сотні UUID...])
 * запити до transactions/user_gpus/user_tasks — це впало живою помилкою
 * "failed to load deposits: Bad Request" щойно в одного амбасадора
 * набралось 474 реферали (список UUID у query-рядку URL перевищив ліміт
 * довжини на проксі-рівні, ще ДО PostgREST). RPC рахує все ВСЕРЕДИНІ БД —
 * жодного списку ID через HTTP, масштабується на будь-яку кількість
 * рефералів.
 *
 * active_referred_count/milestone_met і suspected_farming — сигнали ЛИШЕ
 * для РУЧНОЇ перевірки адміном: ні недобір активних рефералів, ні підозра на
 * накрутку більше НЕ блокують заявку на вивід і НЕ знімають is_ambassador
 * автоматично (продуктове рішення) — рішення "схвалити/відхилити/зняти
 * амбасадора" ухвалює адмін вручну, дивлячись на ці прапорці тут.
 */
export async function GET() {
  try {
    await requireAdminAuth();

    const admin = createAdminClient();

    const { data, error } = await admin.rpc("admin_ambassador_stats");

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "admin_ambassador_stats returned no data");

    const items: AdminAmbassadorStatItem[] = data.map((row) => ({
      telegram_id: row.telegram_id,
      username: row.username,
      first_name: row.first_name,
      referred_count: row.referred_count,
      referred_with_deposit_count: row.referred_with_deposit_count,
      total_real_deposit_ton: row.total_real_deposit_ton,
      active_referred_count: row.active_referred_count,
      inactive_referred_count: row.inactive_referred_count,
      suspected_farming: row.suspected_farming,
      milestone_met: row.milestone_met,
    }));

    const response: AdminAmbassadorStatsResponse = { items };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
