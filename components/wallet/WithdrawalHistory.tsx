"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Clock, Send, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import type { LanguageCode } from "@/lib/i18n/languages";
import type { WithdrawalHistoryItem, WithdrawalHistoryResponse, WithdrawalStatus } from "@/types/api";

/**
 * Історія власних заявок на вивід — раніше єдиним сигналом про долю заявки
 * був одноразовий toast одразу після сабміту в WithdrawModal (закрив модалку —
 * і статус (approved/rejected/застряг у processing) вже неможливо дізнатись
 * з клієнта). Ледачий фетч: список підвантажується лише коли розгорнуто.
 */
export function WithdrawalHistory({ initData }: { initData: string }) {
  const { t, language } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<WithdrawalHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }

      const data = (await res.json()) as WithdrawalHistoryResponse;
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.wallet.history.loadError);
    } finally {
      setIsLoading(false);
    }
  }, [initData, t.wallet.history.loadError]);

  useEffect(() => {
    if (expanded && items === null && !isLoading) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <div className="glass-card p-3.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between text-xs font-semibold text-slate-300"
      >
        {expanded ? t.wallet.history.toggleHide : t.wallet.history.toggleShow}
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2">
          {isLoading && <p className="text-[11px] text-slate-500">{t.wallet.history.loading}</p>}
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          {!isLoading && !error && items !== null && items.length === 0 && (
            <p className="text-[11px] text-slate-500">{t.wallet.history.empty}</p>
          )}

          {items?.map((item) => (
            <HistoryRow key={item.transaction_id} item={item} language={language} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  item,
  language,
}: {
  item: WithdrawalHistoryItem;
  language: LanguageCode;
}) {
  const { t } = useTranslation();
  const statusMeta = getStatusMeta(item.status, t.wallet.history);

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white">
          {formatNumber(language, item.requested_amount, { maximumFractionDigits: 4 })} {t.common.ton}
        </span>
        <span className={`flex items-center gap-1 text-[10px] font-semibold ${statusMeta.className}`}>
          {statusMeta.icon}
          {statusMeta.label}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">{new Date(item.created_at).toLocaleString(language)}</p>
      <p className="mt-0.5 text-[10px] text-slate-500">
        {t.wallet.history.netAmount(formatNumber(language, item.net_payout, { maximumFractionDigits: 4 }))}
      </p>
      {item.status === "rejected" && item.rejection_reason && (
        <p className="mt-1 text-[10px] text-red-400">{t.wallet.history.reason(item.rejection_reason)}</p>
      )}
    </div>
  );
}

function getStatusMeta(
  status: WithdrawalStatus,
  labels: {
    statusPending: string;
    statusProcessing: string;
    statusCompleted: string;
    statusRejected: string;
    statusFailed: string;
    statusCancelled: string;
  },
): { label: string; className: string; icon: React.ReactNode } {
  switch (status) {
    case "pending":
      return { label: labels.statusPending, className: "text-neon-gold", icon: <Clock size={11} /> };
    case "processing":
      return { label: labels.statusProcessing, className: "text-neon-cyan", icon: <Send size={11} /> };
    case "completed":
      return { label: labels.statusCompleted, className: "text-neon-green", icon: <CheckCircle2 size={11} /> };
    case "rejected":
      return { label: labels.statusRejected, className: "text-red-400", icon: <XCircle size={11} /> };
    case "cancelled":
      return { label: labels.statusCancelled, className: "text-slate-500", icon: <XCircle size={11} /> };
    case "failed":
    default:
      return { label: labels.statusFailed, className: "text-red-400", icon: <AlertTriangle size={11} /> };
  }
}
