"use client";

import { useState } from "react";
import { LogOut, Wallet, Users, BarChart3, Gift } from "lucide-react";
import { WithdrawalsPanel } from "@/components/admin/WithdrawalsPanel";
import { AmbassadorsPanel } from "@/components/admin/AmbassadorsPanel";
import { AmbassadorStatsPanel } from "@/components/admin/AmbassadorStatsPanel";
import { ManualGrantsPanel } from "@/components/admin/ManualGrantsPanel";

type AdminTab = "withdrawals" | "ambassadors" | "stats" | "grants";

const TABS: Array<{ id: AdminTab; label: string; icon: typeof Wallet }> = [
  { id: "withdrawals", label: "Виведення", icon: Wallet },
  { id: "ambassadors", label: "Амбасадори", icon: Users },
  { id: "stats", label: "Статистика", icon: BarChart3 },
  { id: "grants", label: "Нарахування", icon: Gift },
];

/**
 * Спільна оболонка адмінки: таби + єдина кнопка "Вийти" (раніше жила всередині
 * WithdrawalsPanel і зникала на інших вкладках). onLogout — термінальний вихід
 * (app/admin/page.tsx переводить у стан "logged-out", без авто-релогіну).
 * onSessionExpired — 401/403 з будь-якого /api/admin/* запиту під час роботи
 * (сесія протухла сама) — тихий ретрай /api/admin/telegram-login.
 */
export function AdminShell({
  onSessionExpired,
  onLogout,
}: {
  onSessionExpired: () => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<AdminTab>("withdrawals");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-bold">Адмінка</h1>
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-red-400/40 hover:text-red-400"
        >
          <LogOut size={14} />
          Вийти
        </button>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                active ? "bg-neon-cyan/10 text-neon-cyan" : "bg-white/5 text-white/50 hover:text-white/80"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          );
        })}
      </div>

      {tab === "withdrawals" && <WithdrawalsPanel onSessionExpired={onSessionExpired} />}
      {tab === "ambassadors" && <AmbassadorsPanel onSessionExpired={onSessionExpired} />}
      {tab === "stats" && <AmbassadorStatsPanel onSessionExpired={onSessionExpired} />}
      {tab === "grants" && <ManualGrantsPanel onSessionExpired={onSessionExpired} />}
    </div>
  );
}
