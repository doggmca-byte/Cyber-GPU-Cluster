"use client";

import { useCallback, useState } from "react";
import { TonConnectButton, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { toNano } from "@ton/core";
import { Copy, Check, TriangleAlert, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { buildCommentPayload, buildDepositMemo } from "@/lib/ton/comment";
import { MIN_DEPOSIT_TON } from "@/lib/constants/economy";
import type { DepositCheckResponse } from "@/types/api";

const PRESETS_TON = [1, 5, 10, 25, 50, 100] as const;
const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_TON_ADDRESS ?? "";

type DepositStatus = "idle" | "sending" | "verifying" | "success" | "error";

async function checkDeposit(initData: string): Promise<DepositCheckResponse> {
  const res = await fetch("/api/wallet/deposit/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `check failed with status ${res.status}`);
  }

  return (await res.json()) as DepositCheckResponse;
}

/** Кілька автоматичних спроб одразу після TonConnect-переказу — та сама транзакція знайдеться за telegram_id. */
async function pollDepositCheck(
  initData: string,
  { maxAttempts = 10, delayMs = 3000 }: { maxAttempts?: number; delayMs?: number } = {},
): Promise<DepositCheckResponse> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const result = await checkDeposit(initData);
    if (result.credited.length > 0) return result;
    // порожньо — транзакція ще не в індексаторі toncenter, пробуємо ще раз
  }

  return { credited: [], game_balance: 0, withdrawal_quota: 0, server_time: new Date().toISOString() };
}

function CopyableField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API може бути недоступний — тихо ігноруємо, це лише зручність.
    }
  };

  return (
    <div>
      <label className="block text-[11px] text-slate-500">{label}</label>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-2xl border border-white/5 bg-[#0b0e14] px-3 py-2 text-left transition active:scale-[0.99]"
      >
        <span className="truncate font-mono text-xs text-white">{value}</span>
        {copied ? (
          <Check size={14} className="shrink-0 text-neon-green" />
        ) : (
          <Copy size={14} className="shrink-0 text-slate-500" />
        )}
      </button>
    </div>
  );
}

export function DepositModal({
  telegramId,
  initData,
  onClose,
}: {
  telegramId: number;
  initData: string;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const { patchProfile } = useUserData();
  const [tonConnectUI] = useTonConnectUI();
  const walletAddress = useTonAddress();

  const [selected, setSelected] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [status, setStatus] = useState<DepositStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [creditedAmount, setCreditedAmount] = useState<number | null>(null);

  const [isChecking, setIsChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const isConfigured = TREASURY_ADDRESS.length > 0;
  const isBusy = status === "sending" || status === "verifying";

  const memo = buildDepositMemo(telegramId);

  const customAmountNumber = Number(customAmount.replace(",", "."));
  const customAmountValid =
    customAmount.trim().length > 0 && Number.isFinite(customAmountNumber) && customAmountNumber >= MIN_DEPOSIT_TON;
  const customAmountInvalid = customAmount.trim().length > 0 && !customAmountValid;

  const selectPreset = (preset: number) => {
    setCustomAmount("");
    setSelected(preset);
  };

  const onCustomAmountChange = (value: string) => {
    setCustomAmount(value);
    const parsed = Number(value.replace(",", "."));
    setSelected(value.trim().length > 0 && Number.isFinite(parsed) && parsed >= MIN_DEPOSIT_TON ? parsed : null);
  };

  const applyCredited = useCallback(
    (result: DepositCheckResponse) => {
      const total = result.credited.reduce((sum, item) => sum + item.amount, 0);
      patchProfile({
        game_balance: result.game_balance,
        withdrawal_quota: result.withdrawal_quota,
      });
      setCreditedAmount(total);
      setStatus("success");
    },
    [patchProfile],
  );

  const deposit = useCallback(async () => {
    if (!selected || !walletAddress || isBusy) return;

    setError(null);
    setStatus("sending");

    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: TREASURY_ADDRESS,
            amount: toNano(String(selected)).toString(),
            payload: buildCommentPayload(memo),
          },
        ],
      });

      setStatus("verifying");
      const result = await pollDepositCheck(initData);

      if (result.credited.length === 0) {
        setStatus("error");
        setError(t.wallet.deposit.timeoutError);
        return;
      }

      applyCredited(result);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : t.common.unknownError);
    }
  }, [selected, walletAddress, isBusy, memo, tonConnectUI, initData, applyCredited, t]);

  const runManualCheck = useCallback(async () => {
    if (isChecking) return;

    setIsChecking(true);
    setCheckMessage(null);

    try {
      const result = await checkDeposit(initData);
      if (result.credited.length > 0) {
        applyCredited(result);
      } else {
        setCheckMessage(t.wallet.deposit.checkNotFound);
      }
    } catch (err) {
      setCheckMessage(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, initData, applyCredited, t]);

  return (
    <Modal title={t.wallet.deposit.title} onClose={onClose}>
      {!isConfigured ? (
        <p className="text-xs text-slate-400">{t.wallet.deposit.notConfigured}</p>
      ) : status === "success" ? (
        <div className="flex flex-col items-center gap-2 py-3 text-center">
          <p className="text-base font-semibold text-neon-green">{t.wallet.deposit.creditedTitle}</p>
          <p className="text-xs text-slate-400">
            {t.wallet.deposit.creditedAmount(
              formatNumber(language, creditedAmount ?? 0, { maximumFractionDigits: 6 }),
            )}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full rounded-2xl bg-neon-cyan py-2.5 text-xs font-semibold text-background"
          >
            {t.wallet.deposit.done}
          </button>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">
            {t.wallet.deposit.minDepositNote(formatNumber(language, MIN_DEPOSIT_TON))}
          </p>

          <div className="mt-2.5 flex flex-col gap-2.5">
            <CopyableField value={TREASURY_ADDRESS} label={t.wallet.deposit.addressLabel} />
            <CopyableField value={memo} label={t.wallet.deposit.memoLabel} />
          </div>

          <div className="mt-2.5 flex items-start gap-2 rounded-2xl bg-neon-gold/10 p-2.5">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-neon-gold" />
            <p className="text-[11px] font-semibold text-neon-gold">{t.wallet.deposit.memoWarning}</p>
          </div>

          <button
            type="button"
            onClick={() => void runManualCheck()}
            disabled={isChecking}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-neon-cyan/30 py-2.5 text-xs font-semibold text-neon-cyan transition active:scale-[0.98] disabled:opacity-50"
          >
            <RefreshCw size={13} className={isChecking ? "animate-spin" : ""} />
            {isChecking ? t.wallet.deposit.checking : t.wallet.deposit.checkButton}
          </button>
          {checkMessage && <p className="mt-1.5 text-center text-[11px] text-slate-400">{checkMessage}</p>}

          <div className="my-3.5 flex items-center gap-2">
            <div className="h-px flex-1 bg-white/5" />
            <span className="text-[10px] uppercase tracking-wide text-slate-600">{t.wallet.deposit.orQuickPay}</span>
            <div className="h-px flex-1 bg-white/5" />
          </div>

          <div className="flex justify-center">
            <TonConnectButton />
          </div>

          {walletAddress && (
            <>
              <p className="mt-2.5 text-[11px] text-slate-500">{t.wallet.deposit.chooseAmount}</p>

              <div className="mt-2.5 grid grid-cols-3 gap-2">
                {PRESETS_TON.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={isBusy}
                    onClick={() => selectPreset(preset)}
                    className={`rounded-xl py-2 text-xs font-semibold transition disabled:opacity-40 ${
                      selected === preset && customAmount.trim().length === 0
                        ? "bg-neon-cyan/10 text-neon-cyan"
                        : "bg-white/5 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {preset} {t.common.ton}
                  </button>
                ))}
              </div>

              <label className="mt-2.5 block text-[11px] text-slate-500">
                {t.wallet.deposit.customAmountLabel(formatNumber(language, MIN_DEPOSIT_TON))}
              </label>
              <input
                type="number"
                inputMode="decimal"
                placeholder={t.wallet.deposit.customAmountPlaceholder}
                value={customAmount}
                disabled={isBusy}
                onChange={(e) => onCustomAmountChange(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/5 bg-[#0b0e14] px-3 py-2 text-xs text-white outline-none transition placeholder:text-slate-600 focus:border-neon-cyan/40 disabled:opacity-40"
              />
              {customAmountInvalid && (
                <p className="mt-1 text-[11px] text-red-400">
                  {t.wallet.deposit.minAmountError(formatNumber(language, MIN_DEPOSIT_TON))}
                </p>
              )}

              <button
                type="button"
                onClick={deposit}
                disabled={!selected || isBusy}
                className="mt-3.5 w-full rounded-2xl bg-neon-cyan py-2.5 text-xs font-semibold text-background transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === "sending"
                  ? t.wallet.deposit.confirmInWallet
                  : status === "verifying"
                    ? t.wallet.deposit.verifyingOnChain
                    : selected
                      ? t.wallet.deposit.depositAmount(selected)
                      : t.wallet.deposit.pickAmount}
              </button>

              {error && <p className="mt-2 text-center text-[11px] text-red-400">{error}</p>}
            </>
          )}

          <p className="mt-3 text-center text-[10px] text-slate-600">{t.wallet.deposit.disclaimer}</p>
        </>
      )}
    </Modal>
  );
}
