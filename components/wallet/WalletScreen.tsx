"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Gauge } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import { DepositModal } from "@/components/wallet/DepositModal";
import { WithdrawModal } from "@/components/wallet/WithdrawModal";
import { MIN_ADS_BEFORE_WITHDRAW } from "@/lib/constants/economy";
import type { SyncResponse } from "@/types/api";

type OpenModal = "deposit" | "withdraw" | null;

export function WalletScreen() {
  const { state } = useUserData();

  if (state.status === "loading") return <ScreenSkeleton />;
  if (state.status === "no-telegram") return <NoTelegramNotice />;
  if (state.status === "error") return <SyncErrorNotice message={state.message} />;

  return <WalletScreenReady data={state.data} initData={state.initData} />;
}

function WalletScreenReady({ data, initData }: { data: SyncResponse; initData: string }) {
  const { t, language } = useTranslation();
  const { profile } = data;
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <BalanceCard label={t.wallet.gameBalance} value={profile.game_balance} accent="cyan" />
        <BalanceCard label={t.wallet.withdrawable} value={profile.withdrawable_balance} accent="purple" />
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center gap-2 text-xs text-white/40">
          <Gauge size={14} />
          {t.wallet.quota}
        </div>
        <p className="mt-1 font-display text-lg font-bold">
          {formatNumber(language, profile.withdrawal_quota, { maximumFractionDigits: 4 })} {t.common.ton}
        </p>
        <p className="mt-1 text-[11px] text-white/30">
          {t.wallet.adsWatched(profile.ads_watched_since_withdraw, MIN_ADS_BEFORE_WITHDRAW)}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setOpenModal("deposit")}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple py-3 text-sm font-bold text-background transition active:scale-[0.98]"
        >
          <ArrowDownToLine size={16} />
          {t.wallet.depositButton}
        </button>

        <button
          type="button"
          onClick={() => setOpenModal("withdraw")}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 py-3 text-sm font-bold text-white/80 transition hover:border-neon-cyan/40 hover:text-neon-cyan active:scale-[0.98]"
        >
          <ArrowUpFromLine size={16} />
          {t.wallet.withdrawButton}
        </button>
      </div>

      {openModal === "deposit" && (
        <DepositModal profileId={profile.id} initData={initData} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "withdraw" && (
        <WithdrawModal profile={profile} initData={initData} onClose={() => setOpenModal(null)} />
      )}
    </div>
  );
}

function BalanceCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "cyan" | "purple";
}) {
  const { t, language } = useTranslation();
  const shadow = accent === "cyan" ? "shadow-neon-cyan" : "shadow-neon-purple";
  const color = accent === "cyan" ? "text-neon-cyan" : "text-neon-purple";

  return (
    <div className={`glass-card p-4 ${shadow}`}>
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <p className={`mt-1 font-display text-xl font-extrabold ${color}`}>
        {formatNumber(language, value, { maximumFractionDigits: 2 })}
      </p>
      <p className="text-[11px] text-white/30">{t.common.ton}</p>
    </div>
  );
}
