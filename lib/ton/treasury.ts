import "server-only";
import {
  TonClient,
  WalletContractV5R1,
  internal,
  fromNano,
  SendMode,
  type OpenedContract,
} from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address, toNano } from "@ton/core";

/**
 * Custodial-гаманець скарбниці: сервер сам зберігає мнемонік-фразу й підписує
 * реальні TON-транзакції виплат — автоматично для кожної заявки
 * (lib/ton/payoutWorker.ts, 20261021120000_auto_withdrawal_payouts.sql).
 *
 * НЕБЕЗПЕЧНО: TREASURY_WALLET_MNEMONIC — це повний контроль над коштами
 * скарбниці. Тримати лише як секрет на сервері (Vercel env, НЕ NEXT_PUBLIC_),
 * ніколи не логувати, ніколи не передавати в жоден HTTP-роут як echo.
 *
 * Тип гаманця — WalletContractV5R1 (дефолт Tonkeeper для цього проєкту).
 * V5R1.create() без явного walletId використовує дефолтний контекст
 * (mainnet, workchain 0, subwallet 0) — саме той, що дає Tonkeeper за
 * замовчуванням для базового гаманця. Якщо адреса скарбниці створена іншою
 * версією/конфігурацією гаманця — getTreasuryWallet() кине чітку помилку
 * невідповідності адрес, а не мовчки надсилатиме з неправильного контракту.
 */

const TONCENTER_BASE_URL = "https://toncenter.com/api/v2/jsonRPC";

interface TreasuryWallet {
  client: TonClient;
  contract: OpenedContract<WalletContractV5R1>;
  keyPair: { publicKey: Buffer; secretKey: Buffer };
  address: Address;
}

let cachedWallet: TreasuryWallet | null = null;

function getConfiguredTreasuryAddress(): Address {
  const raw = process.env.NEXT_PUBLIC_TREASURY_TON_ADDRESS;
  if (!raw) {
    throw new Error("NEXT_PUBLIC_TREASURY_TON_ADDRESS is not set");
  }
  return Address.parse(raw);
}

export async function getTreasuryWallet(): Promise<TreasuryWallet> {
  if (cachedWallet) return cachedWallet;

  const mnemonicRaw = process.env.TREASURY_WALLET_MNEMONIC;
  if (!mnemonicRaw) {
    throw new Error("TREASURY_WALLET_MNEMONIC is not set");
  }

  const mnemonic = mnemonicRaw.trim().split(/\s+/);
  if (mnemonic.length !== 24) {
    throw new Error(`TREASURY_WALLET_MNEMONIC must be 24 words, got ${mnemonic.length}`);
  }

  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });

  const expectedAddress = getConfiguredTreasuryAddress();
  if (!wallet.address.equals(expectedAddress)) {
    throw new Error(
      `TREASURY_WALLET_MNEMONIC derives address ${wallet.address.toString()} ` +
        `(as WalletContractV5R1, default mainnet/workchain-0/subwallet-0 walletId), which ` +
        `does not match NEXT_PUBLIC_TREASURY_TON_ADDRESS (${expectedAddress.toString()}). ` +
        `Wrong mnemonic, or the treasury wallet uses a non-default walletId/subwallet — ` +
        `auto-payout refuses to send from a mismatched address.`,
    );
  }

  const apiKey = process.env.TONCENTER_API_KEY;
  const client = new TonClient({ endpoint: TONCENTER_BASE_URL, apiKey });
  const contract = client.open(wallet);

  cachedWallet = { client, contract, keyPair, address: wallet.address };
  return cachedWallet;
}

export async function getTreasuryBalanceTon(): Promise<number> {
  const { contract } = await getTreasuryWallet();
  const balance = await contract.getBalance();
  return Number(fromNano(balance));
}

export async function getTreasurySeqno(): Promise<number> {
  const { contract } = await getTreasuryWallet();
  return contract.getSeqno();
}

/** Коментар виплати — єдиний ідентифікатор, за яким воркер шукає її в мережі. */
export function payoutComment(transactionId: string): string {
  return `Cyber GPU Cluster withdrawal ${transactionId}`;
}

/**
 * Лише підписує й віддає повідомлення в мережу — без очікувань і без висновків.
 * Будь-яка помилка тут НЕ означає, що грошей не відправлено (toncenter міг
 * прийняти повідомлення і впасти на відповіді), тож викликач ніколи не
 * відкочує заявку за помилкою звідси: що сталось насправді, вирішує лише
 * findTreasuryPayout після validUntil (lib/ton/payoutWorker.ts).
 *
 * validUntil (unix-секунди) зашивається в підпис: після нього гаманець
 * відхилить повідомлення, тож "запізніла" друга виплата неможлива.
 */
export async function sendTreasuryTransfer(args: {
  destinationAddress: string;
  amountTon: number;
  comment: string;
  seqno: number;
  validUntil: number;
}): Promise<void> {
  const { contract, keyPair } = await getTreasuryWallet();

  await contract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno: args.seqno,
    timeout: args.validUntil,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [
      internal({
        to: Address.parse(args.destinationAddress),
        value: toNano(args.amountTon.toFixed(9)),
        bounce: false,
        body: args.comment,
      }),
    ],
  });
}

interface TonCenterOutMessage {
  destination?: string;
  value?: string;
  message?: string;
}

interface TonCenterTransaction {
  transaction_id?: { hash?: string; lt?: string };
  utime?: number;
  out_msgs?: TonCenterOutMessage[];
}

interface TonCenterGetTransactionsResponse {
  ok: boolean;
  result?: TonCenterTransaction[];
}

const HISTORY_PAGE_SIZE = 50;
const HISTORY_MAX_PAGES = 20;

/**
 * Шукає вихідний переказ скарбниці з точно таким коментарем, гортаючи історію
 * назад до sinceUnix. Збіг лише за коментарем (у ньому id заявки) навмисно:
 * адреса й сума можуть повторюватись, а будь-який переказ із цим id означає
 * "виплату вже відправлено" — повторювати не можна.
 *
 * Помилку toncenter кидає далі, а не повертає null: "не вдалось перевірити"
 * ніколи не повинно виглядати як "переказу немає".
 */
export async function findTreasuryPayout(comment: string, sinceUnix: number): Promise<string | null> {
  const { address } = await getTreasuryWallet();
  const apiKey = process.env.TONCENTER_API_KEY;

  let cursor: { lt: string; hash: string } | null = null;

  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const url = new URL("https://toncenter.com/api/v2/getTransactions");
    url.searchParams.set("address", address.toString());
    url.searchParams.set("limit", String(HISTORY_PAGE_SIZE));
    url.searchParams.set("archival", "true");
    if (cursor) {
      url.searchParams.set("lt", cursor.lt);
      url.searchParams.set("hash", cursor.hash);
    }
    if (apiKey) url.searchParams.set("api_key", apiKey);

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`toncenter getTransactions failed with status ${res.status}`);
    }

    const body = (await res.json()) as TonCenterGetTransactionsResponse;
    if (!body.ok || !Array.isArray(body.result)) {
      throw new Error("toncenter returned an unexpected response shape");
    }

    // З курсором перший рядок — це сама транзакція курсора, вона вже переглянута.
    const txs: TonCenterTransaction[] = cursor ? body.result.slice(1) : body.result;
    if (txs.length === 0) return null;

    for (const tx of txs) {
      const hash = tx.transaction_id?.hash;
      if (!hash) continue;
      if ((tx.out_msgs ?? []).some((m) => m.message === comment)) return hash;
    }

    const last: TonCenterTransaction = txs[txs.length - 1];
    if ((last.utime ?? 0) < sinceUnix) return null;
    if (!last.transaction_id?.lt || !last.transaction_id.hash) return null;
    cursor = { lt: last.transaction_id.lt, hash: last.transaction_id.hash };
  }

  throw new Error("treasury history is too long to scan back to the payout start");
}
