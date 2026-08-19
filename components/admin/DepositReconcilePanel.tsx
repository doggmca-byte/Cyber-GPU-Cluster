"use client";

import { useState } from "react";
import { Search, Loader2 } from "lucide-react";

interface ReconcileCreditedItem {
  tx_hash: string;
  comment: string;
  amount_ton: number;
}

interface ReconcileResponse {
  telegram_id: number;
  scanned: number;
  matched_comments: number;
  credited: ReconcileCreditedItem[];
  already_processed: number;
}

/**
 * Ручна санація "загублених" депозитів (code review finding: DepositModal
 * тримає перевірку транзакції лише в пам'яті вкладки — якщо вона обірвалась
 * до матчу, TON уже пішов у мережу, а game_balance так і не зарахувався, і
 * ніщо в застосунку більше сам це не перевірить). Шукає по telegram_id
 * власника серед останніх транзакцій treasury (POST /api/admin/deposits/reconcile)
 * і дозараховує все знайдене, чого ще нема в transactions.
 */
export function DepositReconcilePanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [telegramIdInput, setTelegramIdInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<ReconcileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const telegramId = Number(telegramIdInput.trim());
    if (!Number.isFinite(telegramId) || telegramId <= 0) {
      setError("Вкажи коректний Telegram ID");
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/deposits/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id: telegramId }),
      });

      if (res.status === 401 || res.status === 403) {
        onUnauthorized();
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }

      setResult((await res.json()) as ReconcileResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="glass-card p-3.5">
      <p className="text-xs font-semibold text-white/70">Санація загублених депозитів</p>
      <p className="mt-1 text-[11px] text-white/40">
        Шукає серед останніх транзакцій казначейства по коментарях цього гравця й дозараховує все,
        чого ще нема в БД — для випадків, коли верифікація депозиту обірвалась на клієнті (тайм-аут,
        закрита вкладка) і TON так і не був зарахований.
      </p>

      <div className="mt-2.5 flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Telegram ID гравця"
          value={telegramIdInput}
          onChange={(e) => setTelegramIdInput(e.target.value)}
          className="flex-1 rounded-lg border border-white/10 bg-background px-3 py-2 text-xs text-white outline-none focus:border-neon-cyan/60"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={isRunning}
          className="flex items-center gap-1.5 rounded-lg bg-neon-cyan px-3 py-2 text-xs font-semibold text-background transition disabled:opacity-50"
        >
          {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Перевірити
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

      {result && (
        <div className="mt-3 rounded-xl border border-white/10 p-3 text-[11px] text-white/60">
          <p>
            Проскановано транзакцій: {result.scanned} · збігів коментаря: {result.matched_comments} · вже було
            в БД: {result.already_processed}
          </p>
          {result.credited.length === 0 ? (
            <p className="mt-1.5 text-white/40">Нових депозитів для зарахування не знайдено.</p>
          ) : (
            <div className="mt-1.5 flex flex-col gap-1">
              <p className="font-semibold text-neon-green">Дозараховано:</p>
              {result.credited.map((item) => (
                <p key={item.tx_hash} className="font-mono">
                  +{item.amount_ton} TON — {item.tx_hash.slice(0, 12)}…
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
