import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { fetchTreasuryTransactions, findDepositTransactionsForTelegramId } from "@/lib/ton/deposit";
import { creditMatchingDeposits } from "@/lib/wallet/depositMatching";
import type { DepositCheckResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DepositCheckRequestBody {
  initData?: string;
}

// Наскільки далеко в минуле дивимось за замовчуванням (ручна кнопка
// "Перевірити оплату" в DepositModal) — trohи ширше за буквальні "5-10
// хвилин" із запиту, щоб покрити затримку підтвердження блоку TON і
// можливий розсинхрон годинників клієнт/сервер, не втрачаючи щойно
// відправлений платіж через межу вікна.
const CHECK_WINDOW_SECONDS = 15 * 60;

/**
 * Сканує останні транзакції на treasury-адресу, шукає ті, чий коментар —
 * рівно telegram_id цього користувача (buildDepositMemo, lib/ton/comment.ts),
 * і зараховує всі ще не оброблені (lib/wallet/depositMatching.ts).
 * Викликається і одразу після TonConnect-переказу (DepositModal, кілька
 * автоматичних спроб з паузою), і вручну кнопкою "Перевірити оплату" —
 * ідемпотентно: повторний виклик без нових транзакцій просто поверне
 * credited: [].
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<DepositCheckRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_TON_ADDRESS;
    if (!treasuryAddress) {
      throw new ApiError(500, "server misconfigured: NEXT_PUBLIC_TREASURY_TON_ADDRESS is not set");
    }

    const sinceUtimeSeconds = Math.floor(Date.now() / 1000) - CHECK_WINDOW_SECONDS;

    let transactions;
    try {
      // sinceUtimeSeconds іде прямо у fetchTreasuryTransactions — пагінація
      // (lib/ton/deposit.ts) сама гортає стільки сторінок toncenter, скільки
      // треба, щоб ГАРАНТОВАНО покрити все 15-хвилинне вікно, а не лише
      // останні 100 транзакцій адреси (які під навантаженням могли й не
      // сягати так далеко в минуле).
      transactions = await fetchTreasuryTransactions(treasuryAddress, { sinceUtimeSeconds });
    } catch (err) {
      throw new ApiError(
        502,
        `failed to reach TON indexer: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }

    const mine = findDepositTransactionsForTelegramId(transactions, profile.telegram_id);

    let credited;
    try {
      credited = await creditMatchingDeposits(admin, mine);
    } catch (err) {
      throw new ApiError(500, err instanceof Error ? err.message : "failed to credit matched deposits");
    }

    const { data: fresh, error: profileError } = await admin
      .from("profiles")
      .select("game_balance, withdrawal_quota")
      .eq("id", profile.id)
      .single();

    if (profileError || !fresh) {
      throw new ApiError(
        500,
        `failed to load updated balances: ${profileError?.message ?? "unknown"}`,
      );
    }

    const response: DepositCheckResponse = {
      credited: credited.map((c) => ({ transaction_id: c.transaction_id, tx_hash: c.tx_hash, amount: c.amount })),
      game_balance: fresh.game_balance,
      withdrawal_quota: fresh.withdrawal_quota,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
