import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProfileByTelegramId } from "@/lib/api/profile";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { isTelegramAdmin } from "@/lib/admin/telegramAdmins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GigaPub support (не публічна документація — підтверджено в чаті 22.08.2026)
// назвали лише ОДНЕ значення event — "ad_shown". Приймаємо тільки його
// (fail-closed, той самий принцип, що й PAID_REWARD_EVENT_VALUES у
// Monetag-постбеку) — якщо в майбутньому з'являться інші event-типи
// ("ad_clicked" тощо, що НЕ мають означати завершений rewarded-перегляд),
// вони НЕ пройдуть цю перевірку, доки явно не додамо.
const VALID_EVENTS = new Set(["ad_shown"]);

// Той самий принцип дедуплікації, що й у AdsGram-постбеку: GigaPub, як і
// AdsGram, не дає нам токен спроби наперед — лише uid ({user_id}) у самому
// postback-запиті, без кореляції з конкретним показом із нашого боку.
const DEDUPE_WINDOW_SECONDS = 20;

/**
 * S2S postback від сервера GigaPub — на відміну від Monetag тут НЕМАЄ
 * окремого кроку "відкрити спробу" перед показом: GigaPub сам вирішує, коли
 * стався ad_shown-евент, і б'є по цьому URL з uid={user_id}.
 *
 * ВАЖЛИВО (відкрите питання, потребує підтвердження від GigaPub support):
 * чи справді {user_id} — це наш Telegram ID (те, що ми ніколи явно НЕ
 * передавали в window.showGiga(), lib/ads/gigapub.ts — можливо, їхній SDK
 * сам читає його з window.Telegram.WebApp у Mini App-контексті). Якщо uid
 * не резолвиться в реальний профіль — findProfileByTelegramId поверне null,
 * і роут просто нічого не нарахує (безпечний no-op, а не помилка).
 *
 * Захист — статичний ?secret=, живе лише в дашборді/чаті підтримки GigaPub,
 * ніколи не потрапляє клієнту.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const expectedSecret = process.env.GIGAPUB_POSTBACK_SECRET;
    if (!expectedSecret) {
      throw new ApiError(500, "server misconfigured: GIGAPUB_POSTBACK_SECRET is not set");
    }
    if (url.searchParams.get("secret") !== expectedSecret) {
      throw new ApiError(401, "invalid secret");
    }

    const uidRaw = url.searchParams.get("uid");
    const telegramId = uidRaw ? Number(uidRaw) : NaN;
    if (!uidRaw || !Number.isFinite(telegramId)) {
      throw new ApiError(400, "uid is required");
    }

    const eventRaw = (url.searchParams.get("event") ?? "").toLowerCase();
    if (!VALID_EVENTS.has(eventRaw)) {
      // Невідомий/відсутній event — не нараховуємо, але й не помилка: 200,
      // щоб GigaPub не ретраїв вічно.
      return NextResponse.json({ ok: true, status: "unknown_event" });
    }

    const admin = createAdminClient();
    const profile = await findProfileByTelegramId(admin, telegramId);
    if (!profile) {
      return NextResponse.json({ ok: true, status: "unknown_user" });
    }

    const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_SECONDS * 1000).toISOString();
    const { data: recentConfirmed, error: recentError } = await admin
      .from("ad_verification_attempts")
      .select("id")
      .eq("user_id", profile.id)
      .eq("provider", "gigapub")
      .eq("status", "confirmed")
      .gte("confirmed_at", dedupeSince)
      .limit(1)
      .maybeSingle();

    if (recentError) throw new ApiError(500, `failed to check dedupe window: ${recentError.message}`);
    if (recentConfirmed) {
      return NextResponse.json({ ok: true, status: "confirmed", deduped: true });
    }

    const bypassLimit = isTelegramAdmin(telegramId);
    const { error: rpcError } = await admin.rpc("record_partner_ad_watch", {
      p_user_id: profile.id,
      p_bypass_limit: bypassLimit,
    });

    if (rpcError) {
      if (rpcError.code === "P0001") {
        await admin.from("ad_verification_attempts").insert({
          user_id: profile.id,
          purpose: "partner_ad_watch",
          provider: "gigapub",
          status: "rejected",
          reported_telegram_id: telegramId,
          reported_reward_event_type: eventRaw,
        });
        return NextResponse.json({ ok: true, status: "rejected", reason: rpcError.message });
      }
      throw rpcErrorToApiError(rpcError);
    }

    await admin.from("ad_verification_attempts").insert({
      user_id: profile.id,
      purpose: "partner_ad_watch",
      provider: "gigapub",
      status: "confirmed",
      reported_telegram_id: telegramId,
      reported_reward_event_type: eventRaw,
      confirmed_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, status: "confirmed" });
  } catch (error) {
    return handleRouteError(error);
  }
}
