"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Radio } from "lucide-react";
import type { AdminSessionsResponse, AdminSessionStatItem, AdminSessionTotals } from "@/types/admin";

const RANGES = [7, 30, 90] as const;

/**
 * Вкладка "Сесії": справжній DAU з логу user_sessions (рядок на кожне
 * відкриття застосунку, вікно сесії 30 хв — перезавантаження сторінки не
 * рахується як новий вхід).
 *
 * Раніше активність доводилось оцінювати за побічними слідами (транзакції,
 * реклама, завдання) — той, хто зайшов лише зібрати HASH, у ті числа не
 * потрапляв узагалі. Тут такого перекосу вже немає.
 */
export function SessionsPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AdminSessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/sessions?days=${days}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        onSessionExpired();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }
      setData((await res.json()) as AdminSessionsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [days, onSessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate font-display text-base font-bold">Сесії та DAU</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={isLoading}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-neon-cyan/40 hover:text-neon-cyan disabled:opacity-50"
        >
          <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
          Оновити
        </button>
      </div>

      {error && <div className="glass-card p-4 text-sm text-red-400">{error}</div>}

      {data === null && !error && (
        <div className="glass-card animate-pulse p-4 text-sm text-white/40">Завантаження...</div>
      )}

      {data && (
        <>
          <TotalsGrid totals={data.totals} />

          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDays(r)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                  r === days ? "bg-neon-cyan/10 text-neon-cyan" : "bg-white/5 text-white/50 hover:text-white/80"
                }`}
              >
                {r} днів
              </button>
            ))}
          </div>

          <DailyTable items={data.items} />
        </>
      )}
    </div>
  );
}

function TotalsGrid({ totals }: { totals: AdminSessionTotals }) {
  const cells: Array<{ label: string; value: number; accent?: string }> = [
    { label: "Онлайн зараз", value: totals.online_now, accent: "text-neon-green" },
    { label: "DAU сьогодні", value: totals.dau, accent: "text-neon-cyan" },
    { label: "Сесій сьогодні", value: totals.sessions_today },
    { label: "WAU (7 днів)", value: totals.wau, accent: "text-neon-cyan" },
    { label: "MAU (30 днів)", value: totals.mau, accent: "text-neon-purple" },
    { label: "Зареєстровано", value: totals.registered },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="glass-card p-2.5">
          <p className="truncate text-[10px] uppercase tracking-wide text-white/40">{c.label}</p>
          <p className={`mt-1 font-mono text-base font-bold tabular-nums ${c.accent ?? "text-white"}`}>
            {c.value.toLocaleString("uk-UA")}
          </p>
        </div>
      ))}
    </div>
  );
}

function DailyTable({ items }: { items: AdminSessionStatItem[] }) {
  if (items.length === 0) {
    return <div className="glass-card p-6 text-center text-sm text-white/40">Ще немає жодної сесії.</div>;
  }

  // Смужка масштабується від найактивнішого дня в обраному діапазоні —
  // так видно форму динаміки, а не абсолютні значення.
  const peak = Math.max(...items.map((i) => i.active_users), 1);

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-[10px] uppercase tracking-wide text-white/40">
        <span className="w-20 shrink-0">День</span>
        <span className="flex-1">Активні</span>
        <span className="w-12 shrink-0 text-right">Сесій</span>
        <span className="w-12 shrink-0 text-right">Верн.</span>
        <span className="w-12 shrink-0 text-right">Нових</span>
      </div>

      <div className="flex flex-col">
        {items.map((item) => (
          <div
            key={item.day}
            className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-[11px] last:border-b-0"
          >
            <span className="w-20 shrink-0 font-mono tabular-nums text-white/60">{item.day.slice(5)}</span>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-neon-cyan"
                  style={{ width: `${(item.active_users / peak) * 100}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono font-bold tabular-nums text-neon-cyan">
                {item.active_users}
              </span>
            </div>

            <span className="w-12 shrink-0 text-right font-mono tabular-nums text-white/50">{item.sessions}</span>
            <span className="w-12 shrink-0 text-right font-mono tabular-nums text-neon-green">
              {item.returning_users}
            </span>
            <span className="w-12 shrink-0 text-right font-mono tabular-nums text-white/50">{item.new_users}</span>
          </div>
        ))}
      </div>

      <p className="flex items-center gap-1.5 px-3 py-2 text-[10px] text-white/30">
        <Radio size={10} />
        Дні за UTC. «Верн.» — активні, що зареєструвалися раніше цього дня.
      </p>
    </div>
  );
}
