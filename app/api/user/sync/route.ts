import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { findProfileByTelegramId } from "@/lib/api/profile";
import { isTelegramAdmin } from "@/lib/admin/telegramAdmins";
import { checkChannelMembershipStatus } from "@/lib/telegram/getChatMember";
import { calcTotalHashPerSecond } from "@/lib/farm/totalHashPerSecond";
import { loadGpuTemplates } from "@/lib/farm/gpuTemplates";
import { runOpportunisticDepositScan } from "@/lib/wallet/opportunisticDepositScan";
import type { PromoState } from "@/lib/promo/promo";
import type { SyncResponse } from "@/types/api";
import type { Database } from "@/types/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SyncRequestBody {
  initData?: string;
}

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// очікуваний формат start_param для реферального посилання: ref_<telegram_id>
const REFERRAL_PARAM_RE = /^ref_(\d+)$/;

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<SyncRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user, startParam } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();

    let profile = await findProfileByTelegramId(admin, user.id);

    if (!profile) {
      profile = await createProfileWithOptionalReferral(admin, user, startParam);
    } else {
      profile = await syncDisplayFields(admin, profile, user);
      profile = await enforceChannelUnsubscribePenalties(admin, profile, user.id);
    }

    const [{ data: userGpus, error: gpusError }, gpuTemplates] = await Promise.all([
      admin.from("user_gpus").select("*").eq("user_id", profile.id).order("gpu_level"),
      loadGpuTemplates(admin),
    ]);

    if (gpusError) throw new ApiError(500, `failed to load user_gpus: ${gpusError.message}`);

    // Спільна формула з /api/farm/buy (lib/farm/totalHashPerSecond.ts) —
    // обидва роути мусять давати однакове число для однакового стану БД.
    const totalHashPerSecond = calcTotalHashPerSecond(userGpus ?? [], gpuTemplates);

    // Все, що не потрібне для відповіді, виконується ПІСЛЯ неї (after) і не
    // затримує вхід у гру ні на мілісекунду. Це не косметика: коли шлюз
    // Supabase гикає, він віддає 504 не одразу, а через ~5 секунд — тож три
    // допоміжні виклики поспіль здатні були перетворити вхід у 15-секундне
    // очікування, після якого клієнт здавався за таймаутом. Тепер найгірше,
    // що може статися з телеметрією, — рядок у логах.
    after(async () => {
      // Дозвіл на повідомлення прийшов у ПІДПИСАНОМУ initData — отже боту
      // тепер можна писати. Знімаємо позначку недосяжності, щоб людина
      // повернулась у сповіщення. Без цього кроку WriteAccessPrompt був
      // косметичним: користувач тиснув "Дозволити", а бекенд про це не
      // дізнавався ніколи і тримав його виключеним назавжди.
      if (user.allows_write_to_pm) {
        const { error: clearError } = await admin.rpc("clear_bot_block", { p_user_id: profile.id });
        if (clearError) {
          console.error(`clear_bot_block failed for ${profile.id}: ${clearError.message}`);
        }
      }

      // Лог сесії: один рядок на відкриття застосунку (вікно 30 хв усередині
      // record_session) + last_seen_at.
      const { error: sessionError } = await admin.rpc("record_session", { p_user_id: profile.id });
      if (sessionError) {
        console.error(`record_session failed for ${profile.id}: ${sessionError.message}`);
      }

      // Скан свіжих депозитів. Замок claim_job пускає рівно один скан на
      // 2 хв на весь застосунок, тож сотні входів не перетворюються на сотні
      // запитів до toncenter. Закриває діру з аудиту 11.09: ручний переказ
      // без натискання "Перевірити оплату" раніше чекав на добовий крон.
      await runOpportunisticDepositScan(admin);
    });

    // Акція (якщо триває саме зараз за часом БД). Єдиний допоміжний виклик,
    // що лишився в критичному шляху, бо його результат їде у відповіді —
    // тому з жорстким запобіжником: 1.5 с, і йдемо далі без акції. Помилку
    // ковтаємо: банер знижки — косметика поверх маркету, вона не має права
    // зламати весь sync і залишити гравця без даних.
    const { data: promoRows } = await admin
      .rpc("active_promo")
      .abortSignal(AbortSignal.timeout(1500));
    const promo: PromoState | null = promoRows && promoRows.length > 0 ? promoRows[0] : null;

    const response: SyncResponse = {
      profile,
      user_gpus: userGpus ?? [],
      gpu_templates: gpuTemplates,
      total_hash_per_second: totalHashPerSecond,
      promo,
      // Лише TRUE/FALSE для ЦЬОГО конкретного telegram_id — сам список
      // TELEGRAM_ADMIN_IDS лишається серверним секретом і ніколи не йде в
      // клієнтський бандл чи цю відповідь. Header ховає посилання на /admin
      // для всіх, крім is_admin: true — справжній захист лишається на
      // requireAdminAuth() (lib/admin/auth.ts), це поле лише про UX/приховування.
      is_admin: isTelegramAdmin(user.id),
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}

async function createProfileWithOptionalReferral(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: number; username?: string; first_name: string; language_code?: string },
  startParam: string | null,
): Promise<Profile> {
  let referrerProfileId: string | null = null;

  const refMatch = startParam?.match(REFERRAL_PARAM_RE);
  if (refMatch) {
    const referrerTelegramId = Number(refMatch[1]);
    if (referrerTelegramId !== user.id) {
      const referrer = await findProfileByTelegramId(admin, referrerTelegramId);
      if (referrer) referrerProfileId = referrer.id;
    }
  }

  const { data: inserted, error: insertError } = await admin
    .from("profiles")
    .insert({
      telegram_id: user.id,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      // Сирий Telegram language_code ("en-US", "uk" тощо) — нормалізація
      // (мовна частина до дефіса, фолбек на DEFAULT_LANGUAGE) відбувається
      // при фактичній відправці сповіщення (lib/i18n/resolveLanguage.ts),
      // не тут — тримаємо оригінал на випадок майбутнього використання.
      telegram_language_code: user.language_code ?? null,
      referrer_id: referrerProfileId,
    })
    .select("*")
    .single();

  if (insertError) {
    // 23505 = unique_violation: інший паралельний запит уже створив цей профіль
    // (переможець гонки вже обробив referral) — просто читаємо, що вийшло.
    if (insertError.code === "23505") {
      const existing = await findProfileByTelegramId(admin, user.id);
      if (existing) return existing;
    }
    throw new ApiError(500, `failed to create profile: ${insertError.message}`);
  }

  if (referrerProfileId) {
    const { error: referralError } = await admin.from("referrals").insert({
      referrer_id: referrerProfileId,
      referee_id: inserted.id,
    });

    // некритична помилка — не валимо реєстрацію користувача через збій запису реферала
    if (referralError) {
      console.error("[api/user/sync] failed to record referral:", referralError);
    }
  }

  return inserted;
}

async function syncDisplayFields(
  admin: ReturnType<typeof createAdminClient>,
  profile: Profile,
  user: { username?: string; first_name: string; language_code?: string },
): Promise<Profile> {
  const nextUsername = user.username ?? null;
  const nextFirstName = user.first_name ?? null;
  const nextLanguageCode = user.language_code ?? null;

  if (
    profile.username === nextUsername &&
    profile.first_name === nextFirstName &&
    profile.telegram_language_code === nextLanguageCode
  ) {
    return profile;
  }

  const { data: updated, error: updateError } = await admin
    .from("profiles")
    .update({ username: nextUsername, first_name: nextFirstName, telegram_language_code: nextLanguageCode })
    .eq("id", profile.id)
    .select("*")
    .single();

  // некритична помилка синхронізації відображуваних полів — повертаємо старий профіль
  if (updateError || !updated) {
    console.error("[api/user/sync] failed to sync display fields:", updateError);
    return profile;
  }

  return updated;
}

/**
 * Штраф за відписку від Telegram-каналу/чату протягом 24 годин після
 * клейму нагороди за підписку (2× нагороди — apply_channel_unsubscribe_penalty,
 * 20260825090000_telegram_channel_unsubscribe_penalty.sql). Немає окремого
 * cron під це (ліміт 2 крон-джоби на Vercel Hobby вже вичерпано —
 * vercel.json), тож перевірка йде тут, на КОЖНОМУ /api/user/sync — тобто
 * практично при кожному відкритті застосунку, частіше й надійніше за
 * гіпотетичний щоденний крон.
 *
 * checkChannelMembershipStatus (а не isChannelMember) — навмисно: "не
 * вдалось перевірити" (мережевий збій/неоднозначна відповідь Telegram) НЕ
 * повинно каратись як "відписався", лише явний "not_member".
 */
async function enforceChannelUnsubscribePenalties(
  admin: ReturnType<typeof createAdminClient>,
  profile: Profile,
  telegramUserId: number,
): Promise<Profile> {
  const { data: candidates, error: candidatesError } = await admin
    .from("user_tasks")
    .select("task_id, task_templates!inner(target_value, action_type)")
    .eq("user_id", profile.id)
    .eq("status", "claimed")
    .eq("channel_penalty_applied", false)
    .eq("task_templates.action_type", "telegram_channel")
    .gte("claimed_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (candidatesError) {
    console.error("[api/user/sync] failed to load channel-penalty candidates:", candidatesError);
    return profile;
  }
  if (!candidates || candidates.length === 0) return profile;

  let current = profile;

  for (const candidate of candidates) {
    const chatId = (candidate as unknown as { task_templates: { target_value: string } }).task_templates
      .target_value;
    const membership = await checkChannelMembershipStatus(chatId, telegramUserId);
    if (membership !== "not_member") continue; // "member" — усе гаразд; "unknown" — не караємо за сумнів

    const { data: penaltyResult, error: penaltyError } = await admin
      .rpc("apply_channel_unsubscribe_penalty", { p_user_id: profile.id, p_task_id: candidate.task_id })
      .single();

    if (penaltyError) {
      // P0001 (уже застосовано/минуло 24г — гонка з паралельним sync) — не помилка, просто пропускаємо.
      if (penaltyError.code !== "P0001") {
        console.error("[api/user/sync] failed to apply channel-unsubscribe penalty:", penaltyError);
      }
      continue;
    }

    if (penaltyResult) {
      current = { ...current, game_balance: penaltyResult.game_balance };
    }
  }

  return current;
}
