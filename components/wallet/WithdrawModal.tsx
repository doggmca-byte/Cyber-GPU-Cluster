"use client";

import { useEffect, useState } from "react";
import { useTonAddress } from "@tonconnect/ui-react";
import { Address } from "@ton/core";
import { Modal } from "@/components/ui/Modal";
import { WatchAdButton } from "@/components/wallet/WatchAdButton";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import {
  MIN_ADS_BEFORE_WITHDRAW,
  WITHDRAW_FEE_BPS,
  withdrawMinForRequest,
  withdrawMaxForDeposits,
  withdrawFeeForRequest,
} from "@/lib/constants/economy";
import type { Profile, WithdrawResponse } from "@/types/api";

function isValidTonAddress(value: string): boolean {
  try {
    Address.parse(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function WithdrawModal({
  profile,
  initData,
  onClose,
}: {
  profile: Profile;
  initData: string;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const { patchProfile } = useUserData();
  const connectedAddress = useTonAddress();

  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [addressTouched, setAddressTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // автопідстановка з підключеного TON Connect гаманця, лише поки користувач
  // сам нічого не ввів — далі поле лишається вільно редагованим
  useEffect(() => {
    if (connectedAddress && !addressTouched) {
      setAddress(connectedAddress);
    }
  }, [connectedAddress, addressTouched]);

  const requested = Number(amount);
  const hasValidNumber = Number.isFinite(requested) && requested > 0;
  const addressOk = address.trim().length > 0 && isValidTonAddress(address);

  // Тіньовані мінімум/максимум/комісія за номером ЦІЄЇ заявки та lifetime-
  // депозитами — та сама логіка, що й у request_withdrawal RPC
  // (20260819090000_gpu_lifecycle_withdrawal_tiers_daily_ad_reset.sql).
  const minForThisRequest = withdrawMinForRequest(profile.withdrawal_request_count);
  const maxForThisRequest = withdrawMaxForDeposits(profile.lifetime_deposited_ton);
  const isFlatFeeTier = profile.withdrawal_request_count < 2;

  const todayUtc = new Date().toISOString().slice(0, 10);
  const alreadyRequestedToday = profile.last_withdrawal_request_date === todayUtc;

  // Перегляд реклами (ads_watched_since_withdraw) більше НЕ блокує вивід —
  // лишається лише як інформативний прогрес/бонус до квоти (record_ad_watch
  // все одно додає +0.05 TON квоти за кожен перегляд, незалежно від цього
  // порогу). Реальні hard-blockers: баланс, квота, тіньований мін/макс,
  // адреса, ліміт "1 заявка/добу".
  const adsProgress = profile.ads_watched_since_withdraw >= MIN_ADS_BEFORE_WITHDRAW;
  const balanceOk = hasValidNumber && requested <= profile.withdrawable_balance;
  const quotaOk = hasValidNumber && requested <= profile.withdrawal_quota;
  const minOk = hasValidNumber && requested >= minForThisRequest;
  const maxOk = hasValidNumber && requested <= maxForThisRequest;
  const canSubmit =
    hasValidNumber &&
    balanceOk &&
    quotaOk &&
    minOk &&
    maxOk &&
    !alreadyRequestedToday &&
    addressOk;

  const fee = hasValidNumber ? withdrawFeeForRequest(profile.withdrawal_request_count, requested) : 0;
  const net = hasValidNumber ? requested - fee : 0;
  const feePercentLabel = formatNumber(language, WITHDRAW_FEE_BPS / 100, { maximumFractionDigits: 0 });
  const feeAmountLabel = formatNumber(language, fee, { maximumFractionDigits: 6 });

  const submit = async () => {
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, amount: requested, destination_address: address.trim() }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `withdraw failed with status ${res.status}`);
      }

      const result = (await res.json()) as WithdrawResponse;
      patchProfile({
        withdrawable_balance: result.withdrawable_balance,
        withdrawal_quota: result.withdrawal_quota,
        ads_watched_since_withdraw: result.ads_watched_since_withdraw,
        // request_withdrawal RPC не повертає ці два поля окремо (не міняли
        // сигнатуру відповіді через DROP FUNCTION), але детерміновано інкрементує
        // withdrawal_request_count і виставляє last_withdrawal_request_date =
        // сьогодні UTC при кожному успішному виклику — оптимістично оновлюємо
        // так само тут, щоб тіри мінімуму/комісії/денного ліміту в UI одразу
        // відповідали реальності без повного ресинку.
        withdrawal_request_count: profile.withdrawal_request_count + 1,
        last_withdrawal_request_date: todayUtc,
      });
      setAmount("");
      const addressShort = `${result.destination_address.slice(0, 6)}…${result.destination_address.slice(-4)}`;
      setSuccess(
        t.wallet.withdraw.success(
          formatNumber(language, result.net_payout, { maximumFractionDigits: 6 }),
          addressShort,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal title={t.wallet.withdraw.title} onClose={onClose}>
      {!adsProgress && (
        <div className="mb-3.5 rounded-2xl bg-neon-gold/10 p-2.5">
          <p className="text-[11px] font-semibold text-neon-gold">
            {t.wallet.withdraw.watchAdsPrompt(profile.ads_watched_since_withdraw, MIN_ADS_BEFORE_WITHDRAW)}
          </p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-neon-gold"
              style={{
                width: `${Math.min(profile.ads_watched_since_withdraw / MIN_ADS_BEFORE_WITHDRAW, 1) * 100}%`,
              }}
            />
          </div>
          <div className="mt-2.5">
            <WatchAdButton initData={initData} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{t.wallet.withdraw.balanceLabel}</span>
        <span className="font-semibold text-slate-300">
          {formatNumber(language, profile.withdrawable_balance, { maximumFractionDigits: 4 })}{" "}
          {t.common.ton}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>{t.wallet.withdraw.quotaLabel}</span>
        <span className="font-semibold text-slate-300">
          {formatNumber(language, profile.withdrawal_quota, { maximumFractionDigits: 4 })} {t.common.ton}
        </span>
      </div>

      <label className="mt-2.5 block text-[11px] text-slate-500">{t.wallet.withdraw.addressLabel}</label>
      <input
        type="text"
        placeholder={t.wallet.withdraw.addressPlaceholder}
        value={address}
        onChange={(e) => {
          setAddressTouched(true);
          setAddress(e.target.value);
        }}
        className="mt-1 w-full rounded-2xl border border-white/5 bg-[#0b0e14] px-3 py-2 text-xs text-white outline-none transition placeholder:text-slate-600 focus:border-neon-cyan/40 disabled:opacity-40"
      />
      {address.trim().length > 0 && !addressOk && (
        <p className="mt-1 text-[11px] text-red-400">{t.wallet.withdraw.invalidAddress}</p>
      )}

      {alreadyRequestedToday && (
        <p className="mt-2.5 rounded-2xl bg-neon-gold/10 p-2 text-[11px] font-semibold text-neon-gold">
          {t.wallet.withdraw.oneRequestPerDay}
        </p>
      )}

      <label className="mt-2.5 block text-[11px] text-slate-500">{t.wallet.withdraw.amountLabel}</label>
      <input
        type="number"
        inputMode="decimal"
        placeholder={t.wallet.withdraw.amountPlaceholder}
        value={amount}
        disabled={alreadyRequestedToday}
        onChange={(e) => setAmount(e.target.value)}
        className="mt-1 w-full rounded-2xl border border-white/5 bg-[#0b0e14] px-3 py-2 text-xs text-white outline-none transition placeholder:text-slate-600 focus:border-neon-cyan/40 disabled:opacity-40"
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-600">
        <span>{t.wallet.withdraw.minTierHint(formatNumber(language, minForThisRequest))}</span>
        <span>{t.wallet.withdraw.maxTierHint(formatNumber(language, maxForThisRequest))}</span>
      </div>

      {hasValidNumber && (
        <div className="mt-2.5 flex flex-col gap-1 rounded-2xl bg-white/[0.03] p-2.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">{t.wallet.withdraw.requestRow}</span>
            <span className="text-slate-300">
              {requested.toFixed(2)} {t.common.ton}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">
              {isFlatFeeTier ? t.wallet.withdraw.feeRowFlat(feeAmountLabel) : t.wallet.withdraw.feeRow(feePercentLabel)}
            </span>
            <span className="text-slate-500">
              -{fee.toFixed(fee < 1 ? 3 : 2)} {t.common.ton}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">{t.wallet.withdraw.netRow}</span>
            <span className="font-semibold text-neon-green">
              {net.toFixed(2)} {t.common.ton}
            </span>
          </div>
        </div>
      )}

      {hasValidNumber && !balanceOk && (
        <p className="mt-2 text-[11px] text-red-400">{t.wallet.withdraw.insufficientBalance}</p>
      )}
      {hasValidNumber && balanceOk && !quotaOk && (
        <p className="mt-2 text-[11px] text-red-400">{t.wallet.withdraw.insufficientQuota}</p>
      )}
      {hasValidNumber && balanceOk && quotaOk && !minOk && (
        <p className="mt-2 text-[11px] text-red-400">
          {t.wallet.withdraw.minTierHint(formatNumber(language, minForThisRequest))}
        </p>
      )}
      {hasValidNumber && balanceOk && quotaOk && minOk && !maxOk && (
        <p className="mt-2 text-[11px] text-red-400">
          {t.wallet.withdraw.maxTierHint(formatNumber(language, maxForThisRequest))}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit || isSubmitting}
        className="mt-2.5 w-full rounded-2xl bg-neon-cyan py-2.5 text-xs font-semibold text-background transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSubmitting ? t.wallet.withdraw.submitting : t.wallet.withdraw.submit}
      </button>

      {error && <p className="mt-2 text-center text-[11px] text-red-400">{error}</p>}
      {success && <p className="mt-2 text-center text-[11px] text-neon-green">{success}</p>}
    </Modal>
  );
}
