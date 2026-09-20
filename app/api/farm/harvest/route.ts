import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { calcTotalHashPerSecond } from "@/lib/farm/totalHashPerSecond";
import { loadGpuTemplates } from "@/lib/farm/gpuTemplates";
import type { HarvestResponse, UserGpu } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HarvestRequestBody {
  initData?: string;
}

interface CollectSnapshot {
  collected: number;
  new_hash_balance: number;
  game_balance: number;
  withdrawable_balance: number;
  last_collected_at: string | null;
  user_gpus: UserGpu[];
  server_time: string;
}

function isCollectSnapshot(value: unknown): value is CollectSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.success === true &&
    v.collected != null &&
    v.new_hash_balance != null &&
    Array.isArray(v.user_gpus) &&
    typeof v.server_time === "string"
  );
}

/**
 * Збір $HASH. Клієнт не передає жодної суми — сервер сам рахує нарахування за
 * час, що минув (collect_hash -> harvest_user_hash), і повертає повний знімок
 * стану, з якого клієнт оновлює і баланс, і лічильник.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<HarvestRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    // Усе в одній транзакції на боці Postgres (collect_hash): нарахування,
    // оновлення last_harvest_at і читання балансів + user_gpus. Окремий
    // другий запит за балансами (як було раніше) міг побачити стан після
    // чужої операції, а user_gpus клієнт узагалі не отримував — через це
    // лічильник на Фермі "відкочувався" після зміни вкладки.
    const [{ data: snapshot, error: collectError }, gpuTemplates] = await Promise.all([
      admin.rpc("collect_hash", { p_user_id: profile.id }),
      loadGpuTemplates(admin),
    ]);

    if (collectError) throw rpcErrorToApiError(collectError);
    if (!isCollectSnapshot(snapshot)) {
      throw new ApiError(500, "collect_hash returned an unexpected payload");
    }

    const response: HarvestResponse = {
      success: true,
      collected: Number(snapshot.collected),
      new_hash_balance: Number(snapshot.new_hash_balance),
      game_balance: Number(snapshot.game_balance),
      withdrawable_balance: Number(snapshot.withdrawable_balance),
      last_collected_at: snapshot.last_collected_at,
      user_gpus: snapshot.user_gpus,
      total_hash_per_second: calcTotalHashPerSecond(snapshot.user_gpus, gpuTemplates),
      server_time: snapshot.server_time,
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
