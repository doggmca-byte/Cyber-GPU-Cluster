import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import type { AdminSessionsResponse, AdminSessionStatItem } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Лог сесій для адмінки: зведені показники + денна розбивка.
 *
 * Обидва числа рахує БД (admin_session_totals / admin_session_stats,
 * 20260909120000_user_sessions_log.sql) — жодних списків id через HTTP і
 * жодного ліміту в 1000 рядків PostgREST, скільки б сесій не накопичилось.
 *
 * Джерело даних — user_sessions, який пише /api/user/sync на кожне
 * відкриття застосунку. Це справжній DAU, на відміну від попередніх
 * оцінок за побічними слідами (транзакції/реклама), які не бачили гравця,
 * що зайшов лише зібрати HASH.
 */
export async function GET(request: Request) {
  try {
    await requireAdminAuth();

    const daysParam = Number(new URL(request.url).searchParams.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.trunc(daysParam), 90) : 30;

    const admin = createAdminClient();

    const [totalsRes, statsRes, reachRes] = await Promise.all([
      admin.rpc("admin_session_totals"),
      admin.rpc("admin_session_stats", { p_days: days }),
      admin.rpc("admin_bot_reach"),
    ]);

    if (totalsRes.error) throw rpcErrorToApiError(totalsRes.error);
    if (statsRes.error) throw rpcErrorToApiError(statsRes.error);
    if (reachRes.error) throw rpcErrorToApiError(reachRes.error);

    const totalsRow = totalsRes.data?.[0];
    if (!totalsRow) throw new ApiError(500, "admin_session_totals returned no data");

    const reachRow = reachRes.data?.[0];
    if (!reachRow) throw new ApiError(500, "admin_bot_reach returned no data");

    const items: AdminSessionStatItem[] = (statsRes.data ?? []).map((row) => ({
      day: row.day,
      sessions: row.sessions,
      active_users: row.active_users,
      returning_users: row.returning_users,
      new_users: row.new_users,
    }));

    const response: AdminSessionsResponse = {
      totals: {
        online_now: totalsRow.online_now,
        dau: totalsRow.dau,
        wau: totalsRow.wau,
        mau: totalsRow.mau,
        sessions_today: totalsRow.sessions_today,
        registered: totalsRow.registered,
      },
      reach: {
        reachable: reachRow.reachable,
        blocked: reachRow.blocked,
        no_chat: reachRow.no_chat,
        unknown_reason: reachRow.unknown_reason,
        active7d: reachRow.active7d,
        active7d_reachable: reachRow.active7d_reachable,
        active7d_unreachable: reachRow.active7d_unreachable,
      },
      items,
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
