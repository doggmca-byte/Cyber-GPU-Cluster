import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { fetchTreasuryTransactions, findDepositTransactionsForTelegramId } from "@/lib/ton/deposit";
import { creditMatchingDeposits } from "@/lib/wallet/depositMatching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReconcileRequestBody {
  telegram_id?: number;
}

interface ReconcileResponse {
  telegram_id: number;
  scanned: number;
  matched_comments: number;
  credited: Array<{ tx_hash: string; amount_ton: number }>;
}

/**
 * Ручна санація "загублених" депозитів по конкретному telegram_id — для
 * випадків, коли ні автоматичний поллінг у DepositModal одразу після
 * переказу, ні фоновий /api/cron/deposits ще не встигли (або той, хто платив,
 * закрив застосунок і жодного разу не натиснув "Перевірити оплату"). Той
 * самий алгоритм (creditMatchingDeposits, lib/wallet/depositMatching.ts), що
 * й у /api/wallet/deposit/check і /api/cron/deposits — просто без прив'язки
 * до конкретного авторизованого користувача (адмін підставляє telegram_id
 * вручну), тому окремий route з requireAdminAuth().
 */
export async function POST(request: Request) {
  try {
    await requireAdminAuth();

    const body = await readJsonBody<ReconcileRequestBody>(request);
    if (typeof body.telegram_id !== "number" || !Number.isFinite(body.telegram_id)) {
      throw new ApiError(400, "telegram_id must be a number");
    }

    const admin = createAdminClient();
    const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_TON_ADDRESS;
    if (!treasuryAddress) {
      throw new ApiError(500, "server misconfigured: NEXT_PUBLIC_TREASURY_TON_ADDRESS is not set");
    }

    const transactions = await fetchTreasuryTransactions(treasuryAddress, 200);
    const matched = findDepositTransactionsForTelegramId(transactions, body.telegram_id);

    let credited;
    try {
      credited = await creditMatchingDeposits(admin, matched);
    } catch (err) {
      throw new ApiError(500, err instanceof Error ? err.message : "failed to credit matched deposits");
    }

    const response: ReconcileResponse = {
      telegram_id: body.telegram_id,
      scanned: transactions.length,
      matched_comments: matched.length,
      credited: credited.map((c) => ({ tx_hash: c.tx_hash, amount_ton: c.amount })),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
