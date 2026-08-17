import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import type { TaskActionType, TaskCategory, TaskItem, TaskRewardType, TasksResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TasksRequestBody {
  initData?: string;
}

interface LiveStats {
  gpuTotal: number;
  harvestCount: number;
  referralCount: number;
  depositCount: number;
}

/**
 * ТЗ називає цей ендпоінт GET /api/tasks, але — як і решта роутів застосунку
 * (напр. app/api/friends/stats/route.ts) — реалізовано як POST з initData у
 * тілі: initData несе HMAC-підпис Telegram, і його не варто класти у query
 * string (URL-логи/кеші), а GET-запити з JSON-тілом не є стандартною практикою.
 *
 * Для *_count завдань статус обчислюється НАЖИВО (не лише зі збереженого
 * user_tasks.status): якщо жива умова вже виконана, а рядок ще 'pending',
 * фронтенд одразу бачить 'completed' і показує кнопку "Забрати" без окремого
 * кроку "Перевірити" — саме так, як це трактує claim_task_reward у базі.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<TasksRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data: templates, error: templatesError } = await admin
      .from("task_templates")
      .select("*")
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });

    if (templatesError) {
      throw new ApiError(500, `failed to load task templates: ${templatesError.message}`);
    }

    const { data: userTasks, error: userTasksError } = await admin
      .from("user_tasks")
      .select("task_id, status")
      .eq("user_id", profile.id);

    if (userTasksError) {
      throw new ApiError(500, `failed to load user tasks: ${userTasksError.message}`);
    }

    const statusByTask = new Map((userTasks ?? []).map((ut) => [ut.task_id, ut.status]));

    const [gpuRows, referralCountRes, depositCountRes] = await Promise.all([
      admin.from("user_gpus").select("amount").eq("user_id", profile.id),
      admin
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", profile.id),
      admin
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .eq("type", "deposit")
        .eq("status", "completed"),
    ]);

    if (gpuRows.error) throw new ApiError(500, `failed to load user_gpus: ${gpuRows.error.message}`);
    if (referralCountRes.error) {
      throw new ApiError(500, `failed to load referrals: ${referralCountRes.error.message}`);
    }
    if (depositCountRes.error) {
      throw new ApiError(500, `failed to load deposits: ${depositCountRes.error.message}`);
    }

    const live: LiveStats = {
      gpuTotal: (gpuRows.data ?? []).reduce((sum, g) => sum + g.amount, 0),
      harvestCount: profile.harvest_count,
      referralCount: referralCountRes.count ?? 0,
      depositCount: depositCountRes.count ?? 0,
    };

    const tasks: TaskItem[] = (templates ?? []).map((tmpl) => {
      const storedStatus = (statusByTask.get(tmpl.id) ?? "pending") as TaskItem["status"];
      const progress = computeLiveProgress(tmpl.action_type as TaskActionType, tmpl.target_value, live);

      const status: TaskItem["status"] =
        storedStatus === "pending" && progress && progress.current >= progress.target
          ? "completed"
          : storedStatus;

      return {
        id: tmpl.id,
        category: tmpl.category as TaskCategory,
        title_key: tmpl.title_key,
        icon: tmpl.icon,
        reward_amount: tmpl.reward_amount,
        reward_type: tmpl.reward_type as TaskRewardType,
        action_type: tmpl.action_type as TaskActionType,
        target_value: tmpl.target_value,
        status,
        progress_current: progress?.current,
        progress_target: progress?.target,
      };
    });

    const completedCount = tasks.filter((t) => t.status === "completed" || t.status === "claimed").length;

    const response: TasksResponse = {
      tasks,
      completed_count: completedCount,
      total_count: tasks.length,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}

function computeLiveProgress(
  actionType: TaskActionType,
  targetValue: string,
  live: LiveStats,
): { current: number; target: number } | null {
  const target = Number(targetValue);

  switch (actionType) {
    case "own_gpus_count":
      return { current: live.gpuTotal, target };
    case "harvest_count":
      return { current: live.harvestCount, target };
    case "invite_count":
      return { current: live.referralCount, target };
    case "deposit_count":
      return { current: live.depositCount, target };
    default:
      // telegram_channel / external_link не мають "живого" числового прогресу —
      // їх статус визначається виключно /api/tasks/verify.
      return null;
  }
}
