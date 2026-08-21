"use client";

import { useState } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { showRewardedAdRotating, showRewardedAdRotatingWithProvider } from "@/lib/ads/rewardedAd";
import { startVerifiedAttempt, pollVerifiedAttempt } from "@/lib/ads/verifiedAdWatch";
import type { AdWatchResponse } from "@/types/api";

/**
 * "Ads for Cashout" лічильник (MIN_ADS_BEFORE_WITHDRAW/20) і швидка кнопка
 * бонусної реклами. Показує рекламу через showRewardedAdRotatingWithProvider
 * (GigaPub/Monetag/AdsGram, lib/ads/rewardedAd.ts) — лише Rewarded
 * Interstitial, без переходу в зовнішній браузер.
 *
 * Monetag-показ реально підтверджується через S2S postback
 * (app/api/ads/monetag-postback, purpose: 'withdraw_ad_watch') перед тим,
 * як інкрементувати ads_watched_since_withdraw — той самий принцип, що й
 * PartnerAdsCard (TasksScreen.tsx). GigaPub і AdsGram лишаються на
 * клієнтській довірі: у GigaPub взагалі немає S2S-механізму (підтверджено
 * їхньою документацією), а AdsGram Reward URL жорстко прив'язаний до
 * purpose 'partner_ad_watch' і не може підтвердити цю дію.
 */
export function WatchAdButton({ initData }: { initData: string }) {
  const { t } = useTranslation();
  const { patchProfile } = useUserData();
  const [isWatching, setIsWatching] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watch = async () => {
    if (isWatching) return;

    setIsWatching(true);
    setIsConfirming(false);
    setError(null);

    try {
      const ymid = await startVerifiedAttempt(initData, "withdraw_ad_watch");

      if (!ymid) {
        const adWatched = await showRewardedAdRotating();
        if (!adWatched) {
          setError(t.watchAd.adNotCompleted);
          return;
        }

        const res = await fetch("/api/ads/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `ad watch failed with status ${res.status}`);
        }

        const result = (await res.json()) as AdWatchResponse;
        patchProfile({
          ads_watched_since_withdraw: result.ads_watched_since_withdraw,
          withdrawal_quota: result.withdrawal_quota,
        });
        return;
      }

      const shown = await showRewardedAdRotatingWithProvider(ymid);
      if (!shown.watched) {
        setError(t.watchAd.adNotCompleted);
        return;
      }

      if (shown.provider !== "monetag") {
        // gigapub: немає S2S postback. adsgram: Reward URL підтверджує лише
        // purpose 'partner_ad_watch', не 'withdraw_ad_watch' — не можемо
        // чекати на неможливе підтвердження, лишається довіра.
        const res = await fetch("/api/ads/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `ad watch failed with status ${res.status}`);
        }

        const result = (await res.json()) as AdWatchResponse;
        patchProfile({
          ads_watched_since_withdraw: result.ads_watched_since_withdraw,
          withdrawal_quota: result.withdrawal_quota,
        });
        return;
      }

      setIsConfirming(true);
      const outcome = await pollVerifiedAttempt(initData, ymid);

      if (outcome.kind === "confirmed") {
        patchProfile({
          ads_watched_since_withdraw: outcome.profile.ads_watched_since_withdraw,
          withdrawal_quota: outcome.profile.withdrawal_quota,
        });
      } else if (outcome.kind === "rejected") {
        setError(t.watchAd.notCounted);
      } else {
        setError(t.watchAd.stillProcessing);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsWatching(false);
      setIsConfirming(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={watch}
        disabled={isWatching}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-neon-gold/10 py-2 text-xs font-semibold text-neon-gold transition active:scale-[0.98] disabled:opacity-50"
      >
        {isConfirming ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
        {isConfirming ? t.watchAd.confirming : isWatching ? t.watchAd.loading : t.watchAd.button}
      </button>
      {error && <p className="mt-1.5 text-center text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
