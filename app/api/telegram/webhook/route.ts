import { NextResponse } from "next/server";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { sendWelcomeMessage } from "@/lib/telegram/sendWelcomeMessage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TelegramUpdate } from "@/lib/telegram/webhookTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram Bot API webhook — приймає ВСІ вхідні update'и (Telegram сам
 * викликає це, коли щось стається в чаті з ботом; реєструється один раз
 * через setWebhook, secret_token = TELEGRAM_WEBHOOK_SECRET). Наразі
 * оброблює лише /start — надсилає привітальне повідомлення з кнопками
 * (sendWelcomeMessage.ts). Усе інше в update'і мовчки ігнорується.
 *
 * Секрет перевіряється заголовком X-Telegram-Bot-Api-Secret-Token (Telegram
 * сам додає його до КОЖНОГО запиту, якщо secret_token переданий у
 * setWebhook) — без цього будь-хто міг би слати нам підроблені "update"
 * і змушувати бота розсилати повідомлення від нашого імені.
 *
 * Завжди повертає 200 (ok:true), навіть якщо обробка впала — не 401/500,
 * інакше Telegram агресивно ретраїть і зрештою може призупинити webhook
 * після серії failures. Єдиний non-200 — саме невалідний secret (той
 * випадок НІКОЛИ не станеться для справжнього трафіку від Telegram, лише
 * для підробленого).
 */
export async function POST(request: Request) {
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("[telegram/webhook] TELEGRAM_WEBHOOK_SECRET is not set");
    return NextResponse.json({ ok: true });
  }
  if (secretHeader !== expectedSecret) {
    return handleRouteError(new ApiError(401, "invalid webhook secret"));
  }

  try {
    const update = await readJsonBody<TelegramUpdate>(request);
    const message = update.message;
    const text = message?.text;

    // Будь-який вхідний апдейт означає, що бот НЕ заблокований: щоб написати
    // йому, користувач мусив спершу зняти блокування. Знімаємо прапорець, щоб
    // людина повернулась у розсилки — інакше вона лишилась би виключеною
    // назавжди після одного давнього 403.
    if (message?.from?.id) {
      const admin = createAdminClient();
      const { error } = await admin.rpc("set_bot_blocked_by_telegram_id", {
        p_telegram_id: message.from.id,
        p_blocked: false,
      });
      if (error) {
        console.error("[telegram/webhook] failed to clear is_bot_blocked:", error);
      }
    }

    if (message && text?.startsWith("/start")) {
      const payload = text.slice("/start".length).trim();
      await sendWelcomeMessage(message.chat.id, message.from?.language_code, payload || null);
    }
  } catch (error) {
    console.error("[telegram/webhook] failed to process update:", error);
  }

  return NextResponse.json({ ok: true });
}
