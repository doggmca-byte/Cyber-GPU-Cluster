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

    const ymid = url.searchParams.get("ymid");
    if (!ymid) throw new ApiError(400, "ymid is required");

    const rewardEventTypeRaw = url.searchParams.get("reward_event_type") ?? "";
    const telegramIdRaw = url.searchParams.get("telegram_id");
    const telegramId = telegramIdRaw ? Number(telegramIdRaw) : null;

    const admin = createAdminClient();

    const { data: attempt, error: attemptError } = await admin
      .from("ad_verification_attempts")
      .select("*")
      .eq("id", ymid)
      .maybeSingle();

    if (attemptError) throw new ApiError(500, `failed to load attempt: ${attemptError.message}`);
    if (!attempt) throw new ApiError(404, "unknown ymid");

    // Ідемпотентно: Monetag може повторити postback (мережеві ретраї) —
    // другий виклик з тим самим ymid НЕ повинен нараховувати вдруге.
    if (attempt.status !== "pending") {
      return NextResponse.json({ ok: true, status: attempt.status });
    }

    const isPaid = PAID_REWARD_EVENT_VALUES.has(rewardEventTypeRaw.toLowerCase());

    if (!isPaid) {
      await admin
        .from("ad_verification_attempts")
        .update({
          status: "rejected",
          reported_telegram_id: telegramId,
          reported_reward_event_type: rewardEventTypeRaw || null,
        })
        .eq("id", ymid);

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
        await admin
          .from("ad_verification_attempts")
          .update({
            status: "rejected",
            reported_telegram_id: telegramId,
            reported_reward_event_type: rewardEventTypeRaw || null,
          })
          .eq("id", ymid);
        return NextResponse.json({ ok: true, status: "rejected", reason: rpcError.message });
      }
      throw rpcErrorToApiError(rpcError);
    }

    await admin
      .from("ad_verification_attempts")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        reported_telegram_id: telegramId,
        reported_reward_event_type: rewardEventTypeRaw || null,
      })
      .eq("id", ymid);

    return NextResponse.json({ ok: true, status: "confirmed" });
  } catch (error) {
    return handleRouteError(error);
  }
}
