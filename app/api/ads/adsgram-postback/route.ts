import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProfileByTelegramId } from "@/lib/api/profile";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { rpcErrorToApiError } from "@/lib/api/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Вікно дедуплікації: якщо AdsGram ретраїть той самий reward-евент (мережевий
// збій на їхньому боці, наш 200 не дійшов), не нараховуємо вдруге. На відміну
// від Monetag тут немає власного request/event id від провайдера — єдине, що
// вони дають назад, це [userId] (telegramId) — тож дедуплікуємо по
// user_id+provider у короткому часовому вікні, а не по унікальному токену.
const DEDUPE_WINDOW_SECONDS = 20;

/**
 * S2S postback від сервера AdsGram (Reward URL з дашборду ad-блоку типу
 * "Reward") — на відміну від Monetag тут НЕМАЄ окремого кроку
 * "відкрити спробу" перед показом: AdsGram сам вирішує, коли стався
 * реальний reward-евент, і одразу б'є по цьому URL з telegramId. Тому весь
 * запис (pending -> confirmed) відбувається одним попаданням сюди, а не
 * двома роутами, як у Monetag-флоу.
 *
 * Захист — статичний ?secret=, заданий лише в дашборді AdsGram (Reward URL),
 * ніколи не потрапляє клієнту.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const expectedSecret = process.env.ADSGRAM_POSTBACK_SECRET;
    if (!expectedSecret) {
      throw new ApiError(500, "server misconfigured: ADSGRAM_POSTBACK_SECRET is not set");
    }
    if (url.searchParams.get("secret") !== expectedSecret) {
      throw new ApiError(401, "invalid secret");
    }

    const telegramIdRaw = url.searchParams.get("telegram_id") ?? url.searchParams.get("userid");
    const telegramId = telegramIdRaw ? Number(telegramIdRaw) : NaN;
    if (!telegramIdRaw || !Number.isFinite(telegramId)) {
      throw new ApiError(400, "telegram_id is required");
    }

    const admin = createAdminClient();
    const profile = await findProfileByTelegramId(admin, telegramId);
    if (!profile) {
      // Профіль ще не існує (наприклад, юзер відкрив рекламу до першого
      // /api/user/sync) — не наша провина і не помилка AdsGram, просто
      // нема кого кредитувати. Відповідаємо 200, щоб вони не ретраїли вічно.
      return NextResponse.json({ ok: true, status: "unknown_user" });
    }

    const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_SECONDS * 1000).toISOString();
    const { data: recentConfirmed, error: recentError } = await admin
      .from("ad_verification_attempts")
      .select("id")
      .eq("user_id", profile.id)
      .eq("provider", "adsgram")
      .eq("status", "confirmed")
      .gte("confirmed_at", dedupeSince)
      .limit(1)
      .maybeSingle();

    if (recentError) throw new ApiError(500, `failed to check dedupe window: ${recentError.message}`);
    if (recentConfirmed) {
      return NextResponse.json({ ok: true, status: "confirmed", deduped: true });
    }

    const { error: rpcError } = await admin.rpc("record_partner_ad_watch", { p_user_id: profile.id });

    if (rpcError) {
      if (rpcError.code === "P0001") {
        // Денний ліміт вичерпаний — не помилка нашого/AdsGram боку, просто
        // не нараховуємо. Логуємо як rejected для аудиту.
        await admin.from("ad_verification_attempts").insert({
          user_id: profile.id,
          purpose: "partner_ad_watch",
          provider: "adsgram",
          status: "rejected",
          reported_telegram_id: telegramId,
        });
        return NextResponse.json({ ok: true, status: "rejected", reason: rpcError.message });
      }
      throw rpcErrorToApiError(rpcError);
    }

    await admin.from("ad_verification_attempts").insert({
      user_id: profile.id,
      purpose: "partner_ad_watch",
      provider: "adsgram",
      status: "confirmed",
      reported_telegram_id: telegramId,
      confirmed_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, status: "confirmed" });
  } catch (error) {
    return handleRouteError(error);
  }
}
