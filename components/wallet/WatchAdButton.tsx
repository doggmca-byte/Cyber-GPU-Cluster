"use client";

import { useEffect, useReducer, useSyncExternalStore } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { showRewardedAdForVerifiedFlow } from "@/lib/ads/rewardedAd";
import type { AdWatchResponse } from "@/types/api";
import { startVerifiedAttempt, pollVerifiedAttempt } from "@/lib/ads/verifiedAdWatch";

// /api/ads/watch відповідає 429 + retry_after_ms, якщо реклама закінчилась
// раніше за мінімальний час спроби або пауза після попереднього показу ще не
// минула. Спроба при цьому НЕ спожита — чекаємо й шлемо її ж ще раз.
const MAX_COUNT_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 25_000;

class AdCountError extends Error {}

async function countWatchedAd(initData: string, attemptId: string): Promise<AdWatchResponse> {
  for (let retry = 0; ; retry++) {
    const res = await fetch("/api/ads/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, attempt_id: attemptId }),
    });
    if (res.ok) return (await res.json()) as AdWatchResponse;

    const body = (await res.json().catch(() => null)) as { error?: string; retry_after_ms?: number } | null;
    const waitMs = body?.retry_after_ms;
    if (res.status === 429 && typeof waitMs === "number" && retry < MAX_COUNT_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, MAX_RETRY_WAIT_MS) + 500));
      continue;
    }
    throw new AdCountError(body?.error ?? `status ${res.status}`);
  }
}

// Один показ реклами для виводу на весь застосунок — стан живе в модулі, а не
// в компоненті. Раніше, якщо модалку виводу закрити посеред реклами й
// відкрити знову, новий екземпляр кнопки запускав ДРУГИЙ показ паралельно з
// першим: SDK не завершував обидва, друга спроба лишалась pending, і
// переглянута реклама пропадала (badbogdan, 15.10). Тепер новий екземпляр
// підхоплює поточний показ і показує його стан.
type AdFlowPhase = "idle" | "watching" | "confirming";

interface AdFlowState {
  id: number;
  phase: AdFlowPhase;
  startedAt: number;
  error: string | null;
}

// Показ, на який SDK так і не відповів за цей час, більше не блокує кнопку.
const STALE_FLOW_MS = 4 * 60 * 1000;

let adFlow: AdFlowState = { id: 0, phase: "idle", startedAt: 0, error: null };
const adFlowListeners = new Set<() => void>();

function setAdFlow(next: AdFlowState) {
  adFlow = next;
  adFlowListeners.forEach((listener) => listener());
}

/** Оновлює стан лише поточного показу — застарілий (stale) його не перетирає. */
function updateAdFlow(id: number, patch: Partial<Omit<AdFlowState, "id">>) {
  if (id !== adFlow.id) return;
  setAdFlow({ ...adFlow, ...patch });
}

function subscribeAdFlow(listener: () => void) {
  adFlowListeners.add(listener);
  return () => {
    adFlowListeners.delete(listener);
  };
}

function getAdFlow() {
  return adFlow;
}

function isAdFlowBusy(state: AdFlowState): boolean {
  return state.phase !== "idle" && Date.now() - state.startedAt < STALE_FLOW_MS;
}

/**
 * "Ads for Cashout" лічильник (MIN_ADS_BEFORE_WITHDRAW/20) і швидка кнопка
 * бонусної реклами. Показує рекламу через showRewardedAdRotatingWithProvider
 * (GigaPub/Monetag/AdsGram, lib/ads/rewardedAd.ts) — лише Rewarded
 * Interstitial, без переходу в зовнішній браузер.
 *
 * Показ реально підтверджується через S2S postback Monetag
 * (app/api/ads/monetag-postback, purpose: 'withdraw_ad_watch') перед тим,
 * як інкрементувати ads_watched_since_withdraw. Клієнтської довіри тут немає:
 * "перегляд" без підтвердження сервером не зараховується.
 */
export function WatchAdButton({ initData }: { initData: string }) {
  const { t } = useTranslation();
  const { patchProfile } = useUserData();
  const flow = useSyncExternalStore(subscribeAdFlow, getAdFlow, getAdFlow);
  const isWatching = isAdFlowBusy(flow);
  const isConfirming = isWatching && flow.phase === "confirming";
  const error = isWatching ? null : flow.error;

  // Свіжий екземпляр (модалку щойно відкрили) не показує помилку минулого
  // показу — як і раніше, коли стан жив у компоненті.
  useEffect(() => {
    if (!isAdFlowBusy(adFlow) && adFlow.error) setAdFlow({ ...adFlow, error: null });
  }, []);

  // Коли показ "зависне" довше за STALE_FLOW_MS — перемальовуємо, щоб кнопка ожила.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!isWatching) return;
    const timer = setTimeout(rerender, Math.max(0, flow.startedAt + STALE_FLOW_MS - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [isWatching, flow.startedAt]);

  const watch = async () => {
    // Перевірка по стану модуля, а не по рендеру: ловить і подвійний тап.
    if (isAdFlowBusy(adFlow)) return;

    const id = adFlow.id + 1;
    setAdFlow({ id, phase: "watching", startedAt: Date.now(), error: null });
    const setError = (message: string) => updateAdFlow(id, { error: message });

    try {
      // Спроба Monetag відкривається лише якщо черга реально дійде до
      // Monetag — інакше показ від іншої мережі лишав вічний "pending" рядок.
      const shown = await showRewardedAdForVerifiedFlow("withdraw", () =>
        startVerifiedAttempt(initData, "withdraw_ad_watch"),
      );

      if (!shown.watched) {
        setError(t.watchAd.adNotCompleted);
        return;
      }

      if (!shown.ymid) {
        setError(t.watchAd.notCounted);
        return;
      }

      if (shown.provider !== "monetag") {
        // GigaPub/AdsGram не мають S2S-підтвердження — сервер зараховує показ
        // за відкритою ДО показу спробою (мін. час, пауза, добовий ліміт).
        updateAdFlow(id, { phase: "confirming" });
        const result = await countWatchedAd(initData, shown.ymid);
        patchProfile({
          ads_watched_since_withdraw: result.ads_watched_since_withdraw,
          withdrawal_quota: result.withdrawal_quota,
        });
        return;
      }

      updateAdFlow(id, { phase: "confirming" });
      const outcome = await pollVerifiedAttempt(initData, shown.ymid);

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
      if (err instanceof AdCountError) {
        setError(err.message === "daily_ad_limit_reached" ? t.watchAd.dailyLimit : t.watchAd.notCounted);
      } else {
        setError(err instanceof Error ? err.message : t.common.unknownError);
      }
    } finally {
      updateAdFlow(id, { phase: "idle" });
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
