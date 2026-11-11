import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Автозбір $HASH для профілів із profiles.auto_harvest
 * (supabase/migrations/20261111110000_auto_harvest_flag.sql).
 *
 * Для кожного такого профілю викликаємо collect_hash — той самий RPC, що й
 * кнопка "Collect HASH" (/api/farm/harvest): нарахування за час, що минув,
 * оновлення last_harvest_at і lifetime-ліміту картки в одній транзакції.
 * Клієнт нічого не передає, сума завжди рахується на боці БД.
 *
 * Прогін ідемпотентний: повторний виклик одразу після першого збере ≈ 0 HASH і
 * не збільшить harvest_count (він росте лише при зборі > 0). Паралельний ручний
 * збір серіалізується блокуванням профілю всередині collect_hash.
 *
 * Помилка одного профілю не зупиняє решту — рахуємо її й ідемо далі.
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      throw new ApiError(500, "server misconfigured: CRON_SECRET is not set");
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      throw new ApiError(401, "unauthorized");
    }

    const admin = createAdminClient();
    const { data: profiles, error } = await admin.from("profiles").select("id, telegram_id").eq("auto_harvest", true);

    if (error) {
      throw new ApiError(500, `failed to list auto_harvest profiles: ${error.message}`);
    }

    let collectedTotal = 0;
    let harvested = 0;
    let failed = 0;

    for (const profile of profiles ?? []) {
      const { data, error: collectError } = await admin.rpc("collect_hash", { p_user_id: profile.id });
      if (collectError) {
        failed++;
        console.error(`[cron/auto-harvest] collect_hash failed for ${profile.telegram_id}: ${collectError.message}`);
        continue;
      }

      const collected = Number((data as { collected?: number | string } | null)?.collected ?? 0);
      if (collected > 0) harvested++;
      collectedTotal += collected;
    }

    return NextResponse.json({
      candidates: profiles?.length ?? 0,
      harvested,
      collected_hash: collectedTotal,
      failed,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
