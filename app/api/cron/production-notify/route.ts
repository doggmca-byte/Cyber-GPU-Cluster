import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { sendTelegramMessage, TelegramDeliveryBlockedError } from "@/lib/telegram/sendTelegramMessage";
import { resolveLanguage } from "@/lib/i18n/resolveLanguage";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { MAX_UNCLAIMED_HOURS } from "@/lib/constants/economy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Виробництво призупинено" (12г без харвесту, MAX_UNCLAIMED_HOURS) —
 * Telegram-сповіщення для тих, хто не заходив у застосунок і сам ніколи б
 * цього не побачив (той самий бейдж "Production Paused" уже є в FarmScreen,
 * але лише для тих, хто ЖИВЦЕМ дивиться на екран у момент паузи).
 *
 * Vercel Cron на Hobby-плані — максимум 1 запуск/добу (vercel.json), тому це
 * НЕ "рівно через 12г", а щоденна перевірка "хто зараз призупинений і кому
 * ще не надсилали за цей епізод" (supabase/migrations/
 * 20260821100000_production_paused_notifications.sql).
 *
 * Мова повідомлення — profiles.telegram_language_code (збережено при
 * /api/user/sync із живого Telegram initData), не дефолт застосунку.
 *
 * Позначення "надіслано" (mark_production_paused_notified) виставляється
 * ЛИШЕ після реально успішної відповіді Telegram — тимчасові збої (мережа,
 * 5xx, rate-limit) лишають користувача "не сповіщеним", і завтрашній прогін
 * спробує ще раз. Перманентні (403 — бот заблокований) теж НЕ позначаються
 * як "надіслано" навмисно: користувач однаково не отримав повідомлення, і
 * позначка про це нічого корисного не додає, лише приховала б реальний
 * статус доставки, якби хтось перевіряв profiles.production_paused_notified_at
 * вручну.
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      throw new ApiError(500, "server misconfigured: NEXT_PUBLIC_APP_URL is not set");
    }

    const admin = createAdminClient();
    const { data: candidates, error } = await admin.rpc("list_paused_production_users", {
      p_max_unclaimed_hours: MAX_UNCLAIMED_HOURS,
    });

    if (error) {
      throw new ApiError(500, `failed to list paused production users: ${error.message}`);
    }

    let sent = 0;
    let blocked = 0;
    let failed = 0;

    for (const candidate of candidates ?? []) {
      const lang = resolveLanguage(candidate.telegram_language_code);
      const t = dictionaries[lang];
      const hashBalanceText = formatNumber(lang, candidate.hash_balance, { maximumFractionDigits: 2 });

      try {
        await sendTelegramMessage(candidate.telegram_id, t.notifications.productionPaused(hashBalanceText), {
          webAppButton: { text: t.notifications.openAppButton, url: appUrl },
        });

        const { error: markError } = await admin.rpc("mark_production_paused_notified", {
          p_user_id: candidate.profile_id,
        });
        if (markError) {
          // Повідомлення реально пішло, але позначку не записали — наступний
          // прогін міг би надіслати вдруге. Не критично (спам одним зайвим
          // Telegram-повідомленням, не гроші), але фіксуємо в лог для видимості.
          console.error(
            `[cron/production-notify] sent but failed to mark notified for ${candidate.profile_id}:`,
            markError,
          );
        }
        sent++;
      } catch (err) {
        if (err instanceof TelegramDeliveryBlockedError) {
          blocked++;
        } else {
          failed++;
          console.error(`[cron/production-notify] failed to notify ${candidate.telegram_id}:`, err);
        }
      }
    }

    return NextResponse.json({
      candidates: candidates?.length ?? 0,
      sent,
      blocked,
      failed,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
