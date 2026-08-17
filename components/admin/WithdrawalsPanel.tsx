"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X, LogOut, RefreshCw, Wallet, Loader2, PenLine } from "lucide-react";
import type { AdminWithdrawalItem, AdminWithdrawalsListResponse, AdminTreasuryResponse } from "@/types/admin";

type RowMode = { transactionId: string; type: "sending" | "manual" } | null;

/**
 * Панель модерації заявок на вивід. Рендериться лише ПІСЛЯ успішної
 * автентифікації в app/admin/page.tsx.
 *
 * Approve за замовчуванням = авто-режим: сервер сам підписує й надсилає TON
 * зі скарбниці (custodial-гаманець, lib/ton/treasury.ts) одразу після кліку,
 * без ручного введення хешу. "Manual" — запасний шлях для випадків, коли
 * авто-виплата не вдалась або сума перевищує MAX_AUTO_PAYOUT_TON.
 */
export function WithdrawalsPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [items, setItems] = useState<AdminWithdrawalItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [treasuryBalance, setTreasuryBalance] = useState<number | null>(null);
  const [treasuryError, setTreasuryError] = useState<string | null>(null);

  const [mode, setMode] = useState<RowMode>(null);
  const [manualHash, setManualHash] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/withdrawals", { cache: "no-store" });

      if (res.status === 401 || res.status === 403) {
        onUnauthorized();
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }

      const data = (await res.json()) as AdminWithdrawalsListResponse;
      setItems(data.items);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "unknown error");
    }
  }, [onUnauthorized]);

  const loadTreasury = useCallback(async () => {
    setTreasuryError(null);
    try {
      const res = await fetch("/api/admin/treasury", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }
      const data = (await res.json()) as AdminTreasuryResponse;
      setTreasuryBalance(data.balance_ton);
    } catch (err) {
      setTreasuryError(err instanceof Error ? err.message : "unknown error");
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void load();
    void loadTreasury();
  }, [load, loadTreasury]);

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    onUnauthorized();
  };

  const removeItem = (transactionId: string) => {
    setItems((prev) => prev?.filter((item) => item.transaction_id !== transactionId) ?? prev);
  };

  const approveAuto = async (transactionId: string) => {
    if (mode || isSubmitting) return;

    setMode({ transactionId, type: "sending" });
    setIsSubmitting(true);
    setRowError(null);

    try {
      const res = await fetch(`/api/admin/withdrawals/${transactionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto" }),
      });

      if (res.status === 401 || res.status === 403) {
        onUnauthorized();
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }

      removeItem(transactionId);
      setMode(null);
      void loadTreasury();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitManualApprove = async () => {
    if (!mode || mode.type !== "manual" || isSubmitting) return;

    if (!manualHash.trim()) {
      setRowError("Вкажи хеш виплати");
      return;
    }

    setIsSubmitting(true);
    setRowError(null);

    try {
      const res = await fetch(`/api/admin/withdrawals/${mode.transactionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "manual", payout_tx_hash: manualHash.trim() }),
      });

      if (res.status === 401 || res.status === 403) {
        onUnauthorized();
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }

      removeItem(mode.transactionId);
      setMode(null);
      setManualHash("");
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitReject = async () => {
    if (!rejectTarget || isSubmitting) return;

    if (!rejectReason.trim()) {
      setRowError("Вкажи причину відхилення");
      return;
    }

    setIsSubmitting(true);
    setRowError(null);

    try {
      const res = await fetch(`/api/admin/withdrawals/${rejectTarget}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });

      if (res.status === 401 || res.status === 403) {
        onUnauthorized();
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }

      removeItem(rejectTarget);
      setRejectTarget(null);
      setRejectReason("");
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-bold">Pending Withdrawals</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              void load();
              void loadTreasury();
            }}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-neon-cyan/40 hover:text-neon-cyan"
          >
            <RefreshCw size={14} />
            Оновити
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-red-400/40 hover:text-red-400"
          >
            <LogOut size={14} />
            Вийти
          </button>
        </div>
      </div>

      <div className="glass-card flex items-center justify-between p-3.5">
        <div className="flex items-center gap-1.5 text-xs text-white/40">
          <Wallet size={14} />
          Баланс скарбниці (custodial)
        </div>
        <span className="text-sm font-semibold">
          {treasuryError ? (
            <span className="text-red-400">{treasuryError}</span>
          ) : treasuryBalance === null ? (
            "..."
          ) : (
            `${treasuryBalance.toFixed(4)} TON`
          )}
        </span>
      </div>

      {loadError && <div className="glass-card p-4 text-sm text-red-400">{loadError}</div>}

      {items === null && !loadError && (
        <div className="glass-card animate-pulse p-4 text-sm text-white/40">Завантаження...</div>
      )}

      {items !== null && items.length === 0 && (
        <div className="glass-card p-6 text-center text-sm text-white/40">Немає активних заявок.</div>
      )}

      <div className="flex flex-col gap-3">
        {items?.map((item) => (
          <div key={item.transaction_id} className="glass-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  {item.username ? `@${item.username}` : (item.first_name ?? "—")}
                </p>
                <p className="text-xs text-white/40">Telegram ID: {item.telegram_id}</p>
              </div>
              <p className="text-[11px] text-white/30">
                {new Date(item.created_at).toLocaleString("uk-UA")}
              </p>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-white/40">Запит</p>
                <p className="font-semibold">{item.requested_amount.toFixed(2)} TON</p>
              </div>
              <div>
                <p className="text-white/40">Комісія</p>
                <p className="font-semibold text-white/60">{item.fee.toFixed(2)} TON</p>
              </div>
              <div>
                <p className="text-white/40">До виплати</p>
                <p className="font-semibold text-neon-green">{item.net_payout.toFixed(2)} TON</p>
              </div>
            </div>

            <p className="mt-2 truncate rounded-lg bg-white/[0.03] px-2.5 py-1.5 font-mono text-[11px] text-white/50">
              {item.destination_address || "—"}
            </p>

            {rejectTarget === item.transaction_id ? (
              <div className="mt-3 rounded-xl border border-white/10 p-3">
                <input
                  type="text"
                  autoFocus
                  placeholder="Причина відхилення"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-xs text-white outline-none focus:border-neon-cyan/60"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={submitReject}
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg bg-red-400 py-2 text-xs font-bold text-background transition disabled:opacity-40"
                  >
                    {isSubmitting ? "..." : "Відхилити"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectTarget(null);
                      setRowError(null);
                    }}
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60"
                  >
                    Скасувати
                  </button>
                </div>
                {rowError && <p className="mt-1.5 text-[11px] text-red-400">{rowError}</p>}
              </div>
            ) : mode?.transactionId === item.transaction_id && mode.type === "manual" ? (
              <div className="mt-3 rounded-xl border border-white/10 p-3">
                <input
                  type="text"
                  autoFocus
                  placeholder="Хеш транзакції виплати (надіслав вручну)"
                  value={manualHash}
                  onChange={(e) => setManualHash(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-xs text-white outline-none focus:border-neon-cyan/60"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={submitManualApprove}
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg bg-neon-green py-2 text-xs font-bold text-background transition disabled:opacity-40"
                  >
                    {isSubmitting ? "..." : "Підтвердити"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode(null);
                      setManualHash("");
                      setRowError(null);
                    }}
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60"
                  >
                    Скасувати
                  </button>
                </div>
                {rowError && <p className="mt-1.5 text-[11px] text-red-400">{rowError}</p>}
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void approveAuto(item.transaction_id)}
                    disabled={mode !== null || isSubmitting}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-neon-green py-2 text-xs font-bold text-background transition active:scale-[0.98] disabled:opacity-50"
                  >
                    {mode?.transactionId === item.transaction_id && mode.type === "sending" ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Надсилаємо через блокчейн...
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        Approve (авто)
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectTarget(item.transaction_id);
                      setRowError(null);
                    }}
                    disabled={mode !== null || isSubmitting}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-red-400/40 px-3 py-2 text-xs font-bold text-red-400 transition active:scale-[0.98] disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMode({ transactionId: item.transaction_id, type: "manual" });
                    setManualHash("");
                    setRowError(null);
                  }}
                  disabled={mode !== null || isSubmitting}
                  className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-white/40 transition hover:text-white/70 disabled:opacity-40"
                >
                  <PenLine size={12} />
                  Ввести хеш вручну замість авто-виплати
                </button>

                {mode?.transactionId === item.transaction_id && rowError && (
                  <p className="text-center text-[11px] text-red-400">{rowError}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
