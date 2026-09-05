import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProfileByTelegramId } from "@/lib/api/profile";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { isTelegramAdmin } from "@/lib/admin/telegramAdmins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Вікно дедуплікації — той самий принцип, що й AdsGram (немає власного
// event id від провайдера, дедуплікуємо по user_id+provider у короткому вікні).
const DEDUPE_WINDOW_SECONDS = 20;

interface TadsPostbackBody {
  telegram_id?: string | number;
  widget_id?: string;
}

/**
 * S2S webhook від TADS (Static/TGB widget, "on ad click") — задається як
 * Webhook URL у їхньому кабінеті з ДОПИСАНИМ query-параметром
 * ?secret=TADS_POSTBACK_SECRET. Це навмисно, бо власного механізму
 * автентифікації в TADS API немає взагалі (жодного токена/підпису в їхній
 * документації) — той самий трюк захисту, що вже застосований для AdsGram
 * (app/api/ads/adsgram-postback): секрет наш власний, ми самі його
 * прописуємо в URL, який ДАЄМО їм, тож будь-який запит без правильного
 * ?secret= гарантовано не від TADS.
 *
 * Документація каже "GET or POST" і "кожен POST містить json object" —
 * тож приймаємо обидва: спершу пробуємо JSON body (POST), якщо порожній чи
 * невалідний — падаємо на query-параметри (можливий GET-варіант).
 */
export async function POST(request: Request) {
  return handleTadsPostback(request);
}

export async function GET(request: Request) {
  return handleTadsPostback(request);
}

async function handleTadsPostback(request: Request) {
  try {
    const url = new URL(request.url);

    const expectedSecret = process.env.TADS_POSTBACK_SECRET;
    if (!expectedSecret) {
      throw new ApiError(500, "server misconfigured: TADS_POSTBACK_SECRET is not set");
    }
    if (url.searchParams.get("secret") !== expectedSecret) {
      throw new ApiError(401, "invalid secret");
    }

    let body: TadsPostbackBody = {};
    try {
      body = (await request.json()) as TadsPostbackBody;
    } catch {
      // Немає JSON body (GET чи порожній POST) — читаємо з query нижче.
    }

    const telegramIdRaw = body.telegram_id ?? url.searchParams.get("telegram_id");
    const telegramId = telegramIdRaw !== undefined && telegramIdRaw !== null ? Number(telegramIdRaw) : NaN;
    if (!Number.isFinite(telegramId)) {
      throw new ApiError(400, "telegram_id is required");
    }

    const admin = createAdminClient();
    const profile = await findProfileByTelegramId(admin, telegramId);
    if (!profile) {
      // Профіль ще не існує — не наша провина і не помилка TADS, просто
      // нема кого кредитувати. Відповідаємо 200, щоб вони не ретраїли вічно.
      return NextResponse.json({ ok: true, status: "unknown_user" });
    }

    const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_SECONDS * 1000).toISOString();
    const { data: recentConfirmed, error: recentError } = await admin
      .from("ad_verification_attempts")
      .select("id")
      .eq("user_id", profile.id)
      .eq("provider", "tads")
      .eq("status", "confirmed")
      .gte("confirmed_at", dedupeSince)
      .limit(1)
      .maybeSingle();

    if (recentError) throw new ApiError(500, `failed to check dedupe window: ${recentError.message}`);
    if (recentConfirmed) {
      return NextResponse.json({ ok: true, status: "confirmed", deduped: true });
    }

    const { error: rpcError } = await admin.rpc("record_partner_ad_watch", {
      p_user_id: profile.id,
      p_bypass_limit: isTelegramAdmin(telegramId),
    });

    if (rpcError) {
      if (rpcError.code === "P0001") {
        // Денний ліміт вичерпаний — не помилка нашого/TADS боку.
        await admin.from("ad_verification_attempts").insert({
          user_id: profile.id,
          purpose: "partner_ad_watch",
          provider: "tads",
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
      provider: "tads",
      status: "confirmed",
      reported_telegram_id: telegramId,
      confirmed_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, status: "confirmed" });
  } catch (error) {
    return handleRouteError(error);
  }
}
