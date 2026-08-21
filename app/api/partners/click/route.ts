import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClickRequestBody {
  initData?: string;
  task_id?: string;
}

/**
 * Крок "Виконати" для partner_postback-завдань (Task Center → "Партнери",
 * supabase/migrations/20260821110000_partner_task_postback.sql). На відміну
 * від telegram_channel/external_link, тут НЕ можна просто відкрити
 * task.target_value напряму — спершу генеруємо унікальний click_id і кладемо
 * pending-рядок у partner_task_clicks, щоб пізніше зіставити його з
 * підтвердженням від партнера (POST /api/partners/postback). Фронтенд
 * відкриває URL, який повертає ЦЕЙ роут (з підставленим click_id), а не
 * сам task.target_value.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ClickRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");
    if (!body.task_id) throw new ApiError(400, "task_id is required");

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data: task, error: taskError } = await admin
      .from("task_templates")
      .select("*")
      .eq("id", body.task_id)
      .eq("is_active", true)
      .maybeSingle();

    if (taskError) throw new ApiError(500, `failed to load task: ${taskError.message}`);
    if (!task) throw new ApiError(404, "task not found");
    if (task.action_type !== "partner_postback" || !task.partner_id) {
      throw new ApiError(400, "task is not a partner_postback task");
    }

    const { data: existingUserTask, error: existingError } = await admin
      .from("user_tasks")
      .select("status")
      .eq("user_id", profile.id)
      .eq("task_id", task.id)
      .maybeSingle();

    if (existingError) {
      throw new ApiError(500, `failed to load task status: ${existingError.message}`);
    }
    if (existingUserTask?.status === "claimed") {
      throw new ApiError(409, "task already claimed");
    }

    const clickId = randomUUID();
    // target_value — URL-шаблон партнера з плейсхолдером {click_id} (див.
    // партнерську специфікацію); без плейсхолдера дописуємо click_id як
    // звичайний query-параметр за замовчуванням.
    const url = task.target_value.includes("{click_id}")
      ? task.target_value.replace("{click_id}", clickId)
      : `${task.target_value}${task.target_value.includes("?") ? "&" : "?"}click_id=${clickId}`;

    const { error: insertError } = await admin.from("partner_task_clicks").insert({
      user_id: profile.id,
      task_id: task.id,
      partner_id: task.partner_id,
      click_id: clickId,
      direction: "outbound",
    });

    if (insertError) throw new ApiError(500, `failed to record click: ${insertError.message}`);

    return NextResponse.json({ click_id: clickId, url });
  } catch (error) {
    return handleRouteError(error);
  }
}
