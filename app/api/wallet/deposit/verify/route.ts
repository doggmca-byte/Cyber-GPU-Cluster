import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { fetchTreasuryTransactions, findDepositTransaction, nanoTonToTon } from "@/lib/ton/deposit";
import type { DepositVerifyResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DepositVerifyRequestBody {
  initData?: string;
  /** Точний коментар, який клієнт вклав у TON-транзакцію: dep_<profileId>_<nonce> */
  expected_comment?: string;
}

/**
 * Підтверджує депозит РЕАЛЬНОЮ ончейн-транзакцією (не довіряє клієнту суму) —
 * шукає вхідну транзакцію на treasury-адресу з ТОЧНО таким коментарем через
 * toncenter.com, і кредитує рівно ту суму, яка справді прийшла в мережі.
 *
 * expected_comment завжди має починатись з dep_<profileId викликача>_ — інший
 * користувач не може підсунути чужий коментар, бо він прив'язаний до his
 * власного profile.id, а комітанти в мережі незмінні.
 *
 * 404 означає "транзакція ще не потрапила в індексатор" — клієнт повторює
 * запит (див. components/wallet/DepositModal.tsx).
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<DepositVerifyRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }
    if (!body.expected_comment) {
      throw new ApiError(400, "expected_comment is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    if (!body.expected_comment.startsWith(`dep_${profile.id}_`)) {
      throw new ApiError(400, "expected_comment does not match this profile");
    }

    const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_TON_ADDRESS;
    if (!treasuryAddress) {
      throw new ApiError(500, "server misconfigured: NEXT_PUBLIC_TREASURY_TON_ADDRESS is not set");
    }

    let transactions;
    try {
      transactions = await fetchTreasuryTransactions(treasuryAddress);
    } catch (err) {
      throw new ApiError(
        502,
        `failed to reach TON indexer: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }

    const match = findDepositTransaction(transactions, body.expected_comment);
    if (!match) {
      throw new ApiError(
        404,
        "deposit transaction not found yet — it may still be confirming, try again shortly",
      );
    }

    const amountTon = nanoTonToTon(match.valueNanoTon);
    if (amountTon <= 0) {
      throw new ApiError(500, "matched transaction has non-positive value");
    }

    const { data, error } = await admin
      .rpc("process_successful_deposit", {
        p_user_id: profile.id,
        p_amount: amountTon,
        p_tx_hash: match.hash,
      })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "process_successful_deposit returned no data");

    const response: DepositVerifyResponse = {
      credited_amount: amountTon,
      game_balance: data.game_balance,
      withdrawal_quota: data.withdrawal_quota,
      transaction_id: data.transaction_id,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
