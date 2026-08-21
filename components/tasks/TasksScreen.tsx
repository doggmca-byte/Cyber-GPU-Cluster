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
  PlayCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import { useUserData, type UserDataState } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { showRewardedAdRotating, showRewardedAdRotatingWithProvider } from "@/lib/ads/rewardedAd";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import { SupportButton } from "@/components/layout/SupportButton";
import type {
  TaskCategory,
  TaskItem,
  TasksResponse,
  TaskVerifyResponse,
  TaskClaimResponse,
  PartnerAdWatchResponse,
  SyncResponse,
} from "@/types/api";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

// Дзеркалить константи в record_partner_ad_watch
// (supabase/migrations/20260820100000_lower_partner_ad_reward.sql) — лише
// для відображення (сервер — єдине джерело правди для фактичного нарахування
// й ліміту, тут це тільки початкове значення до першого перегляду за сесію).
const PARTNER_AD_REWARD_TON = 0.001;
const PARTNER_AD_DAILY_LIMIT = 20;

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

/**
 * task_templates.icon для партнерських завдань може бути НЕ ключем ICON_MAP,
 * а прямим емодзі-символом (адмін вписує його напряму в БД) — на відміну від
 * решти завдань, де один Lucide-набір на всю категорію не давав би
 * достатньої різноманітності для окремих партнерів. Якщо значення відоме
 * ICON_MAP — це звичайна Lucide-іконка (getTaskIcon вище), інакше рендеримо
 * сам рядок як емодзі-текст.
 */
function getEmojiIcon(task: TaskItem): string | null {
  if (task.icon && !ICON_MAP[task.icon]) return task.icon;
  return null;
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
      className="sticky top-0 z-40 -mx-4 -mt-4 flex items-center justify-between border-b border-white/5 bg-background/95 px-4 py-2.5"
      style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
    >
      <h1 className="text-sm font-semibold text-white">{t.tasks.title}</h1>
      <div className="flex items-center gap-1.5">
        <SupportButton />
        <Link
          href="/"
          aria-label={t.common.close}
          className="rounded-full p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
        >
          <X size={18} />
        </Link>
      </div>
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

  const openTaskLink = async (task: TaskItem) => {
    let url: string;

    if (task.action_type === "partner_postback") {
      // На відміну від telegram_channel/external_link, тут не можна відкрити
      // task.target_value напряму — спершу /api/partners/click генерує
      // click_id (щоб пізніше зіставити з postback від партнера) і повертає
      // готовий URL з підставленим значенням.
      setErrorByTask((prev) => ({ ...prev, [task.id]: "" }));
      try {
        const res = await fetch("/api/partners/click", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, task_id: task.id }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `partner click failed with status ${res.status}`);
        }

        ({ url } = (await res.json()) as { click_id: string; url: string });
      } catch (err) {
        setErrorByTask((prev) => ({
          ...prev,
          [task.id]: err instanceof Error ? err.message : t.common.unknownError,
        }));
        return;
      }
    } else if (task.action_type === "partner_api_check") {
      // target_value — JSON {open_url, check_url} (lib/partners/checkExternalTask.ts) —
      // відкриваємо саме open_url, а не сирий target_value.
      try {
        ({ open_url: url } = JSON.parse(task.target_value) as { open_url: string; check_url: string });
      } catch {
        setErrorByTask((prev) => ({ ...prev, [task.id]: t.common.unknownError }));
        return;
      }
    } else {
      url =
        task.action_type === "telegram_channel"
          ? `https://t.me/${task.target_value.replace(/^@/, "")}`
          : task.target_value;
    }

    const webApp = window.Telegram?.WebApp;
    // Раніше сюди потрапляв ЛИШЕ telegram_channel — але partner_api_check/
    // partner_postback теж майже завжди відкривають t.me-посилання (боти
    // партнерів, часто з startapp-параметром для запуску їхнього Mini App).
    // openLink() призначений для ЗОВНІШНІХ сайтів і відкриває їх у
    // системному/зовнішньому браузері — для внутрішніх t.me-посилань це
    // ненадійно (Telegram сам документує, що такі лінки мають йти через
    // openTelegramLink, інакше перехід у сам бот/чат може просто не
    // відбутись). Перевіряємо host, а не action_type — надійніше для
    // будь-якого майбутнього partner_postback URL, що теж виявиться t.me.
    let isTelegramInternalLink = false;
    try {
      isTelegramInternalLink = new URL(url).hostname.replace(/^www\./, "") === "t.me";
    } catch {
      // некоректний URL — лишаємо isTelegramInternalLink false, підемо в openLink/window.open нижче
    }

    if (isTelegramInternalLink && webApp?.openTelegramLink) {
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
      <div className="glass-card p-3.5">
        <p className="text-[11px] text-slate-500">{t.tasks.subtitle}</p>

        <div className="mt-2.5 flex items-center justify-between text-[11px] font-semibold text-neon-cyan">
          <span className="flex items-center gap-1">
            <Zap size={11} />
            {t.tasks.progress(completed, total)}
          </span>
          <span className="text-slate-500">{Math.round(progressPercent)}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-neon-cyan transition-all"
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
              className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                active ? "bg-neon-cyan/10 text-neon-cyan" : "bg-white/5 text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.tasks.categories[category]}
              {category === "special" && (
                <span className="absolute -right-1.5 -top-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-neon-gold text-[7px] font-black text-background">
                  ★
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        {activeCategory === "partners" && <PartnerAdsCard initData={initData} />}

        {categoryTasks.length === 0 ? (
          activeCategory !== "partners" && (
            <div className="glass-card p-4 text-center text-xs text-slate-500">{t.tasks.empty}</div>
          )
        ) : (
          categoryTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              opened={openedLinks.has(task.id)}
              busyAction={busy?.taskId === task.id ? busy.action : null}
              disabled={busy !== null}
              error={errorByTask[task.id]}
              onOpenLink={() => void openTaskLink(task)}
              onVerify={() => verify(task)}
              onClaim={() => claim(task)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Rewarded-реклама від GigaPub/Monetag (ротація — lib/ads/rewardedAd.ts, той
// самий SDK-шар, що й WatchAdButton у гаманці) з прямим TON-нарахуванням на
// withdrawable_balance. На відміну від TaskRow це НЕ task_templates-рядок —
// повторювана дія з денним лічильником (record_partner_ad_watch), тож живе
// окремою карткою над списком завдань вкладки "Партнери", а не в
// task_templates/user_tasks (там термінальний claimed один раз назавжди).
// Скільки разів/як часто опитувати /api/ads/monetag/attempt-status ПІСЛЯ
// того, як Monetag SDK резолвився (реклама показана) — реальний postback
// від сервера Monetag (не клієнт) приходить із затримкою в кілька секунд.
const MONETAG_POLL_ATTEMPTS = 8;
const MONETAG_POLL_DELAY_MS = 2000;

type MonetagPollResult =
  | { kind: "confirmed"; partnerAdsWatchedToday: number; withdrawableBalance: number }
  | { kind: "rejected" }
  | { kind: "timeout" };

async function pollMonetagAttemptStatus(initData: string, ymid: string): Promise<MonetagPollResult> {
  for (let attempt = 0; attempt < MONETAG_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, MONETAG_POLL_DELAY_MS));

    try {
      const res = await fetch("/api/ads/monetag/attempt-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, ymid }),
      });
      if (!res.ok) continue; // тимчасовий збій опитування — просто спробуємо ще раз наступного тику

      const data = (await res.json()) as {
        status: string;
        withdrawable_balance?: number;
        partner_ads_watched_today?: number;
      };

      if (data.status === "confirmed") {
        return {
          kind: "confirmed",
          partnerAdsWatchedToday: data.partner_ads_watched_today ?? 0,
          withdrawableBalance: data.withdrawable_balance ?? 0,
        };
      }
      if (data.status === "rejected") return { kind: "rejected" };
      // 'pending' — тікаємо далі
    } catch {
      // мережевий збій самого запиту (не лише !res.ok) — так само не фатально,
      // просто пробуємо ще раз наступного тику, а не обриваємо весь потік
      // загальною помилкою в watch().
    }
  }

  return { kind: "timeout" };
}

// AdsGram, на відміну від Monetag, не видає нам токен спроби наперед —
// їхній Reward URL postback (app/api/ads/adsgram-postback) кореляує
// виключно по telegramId, без ідентифікатора конкретного показу. Тож
// підтвердження тут — це не пошук статусу конкретної спроби, а порівняння
// лічильника partner_ads_watched_today "до" й "після": як тільки бекенд
// реально нарахував через постбек, лічильник зростає. Той самий принцип, що
// й у поллінгу Monetag — просто інший спосіб виявити подію без power токена.
async function pollAdsgramConfirmation(
  initData: string,
  baselineWatchedToday: number,
): Promise<MonetagPollResult> {
  for (let attempt = 0; attempt < MONETAG_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, MONETAG_POLL_DELAY_MS));

    try {
      const res = await fetch("/api/user/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      if (!res.ok) continue;

      const data = (await res.json()) as SyncResponse;
      if (data.profile.partner_ads_watched_today > baselineWatchedToday) {
        return {
          kind: "confirmed",
          partnerAdsWatchedToday: data.profile.partner_ads_watched_today,
          withdrawableBalance: data.profile.withdrawable_balance,
        };
      }
      // лічильник не зріс — постбек ще не прийшов (чи ніколи не прийде,
      // AdsGram не дає нам жодного явного "rejected"-сигналу для polling'у).
    } catch {
      // мережевий збій самого запиту — не фатально, пробуємо ще раз наступного тику.
    }
  }

  return { kind: "timeout" };
}

function PartnerAdsCard({ initData }: { initData: string }) {
  const { t, language } = useTranslation();
  const { state, patchProfile } = useUserData();
  const [isWatching, setIsWatching] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== "ready") return null;
  const { profile } = state.data;

  const today = new Date().toISOString().slice(0, 10);
  const watchedToday =
    profile.partner_ads_reset_date === today ? profile.partner_ads_watched_today : 0;
  const limitReached = watchedToday >= PARTNER_AD_DAILY_LIMIT;

  const watch = async () => {
    if (isWatching || limitReached) return;

    setIsWatching(true);
    setIsConfirming(false);
    setError(null);

    try {
      // Ротація (lib/ads/rewardedAd.ts) сама вирішує, чий зараз показ —
      // GigaPub чи Monetag. Monetag-показ зараз ЄДИНИЙ, для якого можливе
      // реальне server-side підтвердження (S2S postback,
      // app/api/ads/monetag-postback), тож заводимо ymid ДО показу. Якщо цей
      // запит сам не вдався — не блокуємо юзера повністю, а падаємо назад на
      // старий повністю клієнто-довірчий шлях (showRewardedAdRotating) для
      // ОБОХ провайдерів, як було раніше цієї фічі.
      let ymid: string | null = null;
      try {
        const attemptRes = await fetch("/api/ads/monetag/start-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, purpose: "partner_ad_watch" }),
        });
        if (attemptRes.ok) {
          ({ ymid } = (await attemptRes.json()) as { ymid: string });
        }
      } catch {
        // ignore — ymid лишається null, працюємо повністю клієнто-довірчим шляхом нижче
      }

      if (!ymid) {
        const adWatched = await showRewardedAdRotating();
        if (!adWatched) {
          setError(t.tasks.partnerAds.adNotCompleted);
          return;
        }

        const res = await fetch("/api/ads/partner-watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `partner ad watch failed with status ${res.status}`);
        }

        const result = (await res.json()) as PartnerAdWatchResponse;
        patchProfile({
          partner_ads_watched_today: result.partner_ads_watched_today,
          partner_ads_reset_date: today,
          withdrawable_balance: result.withdrawable_balance,
        });
        return;
      }

      const shown = await showRewardedAdRotatingWithProvider(ymid);
      if (!shown.watched) {
        setError(t.tasks.partnerAds.adNotCompleted);
        return;
      }

      if (shown.provider === "gigapub") {
        // GigaPub не має S2S postback — лишається на клієнтській довірі
        // (ymid, заведений вище для можливого Monetag-показу, просто
        // лишається невикористаним pending-рядком — нешкідливо, без
        // реального postback від Monetag ніколи не підтвердиться).
        const res = await fetch("/api/ads/partner-watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `partner ad watch failed with status ${res.status}`);
        }

        const result = (await res.json()) as PartnerAdWatchResponse;
        patchProfile({
          partner_ads_watched_today: result.partner_ads_watched_today,
          partner_ads_reset_date: today,
          withdrawable_balance: result.withdrawable_balance,
        });
        return;
      }

      setIsConfirming(true);

      // provider === "monetag" | "adsgram": НІЧОГО не нараховуємо тут —
      // чекаємо на реальний postback (app/api/ads/monetag-postback чи
      // app/api/ads/adsgram-postback відповідно), опитуючи короткими
      // інтервалами. Monetag дає нам токен спроби (ymid) — опитуємо його
      // напряму; AdsGram токена не дає, тож порівнюємо лічильник
      // partner_ads_watched_today "до" й "після" виклику показу.
      const outcome =
        shown.provider === "adsgram"
          ? await pollAdsgramConfirmation(initData, profile.partner_ads_watched_today)
          : await pollMonetagAttemptStatus(initData, ymid);

      if (outcome.kind === "confirmed") {
        patchProfile({
          partner_ads_watched_today: outcome.partnerAdsWatchedToday,
          partner_ads_reset_date: today,
          withdrawable_balance: outcome.withdrawableBalance,
        });
      } else if (outcome.kind === "rejected") {
        setError(t.tasks.partnerAds.notCounted);
      } else {
        // timeout — НЕ помилка: postback міг просто затриматись довше опитування.
        setError(t.tasks.partnerAds.stillProcessing);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsWatching(false);
      setIsConfirming(false);
    }
  };

  return (
    <div className="glass-card p-3.5">
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neon-gold/10 text-neon-gold">
          <PlayCircle size={16} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white">{t.tasks.partnerAds.title}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{t.tasks.partnerAds.description}</p>

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-neon-green">
              {t.tasks.reward.ton(formatNumber(language, PARTNER_AD_REWARD_TON, { maximumFractionDigits: 3 }))}
            </span>
            <span className="text-[10px] font-medium text-slate-500">
              {t.tasks.partnerAds.progress(watchedToday, PARTNER_AD_DAILY_LIMIT)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2.5">
        <button
          type="button"
          onClick={watch}
          disabled={isWatching || limitReached}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-neon-gold py-2 text-[11px] font-semibold text-background transition active:scale-[0.98] disabled:opacity-50"
        >
          {isWatching && <Loader2 size={13} className="animate-spin" />}
          {limitReached
            ? t.tasks.partnerAds.limitReached
            : isConfirming
              ? t.tasks.partnerAds.confirming
              : isWatching
                ? t.tasks.partnerAds.loading
                : t.tasks.partnerAds.button}
        </button>
      </div>

      {error && <p className="mt-2 text-center text-[11px] text-red-400">{error}</p>}
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
  const emojiIcon = getEmojiIcon(task);
  const copy = getTaskCopy(t, task.title_key);
  const isLinkTask =
    task.action_type === "telegram_channel" ||
    task.action_type === "external_link" ||
    task.action_type === "partner_postback" ||
    task.action_type === "partner_api_check";

  return (
    <div className="glass-card p-3">
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neon-cyan/10 text-neon-cyan">
          {emojiIcon ? (
            <span className="text-base leading-none" aria-hidden="true">
              {emojiIcon}
            </span>
          ) : (
            <Icon size={16} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">{copy.title}</p>
          {copy.description && <p className="mt-0.5 text-[11px] text-slate-500">{copy.description}</p>}

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-neon-green">
              {t.tasks.reward[task.reward_type](
                // 3, не 2 — партнерські nagороди (0.003 TON) округлювались би
                // до "0" при двох знаках після коми (той самий баг, що вже
                // ловили в PartnerAdsCard). Trailing zeros Intl сам не додає
                // (minimumFractionDigits не задано), тож 0.05/4/20 і далі
                // виглядають чисто, без зайвих ".000".
                formatNumber(language, task.reward_amount, { maximumFractionDigits: 3 }),
              )}
            </span>

            {!isLinkTask &&
              task.status === "pending" &&
              task.progress_current !== undefined &&
              task.progress_target !== undefined && (
                <span className="text-[10px] font-medium text-slate-500">
                  {task.progress_current}/{task.progress_target}
                </span>
              )}
          </div>
        </div>
      </div>

      <div className="mt-2.5">
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

      {error && <p className="mt-2 text-center text-[11px] text-red-400">{error}</p>}
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
        className="flex w-full items-center justify-center rounded-2xl bg-white/5 py-2 text-[11px] font-semibold text-slate-500"
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
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-neon-gold py-2 text-[11px] font-semibold text-background transition active:scale-[0.98] disabled:opacity-50"
      >
        {busyAction === "claim" && <Loader2 size={13} className="animate-spin" />}
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
        className="flex w-full items-center justify-center rounded-2xl bg-white/[0.03] py-2 text-[11px] font-semibold text-slate-600"
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
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-neon-cyan py-2 text-[11px] font-semibold text-background transition active:scale-[0.98] disabled:opacity-50"
      >
        {t.tasks.action.start}
      </button>
    );
  }

  if (task.action_type === "partner_postback") {
    // Тут немає /api/tasks/verify — статус може виставити лише реальний
    // postback від партнера (POST /api/partners/postback). GET /api/tasks
    // сам підхопить 'completed' щойно він прийде — досить, щоб юзер
    // повернувся на цей екран пізніше (наступний фетч тут же покаже кнопку
    // "Забрати").
    return (
      <button
        type="button"
        disabled
        className="flex w-full items-center justify-center rounded-2xl bg-white/[0.03] py-2 text-[11px] font-semibold text-slate-600"
      >
        {t.tasks.action.awaitingPartner}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onVerify}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-neon-cyan/10 py-2 text-[11px] font-semibold text-neon-cyan transition active:scale-[0.98] disabled:opacity-50"
    >
      {busyAction === "verify" && <Loader2 size={13} className="animate-spin" />}
      {busyAction === "verify" ? t.tasks.action.verifying : t.tasks.action.verify}
    </button>
  );
}
