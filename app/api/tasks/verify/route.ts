import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { isChannelMember } from "@/lib/telegram/getChatMember";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import type { TaskVerifyResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VerifyRequestBody {
  initData?: string;
  task_id?: string;
}

/**
 * Обслуговує лише два action_type, для яких неможливо валідувати умову
 * прямими SQL-запитами (claim_task_reward сам вважає їх виконаними, лише коли
 * user_tasks.status уже 'completed'):
 *   - telegram_channel: реальна перевірка через Bot API getChatMember.
 *   - external_link: неможливо технічно підтвердити перехід з Mini App —
 *     фіксуємо факт натискання "Перевірити" ПІСЛЯ того, як юзер відкрив
 *     посилання (client відкриває його на кроці "Виконати" ще до виклику).
 * Інші action_type (*_count) сюди не звертаються — їхній статус GET /api/tasks
 * обчислює наживо, без окремого кроку підтвердження.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<VerifyRequestBody>(request);
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

    if (task.action_type !== "telegram_channel" && task.action_type !== "external_link") {
      throw new ApiError(400, "this task type does not support manual verification");
    }

    const { data: existing, error: existingError } = await admin
      .from("user_tasks")
      .select("*")
      .eq("user_id", profile.id)
      .eq("task_id", task.id)
      .maybeSingle();

    if (existingError) {
      throw new ApiError(500, `failed to load task status: ${existingError.message}`);
    }

    // Уже claimed — ідемпотентно повертаємо як є, ніколи не понижуємо статус.
    if (existing?.status === "claimed") {
      const response: TaskVerifyResponse = {
        task_id: task.id,
        status: "claimed",
        completed: true,
        server_time: new Date().toISOString(),
      };
      return NextResponse.json(response);
    }

    const completed =
      task.action_type === "telegram_channel"
        ? await isChannelMember(task.target_value, user.id)
        : true;

    if (completed && existing?.status !== "completed") {
      if (existing) {
        await admin
          .from("user_tasks")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await admin.from("user_tasks").insert({ user_id: profile.id, task_id: task.id, status: "completed" });
      }
    }

    const response: TaskVerifyResponse = {
      task_id: task.id,
      status: completed ? "completed" : "pending",
      completed,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
