"use client";

import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { showRewardedAdRotating } from "@/lib/ads/rewardedAd";
import type { AdWatchResponse } from "@/types/api";

/**
 * "Ads for Cashout" лічильник (MIN_ADS_BEFORE_WITHDRAW/20) і швидка кнопка
 * бонусної реклами. Клік показує лише Rewarded Interstitial — повноцінний
 * внутрішній банер/відео, що закривається хрестиком прямо в Telegram
 * WebApp — через showRewardedAdRotating (lib/ads/rewardedAd.ts), який
 * чергує GigaPub (App ID 7784) і Monetag (zone 11600101) від виклику до
 * виклику, з автоматичним fallback на другого провайдера, якщо в першого
 * немає реклами. /api/ads/watch (інкремент ads_watched_since_withdraw)
 * викликається лише якщо БУДЬ-ЯКИЙ з двох показав рекламу успішно.
 *
 * Rewarded Popup / Monetag Direct Link (перехід у зовнішній браузер на
 * офер-сторінку) свідомо ВИДАЛЕНО — користувача ніколи не можна виштовхувати
 * з Mini App при перегляді реклами.
 *
 * Немає server-side callback від жодного з провайдерів, тож справжній
 * захист від накрутки лишається на бекенді (RPC record_ad_watch).
 */
export function WatchAdButton({ initData }: { initData: string }) {
  const { t } = useTranslation();
  const { patchProfile } = useUserData();
  const [isWatching, setIsWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watch = async () => {
    if (isWatching) return;

    setIsWatching(true);
    setError(null);

    try {
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
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-neon-gold/10 py-2 text-xs font-semibold text-neon-gold transition active:scale-[0.98] disabled:opacity-50"
      >
        <PlayCircle size={14} />
        {isWatching ? t.watchAd.loading : t.watchAd.button}
      </button>
      {error && <p className="mt-1.5 text-center text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
