import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import { calcTotalHashPerSecond } from "@/lib/farm/totalHashPerSecond";
import type { BuyGpuResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BuyRequestBody {
  initData?: string;
  gpu_level?: number;
}

/**
 * Купівля GPU. Відповідь навмисно містить ПОВНИЙ фактичний стан обладнання
 * (user_gpus + total_hash_per_second), а не лише дельту: клієнт більше нічого
 * не домальовує сам і не рахує інкрементами, а просто замінює свій масив тим,
 * що реально лежить у БД після успішної транзакції.
 *
 * Причина — реальний баг: раніше клієнт оптимістично додавав картку ще ДО
 * відповіді, і якщо buy_gpu відхиляв покупку (недостатньо game_balance),
 * відкат лишав у стані рядок з amount = 0, який рендерився на Фермі як
 * "фантомний сервер" із +0 HASH/год. Тепер стан обладнання оновлюється
 * ВИКЛЮЧНО з цієї відповіді, тобто лише після реально успішної транзакції.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<BuyRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const gpuLevel = body.gpu_level;
    if (!Number.isInteger(gpuLevel) || (gpuLevel as number) < 1 || (gpuLevel as number) > 10) {
      throw new ApiError(400, "gpu_level must be an integer between 1 and 10");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("buy_gpu", { p_user_id: profile.id, p_level: gpuLevel as number })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "buy_gpu returned no data");

    // Транзакція вже пройшла — перечитуємо фактичні рядки, щоб віддати
    // клієнту справжні id/amount/last_harvest_at, а не синтетичні локальні.
    const [{ data: userGpus, error: gpusError }, { data: gpuTemplates, error: templatesError }] =
      await Promise.all([
        admin.from("user_gpus").select("*").eq("user_id", profile.id).order("gpu_level"),
        admin.from("gpu_templates").select("*").order("level"),
      ]);

    if (gpusError) throw new ApiError(500, `failed to load user_gpus: ${gpusError.message}`);
    if (templatesError) {
      throw new ApiError(500, `failed to load gpu_templates: ${templatesError.message}`);
    }

    const response: BuyGpuResponse = {
      gpu_level: gpuLevel as number,
      new_game_balance: data.new_game_balance,
      new_gpu_amount: data.new_gpu_amount,
      hash_harvested: data.hash_harvested,
      user_gpus: userGpus ?? [],
      total_hash_per_second: calcTotalHashPerSecond(userGpus ?? [], gpuTemplates ?? []),
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
