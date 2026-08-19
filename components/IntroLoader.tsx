"use client";

import { useEffect, useRef, useState } from "react";
import { Cpu, WifiOff } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

/**
 * Повноекранний Splash/Intro-екран поверх усього чрозму (Header/main/BottomNav
 * уже змонтовані під ним — жодного layout shift при зникненні, вимога #4).
 * Живе в app/(app)/layout.tsx ВСЕРЕДИНІ <UserDataProvider>, бо підписується
 * на useUserData() — той самий стан (loading/no-telegram/error/ready), яким
 * керуються ScreenSkeleton/NoTelegramNotice/SyncErrorNotice по екранах.
 *
 * SSR-безпека: жодного прямого читання window/localStorage в тілі рендера —
 * лише через useUserData()/useTranslation(), які вже SSR-safe самі по собі
 * (стартують з нейтральних дефолтів, реальні значення підвантажують в
 * useEffect). Немає потреби у dynamic(..., {ssr:false}).
 */

// Мінімум, скільки тримати спланш на екрані, навіть якщо sync відповів
// миттєво — щоб анімація прогрес-бару не "блимнула" непомітно (продуктова
// вимога: 1.2–1.5с).
const MIN_DISPLAY_MS = 1300;

// Fail-safe: якщо стан лишається "loading" довше цього — НЕ чекаємо вічно
// (Telegram SDK міг не завантажитись, /api/user/sync міг зависнути) —
// форсуємо стан "failed" з кнопкою повтору. Незалежний setTimeout, що не
// чекає на резолв/реджект жодного проміса — спрацює, навіть якщо fetch
// усередині UserDataProvider ніколи не завершиться сам.
const FAILSAFE_TIMEOUT_MS = 7500;

// Тривалість fade-out перед демонтажем (opacity 1 -> 0).
const FADE_DURATION_MS = 450;

// Скільки протримати "Ready!" на 100% перед стартом fade-out — щоб
// повідомлення встигли прочитати, а не миттю зникли.
const READY_HOLD_MS = 350;

// Імітована "стеля" авто-прогресу, поки реальні дані ще не готові. Сам по
// собі прогрес далі НЕ рухається (asymptotic ease-out — швидко спочатку,
// повільніше що ближче до стелі) — чекає на реальний status !== "loading",
// щоб стрибнути до 100%. 92% навмисно лежить у смузі 71–95% ("Syncing Hash
// rate..." — саме це насправді й відбувається в цей момент).
const SIMULATED_CAP = 92;
const TICK_MS = 150;

type Stage = "loading" | "finishing" | "hidden" | "failed";

export function IntroLoader() {
  const { state, refresh } = useUserData();
  const { t } = useTranslation();

  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<Stage>("loading");

  const mountedAtRef = useRef(Date.now());
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failsafeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearAllTimers() {
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    if (failsafeTimeoutRef.current) clearTimeout(failsafeTimeoutRef.current);
    if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
    tickIntervalRef.current = null;
    failsafeTimeoutRef.current = null;
    finishTimeoutRef.current = null;
  }

  // Запускає/перезапускає весь цикл: авто-прогрес до SIMULATED_CAP +
  // незалежний fail-safe таймер. Викликається при монтуванні і повторно з
  // handleRetry() після "failed".
  function startCycle() {
    clearAllTimers();
    mountedAtRef.current = Date.now();
    setProgress(0);
    setStage("loading");

    tickIntervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= SIMULATED_CAP) return prev;
        return Math.min(prev + (SIMULATED_CAP - prev) * 0.15 + 0.5, SIMULATED_CAP);
      });
    }, TICK_MS);

    failsafeTimeoutRef.current = setTimeout(() => {
      clearAllTimers();
      setStage("failed");
    }, FAILSAFE_TIMEOUT_MS);
  }

  useEffect(() => {
    startCycle();
    return clearAllTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Реагує на реальний UserDataProvider-статус — лише поки локально ще
  // "loading" (після "failed" користувач сам ініціює новий цикл кнопкою,
  // не автоматично тут).
  useEffect(() => {
    if (stage !== "loading") return;

    if (state.status === "error") {
      clearAllTimers();
      setStage("failed");
      return;
    }

    if (state.status === "ready" || state.status === "no-telegram") {
      clearAllTimers();

      const elapsed = Date.now() - mountedAtRef.current;
      const remaining = Math.max(MIN_DISPLAY_MS - elapsed, 0);

      finishTimeoutRef.current = setTimeout(() => {
        setProgress(100);
        finishTimeoutRef.current = setTimeout(() => {
          setStage("finishing");
          finishTimeoutRef.current = setTimeout(() => setStage("hidden"), FADE_DURATION_MS);
        }, READY_HOLD_MS);
      }, remaining);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, stage]);

  function handleRetry() {
    // refresh() скидає UserDataProvider назад у "loading" ЩЕ ДО першого
    // await (див. коментар у UserDataProvider.sync) — тому до моменту, коли
    // ефект вище побачить новий state.status, локальний stage вже теж
    // "loading" (startCycle нижче), а не залишок "error" з минулого разу.
    void refresh();
    startCycle();
  }

  if (stage === "hidden") return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background px-8 transition-opacity duration-[450ms] ease-out ${
        stage === "finishing" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      aria-hidden={stage === "finishing"}
    >
      {stage === "failed" ? (
        <>
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-red-400/30 bg-red-400/10 text-red-400">
            <WifiOff size={32} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">{t.intro.connectionIssueTitle}</p>
            <p className="mt-2 max-w-xs text-xs text-slate-400">{t.intro.connectionIssueDescription}</p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-2xl bg-neon-cyan px-6 py-2.5 text-xs font-semibold text-background shadow-neon-cyan transition active:scale-[0.98]"
          >
            {t.intro.retryButton}
          </button>
        </>
      ) : (
        <>
          <div className="pulse-glow flex h-20 w-20 items-center justify-center rounded-3xl border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan">
            <Cpu size={36} />
          </div>

          <h1 className="bg-gradient-to-r from-neon-cyan to-neon-purple bg-clip-text text-2xl font-bold tracking-wide text-transparent">
            {t.intro.title}
          </h1>

          <div className="flex w-full max-w-[240px] flex-col items-center gap-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple shadow-neon-cyan transition-[width] duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[11px] font-semibold tabular-nums text-neon-cyan">{Math.round(progress)}%</span>
          </div>

          <p className="min-h-[16px] text-center text-[11px] text-slate-500">{getStatusText(t.intro, progress)}</p>
        </>
      )}
    </div>
  );
}

function getStatusText(copy: TranslationDictionary["intro"], progress: number): string {
  if (progress >= 96) return copy.statusReady;
  if (progress >= 71) return copy.statusSync;
  if (progress >= 31) return copy.statusConnect;
  return copy.statusInit;
}
