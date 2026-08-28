import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { checkRetentionCondition } from "@/lib/retention/checkRetentionCondition";
import { RETENTION_TASK_TYPES, type RetentionTaskType } from "@/lib/constants/retentionTasks";
import type { RetentionTaskStartResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartRequestBody {
  initData?: string;
  task_type?: string;
}

function isRetentionTaskType(value: string | undefined): value is RetentionTaskType {
  return !!value && (RETENTION_TASK_TYPES as readonly string[]).includes(value);
}

/**
 * Старт (або повторний старт після скинутого невдалого етапу) — умова
 * (тег/лінк) перевіряється через Telegram Bot API ТУТ, ще ДО виклику RPC.
 * Якщо не виконана — не б'ємо в БД взагалі, просто повертаємо started:false
 * (це нормальний, очікуваний стан флоу, не помилка сервера).
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<StartRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");
    if (!isRetentionTaskType(body.task_type)) throw new ApiError(400, "task_type must be NAME_TAG or BIO_LINK");

    const taskType = body.task_type;
    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const condition = await checkRetentionCondition(taskType, user.id);
    const serverTime = new Date().toISOString();

    if (!condition.met) {
      const response: RetentionTaskStartResponse = {
        started: false,
        failure_reason: condition.reason,
        task_type: taskType,
        server_time: serverTime,
      };
      return NextResponse.json(response);
    }

    const { data, error } = await admin
      .rpc("start_retention_task_stage", {
        p_user_id: profile.id,
        p_task_type: taskType,
        p_condition_met: true,
      })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "start_retention_task_stage returned no data");

    const response: RetentionTaskStartResponse = {
      started: true,
      task_type: data.task_type as RetentionTaskType,
      current_stage: data.current_stage,
      is_active: data.is_active,
      stage_started_at: data.stage_started_at,
      stage_duration_seconds: data.stage_duration_seconds,
      server_time: serverTime,
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
