import "server-only";
import { getTelegramBotToken } from "./verifyInitData";

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
}

export interface SendTelegramMessageOptions {
  /** Текст кнопки, що відкриває Mini App напряму (web_app), під повідомленням. */
  webAppButton?: { text: string; url: string };
}

/**
 * Кидається, коли Telegram відповів ok:false з кодом, що означає "цьому
 * користувачу вже НІКОЛИ не можна написати" (403 — заблокував бота/видалив
 * акаунт/деактивований), на відміну від тимчасових збоїв (мережа, 5xx,
 * rate-limit). Викликач (cron-роут) розрізняє ці два випадки: перманентну
 * помилку безпечно ігнорувати назавжди для цього юзера, тимчасову — лишити
 * "не сповіщеним", щоб наступний прогін cron спробував ще раз.
 */
export class TelegramDeliveryBlockedError extends Error {}

/**
 * Надсилає повідомлення від бота конкретному telegram_id (Bot API
 * sendMessage) — НЕ пов'язано з Mini App initData/WebApp SDK, окремий шлях:
 * бот сам ініціює розмову з користувачем (можливо лише якщо той хоч раз
 * запускав бота — інакше Telegram поверне 400 "chat not found").
 */
export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options: SendTelegramMessageOptions = {},
): Promise<void> {
  const token = getTelegramBotToken();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };

  if (options.webAppButton) {
    body.reply_markup = {
      inline_keyboard: [[{ text: options.webAppButton.text, web_app: { url: options.webAppButton.url } }]],
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => null)) as TelegramApiResponse | null;

  if (!data?.ok) {
    const description = data?.description ?? `HTTP ${res.status}`;
    // 403 — бот заблокований/чат недоступний назавжди. Деякі 400-помилки
    // ("chat not found", "user is deactivated") теж перманентні за суттю,
    // але текст опису не строго стандартизований Telegram — розрізняємо
    // лише за офіційним error_code 403, щоб не сплутати з тимчасовим 400
    // (напр. malformed request через наш власний баг, який МАЄ ретраїтись
    // після фіксу, а не тихо позначатись як "заблокований назавжди").
    if (data?.error_code === 403) {
      throw new TelegramDeliveryBlockedError(description);
    }
    throw new Error(`telegram sendMessage failed: ${description}`);
  }
}
