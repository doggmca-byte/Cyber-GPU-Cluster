import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { rpcErrorToApiError } from "@/lib/api/rpc";

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

    // purpose наразі завжди 'partner_ad_watch' (єдине значення, дозволене
    // CHECK-обмеженням ad_verification_attempts.purpose) — record_partner_ad_watch
    // сам застосовує денний ліміт (20/день), той самий, що й для
    // GigaPub-довірчого шляху.
    const { error: rpcError } = await admin.rpc("record_partner_ad_watch", { p_user_id: attempt.user_id });

    if (rpcError) {
      // Ліміт на добу вичерпаний — не критична помилка нашого боку, просто
      // не нараховуємо, але ПОЗНАЧАЄМО rejected, щоб не намагатись знову.
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
