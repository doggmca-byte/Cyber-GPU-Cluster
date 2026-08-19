"use client";

import { useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import type { AdminGrantResponse } from "@/types/admin";

/**
 * Вкладка "Ручне нарахування": кредитує game_balance користувача за
 * telegram_id (admin_grant_balance RPC). Маркується is_manual: true на боці
 * бекенду — БЕЗ 5% реф-revshare рефереру і БЕЗ впливу на статистику "реальних
 * депозитів рефералів" (вкладка "Статистика" рахує лише type='deposit').
 */
export function ManualGrantsPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [telegramIdInput, setTelegramIdInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminGrantResponse | null>(null);

  const submit = async () => {
    const telegramId = Number(telegramIdInput.trim());
    const amount = Number(amountInput.trim().replace(",", "."));

    if (!Number.isFinite(telegramId) || telegramId <= 0) {
      setError("Вкажи коректний Telegram ID");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Вкажи коректну суму TON (> 0)");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id: telegramId, amount }),
      });

      if (res.status === 401 || res.status === 403) {
        onSessionExpired();
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }

      const data = (await res.json()) as AdminGrantResponse;
      setResult(data);
      setAmountInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card p-3.5">
        <p className="text-xs font-semibold text-white/70">Ручне нарахування TON</p>
        <p className="mt-1 text-[11px] text-white/40">
          Нараховує суму на Ігровий баланс (game_balance) користувача за Telegram ID — за нього можна
          лише купувати майнери/потужності, без прямого виведення. Нарахування маркується як ручне
          (is_manual: true): НЕ дає 5% реф-бонусу вищестоящому рефереру і НЕ рахується в статистику
          "реальних депозитів рефералів".
        </p>

        <div className="mt-2.5 flex flex-col gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Telegram ID користувача"
            value={telegramIdInput}
            onChange={(e) => setTelegramIdInput(e.target.value)}
            className="rounded-lg border border-white/10 bg-background px-3 py-2 text-xs text-white outline-none focus:border-neon-cyan/60"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Сума в TON, напр. 0.5"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="rounded-lg border border-white/10 bg-background px-3 py-2 text-xs text-white outline-none focus:border-neon-cyan/60"
          />

          <button
            type="button"
            onClick={() => void submit()}
            disabled={isSubmitting}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-neon-green py-2.5 text-xs font-bold text-background transition active:scale-[0.98] disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
            {isSubmitting ? "Нараховуємо..." : "Нарахувати"}
          </button>
        </div>

        {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

        {result && (
          <div className="mt-3 rounded-xl border border-neon-green/30 bg-neon-green/5 p-3 text-[11px] text-neon-green">
            Нараховано {result.amount.toFixed(4)} TON користувачу ID {result.telegram_id}. Новий Ігровий
            баланс: {result.game_balance.toFixed(4)} TON.
          </div>
        )}
      </div>
    </div>
  );
}
