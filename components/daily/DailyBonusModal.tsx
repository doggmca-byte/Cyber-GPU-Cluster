"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, PartyPopper, PlayCircle, ShieldCheck, Timer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { showRewardedAdRotating, showRewardedAdRotatingWithProvider } from "@/lib/ads/rewardedAd";
import { startVerifiedAttempt, pollVerifiedAttempt } from "@/lib/ads/verifiedAdWatch";
import {
  DAILY_BONUS_MIN_AD_INTERACTIONS,
  DAILY_BONUS_MIN_AD_WATCH_SECONDS,
  DAILY_BONUS_REWARD_TON,
} from "@/lib/constants/economy";
import type { DailyBonusClaimResponse, DailyBonusStatusResponse } from "@/types/api";

// Скільки секунд показуємо чекліст-заглушку перед автоматичним запуском
// реклами. Сервер (/api/daily-bonus/claim) усе одно перевіряє
// ad_watch_seconds >= DAILY_BONUS_MIN_AD_WATCH_SECONDS (5с) — цей відлік
// чесно покриває той поріг, тож ad_watch_seconds шлемо як цю ж константу.
const AD_COUNTDOWN_SECONDS = 5;

type ModalState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "cooldown"; targetMs: number; rewardAmount: number }
  | { phase: "available"; rewardAmount: number }
  | { phase: "claimed"; rewardAmount: number };

/**
 * Автоматичний флоу без ручного чекліста: короткий відлік → rewarded-показ →
 * клейм. Rewarded-показ — ЛИШЕ Rewarded Interstitial (повноцінний внутрішній
 * банер/відео, закривається хрестиком прямо в Telegram WebApp) через
 * showRewardedAdRotatingWithProvider (lib/ads/rewardedAd.ts), що чергує
 * GigaPub / Monetag / AdsGram від виклику до виклику, з автоматичним
 * fallback на наступного провайдера, якщо в попереднього немає реклами.
 * Rewarded Popup (перехід у зовнішній браузер на офер-сторінку) свідомо не
 * використовується ніде в цьому флоу. Якщо немає реклами в жодного з
 * трьох — клейм НЕ відправляється, користувач бачить "спробуйте пізніше"
 * (жодного автоматичного fallback-нарахування без реального підтвердження
 * перегляду).
 *
 * Monetag-показ реально підтверджується через S2S postback
 * (app/api/ads/monetag-postback, purpose: 'daily_bonus_watch') — клейм
 * відправляється лише ПІСЛЯ підтвердження, не одразу після резолву
 * клієнтського проміса. GigaPub і AdsGram лишаються на клієнтській довірі
 * (як і раніше) — захист від подвійного нарахування для них лишається
 * атомарний кулдаун у claim_daily_bonus (FOR UPDATE), не сам факт показу.
 */
export function DailyBonusModal({ initData, onClose }: { initData: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { patchProfile } = useUserData();

  const [state, setState] = useState<ModalState>({ phase: "loading" });

  const loadStatus = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/daily-bonus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `daily-bonus status failed with status ${res.status}`);
      }

      const data = (await res.json()) as DailyBonusStatusResponse;
      if (data.can_claim) {
        setState({ phase: "available", rewardAmount: data.reward_amount });
      } else {
        setState({
          phase: "cooldown",
          targetMs: Date.now() + data.cooldown_seconds * 1000,
          rewardAmount: data.reward_amount,
        });
      }
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : t.common.unknownError });
    }
  }, [initData, t.common.unknownError]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleClaimed = useCallback(
    (result: DailyBonusClaimResponse) => {
      patchProfile({
        game_balance: result.game_balance,
        withdrawable_balance: result.withdrawable_balance,
      });
      setState({ phase: "claimed", rewardAmount: result.reward_amount });
    },
    [patchProfile],
  );

  return (
    <Modal title={t.dailyBonus.modalTitle} onClose={onClose}>
      {state.phase === "loading" && <StatusMessage text={t.dailyBonus.loading} />}

      {state.phase === "error" && (
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-center text-xs text-red-400">{state.message}</p>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="rounded-2xl bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
          >
            {t.common.retry}
          </button>
        </div>
      )}

      {state.phase === "cooldown" && (
        <CooldownView
          targetMs={state.targetMs}
          rewardAmount={state.rewardAmount}
          onExpire={() => setState({ phase: "available", rewardAmount: state.rewardAmount })}
        />
      )}

      {state.phase === "available" && (
        <AutoAdView initData={initData} onCancel={onClose} onClaimed={handleClaimed} />
      )}

      {state.phase === "claimed" && <ClaimedView rewardAmount={state.rewardAmount} onClose={onClose} />}
    </Modal>
  );
}

function StatusMessage({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
      <Loader2 size={15} className="animate-spin" />
      {text}
    </div>
  );
}

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function CooldownView({
  targetMs,
  rewardAmount,
  onExpire,
}: {
  targetMs: number;
  rewardAmount: number;
  onExpire: () => void;
}) {
  const { t, language } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, (targetMs - Date.now()) / 1000));

  useEffect(() => {
    const tick = () => {
      const remaining = (targetMs - Date.now()) / 1000;
      if (remaining <= 0) {
        setSecondsLeft(0);
        onExpire();
        return;
      }
      setSecondsLeft(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMs]);

  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-gold/10 text-neon-gold">
        <Clock size={22} />
      </div>

      <p className="text-xs text-slate-400">{t.dailyBonus.cooldownTitle}</p>

      <p className="text-lg font-bold tabular-nums text-neon-gold">
        {t.dailyBonus.cooldownLabel(formatCountdown(secondsLeft))}
      </p>

      <p className="text-[11px] text-slate-500">
        {t.dailyBonus.claimButton(formatNumber(language, rewardAmount, { maximumFractionDigits: 6 }))}
      </p>
    </div>
  );
}

// Три пункти чекліста показуємо як уже підтверджені (зелений check) — це
// вимоги, які покриває сам автоматичний флоу (обов'язковий 5-секундний
// відлік + реальний rewarded-показ), а не інтерактивний прогрес користувача.
function ConfirmedChecklistItem({ icon: Icon, label }: { icon: typeof PlayCircle; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-neon-green/10 px-3 py-2">
      <CheckCircle2 size={16} className="shrink-0 text-neon-green" />
      <span className="flex items-center gap-1.5 text-[11px] text-slate-300">
        <Icon size={12} className="shrink-0 opacity-60" />
        {label}
      </span>
    </div>
  );
}

function AutoAdView({
  initData,
  onCancel,
  onClaimed,
}: {
  initData: string;
  onCancel: () => void;
  onClaimed: (result: DailyBonusClaimResponse) => void;
}) {
  const { t } = useTranslation();

  const [countdown, setCountdown] = useState(AD_COUNTDOWN_SECONDS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Захист від подвійного запуску (React StrictMode двічі монтує ефекти в
  // dev, а сам показ реклами — операція з побічним ефектом, яку не можна
  // просто повторити) і від setState після розмонтування (якщо користувач
  // встиг натиснути "Відміна" саме тоді, коли триває await реклами/клейму).
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const claimTrusted = useCallback(async () => {
    const res = await fetch("/api/daily-bonus/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        // Реальний ручний чекліст (кліки/сесія) прибрано — обов'язковий
        // AD_COUNTDOWN_SECONDS-відлік і сам факт rewarded-показу тепер
        // сильніший сигнал, ніж попередні "2+ кнопки/5+ секунд". Шлемо
        // мінімально необхідні за контрактом /api/daily-bonus/claim значення.
        ad_interactions: DAILY_BONUS_MIN_AD_INTERACTIONS,
        ad_watch_seconds: DAILY_BONUS_MIN_AD_WATCH_SECONDS,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `claim failed with status ${res.status}`);
    }

    return (await res.json()) as DailyBonusClaimResponse;
  }, [initData]);

  const runAdAndClaim = useCallback(async () => {
    setIsProcessing(true);
    setClaimError(null);

    try {
      const ymid = await startVerifiedAttempt(initData, "daily_bonus_watch");

      if (!ymid) {
        // Запит на відкриття спроби не вдався — повністю клієнто-довірчий
        // шлях для БУДЬ-ЯКОГО провайдера, як і раніше цієї фічі.
        const adWatched = await showRewardedAdRotating();
        if (!adWatched) {
          if (mountedRef.current) {
            setClaimError(t.dailyBonus.noAdAvailable);
            setIsProcessing(false);
          }
          return;
        }

        const result = await claimTrusted();
        if (mountedRef.current) onClaimed(result);
        return;
      }

      const shown = await showRewardedAdRotatingWithProvider(ymid);
      if (!shown.watched) {
        if (mountedRef.current) {
          setClaimError(t.dailyBonus.noAdAvailable);
          setIsProcessing(false);
        }
        return;
      }

      if (shown.provider !== "monetag") {
        // gigapub: немає S2S postback. adsgram: Reward URL підтверджує лише
        // purpose 'partner_ad_watch' — не можемо чекати на неможливе
        // підтвердження для щоденного бонусу, лишається довіра.
        const result = await claimTrusted();
        if (mountedRef.current) onClaimed(result);
        return;
      }

      if (mountedRef.current) setIsConfirming(true);
      const outcome = await pollVerifiedAttempt(initData, ymid);

      if (!mountedRef.current) return;

      if (outcome.kind === "confirmed") {
        onClaimed({
          reward_amount: DAILY_BONUS_REWARD_TON,
          game_balance: outcome.profile.game_balance,
          withdrawable_balance: outcome.profile.withdrawable_balance,
          last_daily_bonus_at: outcome.profile.last_daily_bonus_at ?? new Date().toISOString(),
          server_time: new Date().toISOString(),
        });
      } else if (outcome.kind === "rejected") {
        setClaimError(t.dailyBonus.notCounted);
        setIsProcessing(false);
        setIsConfirming(false);
      } else {
        setClaimError(t.dailyBonus.stillProcessing);
        setIsProcessing(false);
        setIsConfirming(false);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : t.common.unknownError;
      setClaimError(message === "Cooldown active" ? t.dailyBonus.cooldownActiveError : message);
      setIsProcessing(false);
      setIsConfirming(false);
    }
  }, [
    initData,
    onClaimed,
    claimTrusted,
    t.common.unknownError,
    t.dailyBonus.cooldownActiveError,
    t.dailyBonus.noAdAvailable,
    t.dailyBonus.notCounted,
    t.dailyBonus.stillProcessing,
  ]);

  // Відлік 5 → 0, раз/секунду; по завершенню — рівно один автоматичний запуск.
  useEffect(() => {
    if (countdown <= 0) return;
    const timeout = setTimeout(() => setCountdown((s) => s - 1), 1000);
    return () => clearTimeout(timeout);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || startedRef.current) return;
    startedRef.current = true;
    void runAdAndClaim();
  }, [countdown, runAdAndClaim]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="text-center">
        <p className="text-sm font-semibold text-white">{t.dailyBonus.adScreenTitle}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t.dailyBonus.adScreenSubtitle}</p>
      </div>

      <div className="flex flex-col gap-2">
        <ConfirmedChecklistItem icon={PlayCircle} label={t.dailyBonus.checklist.watchFull} />
        <ConfirmedChecklistItem icon={ShieldCheck} label={t.dailyBonus.checklist.twoButtons} />
        <ConfirmedChecklistItem icon={Timer} label={t.dailyBonus.checklist.stay5s} />
      </div>

      <div className="flex items-center justify-center gap-2 rounded-2xl bg-neon-cyan/10 px-4 py-2.5 text-center text-xs font-semibold text-neon-cyan">
        <Clock size={14} className={countdown > 0 ? "shrink-0 animate-pulse" : "shrink-0 animate-spin"} />
        {countdown > 0 ? t.dailyBonus.adStartingIn(countdown) : isConfirming ? t.dailyBonus.confirming : t.dailyBonus.adInProgress}
      </div>

      {claimError && <p className="text-center text-[11px] text-red-400">{claimError}</p>}

      <button
        type="button"
        onClick={onCancel}
        disabled={isProcessing}
        className="rounded-2xl border border-white/10 py-2 text-xs font-semibold text-slate-400 transition hover:bg-white/5 disabled:opacity-50"
      >
        {t.dailyBonus.cancel}
      </button>
    </div>
  );
}

function ClaimedView({ rewardAmount, onClose }: { rewardAmount: number; onClose: () => void }) {
  const { t, language } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-green/10 text-neon-green">
        <PartyPopper size={22} />
      </div>

      <p className="text-sm font-semibold text-neon-green">{t.dailyBonus.claimedTitle}</p>

      <p className="text-xl font-bold tabular-nums text-neon-green">
        {t.dailyBonus.claimedAmount(formatNumber(language, rewardAmount, { maximumFractionDigits: 6 }))}
      </p>

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-2xl bg-neon-cyan py-2.5 text-xs font-semibold text-background transition active:scale-[0.98]"
      >
        {t.dailyBonus.done}
      </button>
    </div>
  );
}
