import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostbackRequestBody {
  click_id?: string;
  status?: boolean;
  secret?: string;
}

/**
 * S2S postback від партнера: підтверджує, що НАШ юзер (виданий click_id із
 * /api/partners/click) виконав ЙОГО цільову дію. Немає Telegram initData —
 * викликач не наш Mini App, а сервер партнера — тому єдиний захист це
 * per-partner inbound_secret (partner_integrations), а не HMAC-підпис
 * ініт-даних, як у решти роутів.
 *
 * Нарахування нагороди НЕ відбувається тут — цей роут лише переводить
 * user_tasks у 'completed', так само, як /api/tasks/verify для
 * telegram_channel/external_link. claim_task_reward для action_type
 * 'partner_postback' спрацьовує без окремої гілки в CASE (v_user_task.status
 * = 'completed' -> v_condition_met := true) — юзер тисне "Забрати" в UI сам.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<PostbackRequestBody>(request);
    if (!body.click_id) throw new ApiError(400, "click_id is required");
    if (typeof body.status !== "boolean") throw new ApiError(400, "status must be a boolean");
    if (!body.secret) throw new ApiError(400, "secret is required");

    const admin = createAdminClient();

    const { data: click, error: clickError } = await admin
      .from("partner_task_clicks")
      .select("*")
      .eq("click_id", body.click_id)
      .eq("direction", "outbound")
      .maybeSingle();

    if (clickError) throw new ApiError(500, `failed to load click: ${clickError.message}`);
    if (!click) throw new ApiError(404, "click_id not found");

    const { data: partner, error: partnerError } = await admin
      .from("partner_integrations")
      .select("inbound_secret, is_active")
      .eq("id", click.partner_id)
      .single();

    if (partnerError) throw new ApiError(500, `failed to load partner: ${partnerError.message}`);
    if (!partner.is_active) throw new ApiError(403, "partner is not active");
    if (partner.inbound_secret !== body.secret) throw new ApiError(401, "invalid secret");

    if (!body.status) {
      // status:false навмисно нічого не пише в БД — click лишається
      // 'pending' (партнер про невдачу може взагалі не стукати, це той самий
      // стан). Повертаємо ok:true все одно, щоб партнер не ретраїв даремно —
      // це не помилка на нашому боці.
      return NextResponse.json({ ok: true });
    }

    // Ідемпотентно: повторний status:true на вже 'confirmed' click — просто ok:true.
    if (click.status !== "confirmed") {
      const { error: updateClickError } = await admin
        .from("partner_task_clicks")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
        .eq("id", click.id);

      if (updateClickError) {
        throw new ApiError(500, `failed to confirm click: ${updateClickError.message}`);
      }

      const { data: existing, error: existingError } = await admin
        .from("user_tasks")
        .select("*")
        .eq("user_id", click.user_id)
        .eq("task_id", click.task_id)
        .maybeSingle();

      if (existingError) throw new ApiError(500, `failed to load user_task: ${existingError.message}`);

      if (existing) {
        if (existing.status === "pending") {
          const { error: updateTaskError } = await admin
            .from("user_tasks")
            .update({ status: "completed", updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          if (updateTaskError) throw new ApiError(500, `failed to complete task: ${updateTaskError.message}`);
        }
        // 'completed'/'claimed' — уже там, де треба, нічого не робимо.
      } else {
        const { error: insertTaskError } = await admin
          .from("user_tasks")
          .insert({ user_id: click.user_id, task_id: click.task_id, status: "completed" });
        if (insertTaskError) throw new ApiError(500, `failed to insert user_task: ${insertTaskError.message}`);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
