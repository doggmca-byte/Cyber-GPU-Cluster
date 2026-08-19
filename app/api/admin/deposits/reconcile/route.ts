import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { findProfileByTelegramId } from "@/lib/api/profile";
import { fetchTreasuryTransactions, nanoTonToTon } from "@/lib/ton/deposit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReconcileRequestBody {
  telegram_id?: number;
}

interface ReconcileCreditedItem {
  tx_hash: string;
  comment: string;
  amount_ton: number;
}

interface ReconcileResponse {
  telegram_id: number;
  scanned: number;
  matched_comments: number;
  credited: ReconcileCreditedItem[];
  already_processed: number;
}

/**
 * Ручна санація "загублених" депозитів (code review finding: verify живе лише
 * в пам'яті відкритої вкладки DepositModal — якщо polling обірвався до матчу,
 * TON уже пішов у мережу, а game_balance так і не зарахувався, і клієнт сам
 * ніколи це не перевірить знову). Дає адміну спосіб знайти й дозарахувати такі
 * транзакції по конкретному telegram_id БЕЗ прямого доступу до БД/toncenter —
 * пере-перевіряє останні транзакції treasury на коментарі dep_<profileId>_...,
 * що належать цьому профілю, і для кожної, яка ще не в public.transactions,
 * викликає process_successful_deposit (той самий шлях, що й /api/wallet/deposit/verify,
 * тому tx_hash-унікальність і нарахування referral revshare там само гарантовані).
 */
export async function POST(request: Request) {
  try {
    await requireAdminAuth();

    const body = await readJsonBody<ReconcileRequestBody>(request);
    if (typeof body.telegram_id !== "number" || !Number.isFinite(body.telegram_id)) {
      throw new ApiError(400, "telegram_id must be a number");
    }

    const admin = createAdminClient();
    const profile = await findProfileByTelegramId(admin, body.telegram_id);
    if (!profile) {
      throw new ApiError(404, `no profile found for telegram_id ${body.telegram_id}`);
    }

    const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_TON_ADDRESS;
    if (!treasuryAddress) {
      throw new ApiError(500, "server misconfigured: NEXT_PUBLIC_TREASURY_TON_ADDRESS is not set");
    }

    const transactions = await fetchTreasuryTransactions(treasuryAddress, 200);
    const commentPrefix = `dep_${profile.id}_`;
    const candidates = transactions.filter((tx) => tx.comment?.startsWith(commentPrefix));

    const credited: ReconcileCreditedItem[] = [];
    let alreadyProcessed = 0;

    for (const tx of candidates) {
      const amountTon = nanoTonToTon(tx.valueNanoTon);
      if (amountTon <= 0) continue;

      const { data, error } = await admin
        .rpc("process_successful_deposit", {
          p_user_id: profile.id,
          p_amount: amountTon,
          p_tx_hash: tx.hash,
        })
        .single();

      if (error) {
        // P0001 з "already processed" — ця транзакція вже колись зарахувалась
        // (звичайний шлях verify встиг першим) — не помилка санації, просто skip.
        if (error.code === "P0001" && /already processed/i.test(error.message)) {
          alreadyProcessed += 1;
          continue;
        }
        throw new ApiError(500, `failed to credit deposit ${tx.hash}: ${error.message}`);
      }

      if (data) {
        credited.push({ tx_hash: tx.hash, comment: tx.comment ?? "", amount_ton: amountTon });
      }
    }

    const response: ReconcileResponse = {
      telegram_id: body.telegram_id,
      scanned: transactions.length,
      matched_comments: candidates.length,
      credited,
      already_processed: alreadyProcessed,
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
