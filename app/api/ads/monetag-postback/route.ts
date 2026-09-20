import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { isTelegramAdmin } from "@/lib/admin/telegramAdmins";
import { DAILY_BONUS_REWARD_TON } from "@/lib/constants/economy";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type AdminClient = SupabaseClient<Database>;

/**
 * Три rewarded-ad flows застосунку мають РІЗНІ RPC для фактичного
 * нарахування — postback лише коректно диспетчеризує за purpose, самé
 * нарахування (кулдауни/ліміти/суми) лишається повністю в SQL-функціях.
 */
async function creditForPurpose(
  admin: AdminClient,
  purpose: string,
  userId: string,
  bypassLimit: boolean,
): Promise<{ error: PostgrestError | null }> {
  if (purpose === "daily_bonus_watch") {
    const { error } = await admin.rpc("claim_daily_bonus", {
      p_user_id: userId,
      p_reward_amount: DAILY_BONUS_REWARD_TON,
    });
    return { error };
  }
  if (purpose === "withdraw_ad_watch") {
    const { error } = await admin.rpc("record_ad_watch", { p_user_id: userId });
    return { error };
  }
  // partner_ad_watch (єдине інше значення, дозволене CHECK-обмеженням purpose)
  const { error } = await admin.rpc("record_partner_ad_watch", {
    p_user_id: userId,
    p_bypass_limit: bypassLimit,
  });
  return { error };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Monetag вважає подію оплаченою по-різному в різних місцях власної
// документації/дашборду (docs.monetag.com каже "valued"/"non_valued", їхня ж
// UI-підказка на скріні дашборду каже "yes"/"no") — приймаємо обидва
// написання (і "true"/"1" про всяк випадок), а не покладаємось на рівно ОДНЕ.
const PAID_REWARD_EVENT_VALUES = new Set(["valued", "yes", "true", "1"]);

// ymid — це id рядка ad_verification_attempts (uuid). Будь-що інше (порожній
// макрос, показ без ymid, чуже значення) в .eq("id", ...) дало б помилку типу
// uuid й 500, яку Monetag рахує невдалою доставкою й ретраїть без кінця.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeRewardEventType(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * S2S postback від сервера Monetag (docs.monetag.com/docs/postbacks) —
 * підтверджує, що конкретний rewarded-показ (ymid, виданий
 * /api/ads/monetag/start-attempt) реально відбувся й монетизувався.
 *
 * ЄДИНИЙ захист — статичний ?secret=, живе лише в дашборді Monetag ("Your
 * backend URL"), НІКОЛИ не потрапляє клієнту. Сам ymid НЕ можна вважати
 * секретом: він передається в window.show_11600101({ymid}) на клієнті, тож
 * технічно видимий у мережевому трафіку самого юзера — без ?secret= будь-хто
 * міг би скопіювати власний ymid і вдарити по цьому роуту напряму,
 * підробивши reward_event_type=valued, оминаючи перегляд реклами взагалі.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const expectedSecret = process.env.MONETAG_POSTBACK_SECRET;
    if (!expectedSecret) {
      throw new ApiError(500, "server misconfigured: MONETAG_POSTBACK_SECRET is not set");
    }
    if (url.searchParams.get("secret") !== expectedSecret) {
      throw new ApiError(401, "invalid secret");
    }

    // Порожній/чужий/не-uuid ymid — нема що зараховувати, але це НЕ помилка
    // доставки: відповідаємо чистим 200, щоб Monetag не вважав постбек невдалим.
    const ymid = url.searchParams.get("ymid")?.trim() ?? "";
    if (!UUID_RE.test(ymid)) {
      return NextResponse.json({ ok: true, status: "ignored" });
    }

    const rewardEventTypeRaw = (url.searchParams.get("reward_event_type") ?? "").trim();
    const rewardEventType = normalizeRewardEventType(rewardEventTypeRaw);
    const telegramIdRaw = url.searchParams.get("telegram_id");
    const telegramId = telegramIdRaw && Number.isFinite(Number(telegramIdRaw)) ? Number(telegramIdRaw) : null;

    const admin = createAdminClient();

    const { data: attempt, error: attemptError } = await admin
      .from("ad_verification_attempts")
      .select("*")
      .eq("id", ymid)
      .maybeSingle();

    // Тимчасовий збій БД — справжня помилка: 5xx, щоб Monetag повторив постбек.
    if (attemptError) throw new ApiError(500, `failed to load attempt: ${attemptError.message}`);
    // Невідомий ymid (напр. спроба з іншого середовища) — повторювати марно: 200.
    if (!attempt) return NextResponse.json({ ok: true, status: "ignored" });

    // Ідемпотентно: Monetag може повторити postback (мережеві ретраї) —
    // другий виклик з тим самим ymid НЕ повинен нараховувати вдруге.
    //
    // Виняток — спроба, відхилена лише тому, що ПЕРШИЙ postback був
    // non_valued (Monetag шле окремі події на показ і клік, і оплаченою може
    // бути пізніша). Якщо потім приходить valued — це той самий показ, і його
    // треба зарахувати, а не лишати назавжди rejected. Відмови через ліміт
    // (P0001) сюди не потрапляють: там reported_reward_event_type = valued.
    const previouslyReported = normalizeRewardEventType(attempt.reported_reward_event_type);
    const wasUnpaidRejection = attempt.status === "rejected" && !PAID_REWARD_EVENT_VALUES.has(previouslyReported);
    if (attempt.status !== "pending" && !wasUnpaidRejection) {
      return NextResponse.json({ ok: true, status: attempt.status });
    }

    const isPaid = PAID_REWARD_EVENT_VALUES.has(rewardEventType);

    if (!isPaid) {
      // Лише з pending: вже confirmed/rejected ніколи не перезаписуємо.
      await admin
        .from("ad_verification_attempts")
        .update({
          status: "rejected",
          reported_telegram_id: telegramId,
          reported_reward_event_type: rewardEventTypeRaw || null,
        })
        .eq("id", ymid)
        .eq("status", "pending");

      return NextResponse.json({ ok: true, status: "rejected" });
    }

    // Адмін дивиться без обмеження денним лімітом — звіряємо telegram_id
    // ВЛАСНОГО профілю (attempt.user_id), а не reported_telegram_id з
    // query-параметра постбеку: той самопідтверджений Monetag-ом рядок не
    // варто використовувати для авторизаційних рішень.
    const { data: attemptProfile, error: attemptProfileError } = await admin
      .from("profiles")
      .select("telegram_id")
      .eq("id", attempt.user_id)
      .maybeSingle();
    if (attemptProfileError) {
      throw new ApiError(500, `failed to load profile: ${attemptProfileError.message}`);
    }
    const bypassLimit = attemptProfile ? isTelegramAdmin(attemptProfile.telegram_id) : false;

    // purpose — один з трьох (partner_ad_watch/daily_bonus_watch/
    // withdraw_ad_watch), кожен зі своєю RPC (creditForPurpose вище).
    // Власні ліміти/кулдауни кожної RPC лишаються тими самими, що й для
    // клієнто-довірчого шляху (крім адміна — bypassLimit, стосується лише
    // partner_ad_watch).
    const { error: rpcError } = await creditForPurpose(admin, attempt.purpose, attempt.user_id, bypassLimit);

    if (rpcError) {
      // Денний ліміт (partner_ad_watch) чи кулдаун (daily_bonus_watch) —
      // не критична помилка нашого боку, просто не нараховуємо, але
      // ПОЗНАЧАЄМО rejected, щоб не намагатись знову.
      if (rpcError.code === "P0001") {
        // Лише з pending: якщо паралельний дублікат постбека вже встиг
        // зарахувати цей показ (confirmed), відмову другого не записуємо.
        await admin
          .from("ad_verification_attempts")
          .update({
            status: "rejected",
            reported_telegram_id: telegramId,
            reported_reward_event_type: rewardEventTypeRaw || null,
          })
          .eq("id", ymid)
          .eq("status", "pending");
        return NextResponse.json({ ok: true, status: "rejected", reason: rpcError.message });
      }
      throw rpcErrorToApiError(rpcError);
    }

    // confirmed перемагає будь-який інший статус (у т.ч. rejected, якого
    // паралельний дублікат міг встигнути записати раніше за нас), і сам
    // ніколи не перезаписується.
    await admin
      .from("ad_verification_attempts")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        reported_telegram_id: telegramId,
        reported_reward_event_type: rewardEventTypeRaw || null,
      })
      .eq("id", ymid)
      .neq("status", "confirmed");

    return NextResponse.json({ ok: true, status: "confirmed" });
  } catch (error) {
    return handleRouteError(error);
  }
}
