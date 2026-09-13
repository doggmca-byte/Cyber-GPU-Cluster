import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { checkChannelMembershipStatus } from "@/lib/telegram/getChatMember";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Штраф за відписку від Telegram-каналу протягом 24 годин після клейму
 * нагороди за підписку (2× нагороди — apply_channel_unsubscribe_penalty).
 *
 * Раніше ця перевірка жила всередині /api/user/sync і виконувалась на КОЖНЕ
 * відкриття застосунку — не з дизайну, а тому що на Vercel Hobby дозволено
 * лише два крони на добу, і обидва слоти були зайняті. Платив за це вхід у
 * гру: зайвий запит у БД, а для свіжих клеймів ще й round-trip до Telegram.
 *
 * Тепер це окремий крон (кожні 30 хв, vercel.json). Кандидатів мало —
 * лише ті, хто клеймив нагороду за останні 24 години і ще не штрафувався,
 * тож один прогін — це десятки викликів getChatMember, не тисячі.
 *
 * checkChannelMembershipStatus (а не isChannelMember) — навмисно: "не
 * вдалось перевірити" (мережевий збій чи неоднозначна відповідь Telegram)
 * НЕ карається як "відписався", лише явний "not_member".
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

    const { data: candidates, error: candidatesError } = await admin.rpc(
      "list_channel_penalty_candidates",
      { p_limit: 500 },
    );

    if (candidatesError) {
      throw new ApiError(500, `failed to list channel-penalty candidates: ${candidatesError.message}`);
    }

    let checked = 0;
    let penalized = 0;

    for (const candidate of candidates ?? []) {
      checked += 1;

      const membership = await checkChannelMembershipStatus(
        candidate.chat_id,
        Number(candidate.telegram_id),
      );
      if (membership !== "not_member") continue;

      const { error: penaltyError } = await admin
        .rpc("apply_channel_unsubscribe_penalty", {
          p_user_id: candidate.user_id,
          p_task_id: candidate.task_id,
        })
        .single();

      if (penaltyError) {
        // P0001 = "уже застосовано" або "вікно 24г минуло" — не помилка,
        // просто гонка з паралельним прогоном. P0002 = рядок зник.
        if (penaltyError.code !== "P0001" && penaltyError.code !== "P0002") {
          console.error("[cron/channel-penalties] failed to apply penalty:", penaltyError);
        }
        continue;
      }

      penalized += 1;
    }

    if (penalized > 0) {
      console.log(`[cron/channel-penalties] penalized ${penalized} of ${checked} candidate(s)`);
    }

    return NextResponse.json({
      checked,
      penalized,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
