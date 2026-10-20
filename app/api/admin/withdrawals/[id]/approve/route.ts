import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { runPayoutWorker, MAX_AUTO_PAYOUT_TON } from "@/lib/ton/payoutWorker";
import type { AdminApproveResponse } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Захисна межа: заявки понад цю суму НЕ надсилаються автоматично, навіть у
// auto-режимі — вимагають ручного втручання (manual-режим), щоб один баг чи
// скомпрометована admin-сесія не спорожнили скарбницю одним кліком.
// Та сама межа діє у воркері для автовиплат.
function getMaxAutoPayoutTon(): number {
  return MAX_AUTO_PAYOUT_TON;
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

  // Поки автовідправка по цій заявці ще може дійти в мережу, ручне
  // підтвердження заборонене: ручна оплата адміном + запізніле
  // автоповідомлення — це дві виплати за одну заявку.
  const { data: current, error: loadError } = await admin
    .from("transactions")
    .select("status, payload")
    .eq("id", transactionId)
    .maybeSingle();
  if (loadError) throw new ApiError(500, `failed to load withdrawal: ${loadError.message}`);
  const attempt = (current?.payload as { payout_attempt?: { valid_until?: string } } | null)?.payout_attempt;
  const validUntilMs = attempt?.valid_until ? Date.parse(attempt.valid_until) : NaN;
  if (current?.status === "processing" && Number.isFinite(validUntilMs) && Date.now() < validUntilMs + 60_000) {
    throw new ApiError(409, "auto payout for this withdrawal is in flight — wait a minute and refresh");
  }

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
 * "Авто" в адмінці — той самий воркер, що й автовиплати (lib/ton/payoutWorker.ts),
 * лише з цією заявкою першою в черзі. Окремого шляху відправки більше немає:
 * два незалежні відправники на один гаманець ділили б seqno і могли б
 * заплатити двічі.
 */
async function approveAutomatically(transactionId: string) {
  const admin = createAdminClient();

  const { data: requested, error: loadError } = await admin
    .from("transactions")
    .select("payload")
    .eq("id", transactionId)
    .maybeSingle();
  if (loadError) throw new ApiError(500, `failed to load withdrawal: ${loadError.message}`);
  const netPayout = Number((requested?.payload as { net_payout?: number | string } | null)?.net_payout);
  const maxAutoPayout = getMaxAutoPayoutTon();
  if (Number.isFinite(netPayout) && netPayout > maxAutoPayout) {
    throw new ApiError(
      400,
      `net payout ${netPayout} TON exceeds the auto-payout limit of ${maxAutoPayout} TON — use manual mode`,
    );
  }

  const worker = await runPayoutWorker({ trigger: "admin", priorityTransactionId: transactionId });

  if (worker.skipped === "disabled") {
    throw new ApiError(409, "auto payouts are disabled (AUTO_PAYOUTS_DISABLED=1) — use manual mode");
  }

  const { data: tx, error } = await admin
    .from("transactions")
    .select("id, status, tx_hash")
    .eq("id", transactionId)
    .maybeSingle();

  if (error) throw new ApiError(500, `failed to load withdrawal: ${error.message}`);
  if (!tx) throw new ApiError(404, "withdrawal not found");

  if (tx.status !== "completed" || !tx.tx_hash) {
    const reason =
      worker.skipped === "locked" ? "another payout run is in progress" : worker.stopped ?? "not settled yet";
    throw new ApiError(409, `withdrawal is ${tx.status}: ${reason} — refresh in a minute`);
  }

  const response: AdminApproveResponse = {
    transaction_id: tx.id,
    status: tx.status,
    tx_hash: tx.tx_hash,
  };
  return NextResponse.json(response);
}
