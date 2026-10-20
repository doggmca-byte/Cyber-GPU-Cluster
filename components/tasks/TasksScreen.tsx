"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { showGigaRewardedAd } from "@/lib/ads/gigapub";
import { showAdsgramRewardedAdDetailed } from "@/lib/ads/adsgram";
import { isAdsgramCapped, noteAdsgramShown } from "@/lib/ads/adsgramDailyCap";
import { markPartnerAdNoFill, nextPartnerAdSlot } from "@/lib/ads/partnerAdRotation";
import type { VerifiedPollResult } from "@/lib/ads/verifiedAdWatch";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import { SupportButton } from "@/components/layout/SupportButton";
import { SpecialTasks } from "@/components/SpecialTasks";
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
import { postJsonWithRetry } from "@/lib/api/postJsonWithRetry";
import { SPONSOR_TASK_COOLDOWN_SECONDS } from "@/lib/constants/economy";

// Дзеркалить константи в record_partner_ad_watch
// (supabase/migrations/20261020120000_partner_ads_limit_20_and_task_rewards.sql) —
// лише для відображення (сервер — єдине джерело правди для фактичного
// нарахування й ліміту, тут це тільки початкове значення до першого
// перегляду за сесію).
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
// у такому разі показуємо слаг у читабельному вигляді (без підкреслень, кожне
// слово з великої літери) замість краху рендера.
function humanizeSlug(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getTaskCopy(t: TranslationDictionary, key: string): { title: string; description: string } {
  const entry = (t.tasks.items as Record<string, { title: string; description: string } | undefined>)[key];
  return entry ?? { title: humanizeSlug(key), description: "" };
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
      <h1 className="min-w-0 truncate text-sm font-semibold text-white">{t.tasks.title}</h1>
      <div className="flex shrink-0 items-center gap-1.5">
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
      const data = await postJsonWithRetry<TasksResponse>("/api/tasks", { initData });
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
        {activeCategory === "partners" && (
          <>
            <PartnerAdsCard initData={initData} />
            <SponsorSlot initData={initData} />
          </>
        )}
        {activeCategory === "special" && <SpecialTasks initData={initData} />}

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

// Rewarded-реклама від GigaPub/Monetag/AdsGram (ротація — lib/ads/rewardedAd.ts,
// той самий SDK-шар, що й WatchAdButton/DailyBonusModal) з прямим
// TON-нарахуванням на withdrawable_balance. На відміну від TaskRow це НЕ
// task_templates-рядок — повторювана дія з денним лічильником
// (record_partner_ad_watch), тож живе окремою карткою над списком завдань
// вкладки "Партнери", а не в task_templates/user_tasks (там термінальний
// claimed один раз назавжди).
const PARTNER_AD_POLL_ATTEMPTS = 14;
const PARTNER_AD_POLL_DELAY_MS = 2000;

// AdsGram і TADS, на відміну від Monetag, не видають нам токен спроби
// наперед — їхні S2S-постбеки (app/api/ads/adsgram-postback,
// app/api/ads/tads-postback) кореляють виключно по telegramId, без
// ідентифікатора конкретного показу/кліку. Тож підтвердження тут — це не
// пошук статусу конкретної спроби, а порівняння лічильника
// partner_ads_watched_today "до" й "після": як тільки бекенд реально
// нарахував через постбек (від будь-кого з двох), лічильник зростає. Той
// самий принцип, що й у поллінгу Monetag (lib/ads/verifiedAdWatch.ts) —
// просто інший спосіб виявити подію без токена. Працює ЛИШЕ для
// partner_ad_watch — обидва постбеки жорстко прив'язані саме до цієї purpose
// (не можуть передати нам, яку саме дію показ мав підтвердити), тож для
// daily_bonus_watch/withdraw_ad_watch AdsGram/TADS-показ лишається на
// клієнтській довірі (як і GigaPub).
async function pollPartnerAdWatchConfirmation(
  initData: string,
  baselineWatchedToday: number,
): Promise<VerifiedPollResult> {
  for (let attempt = 0; attempt < PARTNER_AD_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, PARTNER_AD_POLL_DELAY_MS));

    try {
      const res = await fetch("/api/user/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      if (!res.ok) continue;

      const data = (await res.json()) as SyncResponse;
      if (data.profile.partner_ads_watched_today > baselineWatchedToday) {
        return { kind: "confirmed", profile: data.profile };
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
  const [hint, setHint] = useState<string | null>(null);

  if (state.status !== "ready") return null;
  const { profile, is_admin: isAdmin } = state.data;

  const today = new Date().toISOString().slice(0, 10);
  const watchedToday =
    profile.partner_ads_reset_date === today ? profile.partner_ads_watched_today : 0;
  // Адмін дивиться без ліміту (бекенд теж не блокує — p_bypass_limit у
  // record_partner_ad_watch) — лічильник тут лише для відображення "X/20",
  // саму кнопку для адміна ніколи не вимикаємо.
  const limitReached = !isAdmin && watchedToday >= PARTNER_AD_DAILY_LIMIT;

  // Клієнто-довірчий шлях (GigaPub, і фолбек для Monetag, якщо не вдалось
  // завести токен верифікації) — просто інкрементує лічильник на бекенді
  // без S2S-підтвердження.
  const creditClientTrust = async () => {
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
  };

  const applyVerifiedOutcome = (outcome: VerifiedPollResult) => {
    if (outcome.kind === "confirmed") {
      patchProfile({
        partner_ads_watched_today: outcome.profile.partner_ads_watched_today,
        partner_ads_reset_date: outcome.profile.partner_ads_reset_date,
        withdrawable_balance: outcome.profile.withdrawable_balance,
      });
    } else if (outcome.kind === "rejected") {
      setError(t.tasks.partnerAds.notCounted);
    } else {
      // timeout — НЕ помилка: postback міг просто затриматись довше опитування.
      setError(t.tasks.partnerAds.stillProcessing);
    }
  };

  const watch = async () => {
    if (isWatching || limitReached) return;

    // Строга ротація 1.GigaPub 2.Monetag 3.AdsGram 4.TADS (lib/ads/partnerAdRotation.ts)
    // — рівно ОДИН майданчик на клік, без фолбеку на іншого в межах цього ж
    // кліку (навмисно, за проханням користувача: показ усіх підряд в одному
    // кліку "напрягатиме людей").
    const slot = nextPartnerAdSlot();

    setIsWatching(true);
    setIsConfirming(false);
    setError(null);
    setHint(null);

    try {
      if (slot === "gigapub") {
        // GigaPub не має S2S postback — лишається на клієнтській довірі.
        const adWatched = await showGigaRewardedAd();
        if (!adWatched) {
          setError(t.tasks.partnerAds.adNotCompleted);
          return;
        }
        await creditClientTrust();
        return;
      }

      // slot === "adsgram": немає токена спроби наперед — підтвердження через
      // порівняння лічильника partner_ads_watched_today "до" й "після" показу.
      // Береться з урахуванням дати скидання: у профілі може лишатись
      // вчорашнє значення, а сервер уже скинув лічильник, і тоді
      // "після" (1) ніколи не перевищило б "до" (напр. 20).
      const baselineWatchedToday = watchedToday;
      const adsgramOutcome = await showAdsgramRewardedAdDetailed();
      if (adsgramOutcome !== "shown") {
        // "Реклами немає" — наступні кліки на 15 хвилин підуть в інші мережі,
        // а не знову в порожній AdsGram з тим самим вікном.
        if (adsgramOutcome === "no_fill") markPartnerAdNoFill("adsgram");
        setError(t.tasks.partnerAds.adNotCompleted);
        return;
      }

      setIsConfirming(true);
      const outcome = await pollPartnerAdWatchConfirmation(initData, baselineWatchedToday);
      applyVerifiedOutcome(outcome);
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
      {!error && hint && <p className="mt-2 text-center text-[11px] text-neon-gold">{hint}</p>}
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

// Блок AdsGram типу Task (кабінет AdsGram -> Block type: Task). Id з кабінету
// виду "task-1234" або просто "1234" — префікс додаємо самі.
const ADSGRAM_TASK_REVEAL_MS = 2500;
const SPONSOR_REWARD_TON = 0.001;

const ADSGRAM_TASK_BLOCK_ID = (() => {
  const raw = process.env.NEXT_PUBLIC_ADSGRAM_TASK_BLOCK_ID?.trim();
  if (!raw) return null;
  return raw.startsWith("task-") ? raw : `task-${raw}`;
})();

type SponsorPollResult = { kind: "confirmed"; profile: SyncResponse["profile"] } | { kind: "timeout" };

/**
 * Спонсорські нагороди (record_sponsor_task_reward) НЕ чіпають лічильник
 * партнерської реклами, тож підтвердження чекаємо за зростанням
 * withdrawable_balance, а не partner_ads_watched_today.
 */
async function pollSponsorReward(initData: string, baselineBalance: number): Promise<SponsorPollResult> {
  for (let attempt = 0; attempt < PARTNER_AD_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, PARTNER_AD_POLL_DELAY_MS));
    try {
      const res = await fetch("/api/user/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as SyncResponse;
      if (Number(data.profile.withdrawable_balance) > baselineBalance) return { kind: "confirmed", profile: data.profile };
    } catch {
      // мережевий збій — пробуємо ще раз наступного тику.
    }
  }
  return { kind: "timeout" };
}

type SponsorReward = ReturnType<typeof useSponsorRewardConfirm>;

/**
 * Спонсорський слот у вкладці "Партнери" використовує лише AdsGram Task.
 * Якщо AdsGram не має доступного завдання, картка показує заглушку.
 */
function SponsorSlot({ initData }: { initData: string }) {
  const { t } = useTranslation();
  const cooldown = useSponsorCooldown();
  const sponsor = useSponsorRewardConfirm(initData, cooldown.start);
  const [adsgramAvailable, setAdsgramAvailable] = useState(Boolean(ADSGRAM_TASK_BLOCK_ID));

  if (!sponsor.ready) return null;

  return (
    <div className="glass-card p-3.5">
      <SponsorCardHeader />
      {cooldown.remainingSeconds > 0 ? (
        <SponsorPlaceholder label={t.tasks.tadsAd.cooldown(formatCountdown(cooldown.remainingSeconds))} />
      ) : adsgramAvailable && !isAdsgramCapped() ? (
        <AdsgramTaskBody sponsor={sponsor} onUnavailable={() => setAdsgramAvailable(false)} />
      ) : (
        <SponsorPlaceholder label={t.tasks.tadsAd.noAdsAvailable} />
      )}
      <SponsorStatus confirming={sponsor.confirming} error={sponsor.error} />
    </div>
  );
}

const SPONSOR_COOLDOWN_STORAGE_KEY = "cgc_sponsor_task_cooldown_until";

function formatCountdown(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/**
 * Кулдаун між завданнями AdsGram (SPONSOR_TASK_COOLDOWN_SECONDS) — дзеркало
 * серверного (app/api/ads/adsgram-postback): поки він іде, завдання не
 * показуємо, бо постбек у цей час однаково не нарахує. Кінець кулдауну — у
 * localStorage, щоб не скидався повторним відкриттям вкладки.
 */
function useSponsorCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(SPONSOR_COOLDOWN_STORAGE_KEY));
      if (Number.isFinite(stored) && stored > Date.now()) setUntil(stored);
    } catch {
      // сховище недоступне — кулдаун лише в пам'яті, сервер однаково його тримає.
    }
  }, []);

  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);

  const start = useCallback(() => {
    const next = Date.now() + SPONSOR_TASK_COOLDOWN_SECONDS * 1000;
    try {
      localStorage.setItem(SPONSOR_COOLDOWN_STORAGE_KEY, String(next));
    } catch {
      // див. вище.
    }
    setNow(Date.now());
    setUntil(next);
  }, []);

  return { remainingSeconds: Math.max(0, Math.ceil((until - now) / 1000)), start };
}

/** Спільне підтвердження нагороди для обох спонсорських провайдерів. */
function useSponsorRewardConfirm(initData: string, onConfirmed: () => void) {
  const { t } = useTranslation();
  const { state, patchProfile } = useUserData();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balance = state.status === "ready" ? Number(state.data.profile.withdrawable_balance) : 0;
  const balanceRef = useRef(balance);
  balanceRef.current = balance;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const confirm = useCallback(() => {
    if (!mountedRef.current) return;
    setError(null);
    setConfirming(true);
    void pollSponsorReward(initData, balanceRef.current).then((outcome) => {
      if (!mountedRef.current) return;
      if (outcome.kind === "confirmed") {
        patchProfile({ withdrawable_balance: outcome.profile.withdrawable_balance });
        onConfirmed();
      } else {
        setError(t.tasks.partnerAds.stillProcessing);
      }
      setConfirming(false);
    });
  }, [initData, patchProfile, t, onConfirmed]);

  return { ready: state.status === "ready", confirming, error, confirm, mountedRef };
}

function SponsorCardHeader() {
  const { t, language } = useTranslation();
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neon-purple/10 text-neon-purple">
        <Handshake size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-white">{t.tasks.tadsAd.title}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{t.tasks.tadsAd.description}</p>
        <p className="mt-1.5 text-[11px] font-semibold text-neon-green">
          {t.tasks.reward.ton(formatNumber(language, SPONSOR_REWARD_TON, { maximumFractionDigits: 3 }))}
        </p>
      </div>
    </div>
  );
}

/** Некликабельний рядок замість реклами: "завантаження" або "реклами немає". */
function SponsorPlaceholder({ label, loading = false }: { label: string; loading?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      aria-disabled="true"
      className="mt-2.5 flex cursor-not-allowed select-none items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2"
    >
      <p className="flex min-w-0 items-center gap-2 text-[11px] text-slate-500">
        {loading && <Loader2 size={13} className="shrink-0 animate-spin" />}
        {label}
      </p>
      <span className="shrink-0 rounded-xl bg-white/5 px-3 py-1.5 text-[11px] font-bold text-slate-600">
        {t.tasks.action.start}
      </span>
    </div>
  );
}

function SponsorStatus({ confirming, error }: { confirming: boolean; error: string | null }) {
  const { t } = useTranslation();
  return (
    <>
      {confirming && (
        <p className="mt-2 flex items-center gap-2 text-[11px] text-neon-gold">
          <Loader2 size={13} className="animate-spin" />
          {t.tasks.partnerAds.confirming}
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </>
  );
}

/**
 * Завдання AdsGram (<adsgram-task>). Коли гравець його виконав, AdsGram смикає
 * Reward URL -> /api/ads/adsgram-postback?type=task (creditSponsorReward, без
 * денного ліміту). Подія "reward" на клієнті — лише сигнал почати опитування.
 * Поки SDK вантажить завдання, його сірий скелет не клікається — тож перші
 * ADSGRAM_TASK_REVEAL_MS поверх нього заглушка "Завантаження", а сам елемент
 * прозорий (але в DOM і не display:none, щоб SDK бачив його як показаний).
 */
function AdsgramTaskBody({ sponsor, onUnavailable }: { sponsor: SponsorReward; onUnavailable: () => void }) {
  const { t, language } = useTranslation();
  const { confirm, mountedRef } = sponsor;
  const [loaded, setLoaded] = useState(false);
  const taskRef = useRef<HTMLElement | null>(null);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    const el = taskRef.current;
    if (!el) return;

    const revealTimer = setTimeout(() => {
      if (mountedRef.current) setLoaded(true);
    }, ADSGRAM_TASK_REVEAL_MS);
    const onNotFound = () => {
      if (mountedRef.current) onUnavailableRef.current();
    };

    const onReward = () => {
      noteAdsgramShown();
      confirm();
    };

    el.addEventListener("reward", onReward);
    el.addEventListener("onBannerNotFound", onNotFound);
    el.addEventListener("onError", onNotFound);
    el.addEventListener("onTooLongSession", onNotFound);
    return () => {
      clearTimeout(revealTimer);
      el.removeEventListener("reward", onReward);
      el.removeEventListener("onBannerNotFound", onNotFound);
      el.removeEventListener("onError", onNotFound);
      el.removeEventListener("onTooLongSession", onNotFound);
    };
  }, [confirm, mountedRef]);

  if (!ADSGRAM_TASK_BLOCK_ID) return null;

  const reward = t.tasks.reward.ton(formatNumber(language, SPONSOR_REWARD_TON, { maximumFractionDigits: 3 }));

  return (
    <div className="relative">
      {!loaded && <SponsorPlaceholder label={t.common.loading} loading />}
      <adsgram-task
        ref={taskRef}
        data-block-id={ADSGRAM_TASK_BLOCK_ID}
        className={loaded ? "mt-2.5 block" : "pointer-events-none absolute inset-x-0 top-0 mt-2.5 block opacity-0"}
      >
        <span slot="reward" className="text-[11px] font-semibold text-neon-green">{reward}</span>
        <div slot="button" className="rounded-xl bg-neon-purple px-3 py-1.5 text-center text-[11px] font-bold text-background">
          {t.tasks.action.start}
        </div>
        <div slot="claim" className="rounded-xl bg-neon-green px-3 py-1.5 text-center text-[11px] font-bold text-background">
          {t.tasks.action.claim}
        </div>
        <div slot="done" className="rounded-xl bg-white/5 px-3 py-1.5 text-center text-[11px] font-semibold text-slate-400">
          {t.tasks.action.claimed}
        </div>
      </adsgram-task>
    </div>
  );
}
