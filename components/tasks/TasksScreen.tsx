"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Cpu,
  Zap,
  Send,
  Link2,
  Handshake,
  Wallet,
  Users,
  Star,
  Gift,
  Loader2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useUserData, type UserDataState } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import type { TaskCategory, TaskItem, TasksResponse, TaskVerifyResponse, TaskClaimResponse } from "@/types/api";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

const CATEGORY_ORDER: TaskCategory[] = ["in_game", "general", "partners", "wallet", "friends", "special"];

const ICON_MAP: Record<string, LucideIcon> = {
  cpu: Cpu,
  zap: Zap,
  send: Send,
  link: Link2,
  handshake: Handshake,
  wallet: Wallet,
  users: Users,
  star: Star,
  gift: Gift,
};

const CATEGORY_FALLBACK_ICON: Record<TaskCategory, LucideIcon> = {
  in_game: Cpu,
  general: Send,
  partners: Handshake,
  wallet: Wallet,
  friends: Users,
  special: Star,
};

function getTaskIcon(task: TaskItem): LucideIcon {
  if (task.icon && ICON_MAP[task.icon]) return ICON_MAP[task.icon];
  return CATEGORY_FALLBACK_ICON[task.category];
}

// Адмін може додати нове завдання в task_templates без відповідного перекладу —
// у такому разі показуємо сам слаг замість краху рендера (як getRarityLabel у
// FarmScreen/MarketScreen).
function getTaskCopy(t: TranslationDictionary, key: string): { title: string; description: string } {
  const entry = (t.tasks.items as Record<string, { title: string; description: string } | undefined>)[key];
  return entry ?? { title: key, description: "" };
}

type TasksState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; tasks: TaskItem[]; completed: number; total: number };

export function TasksScreen() {
  const { state } = useUserData();

  // Верхня плашка (заголовок + кнопка закриття) живе поза станами
  // завантаження/помилки — користувач завжди має явний шлях назад на Ферму,
  // навіть якщо /api/user/sync ще не відповів чи впав.
  return (
    <div className="flex flex-col gap-4">
      <TasksTopBar />
      <TasksBody state={state} />
    </div>
  );
}

function TasksBody({ state }: { state: UserDataState }) {
  if (state.status === "loading") return <ScreenSkeleton />;
  if (state.status === "no-telegram") return <NoTelegramNotice />;
  if (state.status === "error") return <SyncErrorNotice message={state.message} />;

  return <TasksScreenReady initData={state.initData} />;
}

function TasksTopBar() {
  const { t } = useTranslation();

  return (
    <div
      className="sticky top-0 z-40 -mx-4 -mt-4 flex items-center justify-between border-b border-white/[0.06] bg-background/90 px-4 py-3 backdrop-blur-xl"
      style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
    >
      <h1 className="font-display text-base font-extrabold uppercase tracking-wide bg-gradient-to-r from-neon-cyan to-neon-purple bg-clip-text text-transparent">
        {t.tasks.title}
      </h1>
      <Link
        href="/"
        aria-label={t.common.close}
        className="rounded-full p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white"
      >
        <X size={20} />
      </Link>
    </div>
  );
}

// Скелетон, підігнаний під реальну розмітку екрана (прогрес-картка + таби +
// список завдань), а не загальний ScreenSkeleton — щоб під час /api/tasks не
// було різкої зміни форми блоків (те, що тестування описало як "мерехтіння
// чорних блоків": невідповідний за формою/розміром скелетон різко замінювався
// реальним контентом).
function TasksSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="glass-card h-[92px] p-4">
        <div className="h-3 w-40 rounded-full bg-white/10" />
        <div className="mt-4 h-3 w-24 rounded-full bg-white/10" />
        <div className="mt-2 h-2 w-full rounded-full bg-white/5" />
      </div>

      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-20 shrink-0 rounded-full bg-white/5" />
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="glass-card h-[92px]" />
        ))}
      </div>
    </div>
  );
}

function TasksScreenReady({ initData }: { initData: string }) {
  const { t, language } = useTranslation();
  const { patchProfile } = useUserData();

  const [tasksState, setTasksState] = useState<TasksState>({ status: "loading" });
  const [activeCategory, setActiveCategory] = useState<TaskCategory>("in_game");
  const [openedLinks, setOpenedLinks] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<{ taskId: string; action: "verify" | "claim" } | null>(null);
  const [errorByTask, setErrorByTask] = useState<Record<string, string>>({});

  const loadTasks = useCallback(async () => {
    setTasksState({ status: "loading" });
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `tasks fetch failed with status ${res.status}`);
      }

      const data = (await res.json()) as TasksResponse;
      setTasksState({ status: "ready", tasks: data.tasks, completed: data.completed_count, total: data.total_count });
    } catch (err) {
      setTasksState({
        status: "error",
        message: err instanceof Error ? err.message : t.common.unknownError,
      });
    }
  }, [initData, t.common.unknownError]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const openTaskLink = (task: TaskItem) => {
    const url =
      task.action_type === "telegram_channel"
        ? `https://t.me/${task.target_value.replace(/^@/, "")}`
        : task.target_value;

    const webApp = window.Telegram?.WebApp;
    if (task.action_type === "telegram_channel" && webApp?.openTelegramLink) {
      webApp.openTelegramLink(url);
    } else if (webApp?.openLink) {
      webApp.openLink(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }

    setOpenedLinks((prev) => new Set(prev).add(task.id));
  };

  const verify = async (task: TaskItem) => {
    if (busy) return;
    setBusy({ taskId: task.id, action: "verify" });
    setErrorByTask((prev) => ({ ...prev, [task.id]: "" }));

    try {
      const res = await fetch("/api/tasks/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, task_id: task.id }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `verify failed with status ${res.status}`);
      }

      const result = (await res.json()) as TaskVerifyResponse;
      setTasksState((prev) =>
        prev.status === "ready"
          ? { ...prev, tasks: prev.tasks.map((x) => (x.id === task.id ? { ...x, status: result.status } : x)) }
          : prev,
      );

      if (!result.completed) {
        setErrorByTask((prev) => ({ ...prev, [task.id]: t.tasks.action.notCompletedYet }));
      }
    } catch (err) {
      setErrorByTask((prev) => ({
        ...prev,
        [task.id]: err instanceof Error ? err.message : t.common.unknownError,
      }));
    } finally {
      setBusy(null);
    }
  };

  const claim = async (task: TaskItem) => {
    if (busy) return;
    setBusy({ taskId: task.id, action: "claim" });
    setErrorByTask((prev) => ({ ...prev, [task.id]: "" }));

    try {
      const res = await fetch("/api/tasks/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, task_id: task.id }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `claim failed with status ${res.status}`);
      }

      const result = (await res.json()) as TaskClaimResponse;

      // Ресинк спільного стану користувача — Header/Wallet одразу бачать нові
      // баланси без повного /api/user/sync.
      patchProfile({
        game_balance: result.game_balance,
        withdrawable_balance: result.withdrawable_balance,
        withdrawal_quota: result.withdrawal_quota,
      });

      setTasksState((prev) =>
        prev.status === "ready"
          ? {
              ...prev,
              tasks: prev.tasks.map((x) => (x.id === task.id ? { ...x, status: "claimed" } : x)),
              completed: prev.completed + (task.status === "claimed" ? 0 : 1),
            }
          : prev,
      );
    } catch (err) {
      setErrorByTask((prev) => ({
        ...prev,
        [task.id]: err instanceof Error ? err.message : t.common.unknownError,
      }));
    } finally {
      setBusy(null);
    }
  };

  if (tasksState.status === "loading") return <TasksSkeleton />;
  if (tasksState.status === "error") return <SyncErrorNotice message={tasksState.message} />;

  const { tasks, completed, total } = tasksState;
  const progressPercent = total > 0 ? Math.min((completed / total) * 100, 100) : 0;
  const categoryTasks = tasks.filter((task) => task.category === activeCategory);

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card p-4 shadow-neon-purple">
        <p className="text-xs text-white/40">{t.tasks.subtitle}</p>

        <div className="mt-3 flex items-center justify-between text-xs font-semibold text-neon-cyan">
          <span className="flex items-center gap-1">
            <Zap size={12} />
            {t.tasks.progress(completed, total)}
          </span>
          <span className="text-white/40">{Math.round(progressPercent)}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {CATEGORY_ORDER.map((category) => {
          const active = category === activeCategory;
          return (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                active
                  ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan"
                  : "border-white/10 text-white/50 hover:text-white/80"
              }`}
            >
              {t.tasks.categories[category]}
              {category === "special" && (
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 animate-neon-pulse items-center justify-center rounded-full bg-neon-gold text-[8px] font-black text-background shadow-neon-gold">
                  ★
                </span>
              )}
            </button>
          );
        })}
      </div>

      {categoryTasks.length === 0 ? (
        <div className="glass-card p-5 text-center text-sm text-white/40">{t.tasks.empty}</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {categoryTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              opened={openedLinks.has(task.id)}
              busyAction={busy?.taskId === task.id ? busy.action : null}
              disabled={busy !== null}
              error={errorByTask[task.id]}
              onOpenLink={() => openTaskLink(task)}
              onVerify={() => verify(task)}
              onClaim={() => claim(task)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  opened,
  busyAction,
  disabled,
  error,
  onOpenLink,
  onVerify,
  onClaim,
}: {
  task: TaskItem;
  opened: boolean;
  busyAction: "verify" | "claim" | null;
  disabled: boolean;
  error?: string;
  onOpenLink: () => void;
  onVerify: () => void;
  onClaim: () => void;
}) {
  const { t, language } = useTranslation();
  const Icon = getTaskIcon(task);
  const copy = getTaskCopy(t, task.title_key);
  const isLinkTask = task.action_type === "telegram_channel" || task.action_type === "external_link";

  return (
    <div className="glass-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neon-cyan/10 text-neon-cyan">
          <Icon size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{copy.title}</p>
          {copy.description && <p className="mt-0.5 text-xs text-white/40">{copy.description}</p>}

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-neon-green">
              {t.tasks.reward[task.reward_type](
                formatNumber(language, task.reward_amount, { maximumFractionDigits: 2 }),
              )}
            </span>

            {!isLinkTask &&
              task.status === "pending" &&
              task.progress_current !== undefined &&
              task.progress_target !== undefined && (
                <span className="text-[11px] font-medium text-white/40">
                  {task.progress_current}/{task.progress_target}
                </span>
              )}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <TaskActionButton
          task={task}
          opened={opened}
          isLinkTask={isLinkTask}
          busyAction={busyAction}
          disabled={disabled}
          onOpenLink={onOpenLink}
          onVerify={onVerify}
          onClaim={onClaim}
        />
      </div>

      {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}

function TaskActionButton({
  task,
  opened,
  isLinkTask,
  busyAction,
  disabled,
  onOpenLink,
  onVerify,
  onClaim,
}: {
  task: TaskItem;
  opened: boolean;
  isLinkTask: boolean;
  busyAction: "verify" | "claim" | null;
  disabled: boolean;
  onOpenLink: () => void;
  onVerify: () => void;
  onClaim: () => void;
}) {
  const { t } = useTranslation();

  if (task.status === "claimed") {
    return (
      <button
        type="button"
        disabled
        className="flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-white/40"
      >
        {t.tasks.action.claimed}
      </button>
    );
  }

  if (task.status === "completed") {
    return (
      <button
        type="button"
        onClick={onClaim}
        disabled={disabled}
        className="flex w-full animate-neon-pulse items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-neon-gold to-neon-cyan py-2.5 text-xs font-bold uppercase tracking-wide text-background transition active:scale-[0.98] disabled:opacity-50"
      >
        {busyAction === "claim" && <Loader2 size={14} className="animate-spin" />}
        {busyAction === "claim" ? t.tasks.action.claiming : t.tasks.action.claim}
      </button>
    );
  }

  // status === "pending"
  if (!isLinkTask) {
    // *_count завдання: немає окремої дії "почати" — прогрес видно у TaskRow,
    // кнопка з'являється лише коли жива умова вже виконана (status стає 'completed').
    return (
      <button
        type="button"
        disabled
        className="flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-xs font-semibold text-white/30"
      >
        {t.tasks.action.start}
      </button>
    );
  }

  if (!opened) {
    return (
      <button
        type="button"
        onClick={onOpenLink}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple py-2.5 text-xs font-bold uppercase tracking-wide text-background transition active:scale-[0.98] disabled:opacity-50"
      >
        {t.tasks.action.start}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onVerify}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 py-2.5 text-xs font-bold uppercase tracking-wide text-neon-cyan transition active:scale-[0.98] disabled:opacity-50"
    >
      {busyAction === "verify" && <Loader2 size={14} className="animate-spin" />}
      {busyAction === "verify" ? t.tasks.action.verifying : t.tasks.action.verify}
    </button>
  );
}
