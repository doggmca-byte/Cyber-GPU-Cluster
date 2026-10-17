"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, RefreshCw, TrendingUp } from "lucide-react";
import type {
  AdminTopReferrersPeriod,
  AdminTopReferrersResponse,
} from "@/types/admin";

const PERIODS: Array<{ id: AdminTopReferrersPeriod; label: string }> = [
  { id: "7d", label: "7 днів" },
  { id: "30d", label: "30 днів" },
  { id: "all", label: "Весь час" },
];

/**
 * "Статистика" → "Топ рефоводів": усі гравці, відсортовані за сумою реальних
 * депозитів їхніх рефералів (type='deposit', ручні admin_grant не рахуються).
 */
export function TopReferrersPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [period, setPeriod] = useState<AdminTopReferrersPeriod>("30d");
  const [data, setData] = useState<AdminTopReferrersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/referrers/top?period=${period}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        onSessionExpired();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }
      setData((await res.json()) as AdminTopReferrersResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [period, onSessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const referredTon = data ? data.total_deposit_ton - data.organic_deposit_ton : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold">Топ рефоводів за депозитами</h2>
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

      <div className="flex gap-2">
        {PERIODS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPeriod(id)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
              id === period ? "bg-neon-cyan/10 text-neon-cyan" : "bg-white/5 text-white/50 hover:text-white/80"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="glass-card p-4 text-sm text-red-400">{error}</div>}

      {data === null && !error && (
        <div className="glass-card animate-pulse p-4 text-sm text-white/40">Завантаження...</div>
      )}

      {data && (
        <div className="glass-card grid grid-cols-3 gap-2 p-3.5 text-xs">
          <div>
            <p className="text-white/40">Усі депозити</p>
            <p className="font-semibold">{data.total_deposit_ton.toFixed(2)} TON</p>
          </div>
          <div>
            <p className="text-white/40">Від рефералів</p>
            <p className="font-semibold text-neon-cyan">{referredTon.toFixed(2)} TON</p>
          </div>
          <div>
            <p className="text-white/40">Без реферера</p>
            <p className="font-semibold">{data.organic_deposit_ton.toFixed(2)} TON</p>
          </div>
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="glass-card p-6 text-center text-sm text-white/40">
          За цей період жоден реферал не зробив депозит.
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {data?.items.map((item, index) => (
          <div key={item.telegram_id} className="glass-card p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                <span className="text-white/40">#{index + 1}</span>
                <span className="truncate">
                  {item.username ? `@${item.username}` : (item.first_name ?? "—")}
                </span>
                {item.is_ambassador && (
                  <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-neon-gold/10 px-1.5 py-0.5 text-[10px] text-neon-gold">
                    <Crown size={10} />
                    амб.
                  </span>
                )}
              </p>
              <p className="shrink-0 text-[11px] text-white/40">ID: {item.telegram_id}</p>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-white/40">Сума депозитів</p>
                <p className="flex items-center gap-1 font-semibold text-neon-green">
                  <TrendingUp size={11} />
                  {item.total_deposit_ton.toFixed(2)} TON
                </p>
              </div>
              <div>
                <p className="text-white/40">Депозиторів</p>
                <p className="font-semibold text-neon-cyan">
                  {item.depositors_count}
                  <span className="font-normal text-white/40"> / {item.deposits_count} деп.</span>
                </p>
              </div>
              <div>
                <p className="text-white/40">Його комісія</p>
                <p className="font-semibold">{item.revshare_earned_ton.toFixed(3)} TON</p>
              </div>
            </div>

            <p className="mt-2 text-[11px] text-white/40">
              Останній депозит: {new Date(item.last_deposit_at).toLocaleString("uk-UA")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
