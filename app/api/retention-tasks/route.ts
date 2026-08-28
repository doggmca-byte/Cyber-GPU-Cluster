import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { buildReferralLink } from "@/lib/retention/checkRetentionCondition";
import { RETENTION_NAME_TAG, RETENTION_TASK_TYPES, type RetentionTaskType } from "@/lib/constants/retentionTasks";
import type { RetentionStageConfig, RetentionTaskStatus, RetentionTasksResponse, TaskRewardType } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StatusRequestBody {
  initData?: string;
}

/**
 * Повний статус ОБОХ retention-завдань (NAME_TAG/BIO_LINK) одним запитом —
 * той самий підхід, що й /api/tasks (один fetch на весь список замість
 * запиту на кожен таск). seconds_remaining/can_verify рахуються тут, на
 * сервері, за server_time — клієнт лише тикає локально між запитами (як
 * useMiningEngine), ніколи не рахує самостійно "з нуля".
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<StatusRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const [{ data: stageRows, error: stageError }, { data: userRows, error: userError }] = await Promise.all([
      admin.from("retention_task_stage_config").select("*").order("task_type").order("stage"),
      admin.from("user_retention_tasks").select("*").eq("user_id", profile.id),
    ]);

    if (stageError) throw new ApiError(500, `failed to load retention_task_stage_config: ${stageError.message}`);
    if (userError) throw new ApiError(500, `failed to load user_retention_tasks: ${userError.message}`);

    const serverTimeMs = Date.now();
    const stageByTaskAndNumber = new Map((stageRows ?? []).map((s) => [`${s.task_type}:${s.stage}`, s]));
    const userRowByType = new Map((userRows ?? []).map((r) => [r.task_type, r]));

    const tasks: RetentionTaskStatus[] = RETENTION_TASK_TYPES.map((taskType) => {
      const row = userRowByType.get(taskType);
      const currentStage = row?.current_stage ?? 1;
      const isActive = row?.is_active ?? false;
      const stageStartedAt = row?.stage_started_at ?? null;
      const isFullyCompleted = currentStage >= 7;

      let secondsRemaining = 0;
      if (isActive && stageStartedAt) {
        const cfg = stageByTaskAndNumber.get(`${taskType}:${currentStage}`);
        const durationSeconds = cfg?.duration_seconds ?? 0;
        const elapsedSeconds = Math.max((serverTimeMs - new Date(stageStartedAt).getTime()) / 1000, 0);
        secondsRemaining = Math.max(durationSeconds - elapsedSeconds, 0);
      }

      return {
        task_type: taskType,
        current_stage: currentStage,
        is_active: isActive,
        stage_started_at: stageStartedAt,
        seconds_remaining: secondsRemaining,
        can_verify: isActive && secondsRemaining <= 0,
        is_fully_completed: isFullyCompleted,
        total_reward_claimed: row?.total_reward_claimed ?? 0,
        target_text: targetTextFor(taskType, user.id),
      };
    });

    const stages: RetentionStageConfig[] = (stageRows ?? []).map((s) => ({
      task_type: s.task_type as RetentionTaskType,
      stage: s.stage,
      duration_seconds: s.duration_seconds,
      reward_amount: s.reward_amount,
      reward_type: s.reward_type as TaskRewardType,
    }));

    const response: RetentionTasksResponse = {
      tasks,
      stages,
      server_time: new Date(serverTimeMs).toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}

function targetTextFor(taskType: RetentionTaskType, telegramId: number): string {
  return taskType === "NAME_TAG" ? RETENTION_NAME_TAG : buildReferralLink(telegramId);
}
