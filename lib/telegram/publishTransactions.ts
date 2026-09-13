import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getTelegramBotToken } from "./verifyInitData";

/**
 * Публічний канал стрічки транзакцій. Не секрет і не налаштування:
 * посилання на нього вже зашите в завданні subscribe_payouts_channel,
 * тримати те саме значення ще й у змінних оточення — зайвий шанс, що
 * вони розійдуться.
 */
const CHANNEL = "@CGPU_transactions";

/**
 * Telegram душить канали приблизно на 20 повідомленнях за хвилину. Беремо
 * із запасом: 3.5 с між дописами — це ~17/хв, і 429 не прилітає навіть на
 * розборі історичної черги.
 */
const SPACING_MS = 3500;

type PendingTransaction = Database["public"]["Functions"]["list_transactions_for_channel"]["Returns"][number];

/**
 * Нік показуємо обрізаним: канал публічний і назавжди індексується, а
 * доводити чесність виплат можна й без того, щоб видавати повні акаунти
 * гравців. Трьох символів достатньо, щоб було видно — виплати йдуть різним
 * живим людям, а не одному й тому ж гаманцю.
 */
export function maskPlayer(username: string | null, firstName: string | null): string {
  const source = username?.trim() || firstName?.trim() || "";
  if (!source) return "anonymous";

  const visible = source.slice(0, 3);
  const masked = `${visible}***`;
  return username?.trim() ? `@${masked}` : masked;
}

/**
 * Хеші зберігаються в base64 (так їх віддає toncenter), а оглядачі блокчейну
 * очікують hex — до того ж base64 містить "+" і "/", які в URL довелося б
 * екранувати. Некоректний хеш краще не показувати зовсім, ніж дати
 * посилання в нікуди.
 */
function txExplorerUrl(txHash: string | null): string | null {
  if (!txHash) return null;
  try {
    const hex = Buffer.from(txHash, "base64").toString("hex");
    if (hex.length !== 64) return null;
    return `https://tonviewer.com/transaction/${hex}`;
  } catch {
    return null;
  }
}

function formatAmount(value: number): string {
  // До 6 знаків, але без хвоста з нулів: 0.300000 -> 0.3, 0.012345 -> 0.012345
  return Number(value.toFixed(6)).toString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${date}, ${time} UTC`;
}

/**
 * Мова дописів — англійська: канал один на всю аудиторію, а вона в нас
 * вісьмимовна (від іспанської до казахської), тож персоналізувати, як у
 * розсилках, тут неможливо. Назва самого каналу теж англійська.
 */
export function formatTransactionPost(tx: PendingTransaction): string {
  const player = maskPlayer(tx.username, tx.first_name);
  const link = txExplorerUrl(tx.tx_hash);
  const lines: string[] = [];

  if (tx.type === "deposit") {
    lines.push("💰 Deposit");
    lines.push(`Player: ${player}`);
    lines.push(`Amount: ${formatAmount(tx.amount)} TON`);
  } else {
    // amount у виплатах від'ємний (списання з балансу), fee утримується з
    // нього — на гаманець гравця приходить різниця. Показуємо саме те, що
    // реально прийшло, інакше канал завищував би виплати на розмір комісії.
    const requested = Math.abs(tx.amount);
    const fee = tx.fee ?? 0;
    lines.push("💸 Withdrawal");
    lines.push(`Player: ${player}`);
    lines.push(`Paid out: ${formatAmount(requested - fee)} TON`);
    if (fee > 0) lines.push(`Fee: ${formatAmount(fee)} TON`);
  }

  lines.push(formatDate(tx.created_at));
  if (link) lines.push(link);

  return lines.join("\n");
}

async function postToChannel(text: string): Promise<void> {
  const token = getTelegramBotToken();
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL,
      text,
      // Прев'ю tonviewer роздуло б кожен допис на пів екрана.
      link_preview_options: { is_disabled: true },
    }),
  });

  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!body?.ok) {
    throw new Error(`sendMessage to ${CHANNEL} failed: ${body?.description ?? res.status}`);
  }
}

export interface PublishResult {
  published: number;
  failed: number;
}

/**
 * Дістає найстаріші неопубліковані транзакції і відправляє їх у канал.
 *
 * Позначка channel_published_at ставиться ЛИШЕ після успішної відправки —
 * тож збій Telegram не з'їдає допис, наступний прогін почне рівно з того
 * самого рядка. Зворотний бік тієї ж медалі: помилка перериває прогін, щоб
 * черга не перемішалась і канал лишався хронологічним.
 */
export async function publishPendingTransactions(
  admin: SupabaseClient<Database>,
  limit: number,
): Promise<PublishResult> {
  const { data: pending, error } = await admin.rpc("list_transactions_for_channel", { p_limit: limit });
  if (error) throw new Error(`failed to list transactions for channel: ${error.message}`);

  let published = 0;

  for (const tx of pending ?? []) {
    try {
      await postToChannel(formatTransactionPost(tx));
    } catch (err) {
      console.error("[publish-transactions] send failed, stopping this run:", err);
      return { published, failed: 1 };
    }

    const { error: markError } = await admin.rpc("mark_transaction_published", { p_id: tx.id });
    if (markError) {
      // Допис уже в каналі. Якщо не вдалось поставити позначку — зупиняємось,
      // інакше наступний прогін опублікує його вдруге.
      console.error("[publish-transactions] published but failed to mark:", markError.message);
      return { published: published + 1, failed: 1 };
    }

    published += 1;
    await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
  }

  return { published, failed: 0 };
}
