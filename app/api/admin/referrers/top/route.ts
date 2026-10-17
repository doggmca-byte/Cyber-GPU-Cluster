import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import type {
  AdminTopReferrerItem,
  AdminTopReferrersPeriod,
  AdminTopReferrersResponse,
} from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIOD_DAYS: Record<AdminTopReferrersPeriod, number | null> = { "7d": 7, "30d": 30, all: null };
const PAGE_SIZE = 1000;
// Профілі рефоводів тягнемо пачками: довгий .in("id", [...сотні UUID...])
// уже падав на ліміті довжини URL (див. app/api/admin/ambassadors/stats/route.ts).
const ID_CHUNK = 100;
const TOP_LIMIT = 100;

/**
 * Топ рефоводів за депозитами їхніх рефералів.
 *
 * Депозитів мало (десятки-сотні рядків), тож агрегуємо в JS без окремої RPC:
 *   1) усі completed-депозити за період + referrer_id депозитора (many-to-one
 *      embed transactions → profiles, однозначний);
 *   2) deposit_revshare-комісії за той самий період — скільки з цього отримав
 *      сам рефовод;
 *   3) профілі рефоводів пачками по ID_CHUNK.
 * Самозв'язок profiles → profiles (referrer_id) через embed НЕ використовуємо:
 * PostgREST розгортає його у зворотний бік (список рефералів), а не в реферера.
 */
export async function GET(request: Request) {
  try {
    await requireAdminAuth();

    const periodParam = new URL(request.url).searchParams.get("period");
    const period: AdminTopReferrersPeriod =
      periodParam === "7d" || periodParam === "30d" || periodParam === "all" ? periodParam : "30d";
    const days = PERIOD_DAYS[period];
    const since = days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();

    const admin = createAdminClient();

    const deposits: Array<{ user_id: string; amount: number; created_at: string; referrer_id: string | null }> = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = admin
        .from("transactions")
        .select("user_id, amount, created_at, depositor:profiles!user_id(referrer_id)")
        .eq("type", "deposit")
        .eq("status", "completed")
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (since) query = query.gte("created_at", since);

      const { data, error } = await query;
      if (error) throw new ApiError(500, `failed to load deposits: ${error.message}`);

      for (const row of data) {
        const depositor = row.depositor as { referrer_id: string | null } | null;
        deposits.push({
          user_id: row.user_id,
          amount: Number(row.amount),
          created_at: row.created_at,
          referrer_id: depositor?.referrer_id ?? null,
        });
      }
      if (data.length < PAGE_SIZE) break;
    }

    const revshareByReferrer = new Map<string, number>();
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = admin
        .from("transactions")
        .select("user_id, amount")
        .eq("type", "referral_commission")
        .eq("payload->>source", "deposit_revshare")
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (since) query = query.gte("created_at", since);

      const { data, error } = await query;
      if (error) throw new ApiError(500, `failed to load revshare: ${error.message}`);

      for (const row of data) {
        revshareByReferrer.set(row.user_id, (revshareByReferrer.get(row.user_id) ?? 0) + Number(row.amount));
      }
      if (data.length < PAGE_SIZE) break;
    }

    let totalDepositTon = 0;
    let organicDepositTon = 0;
    const byReferrer = new Map<
      string,
      { depositors: Set<string>; deposits: number; total: number; last: string }
    >();

    for (const d of deposits) {
      totalDepositTon += d.amount;
      if (!d.referrer_id) {
        organicDepositTon += d.amount;
        continue;
      }
      const agg = byReferrer.get(d.referrer_id) ?? { depositors: new Set<string>(), deposits: 0, total: 0, last: d.created_at };
      agg.depositors.add(d.user_id);
      agg.deposits += 1;
      agg.total += d.amount;
      if (d.created_at > agg.last) agg.last = d.created_at;
      byReferrer.set(d.referrer_id, agg);
    }

    const top = [...byReferrer.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, TOP_LIMIT);

    const profiles = new Map<
      string,
      { telegram_id: number; username: string | null; first_name: string | null; is_ambassador: boolean }
    >();
    const ids = top.map(([id]) => id);
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data, error } = await admin
        .from("profiles")
        .select("id, telegram_id, username, first_name, is_ambassador")
        .in("id", ids.slice(i, i + ID_CHUNK));
      if (error) throw new ApiError(500, `failed to load referrer profiles: ${error.message}`);
      for (const p of data) profiles.set(p.id, p);
    }

    const items: AdminTopReferrerItem[] = top.flatMap(([id, agg]) => {
      const p = profiles.get(id);
      if (!p) return [];
      return [
        {
          telegram_id: p.telegram_id,
          username: p.username,
          first_name: p.first_name,
          is_ambassador: p.is_ambassador,
          depositors_count: agg.depositors.size,
          deposits_count: agg.deposits,
          total_deposit_ton: agg.total,
          revshare_earned_ton: revshareByReferrer.get(id) ?? 0,
          last_deposit_at: agg.last,
        },
      ];
    });

    const response: AdminTopReferrersResponse = {
      period,
      total_deposit_ton: totalDepositTon,
      organic_deposit_ton: organicDepositTon,
      items,
    };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
