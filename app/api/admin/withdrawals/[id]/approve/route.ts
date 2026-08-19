import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { sendTreasuryPayout, AmbiguousPayoutError } from "@/lib/ton/treasury";
import type { AdminApproveResponse } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Захисна межа: заявки понад цю суму НЕ надсилаються автоматично, навіть у
// auto-режимі — вимагають ручного втручання (manual-режим), щоб один баг чи
// скомпрометована admin-сесія не спорожнили скарбницю одним кліком.
const DEFAULT_MAX_AUTO_PAYOUT_TON = 50;

function getMaxAutoPayoutTon(): number {
  const raw = process.env.MAX_AUTO_PAYOUT_TON;
  if (!raw) return DEFAULT_MAX_AUTO_PAYOUT_TON;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_AUTO_PAYOUT_TON;
}

interface ApproveRequestBody {
  mode?: "auto" | "manual";
  payout_tx_hash?: string; // лише для mode="manual"
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminAuth();

    const { id } = await params;
    const body = await readJsonBody<ApproveRequestBody>(request);

    if (body.mode !== "auto" && body.mode !== "manual") {
      throw new ApiError(400, "mode must be 'auto' or 'manual'");
    }

    if (body.mode === "manual") {
      return await approveManually(id, body.payout_tx_hash);
    }

    return await approveAutomatically(id);
  } catch (error) {
    return handleRouteError(error);
  }
}

async function approveManually(transactionId: string, payoutTxHash: string | undefined) {
  if (!payoutTxHash || payoutTxHash.trim().length === 0) {
    throw new ApiError(400, "payout_tx_hash is required for mode='manual'");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .rpc("approve_withdrawal", { p_transaction_id: transactionId, p_payout_tx_hash: payoutTxHash.trim() })
    .single();

  if (error) throw rpcErrorToApiError(error);
  if (!data) throw new ApiError(500, "approve_withdrawal returned no data");

  const response: AdminApproveResponse = {
    transaction_id: data.transaction_id,
    status: data.status,
    tx_hash: data.tx_hash,
  };
  return NextResponse.json(response);
}

/**
 * Custodial авто-виплата: begin_withdrawal_payout атомарно "застовплює"
 * заявку (pending -> processing), щоб паралельний/повторний запит не міг
 * відправити ту саму виплату двічі. Якщо на БУДЬ-ЯКОМУ кроці після цього
 * стається збій ДО фактичної відправки в мережу — відкочуємо назад у
 * pending через revert_withdrawal_to_pending. Якщо гроші вже пішли, але
 * approve_withdrawal чомусь не вдався — НЕ відкочуємо (щоб не дозволити
 * повторну відправку реальних коштів), а повертаємо 500 з хешем транзакції
 * в повідомленні для ручного дорозслідування.
 */
async function approveAutomatically(transactionId: string) {
  const admin = createAdminClient();

  const { data: claim, error: claimError } = await admin
    .rpc("begin_withdrawal_payout", { p_transaction_id: transactionId })
    .single();

  if (claimError) throw rpcErrorToApiError(claimError);
  if (!claim) throw new ApiError(500, "begin_withdrawal_payout returned no data");

  const { destination_address: destinationAddress, net_payout: netPayout } = claim;

  if (!destinationAddress || !Number.isFinite(netPayout) || netPayout <= 0) {
    await revertSafely(admin, transactionId, "missing or invalid payout details in transaction payload");
    throw new ApiError(500, "withdrawal payload is missing destination_address/net_payout");
  }

  const maxAutoPayout = getMaxAutoPayoutTon();
  if (netPayout > maxAutoPayout) {
    await revertSafely(admin, transactionId, `exceeds MAX_AUTO_PAYOUT_TON (${maxAutoPayout})`);
    throw new ApiError(
      400,
      `net payout ${netPayout} TON exceeds the auto-payout limit of ${maxAutoPayout} TON — use manual mode`,
    );
  }

  let payoutTxHash: string;
  try {
    const payout = await sendTreasuryPayout(
      destinationAddress,
      netPayout,
      `Cyber GPU Cluster withdrawal ${transactionId}`,
    );
    payoutTxHash = payout.txHash;
  } catch (err) {
    if (err instanceof AmbiguousPayoutError) {
      // sendTreasuryPayout сам перевірив seqno гаманця й визначив, що
      // виплата, найімовірніше, УЖЕ пішла в мережу попри помилку — НЕ
      // відкочуємо в pending (інакше повторний Approve міг би відправити
      // ту саму виплату вдруге). Заявка лишається в 'processing'
      // (застовплена begin_withdrawal_payout раніше в цій функції) — тепер
      // видима в адмінці (GET /api/admin/withdrawals включає 'processing')
      // з єдиною доступною дією "Ввести хеш вручну", щоб дожати вручну
      // реальним хешем після перевірки в експлорері.
      throw new ApiError(
        500,
        `AMBIGUOUS payout state — do NOT retry auto-approve for this transaction: ${err.message}`,
      );
    }

    // Гроші достеменно НЕ пішли (seqno гаманця лишився незмінним) —
    // безпечно відкотити назад у pending для повторної спроби.
    const message = err instanceof Error ? err.message : "unknown treasury error";
    await revertSafely(admin, transactionId, message);
    throw new ApiError(502, `treasury payout failed: ${message}`);
  }

  const { data: approved, error: approveError } = await admin
    .rpc("approve_withdrawal", { p_transaction_id: transactionId, p_payout_tx_hash: payoutTxHash })
    .single();

  if (approveError) {
    // Гроші ВЖЕ пішли (payoutTxHash отримано) — НЕ чіпаємо статус, щоб не
    // допустити повторної відправки. Хеш є в повідомленні для адміна.
    throw new ApiError(
      500,
      `payout sent (tx_hash=${payoutTxHash}) but failed to finalize in DB: ${approveError.message}. ` +
        `Resolve manually — do NOT retry auto-approve for this transaction.`,
    );
  }

  if (!approved) throw new ApiError(500, "approve_withdrawal returned no data");

  const response: AdminApproveResponse = {
    transaction_id: approved.transaction_id,
    status: approved.status,
    tx_hash: approved.tx_hash,
  };
  return NextResponse.json(response);
}

async function revertSafely(
  admin: ReturnType<typeof createAdminClient>,
  transactionId: string,
  reason: string,
): Promise<void> {
  const { error } = await admin.rpc("revert_withdrawal_to_pending", {
    p_transaction_id: transactionId,
    p_reason: reason,
  });

  if (error) {
    console.error("[admin/approve] failed to revert withdrawal to pending:", transactionId, error);
  }
}
