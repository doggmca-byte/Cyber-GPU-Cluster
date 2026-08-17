"use client";

import { useEffect, useState } from "react";
import { useTonAddress } from "@tonconnect/ui-react";
import { Address } from "@ton/core";
import { Modal } from "@/components/ui/Modal";
import { WatchAdButton } from "@/components/wallet/WatchAdButton";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { MIN_ADS_BEFORE_WITHDRAW, WITHDRAW_FEE_BPS, calcFee } from "@/lib/constants/economy";
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

  const adsOk = profile.ads_watched_since_withdraw >= MIN_ADS_BEFORE_WITHDRAW;
  const balanceOk = hasValidNumber && requested <= profile.withdrawable_balance;
  const quotaOk = hasValidNumber && requested <= profile.withdrawal_quota;
  const canSubmit = adsOk && hasValidNumber && balanceOk && quotaOk && addressOk;

  const fee = hasValidNumber ? calcFee(requested, WITHDRAW_FEE_BPS) : 0;
  const net = hasValidNumber ? requested - fee : 0;
  const feePercentLabel = formatNumber(language, WITHDRAW_FEE_BPS / 100, { maximumFractionDigits: 0 });

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
      {!adsOk && (
        <div className="mb-4 rounded-xl border border-neon-gold/30 bg-neon-gold/10 p-3">
          <p className="text-xs font-semibold text-neon-gold">
            {t.wallet.withdraw.watchAdsPrompt(profile.ads_watched_since_withdraw, MIN_ADS_BEFORE_WITHDRAW)}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-neon-gold"
              style={{
                width: `${Math.min(profile.ads_watched_since_withdraw / MIN_ADS_BEFORE_WITHDRAW, 1) * 100}%`,
              }}
            />
          </div>
          <div className="mt-3">
            <WatchAdButton initData={initData} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-white/40">
        <span>{t.wallet.withdraw.balanceLabel}</span>
        <span className="font-semibold text-white/70">
          {formatNumber(language, profile.withdrawable_balance, { maximumFractionDigits: 4 })}{" "}
          {t.common.ton}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-white/40">
        <span>{t.wallet.withdraw.quotaLabel}</span>
        <span className="font-semibold text-white/70">
          {formatNumber(language, profile.withdrawal_quota, { maximumFractionDigits: 4 })} {t.common.ton}
        </span>
      </div>

      <label className="mt-3 block text-xs text-white/40">{t.wallet.withdraw.addressLabel}</label>
      <input
        type="text"
        placeholder={t.wallet.withdraw.addressPlaceholder}
        value={address}
        disabled={!adsOk}
        onChange={(e) => {
          setAddressTouched(true);
          setAddress(e.target.value);
        }}
        className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-neon-cyan/60 disabled:opacity-40"
      />
      {address.trim().length > 0 && !addressOk && (
        <p className="mt-1 text-xs text-red-400">{t.wallet.withdraw.invalidAddress}</p>
      )}

      <label className="mt-3 block text-xs text-white/40">{t.wallet.withdraw.amountLabel}</label>
      <input
        type="number"
        inputMode="decimal"
        placeholder={t.wallet.withdraw.amountPlaceholder}
        value={amount}
        disabled={!adsOk}
        onChange={(e) => setAmount(e.target.value)}
        className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-neon-cyan/60 disabled:opacity-40"
      />

      {hasValidNumber && (
        <div className="mt-3 flex flex-col gap-1 rounded-xl bg-white/[0.03] p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-white/40">{t.wallet.withdraw.requestRow}</span>
            <span className="text-white/70">
              {requested.toFixed(2)} {t.common.ton}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/40">{t.wallet.withdraw.feeRow(feePercentLabel)}</span>
            <span className="text-white/40">
              -{fee.toFixed(2)} {t.common.ton}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/40">{t.wallet.withdraw.netRow}</span>
            <span className="font-semibold text-neon-green">
              {net.toFixed(2)} {t.common.ton}
            </span>
          </div>
        </div>
      )}

      {hasValidNumber && !balanceOk && (
        <p className="mt-2 text-xs text-red-400">{t.wallet.withdraw.insufficientBalance}</p>
      )}
      {hasValidNumber && balanceOk && !quotaOk && (
        <p className="mt-2 text-xs text-red-400">{t.wallet.withdraw.insufficientQuota}</p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit || isSubmitting}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple py-3 text-sm font-bold text-background transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSubmitting ? t.wallet.withdraw.submitting : t.wallet.withdraw.submit}
      </button>

      {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}
      {success && <p className="mt-2 text-center text-xs text-neon-green">{success}</p>}
    </Modal>
  );
}
