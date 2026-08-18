"use client";

import { useState } from "react";
import { Zap, Wallet as WalletIcon, ArrowDown } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import {
  HASH_TO_TON_RATE,
  MIN_HASH_EXCHANGE,
  HASH_EXCHANGE_STEP,
  HASH_EXCHANGE_WITHDRAWABLE_FEE_BPS,
  MIN_CONVERT_BACK_TON,
  calcFee,
} from "@/lib/constants/economy";
import type { ConvertBalanceResponse, ExchangeResponse, ExchangeTargetBalance, SyncResponse } from "@/types/api";

export function ExchangeScreen() {
  const { state } = useUserData();

  if (state.status === "loading") return <ScreenSkeleton />;
  if (state.status === "no-telegram") return <NoTelegramNotice />;
  if (state.status === "error") return <SyncErrorNotice message={state.message} />;

  return <ExchangeScreenReady data={state.data} initData={state.initData} />;
}

function ExchangeScreenReady({ data, initData }: { data: SyncResponse; initData: string }) {
  return (
    <div className="flex flex-col gap-4">
      <HashToTonCard profile={data.profile} initData={initData} />
      <ConvertBackCard profile={data.profile} initData={initData} />
    </div>
  );
}

function HashToTonCard({
  profile,
  initData,
}: {
  profile: SyncResponse["profile"];
  initData: string;
}) {
  const { t, language } = useTranslation();
  const { patchProfile } = useUserData();
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState<ExchangeTargetBalance>("withdrawable");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hashAmount = Number(amount);
  const hasMinAmount = Number.isFinite(hashAmount) && hashAmount >= MIN_HASH_EXCHANGE;
  const isMultipleOfStep = hasMinAmount && hashAmount % HASH_EXCHANGE_STEP === 0;
  const isValidAmount = hasMinAmount && isMultipleOfStep;
  const tonGross = isValidAmount ? hashAmount * HASH_TO_TON_RATE : 0;
  const fee = target === "withdrawable" ? calcFee(tonGross, HASH_EXCHANGE_WITHDRAWABLE_FEE_BPS) : 0;
  const tonNet = tonGross - fee;

  const submit = async () => {
    if (!isValidAmount || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/farm/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, hash_amount: hashAmount, target_balance: target }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `exchange failed with status ${res.status}`);
      }

      const result = (await res.json()) as ExchangeResponse;
      patchProfile({
        hash_balance: result.hash_balance,
        game_balance: result.game_balance,
        withdrawable_balance: result.withdrawable_balance,
      });
      setAmount("");
      setSuccess(
        t.exchange.hashToTon.success(formatNumber(language, result.ton_credited, { maximumFractionDigits: 6 })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const minHashLabel = formatNumber(language, MIN_HASH_EXCHANGE);

  return (
    <div className="glass-card p-4 shadow-neon-cyan">
      <div className="flex items-center gap-2">
        <Zap size={16} className="text-neon-cyan" />
        <h2 className="font-display text-sm font-bold">{t.exchange.hashToTon.title}</h2>
      </div>
      <p className="mt-1 text-xs text-white/40">{t.exchange.hashToTon.rateNote(minHashLabel)}</p>

      <div className="mt-3 flex items-center justify-between text-xs text-white/40">
        <span>{t.exchange.hashToTon.available}</span>
        <span className="font-semibold text-white/70">
          {formatNumber(language, profile.hash_balance, { maximumFractionDigits: 4 })} {t.common.hash}
        </span>
      </div>

      <input
        type="number"
        inputMode="decimal"
        placeholder={t.exchange.hashToTon.amountPlaceholder(minHashLabel)}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mt-2 w-full rounded-xl border border-white/10 bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-neon-cyan/60"
      />
      {hasMinAmount && !isMultipleOfStep && (
        <p className="mt-1.5 text-xs text-red-400">
          {t.exchange.hashToTon.stepError(formatNumber(language, HASH_EXCHANGE_STEP))}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <TargetButton
          label={t.exchange.hashToTon.targetWithdrawable}
          active={target === "withdrawable"}
          onClick={() => setTarget("withdrawable")}
        />
        <TargetButton
          label={t.exchange.hashToTon.targetGame}
          active={target === "game"}
          onClick={() => setTarget("game")}
        />
      </div>

      {isValidAmount && (
        <div className="mt-3 flex flex-col gap-1 rounded-xl bg-white/[0.03] p-3 text-xs">
          <Row label={t.exchange.hashToTon.grossRow} value={`${tonGross.toFixed(6)} ${t.common.ton}`} />
          {fee > 0 && (
            <Row label={t.exchange.hashToTon.feeRow} value={`-${fee.toFixed(6)} ${t.common.ton}`} muted />
          )}
          <Row label={t.exchange.hashToTon.netRow} value={`${tonNet.toFixed(6)} ${t.common.ton}`} strong />
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!isValidAmount || isSubmitting}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple py-2.5 text-sm font-bold text-background transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSubmitting ? t.exchange.hashToTon.submitting : t.exchange.hashToTon.submit}
      </button>

      {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}
      {success && <p className="mt-2 text-center text-xs text-neon-green">{success}</p>}
    </div>
  );
}

function ConvertBackCard({
  profile,
  initData,
}: {
  profile: SyncResponse["profile"];
  initData: string;
}) {
  const { t, language } = useTranslation();
  const { patchProfile } = useUserData();
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const tonAmount = Number(amount);
  const isValidAmount = Number.isFinite(tonAmount) && tonAmount >= MIN_CONVERT_BACK_TON;

  const submit = async () => {
    if (!isValidAmount || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/wallet/convert-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, amount: tonAmount }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `convert failed with status ${res.status}`);
      }

      const result = (await res.json()) as ConvertBalanceResponse;
      patchProfile({
        withdrawable_balance: result.withdrawable_balance,
        game_balance: result.game_balance,
      });
      setAmount("");
      setSuccess(t.exchange.convertBack.success(formatNumber(language, tonAmount)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const minConvertLabel = formatNumber(language, MIN_CONVERT_BACK_TON);

  return (
    <div className="glass-card p-4 shadow-neon-purple">
      <div className="flex items-center gap-2">
        <WalletIcon size={16} className="text-neon-purple" />
        <h2 className="font-display text-sm font-bold">{t.exchange.convertBack.title}</h2>
      </div>
      <p className="mt-1 text-xs text-white/40">{t.exchange.convertBack.rateNote(minConvertLabel)}</p>

      <div className="mt-3 flex items-center justify-center gap-3 text-xs">
        <div className="flex-1 rounded-xl bg-white/[0.03] p-2.5 text-center">
          <p className="text-white/40">{t.exchange.convertBack.withdrawableLabel}</p>
          <p className="mt-0.5 font-semibold text-neon-purple">
            {formatNumber(language, profile.withdrawable_balance, { maximumFractionDigits: 2 })}{" "}
            {t.common.ton}
          </p>
        </div>
        <ArrowDown size={16} className="shrink-0 rotate-[-90deg] text-white/30 rtl:rotate-90" />
        <div className="flex-1 rounded-xl bg-white/[0.03] p-2.5 text-center">
          <p className="text-white/40">{t.exchange.convertBack.gameLabel}</p>
          <p className="mt-0.5 font-semibold text-neon-cyan">
            {formatNumber(language, profile.game_balance, { maximumFractionDigits: 2 })} {t.common.ton}
          </p>
        </div>
      </div>

      <input
        type="number"
        inputMode="decimal"
        placeholder={t.exchange.convertBack.amountPlaceholder(minConvertLabel)}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mt-3 w-full rounded-xl border border-white/10 bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-neon-purple/60"
      />

      <button
        type="button"
        onClick={submit}
        disabled={!isValidAmount || isSubmitting}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-neon-purple to-neon-cyan py-2.5 text-sm font-bold text-background transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSubmitting ? t.exchange.convertBack.submitting : t.exchange.convertBack.submit}
      </button>

      {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}
      {success && <p className="mt-2 text-center text-xs text-neon-green">{success}</p>}
    </div>
  );
}

function TargetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition ${
        active
          ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan"
          : "border-white/10 text-white/50 hover:text-white/80"
      }`}
    >
      {label}
    </button>
  );
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/40">{label}</span>
      <span className={strong ? "font-semibold text-neon-green" : muted ? "text-white/40" : "text-white/70"}>
        {value}
      </span>
    </div>
  );
}
