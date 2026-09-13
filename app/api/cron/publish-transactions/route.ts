import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { publishPendingTransactions } from "@/lib/telegram/publishTransactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Скільки дописів за один прогін. При паузі 3.5 с це ~42 секунди роботи —
 * вкладається у хвилину між запусками з запасом, а історичну чергу
 * (86 транзакцій на момент запуску) розбирає приблизно за сім хвилин.
 */
const BATCH_SIZE = 12;

/**
 * Стрічка поповнень і виплат у публічний канал @CGPU_transactions.
 *
 * Крон, а не відправка з місця створення транзакції: поповнення
 * зараховуються з чотирьох різних шляхів (крон скарбниці, скан при
 * відкритті застосунку, кнопка "Перевірити оплату", санація в адмінці),
 * і рано чи пізно з'явиться п'ятий, до якого відправку забудуть причепити.
 * Тут джерело правди одне — сама таблиця transactions.
 *
 * Замок claim_job не дає двом прогонам накластись: публікація триває довше,
 * ніж інтервал між запусками, і без замка канал отримав би дублі.
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

    const admin = createAdminClient();

    const { data: won, error: claimError } = await admin.rpc("claim_job", {
      p_name: "publish_transactions",
      p_min_interval_seconds: 55,
    });
    if (claimError) {
      throw new ApiError(500, `claim_job failed: ${claimError.message}`);
    }
    if (!won) {
      return NextResponse.json({ skipped: "another run is in progress" });
    }

    const result = await publishPendingTransactions(admin, BATCH_SIZE);

    return NextResponse.json({
      published: result.published,
      failed: result.failed,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
