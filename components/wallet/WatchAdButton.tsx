"use client";

import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { showRewardedAd } from "@/lib/ads/monetag";
import { openDirectAdLink } from "@/lib/ads/openAdLink";
import type { AdWatchResponse } from "@/types/api";

/**
 * "Ads for Cashout" лічильник (MIN_ADS_BEFORE_WITHDRAW/20) і швидка кнопка
 * бонусної реклами. Клік запускає два незалежні монетизаційні канали
 * Monetag разом:
 *  - Direct Link (openDirectAdLink, lib/ads/openAdLink.ts) — відкривається
 *    одразу, без очікування. Немає промісу завершення, тож не впливає на
 *    інкремент лічильника — паралельний дохід.
 *  - SDK Rewarded Interstitial (showRewardedAd, zone 11600101,
 *    lib/ads/monetag.ts) — /api/ads/watch (інкремент ads_watched_since_withdraw)
 *    викликається лише після успішного резолву його промісу.
 * Немає server-side callback від Monetag, тож справжній захист від накрутки
 * лишається на бекенді (RPC record_ad_watch).
 */
export function WatchAdButton({ initData }: { initData: string }) {
  const { t } = useTranslation();
  const { state: userDataState, patchProfile } = useUserData();
  const telegramId = userDataState.status === "ready" ? userDataState.data.profile.telegram_id : undefined;
  const [isWatching, setIsWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watch = async () => {
    if (isWatching) return;

    setIsWatching(true);
    setError(null);

    try {
      openDirectAdLink(telegramId);

      const adWatched = await showRewardedAd();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsWatching(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={watch}
        disabled={isWatching}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-neon-gold/30 bg-neon-gold/10 py-2.5 text-sm font-semibold text-neon-gold transition active:scale-[0.98] disabled:opacity-50"
      >
        <PlayCircle size={16} />
        {isWatching ? t.watchAd.loading : t.watchAd.button}
      </button>
      {error && <p className="mt-1.5 text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}
