import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pull/API-check модель — партнер САМ синхронно стукає сюди, коли хоче
 * перевірити, чи виконав конкретний telegram_id умову в нас (на відміну
 * від push/postback у /api/partners/postback, де СТУКАЄМО МИ). Той самий
 * формат, що вже реально використовує мережа партнерів (приклад Cookie
 * Wars: GET .../tasks/check?id=<slug>&telegram_id=<user_id>).
 *
 * Навмисно БЕЗ секрету в query — обидва застосунки Telegram Mini App,
 * telegram_id сам по собі вже universal identifier між ними, і відповідь
 * тут лише true/false по одній наперед визначеній умові (не сума балансу
 * чи інші деталі) — той самий рівень чутливості, що й публічний
 * task_templates (уже читається без автентифікації). Це той компроміс,
 * якого прямо вимагає сумісність із форматом, що партнери вже
 * використовують і не змінюватимуть під нас.
 *
 * id (slug) -> яку саме умову перевіряти зберігається в
 * partner_check_definitions, а не хардкодиться тут — новий пункт
 * "api таски" для нового партнера це один INSERT, без деплою.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get("id");
    const telegramIdRaw = url.searchParams.get("telegram_id");

    if (!slug) throw new ApiError(400, "id is required");
    if (!telegramIdRaw) throw new ApiError(400, "telegram_id is required");

    const telegramId = Number(telegramIdRaw);
    if (!Number.isFinite(telegramId)) {
      throw new ApiError(400, "telegram_id must be a number");
    }

    const admin = createAdminClient();

    const { data: definition, error: definitionError } = await admin
      .from("partner_check_definitions")
      .select("action_type, target_value")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();

    if (definitionError) {
      throw new ApiError(500, `failed to load check definition: ${definitionError.message}`);
    }
    if (!definition) throw new ApiError(404, "unknown task id");

    const { data: success, error: evaluateError } = await admin.rpc("evaluate_partner_check_condition", {
      p_telegram_id: telegramId,
      p_action_type: definition.action_type,
      p_target_value: definition.target_value,
    });

    if (evaluateError) {
      throw new ApiError(500, `failed to evaluate condition: ${evaluateError.message}`);
    }

    return NextResponse.json({ success: Boolean(success) });
  } catch (error) {
    return handleRouteError(error);
  }
}
