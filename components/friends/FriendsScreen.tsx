"use client";

import { useEffect, useState } from "react";
import { Users, Coins, Copy, Send, Check, Info } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import {
  REFERRAL_DEPOSIT_REVSHARE_RATE,
  REFERRAL_FIRST_HARVEST_BONUS_TON,
  REFERRAL_FIRST_HARVEST_THRESHOLD_HASH,
} from "@/lib/constants/economy";
import type { ClaimReferralResponse, SyncResponse } from "@/types/api";

interface ReferralStats {
  friends_count: number;
  total_earned: number;
  pending_reward: number;
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";

export function FriendsScreen() {
  const { state } = useUserData();

  if (state.status === "loading") return <ScreenSkeleton />;
  if (state.status === "no-telegram") return <NoTelegramNotice />;
  if (state.status === "error") return <SyncErrorNotice message={state.message} />;

  return <FriendsScreenReady data={state.data} initData={state.initData} />;
}

function FriendsScreenReady({ data, initData }: { data: SyncResponse; initData: string }) {
  const { t, language } = useTranslation();
  const { patchProfile } = useUserData();
  const { profile } = data;

  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/friends/stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `stats failed with status ${res.status}`);
        }

        const result = (await res.json()) as ReferralStats;
        if (!cancelled) setStats(result);
      } catch (err) {
        if (!cancelled) {
          setStatsError(err instanceof Error ? err.message : t.common.unknownError);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initData, t.common.unknownError]);

  const referralLink = BOT_USERNAME
    ? `https://t.me/${BOT_USERNAME}?startapp=ref_${profile.telegram_id}`
    : null;

  const copyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API може бути недоступний у деяких WebView — тихо ігноруємо
    }
  };

  const shareLink = () => {
    if (!referralLink) return;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(
      t.friends.shareMessage,
    )}`;
    window.Telegram?.WebApp?.openTelegramLink?.(shareUrl) ?? window.open(shareUrl, "_blank");
  };

  const claim = async () => {
    if (isClaiming || !stats || stats.pending_reward <= 0) return;

    setIsClaiming(true);
    setClaimError(null);
    setClaimSuccess(null);

    try {
      const res = await fetch("/api/friends/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `claim failed with status ${res.status}`);
      }

      const result = (await res.json()) as ClaimReferralResponse;
      patchProfile({ withdrawable_balance: result.withdrawable_balance });
      setStats((prev) =>
        prev
          ? {
              ...prev,
              pending_reward: 0,
              total_earned: prev.total_earned + result.claimed_amount,
            }
          : prev,
      );
      setClaimSuccess(
        t.friends.claimSuccess(formatNumber(language, result.claimed_amount, { maximumFractionDigits: 6 })),
      );
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <StatCard
          icon={<Users size={14} className="text-neon-cyan" />}
          label={t.friends.invitedFriends}
          value={stats ? String(stats.friends_count) : "—"}
        />
        <StatCard
          icon={<Coins size={14} className="text-neon-gold" />}
          label={t.friends.totalEarned}
          value={
            stats
              ? `${formatNumber(language, stats.total_earned, { maximumFractionDigits: 4 })} ${t.common.ton}`
              : "—"
          }
        />
      </div>

      {statsError && (
        <div className="glass-card p-3.5 text-center text-[11px] text-red-400">{statsError}</div>
      )}

      <div className="glass-card p-3.5">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">{t.friends.pendingCommission}</p>
        <p className="mt-1 text-xl font-bold text-neon-green">
          {stats ? formatNumber(language, stats.pending_reward, { maximumFractionDigits: 6 }) : "0"}{" "}
          {t.common.ton}
        </p>

        <button
          type="button"
          onClick={claim}
          disabled={!stats || stats.pending_reward <= 0 || isClaiming}
          className="mt-2.5 w-full rounded-2xl bg-neon-green py-2.5 text-xs font-semibold text-background transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isClaiming ? t.friends.claiming : t.friends.claimButton}
        </button>

        {claimError && <p className="mt-2 text-center text-[11px] text-red-400">{claimError}</p>}
        {claimSuccess && <p className="mt-2 text-center text-[11px] text-neon-green">{claimSuccess}</p>}
      </div>

      <div className="glass-card p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
          <Info size={13} className="text-neon-cyan" />
          {t.friends.rulesTitle}
        </div>
        <ul className="mt-2 flex flex-col gap-1.5 text-[11px] text-slate-400">
          <li>
            •{" "}
            {t.friends.ruleRevshare(
              formatNumber(language, REFERRAL_DEPOSIT_REVSHARE_RATE * 100, { maximumFractionDigits: 0 }),
            )}
          </li>
          <li>
            •{" "}
            {t.friends.ruleFirstHarvest(
              formatNumber(language, REFERRAL_FIRST_HARVEST_BONUS_TON, { maximumFractionDigits: 2 }),
              formatNumber(language, REFERRAL_FIRST_HARVEST_THRESHOLD_HASH),
            )}
          </li>
        </ul>
      </div>

      <div className="glass-card p-3.5">
        <p className="text-xs font-semibold text-white">{t.friends.yourLink}</p>

        {referralLink ? (
          <>
            <p className="mt-2 truncate rounded-2xl bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400">
              {referralLink}
            </p>

            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={shareLink}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-neon-cyan py-2.5 text-xs font-semibold text-background transition active:scale-[0.98]"
              >
                <Send size={14} />
                {t.friends.share}
              </button>

              <button
                type="button"
                onClick={copyLink}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-white/5 px-3.5 py-2.5 text-xs font-semibold text-slate-300 transition hover:text-neon-cyan"
              >
                {copied ? <Check size={14} className="text-neon-green" /> : <Copy size={14} />}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">{t.friends.notConfigured}</p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-base font-bold text-white">{value}</p>
    </div>
  );
}
