"use client";

/**
 * Персистенція "незавершеної" спроби депозиту в localStorage — фікс на
 * знахідку code review: раніше verifyDepositWithRetries (DepositModal.tsx)
 * жив ЛИШЕ в пам'яті відкритої вкладки. Якщо застосунок згорнули/закрили
 * (або toncenter не встиг проіндексувати транзакцію за 10×3с), TON уже
 * пішов з гаманця, а game_balance так і не зараховувався — і найгірше,
 * повторний клік "Поповнити" мінтив НОВИЙ nonce й відправляв ДРУГУ
 * транзакцію замість перевірки першої.
 *
 * Зберігаємо comment (dep_<profileId>_<nonce>) одразу після успішного
 * sendTransaction, ДО початку polling — щоб навіть при закритті вкладки
 * посеред перевірки користувач при наступному відкритті DepositModal побачив
 * банер "перевірити попередній депозит" замість того, щоб почати новий.
 */

const STORAGE_PREFIX = "cgc_pending_deposit_";
// Скільки часу ще пропонуємо перевірити стару спробу — довше того реально
// відправлена транзакція вже точно або підтвердилась, або зникла (replaced/
// timeout на боці гаманця); не варто вічно нагадувати про неї.
const RESUME_TTL_MS = 2 * 60 * 60 * 1000; // 2 години

export interface PendingDeposit {
  comment: string;
  createdAt: number;
}

function storageKey(profileId: string): string {
  return `${STORAGE_PREFIX}${profileId}`;
}

export function savePendingDeposit(profileId: string, comment: string): void {
  try {
    const entry: PendingDeposit = { comment, createdAt: Date.now() };
    window.localStorage.setItem(storageKey(profileId), JSON.stringify(entry));
  } catch {
    // localStorage може бути недоступний (приватний режим/квота) — це лише
    // допоміжна сітка безпеки, а не критичний шлях, тихо ігноруємо.
  }
}

export function readPendingDeposit(profileId: string): PendingDeposit | null {
  try {
    const raw = window.localStorage.getItem(storageKey(profileId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingDeposit>;
    if (typeof parsed.comment !== "string" || typeof parsed.createdAt !== "number") {
      window.localStorage.removeItem(storageKey(profileId));
      return null;
    }

    if (Date.now() - parsed.createdAt > RESUME_TTL_MS) {
      window.localStorage.removeItem(storageKey(profileId));
      return null;
    }

    return { comment: parsed.comment, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

export function clearPendingDeposit(profileId: string): void {
  try {
    window.localStorage.removeItem(storageKey(profileId));
  } catch {
    // ignore
  }
}
