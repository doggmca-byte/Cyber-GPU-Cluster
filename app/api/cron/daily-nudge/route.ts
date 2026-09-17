import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { sendTelegramMessage, TelegramDeliveryBlockedError } from "@/lib/telegram/sendTelegramMessage";
import { resolveLanguage } from "@/lib/i18n/resolveLanguage";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { MAX_UNCLAIMED_HOURS } from "@/lib/constants/economy";
import type { Database } from "@/types/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Хто вважається "активним": заходив за останні два тижні. Далі цього
 * горизонту людину вже не повертає жодне повідомлення — вона або пішла, або
 * взагалі ніколи не тиснула Start і не отримає його технічно.
 */
const ACTIVE_WINDOW_DAYS = 14;

/**
 * Кого НЕ чіпаємо: хто був у застосунку протягом останньої доби. Нагадувати
 * про бонус тому, хто щойно грав, — це не турбота, а шум.
 */
const QUIET_HOURS = 20;

/** Telegram тримає ~30 повідомлень/с на бота; 20 — із запасом. */
const RATE_PER_SECOND = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Admin = SupabaseClient<Database>;

/**
 * PostgREST віддає максимум 1000 рядків за запит — user_tasks їх уже вчетверо
 * більше. Без посторінкового читання половина гравців мовчки виглядала б як
 * така, що не виконала жодного завдання.
 */
async function selectAll<T>(
  admin: Admin,
  table: "profiles" | "user_gpus" | "user_tasks" | "task_templates",
  columns: string,
  apply?: (q: ReturnType<ReturnType<Admin["from"]>["select"]>) => unknown,
): Promise<T[]> {
  const rows: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = admin.from(table).select(columns).range(from, from + PAGE - 1);
    if (apply) query = apply(query) as typeof query;
    const { data, error } = await query;
    if (error) throw new ApiError(500, `failed to load ${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

interface Candidate {
  profile_id: string;
  telegram_id: number;
  language_code: string | null;
  reason: "daily_bonus" | "tasks";
  tasks_count: number;
  tasks_reward: number;
}

/**
 * Щоденне нагадування — але тільки тому, у кого є РЕАЛЬНИЙ привід, і не
 * частіше ніж раз на добу на людину.
 *
 * Це навмисно не "розсилка всім активним": досяжних гравців у нас близько
 * п'ятисот, і щоденне загальне оголошення — найшвидший спосіб перетворити їх
 * на заблокованих. Тому привід завжди про власну ферму адресата, а якщо
 * приводу немає — повідомлення не йде взагалі.
 *
 * Тих, у кого зупинилось виробництво, цей крон пропускає: їм пише
 * /api/cron/production-notify, і два повідомлення за день від одного бота —
 * це вже спам.
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) throw new ApiError(500, "server misconfigured: CRON_SECRET is not set");

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) throw new ApiError(401, "unauthorized");

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) throw new ApiError(500, "server misconfigured: NEXT_PUBLIC_APP_URL is not set");

    const admin = createAdminClient();

    // Сухий прогін: показує, кому й що пішло б, але нічого не надсилає і не
    // займає замок. Потрібен не для тестів, а щоб у будь-який момент можна
    // було подивитись, чи не роздувається аудиторія нагадувань.
    const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";

    // Замок заразом і захист від повторної відправки: навіть якщо крон
    // спрацює двічі (ретрай платформи, ручний виклик), другий прогін за добу
    // не візьме роботу і нікому нічого не надішле.
    if (!dryRun) {
      const { data: won, error: claimError } = await admin.rpc("claim_job", {
        p_name: "daily_nudge",
        p_min_interval_seconds: QUIET_HOURS * 3600,
      });
      if (claimError) throw new ApiError(500, `claim_job failed: ${claimError.message}`);
      if (!won) return NextResponse.json({ skipped: "already ran within the last 20 hours" });
    }

    const now = Date.now();
    const activeSince = new Date(now - ACTIVE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
    const quietBefore = new Date(now - QUIET_HOURS * 3600 * 1000).toISOString();

    const profiles = await selectAll<{
      id: string;
      telegram_id: number;
      telegram_language_code: string | null;
      last_daily_bonus_at: string | null;
    }>(admin, "profiles", "id,telegram_id,telegram_language_code,last_daily_bonus_at", (q) =>
      (q as ReturnType<ReturnType<Admin["from"]>["select"]>)
        .eq("is_bot_blocked", false)
        .gte("last_seen_at", activeSince)
        .lte("last_seen_at", quietBefore),
    );

    if (profiles.length === 0) {
      return NextResponse.json({ candidates: 0, sent: 0, server_time: new Date().toISOString() });
    }

    const eligible = new Set(profiles.map((p) => p.id));

    // Виробництво зупинене -> цією людиною займається production-notify.
    const gpus = await selectAll<{ user_id: string; amount: number; is_dead: boolean; last_harvest_at: string }>(
      admin,
      "user_gpus",
      "user_id,amount,is_dead,last_harvest_at",
    );
    const lastHarvest = new Map<string, number>();
    for (const g of gpus) {
      if (!eligible.has(g.user_id) || g.amount <= 0 || g.is_dead) continue;
      const at = Date.parse(g.last_harvest_at);
      if (!lastHarvest.has(g.user_id) || at > (lastHarvest.get(g.user_id) as number)) {
        lastHarvest.set(g.user_id, at);
      }
    }
    const pausedCutoff = now - MAX_UNCLAIMED_HOURS * 3600 * 1000;

    // Скільки завдань людина ще не забрала і на яку суму.
    const templates = await selectAll<{ id: string; reward_amount: number; is_active: boolean }>(
      admin,
      "task_templates",
      "id,reward_amount,is_active",
    );
    const activeTemplates = templates.filter((t) => t.is_active);
    const userTasks = await selectAll<{ user_id: string; task_id: string; status: string }>(
      admin,
      "user_tasks",
      "user_id,task_id,status",
    );
    const claimed = new Map<string, Set<string>>();
    for (const ut of userTasks) {
      if (!eligible.has(ut.user_id) || ut.status !== "claimed") continue;
      if (!claimed.has(ut.user_id)) claimed.set(ut.user_id, new Set());
      (claimed.get(ut.user_id) as Set<string>).add(ut.task_id);
    }

    const candidates: Candidate[] = [];
    for (const p of profiles) {
      const harvestedAt = lastHarvest.get(p.id);
      if (harvestedAt !== undefined && harvestedAt <= pausedCutoff) continue;

      const bonusReady =
        !p.last_daily_bonus_at || Date.parse(p.last_daily_bonus_at) <= now - 24 * 3600 * 1000;

      const done = claimed.get(p.id);
      const open = activeTemplates.filter((t) => !done?.has(t.id));
      const openReward = open.reduce((s, t) => s + Number(t.reward_amount), 0);

      // Бонус має пріоритет: він обнуляється щодня, а завдання чекатимуть.
      if (bonusReady) {
        candidates.push({
          profile_id: p.id,
          telegram_id: p.telegram_id,
          language_code: p.telegram_language_code,
          reason: "daily_bonus",
          tasks_count: open.length,
          tasks_reward: openReward,
        });
      } else if (open.length > 0) {
        candidates.push({
          profile_id: p.id,
          telegram_id: p.telegram_id,
          language_code: p.telegram_language_code,
          reason: "tasks",
          tasks_count: open.length,
          tasks_reward: openReward,
        });
      }
    }

    if (dryRun) {
      const preview: Record<string, number> = { daily_bonus: 0, tasks: 0 };
      const byLang: Record<string, number> = {};
      for (const c of candidates) {
        preview[c.reason] += 1;
        const lang = resolveLanguage(c.language_code);
        byLang[lang] = (byLang[lang] ?? 0) + 1;
      }
      const sample = candidates[0];
      return NextResponse.json({
        dry_run: true,
        active_profiles: profiles.length,
        candidates: candidates.length,
        by_reason: preview,
        by_language: byLang,
        sample: sample
          ? {
              reason: sample.reason,
              language: resolveLanguage(sample.language_code),
              text:
                sample.reason === "daily_bonus"
                  ? dictionaries[resolveLanguage(sample.language_code)].notifications.dailyBonusReady
                  : dictionaries[resolveLanguage(sample.language_code)].notifications.tasksWaiting(
                      sample.tasks_count,
                      formatNumber(resolveLanguage(sample.language_code), sample.tasks_reward, {
                        maximumFractionDigits: 2,
                      }),
                    ),
            }
          : null,
        server_time: new Date().toISOString(),
      });
    }

    let sent = 0;
    let blocked = 0;
    let failed = 0;
    const byReason: Record<string, number> = { daily_bonus: 0, tasks: 0 };

    for (const c of candidates) {
      const lang = resolveLanguage(c.language_code);
      const t = dictionaries[lang];
      const text =
        c.reason === "daily_bonus"
          ? t.notifications.dailyBonusReady
          : t.notifications.tasksWaiting(
              c.tasks_count,
              formatNumber(lang, c.tasks_reward, { maximumFractionDigits: 2 }),
            );

      try {
        await sendTelegramMessage(c.telegram_id, text, {
          webAppButton: { text: t.notifications.openAppButton, url: appUrl },
        });
        sent += 1;
        byReason[c.reason] += 1;
      } catch (err) {
        if (err instanceof TelegramDeliveryBlockedError) {
          const reason = err.message.toLowerCase().includes("chat not found") ? "no_chat" : "blocked";
          const { error: flagError } = await admin.rpc("flag_bot_unreachable", {
            p_user_id: c.profile_id,
            p_reason: reason,
          });
          if (flagError) console.error(`[cron/daily-nudge] failed to flag ${c.profile_id}:`, flagError);
          blocked += 1;
        } else {
          failed += 1;
          console.error(`[cron/daily-nudge] failed to notify ${c.telegram_id}:`, err);
        }
      }

      await sleep(Math.ceil(1000 / RATE_PER_SECOND));
    }

    console.log(
      `[cron/daily-nudge] candidates=${candidates.length} sent=${sent} blocked=${blocked} failed=${failed}`,
    );

    return NextResponse.json({
      active_profiles: profiles.length,
      candidates: candidates.length,
      sent,
      by_reason: byReason,
      blocked,
      failed,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
