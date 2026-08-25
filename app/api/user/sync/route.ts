import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { findProfileByTelegramId } from "@/lib/api/profile";
import { isTelegramAdmin } from "@/lib/admin/telegramAdmins";
import { checkChannelMembershipStatus } from "@/lib/telegram/getChatMember";
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

    const [{ data: userGpus, error: gpusError }, { data: gpuTemplates, error: templatesError }] =
      await Promise.all([
        admin.from("user_gpus").select("*").eq("user_id", profile.id).order("gpu_level"),
        admin.from("gpu_templates").select("*").order("level"),
      ]);

    if (gpusError) throw new ApiError(500, `failed to load user_gpus: ${gpusError.message}`);
    if (templatesError) {
      throw new ApiError(500, `failed to load gpu_templates: ${templatesError.message}`);
    }

    const templateByLevel = new Map((gpuTemplates ?? []).map((t) => [t.level, t]));
    // Мертві (is_dead) картки не виробляють нічого, доки не оживлені —
    // не рахуємо їх у сумарну швидкість (той самий принцип, що й
    // harvest_user_hash: continue для is_dead рядків).
    const totalHashPerSecond = (userGpus ?? []).reduce((sum, gpu) => {
      if (gpu.is_dead) return sum;
      const template = templateByLevel.get(gpu.gpu_level);
      return sum + (template ? template.hash_per_second * gpu.amount : 0);
    }, 0);

    const response: SyncResponse = {
      profile,
      user_gpus: userGpus ?? [],
      gpu_templates: gpuTemplates ?? [],
      total_hash_per_second: totalHashPerSecond,
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
