"use client";

import { useCallback, useState } from "react";
import { TonConnectButton, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { toNano } from "@ton/core";
import { Modal } from "@/components/ui/Modal";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { buildCommentPayload, buildDepositComment } from "@/lib/ton/comment";
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
  const [status, setStatus] = useState<DepositStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [creditedAmount, setCreditedAmount] = useState<number | null>(null);

  const isConfigured = TREASURY_ADDRESS.length > 0;
  const isBusy = status === "sending" || status === "verifying";

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

      setStatus("verifying");
      const result = await verifyDepositWithRetries(initData, comment, t);

      patchProfile({
        game_balance: result.game_balance,
        withdrawal_quota: result.withdrawal_quota,
      });
      setCreditedAmount(result.credited_amount);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : t.common.unknownError);
    }
  }, [selected, walletAddress, isBusy, profileId, tonConnectUI, initData, patchProfile, t]);

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
                    onClick={() => setSelected(preset)}
                    className={`rounded-xl py-2 text-xs font-semibold transition disabled:opacity-40 ${
                      selected === preset
                        ? "bg-neon-cyan/10 text-neon-cyan"
                        : "bg-white/5 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {preset} {t.common.ton}
                  </button>
                ))}
              </div>

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
