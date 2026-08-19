"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp } from "lucide-react";
import type { AdminAmbassadorStatItem, AdminAmbassadorStatsResponse } from "@/types/admin";

/**
 * Вкладка "Статистика": по кожному амбасадору — скільки рефералів запросив,
 * скільки з них зробили хоча б 1 реальний депозит, і на яку суму сумарно.
 * "Реальний" = /api/admin/ambassadors/stats рахує лише type='deposit'
 * (ручні нарахування адміна — type='admin_grant' — туди не потрапляють).
 */
export function AmbassadorStatsPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [items, setItems] = useState<AdminAmbassadorStatItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/ambassadors/stats", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        onSessionExpired();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }
      const data = (await res.json()) as AdminAmbassadorStatsResponse;
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold">Статистика амбасадорів</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-neon-cyan/40 hover:text-neon-cyan disabled:opacity-50"
        >
          <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
          Оновити
        </button>
      </div>

      {error && <div className="glass-card p-4 text-sm text-red-400">{error}</div>}

      {items === null && !error && (
        <div className="glass-card animate-pulse p-4 text-sm text-white/40">Завантаження...</div>
      )}

      {items !== null && items.length === 0 && (
        <div className="glass-card p-6 text-center text-sm text-white/40">
          Немає жодного амбасадора — призначай на вкладці "Амбасадори".
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {items?.map((item) => (
          <div key={item.telegram_id} className="glass-card p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                {item.username ? `@${item.username}` : (item.first_name ?? "—")}
              </p>
              <p className="text-[11px] text-white/40">ID: {item.telegram_id}</p>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-white/40">Запрошено</p>
                <p className="font-semibold">{item.referred_count}</p>
              </div>
              <div>
                <p className="text-white/40">З депозитом</p>
                <p className="font-semibold text-neon-cyan">{item.referred_with_deposit_count}</p>
              </div>
              <div>
                <p className="text-white/40">Сума депозитів</p>
                <p className="flex items-center gap-1 font-semibold text-neon-green">
                  <TrendingUp size={11} />
                  {item.total_real_deposit_ton.toFixed(4)} TON
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
