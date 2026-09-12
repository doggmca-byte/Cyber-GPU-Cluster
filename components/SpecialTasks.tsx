"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Tag,
  Link2,
  Copy,
  Check,
  Lock,
  Clock,
  Loader2,
  PartyPopper,
  AlertCircle,
  Play,
  BellRing,
} from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import type {
  RetentionFailureReason,
  RetentionStageConfig,
  RetentionTaskStartResponse,
  RetentionTaskStatus,
  RetentionTasksResponse,
  RetentionTaskType,
  RetentionTaskVerifyResponse,
} from "@/types/api";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import { postJsonWithRetry } from "@/lib/api/postJsonWithRetry";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; tasks: RetentionTaskStatus[]; stages: RetentionStageConfig[] };

/**
 * "Особливі завдання із таймером утримання" — NAME_TAG (тег в імені) і
 * BIO_LINK (реферальне посилання в Bio), 6-етапний ланцюжок кожен.
 * Один запит /api/retention-tasks на завантаження (обидва завдання разом),
 * далі кожна картка керує власним Старт/Перевірити незалежно.
 */
export function SpecialTasks({ initData }: { initData: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const data = await postJsonWithRetry<RetentionTasksResponse>("/api/retention-tasks", { initData });
      setState({ phase: "ready", tasks: data.tasks, stages: data.stages });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : t.retentionTasks.loadError,
      });
    }
  }, [initData, t.retentionTasks.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateTask = useCallback((next: RetentionTaskStatus) => {
    setState((prev) => {
      if (prev.phase !== "ready") return prev;
      return { ...prev, tasks: prev.tasks.map((task) => (task.task_type === next.task_type ? next : task)) };
    });
  }, []);

  if (state.phase === "loading") {
    return (
      <div className="glass-card flex items-center justify-center gap-2 border-neon-gold/20 py-8 text-xs text-slate-500">
        <Loader2 size={15} className="animate-spin" />
        {t.common.loading}
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="glass-card flex flex-col items-center gap-3 border-neon-gold/20 p-4 text-center">
        <p className="text-xs text-red-400">{state.message}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-2xl bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
        >
          {t.common.retry}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="px-1">
        <p className="text-xs font-bold uppercase tracking-widest text-neon-gold">{t.retentionTasks.sectionTitle}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{t.retentionTasks.sectionSubtitle}</p>
      </div>

      {state.tasks.map((task) => (
        <RetentionTaskCard
          key={task.task_type}
          task={task}
          allStages={state.stages}
          initData={initData}
          onUpdate={updateTask}
        />
      ))}
    </div>
  );
}

function iconForTaskType(taskType: RetentionTaskType) {
  return taskType === "NAME_TAG" ? Tag : Link2;
}

function titleFor(t: TranslationDictionary, taskType: RetentionTaskType): { title: string; description: string } {
  return taskType === "NAME_TAG"
    ? { title: t.retentionTasks.nameTagTitle, description: t.retentionTasks.nameTagDescription }
    : { title: t.retentionTasks.bioLinkTitle, description: t.retentionTasks.bioLinkDescription };
}

function failureReasonToMessage(t: TranslationDictionary, reason: RetentionFailureReason | undefined): string {
  if (reason === "tag_missing") return t.retentionTasks.errorTagMissing;
  if (reason === "bio_hidden_or_missing") return t.retentionTasks.errorBioHidden;
  return t.retentionTasks.errorCheckFailed;
}

/**
 * Кілька "сирих" повідомлень із SQL-винятків (start_retention_task_stage /
 * verify_retention_task_stage) можуть вискочити при рідкісних гонках
 * (розсинхрон годинника клієнт/сервер, кілька відкритих вкладок) — мапимо
 * їх на дружній текст замість технічного англійського рядка, той самий
 * підхід, що й DailyBonusModal ("Cooldown active" -> cooldownActiveError).
 */
function friendlyApiError(t: TranslationDictionary, rawMessage: string, fallback: string): string {
  if (
    rawMessage === "stage timer has not elapsed yet" ||
    rawMessage === "stage already active" ||
    rawMessage === "all stages already completed" ||
    rawMessage === "condition not met yet"
  ) {
    return fallback;
  }
  return rawMessage;
}

function formatStageCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function formatStageDuration(t: TranslationDictionary, seconds: number): string {
  if (seconds >= 86400) return t.retentionTasks.unitDays(Math.round(seconds / 86400));
  if (seconds >= 3600) return t.retentionTasks.unitHours(Math.round(seconds / 3600));
  return t.retentionTasks.unitMinutes(Math.round(seconds / 60));
}

function RetentionTaskCard({
  task: initialTask,
  allStages,
  initData,
  onUpdate,
}: {
  task: RetentionTaskStatus;
  allStages: RetentionStageConfig[];
  initData: string;
  onUpdate: (next: RetentionTaskStatus) => void;
}) {
  const { t, language } = useTranslation();
  const { patchProfile } = useUserData();

  // Локальна копія статусу цієї картки — оновлюється і батьком (onUpdate,
  // після реального запиту), і живим тіком секунд тут же (щоб не смикати
  // весь /api/retention-tasks раз/сек заради одного таймера).
  const [task, setTask] = useState(initialTask);
  useEffect(() => setTask(initialTask), [initialTask]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!task.is_active) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [task.is_active]);

  const fetchedAtRef = useRef(Date.now());
  useEffect(() => {
    fetchedAtRef.current = Date.now();
    setNow(Date.now());
  }, [initialTask]);

  const liveSecondsRemaining = task.is_active
    ? Math.max(task.seconds_remaining - (now - fetchedAtRef.current) / 1000, 0)
    : 0;
  const canVerifyNow = task.is_active && liveSecondsRemaining <= 0;

  const [isStarting, setIsStarting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const myStages = useMemo(
    () =>
      allStages
        .filter((s) => s.task_type === task.task_type)
        .sort((a, b) => a.stage - b.stage),
    [allStages, task.task_type],
  );

  const totalPossible = useMemo(
    () => myStages.reduce((sum, s) => sum + s.reward_amount, 0),
    [myStages],
  );

  const { title, description } = titleFor(t, task.task_type);
  const Icon = iconForTaskType(task.task_type);

  const copyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(task.target_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API недоступний — тиха відмова, як і в ProfileCard.
    }
  }, [task.target_text]);

  const start = useCallback(async () => {
    if (isStarting) return;
    setIsStarting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/retention-tasks/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, task_type: task.task_type }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          body?.error
            ? friendlyApiError(t, body.error, t.retentionTasks.errorGenericStart)
            : t.retentionTasks.errorGenericStart,
        );
      }

      const data = (await res.json()) as RetentionTaskStartResponse;
      if (!data.started) {
        setErrorMessage(failureReasonToMessage(t, data.failure_reason));
        return;
      }

      const next: RetentionTaskStatus = {
        ...task,
        current_stage: data.current_stage ?? task.current_stage,
        is_active: data.is_active ?? true,
        stage_started_at: data.stage_started_at ?? new Date().toISOString(),
        seconds_remaining: data.stage_duration_seconds ?? task.seconds_remaining,
        can_verify: false,
      };
      fetchedAtRef.current = Date.now();
      setNow(Date.now());
      setTask(next);
      onUpdate(next);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t.retentionTasks.errorGenericStart);
    } finally {
      setIsStarting(false);
    }
  }, [initData, isStarting, onUpdate, t, task]);

  const verify = useCallback(async () => {
    if (isVerifying) return;
    setIsVerifying(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/retention-tasks/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, task_type: task.task_type }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          body?.error
            ? friendlyApiError(t, body.error, t.retentionTasks.errorGenericVerify)
            : t.retentionTasks.errorGenericVerify,
        );
      }

      const data = (await res.json()) as RetentionTaskVerifyResponse;

      patchProfile({
        game_balance: data.game_balance,
        withdrawable_balance: data.withdrawable_balance,
        withdrawal_quota: data.withdrawal_quota,
      });

      if (!data.success) {
        setErrorMessage(`${failureReasonToMessage(t, data.failure_reason)} ${t.retentionTasks.errorTimerReset}`);
        const next: RetentionTaskStatus = {
          ...task,
          is_active: false,
          stage_started_at: null,
          seconds_remaining: 0,
          can_verify: false,
        };
        fetchedAtRef.current = Date.now();
        setNow(Date.now());
        setTask(next);
        onUpdate(next);
        return;
      }

      const next: RetentionTaskStatus = {
        ...task,
        current_stage: data.current_stage,
        is_active: data.is_active,
        stage_started_at: data.stage_started_at,
        seconds_remaining: myStages.find((s) => s.stage === data.current_stage)?.duration_seconds ?? 0,
        can_verify: false,
        is_fully_completed: data.is_fully_completed,
        total_reward_claimed: task.total_reward_claimed + data.reward_credited,
      };
      fetchedAtRef.current = Date.now();
      setNow(Date.now());
      setTask(next);
      onUpdate(next);
      setSuccessMessage(
        t.retentionTasks.rewardToast(formatNumber(language, data.reward_credited, { maximumFractionDigits: 6 })),
      );
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t.retentionTasks.errorGenericVerify);
    } finally {
      setIsVerifying(false);
    }
  }, [initData, isVerifying, language, myStages, onUpdate, patchProfile, t, task]);

  const canStart = !task.is_active && !task.is_fully_completed;
  const canVerifyClick = task.is_active && canVerifyNow && !task.is_fully_completed;

  return (
    <div className="glass-card relative flex flex-col gap-3 overflow-hidden border-neon-gold/25 p-3.5 shadow-[0_0_1px_rgba(251,191,36,0.7),0_0_24px_rgba(251,191,36,0.12)]">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neon-gold/20 bg-gradient-to-br from-neon-gold/15 to-neon-green/10 text-neon-gold">
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">{title}</p>
          <p className="mt-0.5 font-mono text-[11px] font-bold tabular-nums text-neon-green">
            {t.retentionTasks.rewardProgress(
              formatNumber(language, task.total_reward_claimed, { maximumFractionDigits: 3 }),
              formatNumber(language, totalPossible, { maximumFractionDigits: 3 }),
              t.common.ton,
            )}
          </p>
        </div>
        {task.is_fully_completed && (
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-neon-green/10 px-2 py-1 text-[10px] font-bold text-neon-green">
            <PartyPopper size={12} />
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500">{description}</p>

      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300" dir="ltr">
          {task.target_text}
        </p>
        <button
          type="button"
          onClick={() => void copyText()}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 transition active:scale-95 hover:bg-white/10"
        >
          {copied ? <Check size={12} className="text-neon-green" /> : <Copy size={12} />}
          {copied ? t.retentionTasks.copied : t.retentionTasks.copyButton}
        </button>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {myStages.map((stage) => (
          <StageCell
            key={stage.stage}
            stage={stage}
            currentStage={task.current_stage}
            isActive={task.is_active}
            secondsRemaining={liveSecondsRemaining}
            isFullyCompleted={task.is_fully_completed}
          />
        ))}
      </div>

      {task.task_type === "BIO_LINK" && !task.is_fully_completed && (
        <div className="flex items-start gap-1.5 rounded-xl bg-neon-gold/10 px-2.5 py-2 text-[10px] text-slate-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0 text-neon-gold" />
          {t.retentionTasks.bioPrivacyWarning}
        </div>
      )}

      {task.is_fully_completed ? (
        <div className="flex flex-col items-center gap-1 rounded-xl bg-neon-green/10 py-2.5 text-center">
          <p className="text-xs font-bold text-neon-green">{t.retentionTasks.fullyCompletedTitle}</p>
          <p className="text-[10px] text-slate-500">{t.retentionTasks.fullyCompletedHint}</p>
        </div>
      ) : (
        <>
          {task.is_active && !canVerifyNow && (
            <p className="text-center font-mono text-[11px] text-slate-500">
              {t.retentionTasks.countdownLabel(formatStageCountdown(liveSecondsRemaining))}
            </p>
          )}
          {canVerifyClick && (
            <p className="text-center text-[11px] font-semibold text-neon-green">{t.retentionTasks.readyToVerify}</p>
          )}
          {!task.is_active && <p className="text-center text-[10px] text-slate-500">{t.retentionTasks.notStartedHint}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void start()}
              disabled={!canStart || isStarting}
              className="flex items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-slate-300 transition active:scale-95 disabled:opacity-40"
            >
              {isStarting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {isStarting ? t.retentionTasks.starting : t.retentionTasks.startButton}
            </button>

            <button
              type="button"
              onClick={() => void verify()}
              disabled={!canVerifyClick || isVerifying}
              className="flex items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-neon-gold to-neon-green py-2.5 text-xs font-bold text-background shadow-[0_0_16px_rgba(251,191,36,0.35)] transition active:scale-95 disabled:opacity-40 disabled:shadow-none"
            >
              {isVerifying ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
              {isVerifying ? t.retentionTasks.verifying : t.retentionTasks.verifyButton}
            </button>
          </div>
        </>
      )}

      {errorMessage && <p className="text-center text-[11px] text-red-400">{errorMessage}</p>}
      {successMessage && <p className="text-center text-[11px] font-semibold text-neon-green">{successMessage}</p>}
    </div>
  );
}

function StageCell({
  stage,
  currentStage,
  isActive,
  secondsRemaining,
  isFullyCompleted,
}: {
  stage: RetentionStageConfig;
  currentStage: number;
  isActive: boolean;
  secondsRemaining: number;
  isFullyCompleted: boolean;
}) {
  const { t } = useTranslation();

  const isDone = isFullyCompleted || stage.stage < currentStage;
  const isCurrent = !isFullyCompleted && stage.stage === currentStage;
  const isLocked = !isFullyCompleted && stage.stage > currentStage;
  const isReady = isCurrent && isActive && secondsRemaining <= 0;
  const isCounting = isCurrent && isActive && secondsRemaining > 0;
  const isIdleCurrent = isCurrent && !isActive;

  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-xl border p-1.5 text-center transition ${
        isDone
          ? "border-neon-green/30 bg-neon-green/10"
          : isReady
            ? "border-neon-gold/40 bg-neon-gold/10 shadow-[0_0_10px_rgba(251,191,36,0.3)]"
            : isCounting
              ? "border-neon-cyan/25 bg-neon-cyan/5"
              : isIdleCurrent
                ? "border-white/15 bg-white/5"
                : "border-white/5 bg-white/[0.02] opacity-50"
      }`}
    >
      {isDone ? (
        <Check size={13} className="text-neon-green" />
      ) : isReady ? (
        <BellRing size={13} className="text-neon-gold" />
      ) : isCounting ? (
        <Clock size={13} className="text-neon-cyan" />
      ) : isIdleCurrent ? (
        <Play size={13} className="text-slate-300" />
      ) : (
        <Lock size={11} className="text-slate-600" />
      )}
      <span
        className={`text-[8px] font-bold uppercase tabular-nums ${
          isLocked ? "text-slate-600" : "text-slate-400"
        }`}
      >
        {formatStageDuration(t, stage.duration_seconds)}
      </span>
    </div>
  );
}
