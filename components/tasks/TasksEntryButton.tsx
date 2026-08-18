"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ListChecks, ChevronRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import type { TasksResponse } from "@/types/api";

/**
 * Кнопка "ЗАВДАННЯ" на головному (Farm) екрані. Робить власний легкий запит
 * до /api/tasks лише заради лічильників (скільки виконано / скільки готово
 * забрати) — повний список та дії живуть на /tasks. Якщо запит не встиг чи
 * впав — кнопка все одно клікабельна, просто без бейджа.
 */
export function TasksEntryButton({ initData }: { initData: string }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<{ completed: number; total: number; claimable: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<TasksResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        const claimable = data.tasks.filter((task) => task.status === "completed").length;
        setSummary({ completed: data.completed_count, total: data.total_count, claimable });
      })
      .catch(() => {
        // мовчазний фолбек — кнопка лишається робочою без бейджа
      });

    return () => {
      cancelled = true;
    };
  }, [initData]);

  const hasClaimable = (summary?.claimable ?? 0) > 0;

  return (
    <Link href="/tasks" className="glass-card flex items-center justify-between gap-2 px-3.5 py-2.5 transition active:scale-[0.98]">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-neon-purple/10 text-neon-purple">
          <ListChecks size={16} />
        </div>
        <div>
          <p className="text-xs font-semibold text-white">{t.tasks.openButton}</p>
          {summary && (
            <p className="text-[10px] text-slate-500">{t.tasks.progress(summary.completed, summary.total)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {hasClaimable && (
          <span className="rounded-full bg-neon-gold px-1.5 py-0.5 text-[10px] font-bold text-background">
            {summary?.claimable}
          </span>
        )}
        <ChevronRight size={14} className="text-slate-600" />
      </div>
    </Link>
  );
}
