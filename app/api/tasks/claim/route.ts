import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { TaskClaimResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClaimRequestBody {
  initData?: string;
  task_id?: string;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ClaimRequestBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");
    if (!body.task_id) throw new ApiError(400, "task_id is required");

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("claim_task_reward", { p_user_id: profile.id, p_task_id: body.task_id })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "claim_task_reward returned no data");

    const response: TaskClaimResponse = {
      task_id: data.task_id,
      status: data.status as TaskClaimResponse["status"],
      reward_amount: data.reward_amount,
      reward_type: data.reward_type as TaskClaimResponse["reward_type"],
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
