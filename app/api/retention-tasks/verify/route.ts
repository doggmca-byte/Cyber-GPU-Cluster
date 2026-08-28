import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { checkRetentionCondition } from "@/lib/retention/checkRetentionCondition";
import { RETENTION_TASK_TYPES, type RetentionTaskType } from "@/lib/constants/retentionTasks";
import type { RetentionTaskVerifyResponse, TaskRewardType } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VerifyRequestBody {
  initData?: string;
  task_type?: string;
}

function isRetentionTaskType(value: string | undefined): value is RetentionTaskType {
  return !!value && (RETENTION_TASK_TYPES as readonly string[]).includes(value);
}

/**
 * Перевірка після спливання таймера. На відміну від /start, умова тут
 * передається в RPC НЕЗАЛЕЖНО від результату (true чи false) — навіть при
 * false потрібна атомарна зміна стану (скидання таймера поточного етапу під
 * FOR UPDATE), тож пропустити виклик RPC тут не можна (див. коментар у
 * supabase/migrations/20260829090000_special_retention_tasks.sql).
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<VerifyRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");
    if (!isRetentionTaskType(body.task_type)) throw new ApiError(400, "task_type must be NAME_TAG or BIO_LINK");

    const taskType = body.task_type;
    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const condition = await checkRetentionCondition(taskType, user.id);

    const { data, error } = await admin
      .rpc("verify_retention_task_stage", {
        p_user_id: profile.id,
        p_task_type: taskType,
        p_condition_met: condition.met,
      })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "verify_retention_task_stage returned no data");

    const response: RetentionTaskVerifyResponse = {
      success: data.success,
      // condition.met є false рівно тоді, коли data.success є false (єдиний
      // шлях до success:false в RPC — гілка "not p_condition_met") — тож
      // reason тут завжди визначений саме в цьому випадку.
      failure_reason: !condition.met ? condition.reason : undefined,
      task_type: data.task_type as RetentionTaskType,
      current_stage: data.current_stage,
      is_active: data.is_active,
      stage_started_at: data.stage_started_at,
      is_fully_completed: data.is_fully_completed,
      reward_credited: data.reward_credited,
      reward_type: data.reward_type as TaskRewardType,
      game_balance: data.game_balance,
      withdrawable_balance: data.withdrawable_balance,
      withdrawal_quota: data.withdrawal_quota,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
