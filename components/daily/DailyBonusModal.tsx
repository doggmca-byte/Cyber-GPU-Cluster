"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  Eye,
  ExternalLink,
  Loader2,
  PartyPopper,
  PlayCircle,
  ShieldCheck,
  ShoppingCart,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { showRewardedAd } from "@/lib/ads/monetag";
import { openDirectAdLink } from "@/lib/ads/openAdLink";
import { DAILY_BONUS_MIN_AD_INTERACTIONS, DAILY_BONUS_MIN_AD_WATCH_SECONDS } from "@/lib/constants/economy";
import type { DailyBonusClaimResponse, DailyBonusStatusResponse } from "@/types/api";

// Локальний поріг "переглянуто до кінця" — навмисно довший за
// DAILY_BONUS_MIN_AD_WATCH_SECONDS (5с "лишайся на цільовій сторінці"), щоб
// три пункти чеклиста відчувались як послідовний прогрес одного й того ж
// таймера сесії, а не збігались миттєво. Суто UI-деталь: сервер перевіряє
// лише ad_watch_seconds >= DAILY_BONUS_MIN_AD_WATCH_SECONDS.
const AD_FULL_SESSION_SECONDS = 8;

const AD_BUTTON_KEYS = ["go", "playNow", "joinNow", "view", "open", "install", "buy", "subscribe"] as const;
type AdButtonKey = (typeof AD_BUTTON_KEYS)[number];

const AD_BUTTON_ICONS: Record<AdButtonKey, LucideIcon> = {
  go: ArrowRight,
  playNow: PlayCircle,
  joinNow: Users,
  view: Eye,
  open: ExternalLink,
  install: Download,
  buy: ShoppingCart,
  subscribe: Bell,
};

type ModalState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "cooldown"; targetMs: number; rewardAmount: number }
  | { phase: "available"; rewardAmount: number }
  | { phase: "claimed"; rewardAmount: number };

/**
 * Сітка CTA-кнопок + таймер сесії — це UI-чекліст залучення (2+ різні
 * кнопки, 5+ секунд на сторінці), який клієнт відправляє разом із клеймом і
 * який сервер (/api/daily-bonus/claim) перевіряє як мінімальний поріг.
 * Два незалежні монетизаційні канали Monetag тут разом:
 *  - Direct Link (openDirectAdLink, lib/ads/openAdLink.ts) — відкривається
 *    один раз на старті рекламної сесії (перший клік по CTA-кнопці). Немає
 *    промісу завершення, тож НЕ гейтить клейм — це паралельний дохід.
 *  - SDK rewarded-показ (showRewardedAd, zone 11600101, lib/ads/monetag.ts)
 *    — кнопка клейму чекає на успішний проміс-резолв і лише тоді відправляє
 *    запит на бекенд.
 * Server-side callback від Monetag немає, тож захист від подвійного
 * нарахування — атомарний кулдаун у claim_daily_bonus (FOR UPDATE), не сам
 * факт показу реклами.
 */
export function DailyBonusModal({ initData, onClose }: { initData: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { state: userDataState, patchProfile } = useUserData();
  const telegramId = userDataState.status === "ready" ? userDataState.data.profile.telegram_id : undefined;

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
          <p className="text-center text-sm text-red-400">{state.message}</p>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/5"
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
        <AdInteractionView
          initData={initData}
          telegramId={telegramId}
          rewardAmount={state.rewardAmount}
          onCancel={onClose}
          onClaimed={handleClaimed}
        />
      )}

      {state.phase === "claimed" && <ClaimedView rewardAmount={state.rewardAmount} onClose={onClose} />}
    </Modal>
  );
}

function StatusMessage({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/40">
      <Loader2 size={16} className="animate-spin" />
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
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neon-gold/10 text-neon-gold shadow-neon-gold">
        <Clock size={28} />
      </div>

      <p className="text-sm text-white/50">{t.dailyBonus.cooldownTitle}</p>

      <p className="font-display text-2xl font-extrabold tabular-nums text-neon-gold drop-shadow-[0_0_18px_rgba(255,184,0,0.45)]">
        {t.dailyBonus.cooldownLabel(formatCountdown(secondsLeft))}
      </p>

      <p className="text-xs text-white/30">
        {t.dailyBonus.claimButton(formatNumber(language, rewardAmount, { maximumFractionDigits: 6 }))}
      </p>
    </div>
  );
}

function ChecklistItem({ done, icon: Icon, label }: { done: boolean; icon: LucideIcon; label: string }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${
        done ? "border-neon-green/40 bg-neon-green/10" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      {done ? (
        <CheckCircle2 size={18} className="shrink-0 text-neon-green" />
      ) : (
        <Circle size={18} className="shrink-0 text-white/20" />
      )}
      <span className={`flex items-center gap-1.5 text-xs ${done ? "text-white/80" : "text-white/50"}`}>
        <Icon size={13} className="shrink-0 opacity-60" />
        {label}
      </span>
    </div>
  );
}

function AdInteractionView({
  initData,
  telegramId,
  rewardAmount,
  onCancel,
  onClaimed,
}: {
  initData: string;
  telegramId: number | undefined;
  rewardAmount: number;
  onCancel: () => void;
  onClaimed: (result: DailyBonusClaimResponse) => void;
}) {
  const { t, language } = useTranslation();

  const [clickedButtons, setClickedButtons] = useState<Set<AdButtonKey>>(new Set());
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Таймер "рекламної сесії" стартує з першого кліку по будь-якій кнопці —
  // до цього моменту жоден пункт чеклиста не може виконатись.
  useEffect(() => {
    if (sessionStartMs === null) return;

    const tick = () => setElapsedSeconds(Math.max(0, (Date.now() - sessionStartMs) / 1000));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [sessionStartMs]);

  const handleAdButtonClick = (key: AdButtonKey) => {
    if (sessionStartMs === null) {
      // Direct Link — окремий монетизаційний канал від showRewardedAd на
      // кнопці клейму (не гейтить чекліст/клейм, лише сам факт відкриття),
      // тож відкриваємо його рівно раз, на старті рекламної сесії.
      openDirectAdLink(telegramId);
      setSessionStartMs(Date.now());
    }
    setClickedButtons((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const watchedFull = elapsedSeconds >= AD_FULL_SESSION_SECONDS;
  const twoButtonsClicked = clickedButtons.size >= DAILY_BONUS_MIN_AD_INTERACTIONS;
  const stayedMinSeconds = elapsedSeconds >= DAILY_BONUS_MIN_AD_WATCH_SECONDS;

  const doneCount = [watchedFull, twoButtonsClicked, stayedMinSeconds].filter(Boolean).length;
  const allDone = doneCount === 3;

  const claim = async () => {
    if (!allDone || isSubmitting) return;

    setIsSubmitting(true);
    setClaimError(null);

    try {
      // Rewarded Popup: клейм відправляється на бекенд лише якщо проміс
      // Monetag SDK успішно резолвнувся (реклама фактично переглянута).
      const adWatched = await showRewardedAd("pop");
      if (!adWatched) {
        setClaimError(t.dailyBonus.adNotCompleted);
        return;
      }

      const res = await fetch("/api/daily-bonus/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData,
          ad_interactions: clickedButtons.size,
          ad_watch_seconds: Math.floor(elapsedSeconds),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `claim failed with status ${res.status}`);
      }

      const result = (await res.json()) as DailyBonusClaimResponse;
      onClaimed(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : t.common.unknownError;
      setClaimError(message === "Cooldown active" ? t.dailyBonus.cooldownActiveError : message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <p className="font-display text-sm font-extrabold uppercase tracking-wide bg-gradient-to-r from-neon-cyan to-neon-purple bg-clip-text text-transparent">
          {t.dailyBonus.adScreenTitle}
        </p>
        <p className="mt-1 text-xs text-white/40">{t.dailyBonus.adScreenSubtitle}</p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {AD_BUTTON_KEYS.map((key) => {
          const Icon = AD_BUTTON_ICONS[key];
          const active = clickedButtons.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleAdButtonClick(key)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2.5 text-[10px] font-semibold transition active:scale-95 ${
                active
                  ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan shadow-neon-cyan"
                  : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20"
              }`}
            >
              <Icon size={16} />
              <span className="truncate">{t.dailyBonus.adButtons[key]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <ChecklistItem done={watchedFull} icon={PlayCircle} label={t.dailyBonus.checklist.watchFull} />
        <ChecklistItem done={twoButtonsClicked} icon={ShieldCheck} label={t.dailyBonus.checklist.twoButtons} />
        <ChecklistItem done={stayedMinSeconds} icon={Timer} label={t.dailyBonus.checklist.stay5s} />
      </div>

      <div className="flex items-center justify-between text-[11px] text-white/40">
        <span>{t.dailyBonus.progress(doneCount, 3)}</span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-green transition-all"
            style={{ width: `${(doneCount / 3) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-semibold text-white/60 transition hover:bg-white/5 disabled:opacity-50"
        >
          {t.dailyBonus.cancel}
        </button>
        <button
          type="button"
          onClick={claim}
          disabled={!allDone || isSubmitting}
          className={`flex flex-[2] items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold uppercase tracking-wide transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
            allDone
              ? "animate-neon-pulse bg-gradient-to-r from-neon-green to-neon-cyan text-background"
              : "bg-white/[0.06] text-white/40"
          }`}
        >
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          {isSubmitting
            ? t.dailyBonus.claiming
            : t.dailyBonus.claimButton(formatNumber(language, rewardAmount, { maximumFractionDigits: 6 }))}
        </button>
      </div>

      {claimError && <p className="text-center text-xs text-red-400">{claimError}</p>}
    </div>
  );
}

function ClaimedView({ rewardAmount, onClose }: { rewardAmount: number; onClose: () => void }) {
  const { t, language } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="flex h-16 w-16 animate-neon-pulse items-center justify-center rounded-full bg-neon-green/10 text-neon-green shadow-neon-green">
        <PartyPopper size={28} />
      </div>

      <p className="font-display text-base font-extrabold text-neon-green">{t.dailyBonus.claimedTitle}</p>

      <p className="text-2xl font-bold tabular-nums text-neon-green">
        {t.dailyBonus.claimedAmount(formatNumber(language, rewardAmount, { maximumFractionDigits: 6 }))}
      </p>

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple py-2.5 text-sm font-bold text-background transition active:scale-[0.98]"
      >
        {t.dailyBonus.done}
      </button>
    </div>
  );
}
