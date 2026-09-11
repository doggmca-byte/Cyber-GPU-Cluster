import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { fetchTreasuryTransactions } from "@/lib/ton/deposit";
import { creditMatchingDeposits } from "@/lib/wallet/depositMatching";

/**
 * Не частіше ніж раз на стільки секунд — на весь застосунок, а не на
 * користувача. При ~200 DAU це означає, що ручний переказ (адреса + мемо)
 * зараховується за лічені хвилини після того, як хтось відкрив застосунок,
 * а не наступного ранку кроном.
 */
const SCAN_INTERVAL_SECONDS = 120;

/**
 * Вікно сканування. Добовий крон /api/cron/deposits однаково підбирає все
 * старше, тож тут достатньо останньої доби — вона покриває і випадок, коли
 * застосунок кілька годин ніхто не відкривав.
 */
const SCAN_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Одна сторінка toncenter (100 транзакцій) з великим запасом покриває добу
 * для цієї скарбниці; ліміт — лише страховка від зайвих запитів.
 */
const SCAN_MAX_PAGES = 3;

/**
 * Опортуністичний скан скарбниці: викликається з /api/user/sync через
 * next/server after(), тобто ПІСЛЯ того, як відповідь уже пішла гравцю —
 * вхід у гру не сповільнюється ні на мілісекунду.
 *
 * Логіка зарахування — та сама, що в кроні, у ручній кнопці й в адмін-санації
 * (creditMatchingDeposits): мемо = telegram_id, захист від подвійного
 * зарахування — унікальний tx_hash усередині process_successful_deposit.
 *
 * Ніколи не кидає назовні: це фоновий бекстоп, його збій (напр. транзієнтна
 * 5xx від toncenter) не має впливати ні на що, крім логу.
 */
export async function runOpportunisticDepositScan(admin: SupabaseClient<Database>): Promise<void> {
  try {
    const { data: won, error: claimError } = await admin.rpc("claim_job", {
      p_name: "deposit_scan",
      p_min_interval_seconds: SCAN_INTERVAL_SECONDS,
    });
    if (claimError) {
      console.error("[deposit-scan] claim_job failed:", claimError.message);
      return;
    }
    // Хтось інший уже сканував протягом інтервалу — нічого не робимо.
    if (!won) return;

    const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_TON_ADDRESS;
    if (!treasuryAddress) return;

    const sinceUtimeSeconds = Math.floor(Date.now() / 1000) - SCAN_WINDOW_SECONDS;
    const transactions = await fetchTreasuryTransactions(treasuryAddress, {
      sinceUtimeSeconds,
      maxPages: SCAN_MAX_PAGES,
    });
    const credited = await creditMatchingDeposits(admin, transactions);

    if (credited.length > 0) {
      console.log(`[deposit-scan] credited ${credited.length} deposit(s):`, credited);
    }
  } catch (error) {
    console.error("[deposit-scan] failed:", error);
  }
}
