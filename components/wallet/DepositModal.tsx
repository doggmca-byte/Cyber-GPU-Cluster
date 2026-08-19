"use client";

import { useCallback, useEffect, useState } from "react";
import { TonConnectButton, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { toNano } from "@ton/core";
import { Modal } from "@/components/ui/Modal";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { buildCommentPayload, buildDepositComment } from "@/lib/ton/comment";
import { MIN_DEPOSIT_TON } from "@/lib/constants/economy";
import {
  readPendingDeposit,
  savePendingDeposit,
  clearPendingDeposit,
  type PendingDeposit,
} from "@/lib/wallet/pendingDeposit";
import type { DepositVerifyResponse } from "@/types/api";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

const PRESETS_TON = [1, 5, 10, 25, 50, 100] as const;
const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_TON_ADDRESS ?? "";

type DepositStatus = "idle" | "sending" | "verifying" | "success" | "error";

async function verifyDepositWithRetries(
  initData: string,
  expectedComment: string,
  t: TranslationDictionary,
  { maxAttempts = 10, delayMs = 3000 }: { maxAttempts?: number; delayMs?: number } = {},
): Promise<DepositVerifyResponse> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const res = await fetch("/api/wallet/deposit/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, expected_comment: expectedComment }),
    });

    if (res.ok) {
      return (await res.json()) as DepositVerifyResponse;
    }

    if (res.status !== 404) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `verify failed with status ${res.status}`);
    }
    // 404 = транзакція ще не в індексаторі toncenter — пробуємо ще раз
  }

  throw new Error(t.wallet.deposit.timeoutError);
}

export function DepositModal({
  profileId,
  initData,
  onClose,
}: {
  profileId: string;
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

  // Незавершена спроба з попереднього сеансу (застосунок закрили/згорнули
  // до того, як verifyDepositWithRetries знайшов матч) — детально в
  // lib/wallet/pendingDeposit.ts.
  const [resumeAttempt, setResumeAttempt] = useState<PendingDeposit | null>(null);
  const [isCheckingResume, setIsCheckingResume] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  useEffect(() => {
    setResumeAttempt(readPendingDeposit(profileId));
  }, [profileId]);

  const isConfigured = TREASURY_ADDRESS.length > 0;
  const isBusy = status === "sending" || status === "verifying";

  const customAmountNumber = Number(customAmount.replace(",", "."));
  const customAmountValid = customAmount.trim().length > 0 && Number.isFinite(customAmountNumber) && customAmountNumber >= MIN_DEPOSIT_TON;
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

  const deposit = useCallback(async () => {
    if (!selected || !walletAddress || isBusy) return;

    setError(null);
    setStatus("sending");

    // Коментар транзакції (dep_<UUID профілю>_<nonce>) будується незалежно
    // від обраної мови інтерфейсу — buildDepositComment працює лише з
    // profileId, мова UI ніяк на нього не впливає.
    const comment = buildDepositComment(profileId);

    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: TREASURY_ADDRESS,
            amount: toNano(String(selected)).toString(),
            payload: buildCommentPayload(comment),
          },
        ],
      });

      // Транзакція реально пішла в мережу — зберігаємо comment ДО початку
      // polling, щоб навіть закриття вкладки посеред перевірки лишило слід,
      // за яким наступний відкритий DepositModal зможе резюмувати перевірку
      // замість того, щоб примусити відправити ще одну транзакцію.
      savePendingDeposit(profileId, comment);
      setResumeAttempt({ comment, createdAt: Date.now() });

      setStatus("verifying");
      const result = await verifyDepositWithRetries(initData, comment, t);

      patchProfile({
        game_balance: result.game_balance,
        withdrawal_quota: result.withdrawal_quota,
      });
      setCreditedAmount(result.credited_amount);
      setStatus("success");
      clearPendingDeposit(profileId);
      setResumeAttempt(null);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : t.common.unknownError);
      // НЕ чистимо pendingDeposit тут — саме на цей випадок (timeout/збій
      // polling, а транзакція вже могла піти) він і існує, лишається для
      // resume-банера при наступному відкритті модалки.
    }
  }, [selected, walletAddress, isBusy, profileId, tonConnectUI, initData, patchProfile, t]);

  const checkPendingDeposit = useCallback(async () => {
    if (!resumeAttempt || isCheckingResume) return;

    setIsCheckingResume(true);
    setResumeMessage(null);

    try {
      // Коротший поллінг, ніж свіжий депозит (3×2с) — це разовий "спот-чек"
      // транзакції, яка вже могла давно потрапити в індексатор, а не перше
      // очікування підтвердження в мережі.
      const result = await verifyDepositWithRetries(initData, resumeAttempt.comment, t, {
        maxAttempts: 3,
        delayMs: 2000,
      });

      patchProfile({
        game_balance: result.game_balance,
        withdrawal_quota: result.withdrawal_quota,
      });
      setCreditedAmount(result.credited_amount);
      setStatus("success");
      clearPendingDeposit(profileId);
      setResumeAttempt(null);
    } catch (err) {
      setResumeMessage(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsCheckingResume(false);
    }
  }, [resumeAttempt, isCheckingResume, initData, t, patchProfile, profileId]);

  const dismissResumeAttempt = useCallback(() => {
    clearPendingDeposit(profileId);
    setResumeAttempt(null);
    setResumeMessage(null);
  }, [profileId]);

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
          {resumeAttempt && (
            <div className="mb-3 rounded-2xl border border-neon-gold/30 bg-neon-gold/5 p-3">
              <p className="text-[11px] font-semibold text-neon-gold">{t.wallet.deposit.resumeTitle}</p>
              <p className="mt-1 text-[11px] text-slate-400">{t.wallet.deposit.resumeBody}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void checkPendingDeposit()}
                  disabled={isCheckingResume}
                  className="flex-1 rounded-xl bg-neon-gold py-2 text-[11px] font-semibold text-background transition active:scale-[0.98] disabled:opacity-50"
                >
                  {isCheckingResume ? t.wallet.deposit.resumeChecking : t.wallet.deposit.resumeCheckButton}
                </button>
                <button
                  type="button"
                  onClick={dismissResumeAttempt}
                  disabled={isCheckingResume}
                  className="rounded-xl border border-white/10 px-3 py-2 text-[11px] text-slate-400 transition hover:text-slate-200 disabled:opacity-50"
                >
                  {t.wallet.deposit.resumeDismissButton}
                </button>
              </div>
              {resumeMessage && <p className="mt-1.5 text-[11px] text-red-400">{resumeMessage}</p>}
            </div>
          )}

          <div className="mb-3 flex justify-center">
            <TonConnectButton />
          </div>

          {walletAddress && (
            <>
              <p className="text-[11px] text-slate-500">{t.wallet.deposit.chooseAmount}</p>

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
