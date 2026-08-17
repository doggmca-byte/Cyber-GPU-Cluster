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
 * реальні TON-транзакції виплат після Approve в адмінці — усвідомлений
 * компроміс (див. supabase/migrations/20260817030441_...), обраний замість
 * TON Connect-підпису адміном.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PayoutResult {
  txHash: string;
}

/**
 * Надсилає TON зі скарбниці на destinationAddress і повертає реальний хеш
 * транзакції (для запису в approve_withdrawal). Чекає на інкремент seqno
 * (підтвердження, що зовнішнє повідомлення оброблено мережею), потім шукає
 * відповідну вихідну транзакцію в історії гаманця за адресою одержувача.
 */
export async function sendTreasuryPayout(
  destinationAddress: string,
  amountTon: number,
  comment: string,
): Promise<PayoutResult> {
  const { contract, keyPair, address } = await getTreasuryWallet();

  const to = Address.parse(destinationAddress);
  const seqno = await contract.getSeqno();

  await contract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [
      internal({
        to,
        value: toNano(amountTon.toFixed(9)),
        bounce: false,
        body: comment,
      }),
    ],
  });

  await waitForSeqnoIncrement(contract, seqno);

  const txHash = await findOutgoingTransactionHash(address, to, amountTon);
  if (!txHash) {
    throw new Error(
      "payout was broadcast and seqno advanced, but the resulting transaction could not " +
        "be located yet — check the treasury wallet explorer before retrying, to avoid a double payout",
    );
  }

  return { txHash };
}

async function waitForSeqnoIncrement(
  contract: OpenedContract<WalletContractV5R1>,
  previousSeqno: number,
  { maxAttempts = 8, delayMs = 3000 }: { maxAttempts?: number; delayMs?: number } = {},
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(delayMs);
    const seqno = await contract.getSeqno();
    if (seqno > previousSeqno) return;
  }

  throw new Error("timed out waiting for the treasury wallet to confirm the transaction (seqno unchanged)");
}

interface TonCenterOutMessage {
  destination?: string;
  value?: string;
}

interface TonCenterTransaction {
  transaction_id?: { hash?: string };
  utime?: number;
  out_msgs?: TonCenterOutMessage[];
}

interface TonCenterGetTransactionsResponse {
  ok: boolean;
  result?: TonCenterTransaction[];
}

/** Шукає щойно відправлену транзакцію серед останніх вихідних з гаманця скарбниці. */
async function findOutgoingTransactionHash(
  treasuryAddress: Address,
  destination: Address,
  amountTon: number,
): Promise<string | null> {
  const url = new URL("https://toncenter.com/api/v2/getTransactions");
  url.searchParams.set("address", treasuryAddress.toString());
  url.searchParams.set("limit", "10");
  url.searchParams.set("archival", "false");

  const apiKey = process.env.TONCENTER_API_KEY;
  if (apiKey) url.searchParams.set("api_key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`toncenter getTransactions failed with status ${res.status}`);
  }

  const body = (await res.json()) as TonCenterGetTransactionsResponse;
  if (!body.ok || !Array.isArray(body.result)) {
    throw new Error("toncenter returned an unexpected response shape");
  }

  const destinationRaw = destination.toRawString();
  const targetNano = toNano(amountTon.toFixed(9));

  for (const tx of body.result) {
    const hash = tx.transaction_id?.hash;
    if (!hash) continue;

    for (const outMsg of tx.out_msgs ?? []) {
      if (!outMsg.destination || !outMsg.value) continue;

      let outDestination: Address;
      try {
        outDestination = Address.parse(outMsg.destination);
      } catch {
        continue;
      }

      if (outDestination.toRawString() !== destinationRaw) continue;
      if (BigInt(outMsg.value) !== targetNano) continue;

      return hash;
    }
  }

  return null;
}
