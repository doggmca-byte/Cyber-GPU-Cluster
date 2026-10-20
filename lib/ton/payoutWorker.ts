import "server-only";
import { randomUUID } from "node:crypto";
import { Address } from "@ton/core";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findTreasuryPayout,
  getTreasuryBalanceTon,
  getTreasurySeqno,
  payoutComment,
  sendTreasuryTransfer,
} from "@/lib/ton/treasury";

/**
 * Автовиплати заявок на вивід — по одній, одразу після появи заявки.
 *
 * Запускається з трьох місць: після request_withdrawal (after() у
 * /api/wallet/withdraw), кнопкою "Авто" в адмінці і кроном щохвилини
 * (/api/cron/payouts) як страховка. Усі три йдуть через один замок у БД,
 * тож гаманцем у будь-який момент користується рівно один воркер.
 *
 * Головне правило проти подвійних виплат: після того як повідомлення
 * підписане, заявка НІКОЛИ не повертається в pending через помилку (HTTP
 * 400/401/500/таймаут toncenter, обрив функції Vercel — байдуже). Доля
 * заявки вирішується лише історією гаманця:
 *   - є переказ із її id у коментарі            -> completed з цим хешем;
 *   - немає, але validUntil + запас уже минули   -> pending (повідомлення
 *     гарантовано мертве — гаманець його вже не прийме);
 *   - інакше чекаємо, і НОВІ виплати не стартують, поки ця не вирішена.
 *
 * Аварійний вимикач: AUTO_PAYOUTS_DISABLED=1 у змінних оточення Vercel.
 */

/**
 * Заявки понад цю суму автоматично не платяться — лишаються в pending, і їх
 * вирішує адмін вручну. Константа, а не env: щоб стара змінна в Vercel
 * (MAX_AUTO_PAYOUT_TON=50) не підняла межу непомітно.
 */
export const MAX_AUTO_PAYOUT_TON = 15;

const LOCK_NAME = "withdrawal_payouts";
/** Більше за maxDuration роутів (300 с), щоб оренда не спливла під живим воркером. */
const LOCK_LEASE_SECONDS = 330;
/** Після цього нові виплати не стартують — лишається час довести поточну до кінця. */
const START_BUDGET_MS = 150_000;
/** Жорстка межа очікування в межах одного запуску; далі підхопить наступний. */
const HARD_STOP_MS = 270_000;
/** Скільки живе підписане повідомлення гаманця. */
const MESSAGE_TTL_SECONDS = 60;
/** Запас після validUntil на те, щоб переказ точно з'явився в історії toncenter. */
const EXPIRY_GRACE_SECONDS = 60;
/** Після стількох спроб без результату заявка лишається в pending для адміна (адмінське "Авто" все одно може її взяти). */
const MAX_AUTO_ATTEMPTS = 5;
/** На комісію мережі поверх суми виплати. */
const FEE_RESERVE_TON = 0.05;
const POLL_INTERVAL_MS = 3000;
const PAUSE_BETWEEN_PAYOUTS_MS = 1000;

type AdminClient = ReturnType<typeof createAdminClient>;

interface PayoutAttempt {
  seqno?: number;
  valid_until?: string;
  started_at?: string;
}

interface WithdrawPayload {
  net_payout?: number | string;
  destination_address?: string;
  payout_attempts?: number;
  payout_attempt?: PayoutAttempt;
}

export interface PayoutWorkerResult {
  skipped?: "disabled" | "locked";
  /** Чому воркер зупинився, не розібравши чергу (заявка чекає підтвердження, мало TON тощо). */
  stopped?: string;
  paid: string[];
  reverted: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runPayoutWorker(options: {
  trigger: string;
  /** Адмінка: цю заявку беремо першою, навіть якщо автоспроби вичерпані. */
  priorityTransactionId?: string;
}): Promise<PayoutWorkerResult> {
  const result: PayoutWorkerResult = { paid: [], reverted: [] };

  if (process.env.AUTO_PAYOUTS_DISABLED === "1") {
    result.skipped = "disabled";
    return result;
  }

  const admin = createAdminClient();
  const startedAt = Date.now();
  const holder = `${options.trigger}:${randomUUID()}`;

  // Другий захід потрібен на випадок, коли нова заявка з'явилась у ту мить,
  // коли ми вже вирішили, що черга порожня, а її after() ще бачив замок
  // зайнятим і вийшов. Без цього вона чекала б кроном до хвилини.
  for (let round = 0; round < 2; round++) {
    const { data: locked, error: lockError } = await admin.rpc("acquire_job_lock", {
      p_name: LOCK_NAME,
      p_holder: holder,
      p_lease_seconds: LOCK_LEASE_SECONDS,
    });
    if (lockError) throw new Error(`acquire_job_lock failed: ${lockError.message}`);
    if (!locked) {
      if (round === 0) result.skipped = "locked";
      return result;
    }

    try {
      await drainQueue(admin, startedAt, options.priorityTransactionId, result);
    } finally {
      const { error: releaseError } = await admin.rpc("release_job_lock", {
        p_name: LOCK_NAME,
        p_holder: holder,
      });
      if (releaseError) console.error(`[payouts] release_job_lock failed: ${releaseError.message}`);
    }

    if (result.stopped || Date.now() - startedAt > START_BUDGET_MS) break;
    if (!(await hasPendingWithdrawals(admin))) break;
  }

  return result;
}

async function drainQueue(
  admin: AdminClient,
  startedAt: number,
  priorityTransactionId: string | undefined,
  result: PayoutWorkerResult,
): Promise<void> {
  for (;;) {
    // Звірка першою і після кожної відправки: щойно відправлена виплата
    // доводиться до completed у цьому ж запуску, а не висить до наступного.
    const unresolved = await reconcileProcessing(admin, startedAt, result);
    if (unresolved) {
      result.stopped = `waiting for payout ${unresolved} to settle`;
      return;
    }

    if (Date.now() - startedAt >= START_BUDGET_MS) return;

    const next = await loadNextPending(admin, priorityTransactionId);
    if (!next) return;

    const outcome = await startPayout(admin, next);
    if (outcome !== "started") {
      result.stopped = outcome;
      return;
    }

    await sleep(PAUSE_BETWEEN_PAYOUTS_MS);
  }
}

// ------------------------------------------------------------------------------------
// Звірка заявок у 'processing' з історією гаманця
// ------------------------------------------------------------------------------------

/** Повертає id заявки, яка ще не вирішена (тоді нові виплати не стартують), або null. */
async function reconcileProcessing(
  admin: AdminClient,
  startedAt: number,
  result: PayoutWorkerResult,
): Promise<string | null> {
  const { data: rows, error } = await admin
    .from("transactions")
    .select("id, payload")
    .eq("type", "withdraw")
    .eq("status", "processing")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`failed to load processing withdrawals: ${error.message}`);

  for (const row of rows ?? []) {
    const attempt = ((row.payload ?? {}) as WithdrawPayload).payout_attempt;
    const validUntilMs = attempt?.valid_until ? Date.parse(attempt.valid_until) : NaN;
    const startedAtMs = attempt?.started_at ? Date.parse(attempt.started_at) : NaN;

    // 'processing' без даних спроби — спадок старого ручного "Авто" з адмінки.
    // Що з ним, воркер знати не може: таку заявку дотискає адмін хешем вручну.
    if (!Number.isFinite(validUntilMs) || !Number.isFinite(startedAtMs)) continue;

    const settled = await settleOne(admin, row.id, validUntilMs, startedAtMs, startedAt, result);
    if (!settled) return row.id;
  }

  return null;
}

async function settleOne(
  admin: AdminClient,
  transactionId: string,
  validUntilMs: number,
  attemptStartedMs: number,
  runStartedAt: number,
  result: PayoutWorkerResult,
): Promise<boolean> {
  const comment = payoutComment(transactionId);
  const sinceUnix = Math.floor(attemptStartedMs / 1000) - 120;

  for (;;) {
    // Час фіксуємо ДО пошуку: відкат дозволений лише за пошуком, який почався
    // вже після validUntil + запас.
    const checkedAt = Date.now();
    let txHash: string | null;
    try {
      txHash = await findTreasuryPayout(comment, sinceUnix);
    } catch (err) {
      // Не змогли перевірити — це НЕ "переказу немає". Пробуємо ще, поки є час.
      console.error(`[payouts] history check failed for ${transactionId}: ${describeError(err)}`);
      if (Date.now() - runStartedAt > HARD_STOP_MS) return false;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (txHash) {
      const { error } = await admin
        .rpc("approve_withdrawal", { p_transaction_id: transactionId, p_payout_tx_hash: txHash })
        .single();
      if (error) {
        console.error(`[payouts] PAID but approve_withdrawal failed for ${transactionId} (tx ${txHash}): ${error.message}`);
        return false;
      }
      result.paid.push(transactionId);
      return true;
    }

    if (checkedAt > validUntilMs + EXPIRY_GRACE_SECONDS * 1000) {
      const { error } = await admin.rpc("revert_withdrawal_to_pending", {
        p_transaction_id: transactionId,
        p_reason: "payout message expired without reaching the network",
      });
      if (error) {
        console.error(`[payouts] revert_withdrawal_to_pending failed for ${transactionId}: ${error.message}`);
        return false;
      }
      result.reverted.push(transactionId);
      return true;
    }

    if (Date.now() - runStartedAt > HARD_STOP_MS) return false;
    await sleep(POLL_INTERVAL_MS);
  }
}

// ------------------------------------------------------------------------------------
// Старт нової виплати
// ------------------------------------------------------------------------------------

interface PendingWithdrawal {
  id: string;
  destinationAddress: string;
  netPayout: number;
}

function parsePending(row: { id: string; payload: unknown }): PendingWithdrawal | null {
  const payload = (row.payload ?? {}) as WithdrawPayload;
  const netPayout = Number(payload.net_payout);
  const destination = payload.destination_address;
  if (!destination || !Number.isFinite(netPayout) || netPayout <= 0) return null;
  if (netPayout > MAX_AUTO_PAYOUT_TON) return null;
  try {
    Address.parse(destination);
  } catch {
    return null;
  }
  return { id: row.id, destinationAddress: destination, netPayout };
}

async function loadNextPending(
  admin: AdminClient,
  priorityTransactionId: string | undefined,
): Promise<PendingWithdrawal | null> {
  if (priorityTransactionId) {
    const { data, error } = await admin
      .from("transactions")
      .select("id, payload")
      .eq("id", priorityTransactionId)
      .eq("type", "withdraw")
      .eq("status", "pending")
      .maybeSingle();
    if (error) throw new Error(`failed to load withdrawal ${priorityTransactionId}: ${error.message}`);
    const parsed = data ? parsePending(data) : null;
    if (parsed) return parsed;
  }

  const { data: rows, error } = await admin
    .from("transactions")
    .select("id, payload")
    .eq("type", "withdraw")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) throw new Error(`failed to load pending withdrawals: ${error.message}`);

  for (const row of rows ?? []) {
    const payload = (row.payload ?? {}) as WithdrawPayload;
    if (Number(payload.payout_attempts ?? 0) >= MAX_AUTO_ATTEMPTS) continue;
    if (Number(payload.net_payout) > MAX_AUTO_PAYOUT_TON) continue;
    const parsed = parsePending(row);
    if (parsed) return parsed;
    console.error(`[payouts] withdrawal ${row.id} has invalid destination/net_payout — left for manual review`);
  }

  return null;
}

async function hasPendingWithdrawals(admin: AdminClient): Promise<boolean> {
  const { count, error } = await admin
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("type", "withdraw")
    .eq("status", "pending");
  if (error) return false;
  return (count ?? 0) > 0;
}

/**
 * "started" — повідомлення підписане й віддане в мережу (або спроба віддати
 * була): далі заявку веде лише reconcileProcessing. Інше — причина зупинки черги.
 */
async function startPayout(admin: AdminClient, next: PendingWithdrawal): Promise<string> {
  let balance: number;
  let seqno: number;
  try {
    balance = await getTreasuryBalanceTon();
    seqno = await getTreasurySeqno();
  } catch (err) {
    return `treasury unavailable: ${describeError(err)}`;
  }

  if (balance < next.netPayout + FEE_RESERVE_TON) {
    console.error(`[payouts] treasury balance ${balance} TON is not enough for ${next.id} (${next.netPayout} TON)`);
    return `insufficient treasury balance (${balance} TON)`;
  }

  const validUntil = Math.floor(Date.now() / 1000) + MESSAGE_TTL_SECONDS;

  // Спершу фіксуємо в БД seqno і validUntil, і лише потім підписуємо. Якщо
  // функцію обірвуть між цими кроками, звірка знає, до якого моменту
  // повідомлення могло бути прийняте.
  const { error: beginError } = await admin
    .rpc("begin_auto_withdrawal_payout", {
      p_transaction_id: next.id,
      p_seqno: seqno,
      p_valid_until: new Date(validUntil * 1000).toISOString(),
    })
    .single();

  if (beginError) {
    console.error(`[payouts] could not claim ${next.id}: ${beginError.message}`);
    return `could not claim ${next.id}: ${beginError.message}`;
  }

  try {
    await sendTreasuryTransfer({
      destinationAddress: next.destinationAddress,
      amountTon: next.netPayout,
      comment: payoutComment(next.id),
      seqno,
      validUntil,
    });
  } catch (err) {
    // Навмисно без відкату: помилка відправки не доводить, що грошей не пішло.
    console.error(`[payouts] send error for ${next.id} (will be settled from wallet history): ${describeError(err)}`);
  }

  return "started";
}
