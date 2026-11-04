import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { ReviveGpuResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReviveRequestBody {
  initData?: string;
  gpu_level?: number;
  /** id партії (рядка user_gpus). Старий клієнт його не шле — тоді RPC бере найстаршу мертву партію рівня. */
  gpu_id?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Оживлення "мертвої" (is_dead) партії карток — revive_gpu RPC. Дозволено лише
 * коли партія дійсно мертва і лишились оживлення (< 3), інакше RPC кидає P0001
 * (див. supabase/migrations/20261104090000_gpu_lots_own_lifecycle.sql).
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ReviveRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const gpuLevel = body.gpu_level;
    if (!Number.isInteger(gpuLevel) || (gpuLevel as number) < 1 || (gpuLevel as number) > 10) {
      throw new ApiError(400, "gpu_level must be an integer between 1 and 10");
    }

    if (body.gpu_id !== undefined && (typeof body.gpu_id !== "string" || !UUID_RE.test(body.gpu_id))) {
      throw new ApiError(400, "gpu_id must be a uuid");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("revive_gpu", { p_user_id: profile.id, p_level: gpuLevel as number, p_gpu_id: body.gpu_id })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "revive_gpu returned no data");

    const response: ReviveGpuResponse = {
      gpu_level: gpuLevel as number,
      gpu_id: data.gpu_id,
      new_game_balance: data.new_game_balance,
      revival_count: data.revival_count,
      revival_cost: data.revival_cost,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
