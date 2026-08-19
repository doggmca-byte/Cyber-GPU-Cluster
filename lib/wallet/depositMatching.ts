import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { nanoTonToTon, parseTelegramIdFromComment, type TreasuryTransaction } from "@/lib/ton/deposit";

type AdminClient = SupabaseClient<Database>;

export interface CreditedDepositResult {
  transaction_id: string;
  tx_hash: string;
  telegram_id: number;
  amount: number;
}

/**
 * Спільна логіка "знайшли транзакції з розпізнаваним telegram_id у
 * коментарі → зарахувати" — використовується і user-flow (/api/wallet/
 * deposit/check), і адмін-санацією (/api/admin/deposits/reconcile), і
 * фоновим воркером (/api/cron/deposits), щоб не дублювати один і той самий
 * алгоритм у трьох місцях.
 *
 * Реальний захист від подвійного зарахування — унікальний частковий індекс
 * transactions_tx_hash_uq на tx_hash усередині process_successful_deposit
 * (той самий RPC, що й раніше). Попередній фільтр по вже наявних tx_hash тут
 * — лише оптимізація (менше зайвих round-trip'ів до RPC при повторних
 * скануваннях того самого вікна транзакцій), а не сама межа безпеки.
 */
export async function creditMatchingDeposits(
  admin: AdminClient,
  transactions: TreasuryTransaction[],
): Promise<CreditedDepositResult[]> {
  const withTelegramId = transactions
    .map((tx) => ({ tx, telegramId: parseTelegramIdFromComment(tx.comment) }))
    .filter((x): x is { tx: TreasuryTransaction; telegramId: number } => x.telegramId !== null);

  if (withTelegramId.length === 0) return [];

  const hashes = withTelegramId.map((x) => x.tx.hash);
  const { data: existing, error: existingError } = await admin
    .from("transactions")
    .select("tx_hash")
    .in("tx_hash", hashes);

  if (existingError) {
    throw new Error(`failed to check already-processed tx hashes: ${existingError.message}`);
  }

  const alreadyProcessed = new Set((existing ?? []).map((t) => t.tx_hash));
  const candidates = withTelegramId.filter((x) => !alreadyProcessed.has(x.tx.hash));
  if (candidates.length === 0) return [];

  // Кешуємо профілі по telegram_id всередині одного проходу — той самий
  // гравець може мати кілька непроведених транзакцій в одному батчі.
  const uniqueTelegramIds = [...new Set(candidates.map((x) => x.telegramId))];
  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, telegram_id")
    .in("telegram_id", uniqueTelegramIds);

  if (profilesError) {
    throw new Error(`failed to load profiles for matched telegram_id comments: ${profilesError.message}`);
  }

  const profileIdByTelegramId = new Map((profiles ?? []).map((p) => [p.telegram_id, p.id]));

  const credited: CreditedDepositResult[] = [];

  for (const { tx, telegramId } of candidates) {
    // Коментар парситься як число, але немає такого профілю — найімовірніше,
    // хтось помилився цифрою або надіслав ще до реєстрації в застосунку.
    // Свідомо ігноруємо (жоден зарахування без реального власника рахунку),
    // а не намагаємось вгадати/створити профіль сам факт наявності платежу.
    const profileId = profileIdByTelegramId.get(telegramId);
    if (!profileId) continue;

    const amountTon = nanoTonToTon(tx.valueNanoTon);
    if (amountTon <= 0) continue;

    const { data, error } = await admin
      .rpc("process_successful_deposit", {
        p_user_id: profileId,
        p_amount: amountTon,
        p_tx_hash: tx.hash,
      })
      .single();

    if (error) {
      // Дві форми "хтось інший це вже зарахував за мить до нас" — обидві
      // безпечний скіп, а не помилка санації:
      //   P0001 "already processed" — власна перевірка process_successful_deposit
      //   (exists-check ДО insert) встигла побачити вже вставлений рядок.
      //   23505 (unique_violation) — TOCTOU-гонка: наш власний exists-check
      //   пройшов (рядка ще не було), але паралельний виклик (cron і ручна
      //   кнопка "Перевірити оплату"/адмін-санація майже одночасно) вставив
      //   свій рядок ПЕРШИМ між нашим exists і insert — тоді сам INSERT
      //   впаде на унікальному індексі transactions_tx_hash_uq. Без цієї
      //   гілки цілком очікувана, нешкідлива гонка сплила б як 500-ка.
      if (error.code === "P0001" && /already processed/i.test(error.message)) continue;
      if (error.code === "23505") continue;
      throw new Error(`failed to credit deposit ${tx.hash} (telegram_id ${telegramId}): ${error.message}`);
    }

    if (data) {
      credited.push({
        transaction_id: data.transaction_id,
        tx_hash: tx.hash,
        telegram_id: telegramId,
        amount: amountTon,
      });
    }
  }

  return credited;
}
