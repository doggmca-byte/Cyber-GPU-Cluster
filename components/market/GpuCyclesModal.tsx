"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { MinerIcon } from "@/components/miners/MinerIcons";
import {
  HASH_TO_TON_RATE,
  GPU_REVIVAL_MAX_COUNT,
  GPU_REVIVAL_COST_MULTIPLIERS,
  gpuLifecycleCapHash,
} from "@/lib/constants/economy";
import type { GpuTemplate } from "@/types/api";

/**
 * Калькулятор ROI по всіх lifecycle-циклах картки (1 життя + до
 * GPU_REVIVAL_MAX_COUNT оживлень) для обраної кількості одиниць — та сама
 * формула, що й реальний харвест/revive_gpu на бекенді (cap = 1.25×
 * cost_ton×qty на КОЖЕН цикл, вартість оживлення = cost_ton×qty×[75%, 50%,
 * 25%]), тут лише візуалізація наперед, до покупки. Жодних нових розрахунків
 * — суто прев'ю вже наявної механіки (harvest_user_hash / revive_gpu,
 * supabase/migrations/20260819090000_...sql).
 */
export function GpuCyclesModal({
  template,
  maxQuantity,
  onClose,
}: {
  template: GpuTemplate;
  maxQuantity: number;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const [quantity, setQuantity] = useState(1);

  const stats = useMemo(() => {
    const capHash = gpuLifecycleCapHash(template.cost_ton, quantity);
    const capTon = capHash * HASH_TO_TON_RATE;
    const ratePerSecond = template.hash_per_second * quantity;
    const tonPerHour = ratePerSecond * 3600 * HASH_TO_TON_RATE;
    const cycleDurationDays = ratePerSecond > 0 ? capHash / ratePerSecond / 86400 : 0;

    const cycleCosts = [
      template.cost_ton * quantity,
      ...GPU_REVIVAL_COST_MULTIPLIERS.map((m) => template.cost_ton * quantity * m),
    ];

    let cumulativeProfit = 0;
    const cycles = cycleCosts.map((cost, index) => {
      const profit = capTon - cost;
      cumulativeProfit += profit;
      const roiDays = capTon > 0 ? (cost / capTon) * cycleDurationDays : 0;
      return { cycleNumber: index + 1, cost, roiDays, profit, cumulativeProfit };
    });

    const totalCost = cycleCosts.reduce((sum, c) => sum + c, 0);
    const totalProduction = capTon * cycleCosts.length;

    return { capTon, tonPerHour, cycleDurationDays, cycles, totalCost, totalProduction };
  }, [template, quantity]);

  const quantityOptions = Array.from({ length: maxQuantity }, (_, i) => i + 1);
  const fmt = (n: number, digits = 3) => formatNumber(language, n, { maximumFractionDigits: digits });

  return (
    <Modal title={t.market.cycles.title(template.name)} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5">
            <MinerIcon level={template.level} rarity={template.rarity} className="h-5 w-5" />
          </div>
          <p className="min-w-0 truncate text-xs font-semibold text-white">{template.name}</p>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] text-slate-500">{t.market.cycles.quantityLabel}</p>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
            {quantityOptions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuantity(q)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  q === quantity ? "bg-neon-green/10 text-neon-green" : "bg-white/5 text-slate-500 hover:text-slate-300"
                }`}
              >
                {q}×
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="glass-card p-2.5">
            <p className="text-slate-400">{t.market.cycles.goalPerCycle(fmt(stats.capTon, 2))}</p>
          </div>
          <div className="glass-card p-2.5">
            <p className="text-slate-400">{t.market.cycles.productionPerHour(fmt(stats.tonPerHour, 4))}</p>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-500">
          {t.market.cycles.durationPerCycle(fmt(stats.cycleDurationDays, 1))}
        </p>

        <div className="flex flex-col gap-1.5">
          {stats.cycles.map((cycle) => (
            <div
              key={cycle.cycleNumber}
              className="rounded-xl bg-white/[0.03] px-3 py-2 text-[11px] text-slate-300"
            >
              {t.market.cycles.cycleRow(
                cycle.cycleNumber,
                fmt(cycle.cost, 3),
                fmt(cycle.roiDays, 0),
                fmt(cycle.profit, 3),
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-xl bg-white/[0.03] p-2.5 text-center text-[10px]">
          <div>
            <p className="text-slate-500">{t.market.cycles.totalCost}</p>
            <p className="mt-0.5 font-semibold text-slate-200">{fmt(stats.totalCost, 2)}</p>
          </div>
          <div>
            <p className="text-slate-500">{t.market.cycles.totalProduction}</p>
            <p className="mt-0.5 font-semibold text-slate-200">{fmt(stats.totalProduction, 2)}</p>
          </div>
          <div>
            <p className="text-slate-500">{t.market.cycles.netProfit}</p>
            <p className="mt-0.5 font-semibold text-neon-green">
              {fmt(stats.totalProduction - stats.totalCost, 2)}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
