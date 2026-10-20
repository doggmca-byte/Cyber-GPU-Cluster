import { NextResponse } from "next/server";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { runPayoutWorker } from "@/lib/ton/payoutWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Страховка автовиплат. Основний запуск — одразу після заявки (after() у
 * /api/wallet/withdraw); цей крон щохвилини дотискає те, що там не вдалось:
 * обрив функції, збій toncenter, заявку, що чекала підтвердження попередньої.
 * Якщо воркер уже працює, замок у БД просто поверне skipped.
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      throw new ApiError(500, "server misconfigured: CRON_SECRET is not set");
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      throw new ApiError(401, "unauthorized");
    }

    const result = await runPayoutWorker({ trigger: "cron" });

    return NextResponse.json({ ...result, server_time: new Date().toISOString() });
  } catch (error) {
    return handleRouteError(error);
  }
}
