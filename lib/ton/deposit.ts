import "server-only";

/**
 * Читання вхідних транзакцій treasury-гаманця через публічний REST API
 * toncenter.com. Без TONCENTER_API_KEY працює, але з жорсткими лімітами —
 * для продакшену отримати ключ на https://toncenter.com/.
 *
 * ВАЖЛИВО: я не міг наживо протестувати цей шлях реальною ончейн-транзакцією
 * (немає фінансованого гаманця в цьому середовищі) — форма відповіді
 * toncenter відтворена за офіційною документацією API v2, але перед
 * продакшеном варто перевірити на реальному тестовому депозиті.
 */

export interface TreasuryTransaction {
  /** base64 transaction hash — те, що йде як p_tx_hash у process_successful_deposit */
  hash: string;
  utime: number;
  valueNanoTon: string;
  comment: string | null;
  sourceAddress: string | null;
}

interface ToncenterMessage {
  source?: string;
  destination?: string;
  value?: string;
  message?: string;
  msg_data?: { text?: string };
}

interface ToncenterTransaction {
  transaction_id?: { hash?: string; lt?: string };
  utime?: number;
  in_msg?: ToncenterMessage;
}

interface ToncenterGetTransactionsResponse {
  ok: boolean;
  result?: ToncenterTransaction[];
}

const TONCENTER_BASE_URL = "https://toncenter.com/api/v2";

export async function fetchTreasuryTransactions(
  treasuryAddress: string,
  // 100, не 30: під навантаженням (багато депозитів від РІЗНИХ користувачів
  // на ту саму treasury-адресу) вузьке вікно ризикувало "виштовхнути" ще не
  // знайдений матч за 30-секундне вікно поллінгу DepositModal — див. Fix у
  // code review (втрачені депозити).
  limit = 100,
): Promise<TreasuryTransaction[]> {
  const url = new URL(`${TONCENTER_BASE_URL}/getTransactions`);
  url.searchParams.set("address", treasuryAddress);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("archival", "false");

  const apiKey = process.env.TONCENTER_API_KEY;
  if (apiKey) {
    url.searchParams.set("api_key", apiKey);
  }

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`toncenter request failed with status ${res.status}`);
  }

  const body = (await res.json()) as ToncenterGetTransactionsResponse;
  if (!body.ok || !Array.isArray(body.result)) {
    throw new Error("toncenter returned an unexpected response shape");
  }

  const transactions: TreasuryTransaction[] = [];
  for (const tx of body.result) {
    const hash = tx.transaction_id?.hash;
    if (!hash || !tx.in_msg) continue;

    transactions.push({
      hash,
      utime: tx.utime ?? 0,
      valueNanoTon: tx.in_msg.value ?? "0",
      comment: tx.in_msg.message ?? tx.in_msg.msg_data?.text ?? null,
      sourceAddress: tx.in_msg.source ?? null,
    });
  }

  return transactions;
}

/** Точний збіг коментаря — унікальний nonce на кожну спробу депозиту виключає повторний матч. */
export function findDepositTransaction(
  transactions: TreasuryTransaction[],
  expectedComment: string,
): TreasuryTransaction | null {
  return transactions.find((tx) => tx.comment === expectedComment) ?? null;
}

export function nanoTonToTon(nanoTon: string): number {
  return Number(BigInt(nanoTon)) / 1_000_000_000;
}
