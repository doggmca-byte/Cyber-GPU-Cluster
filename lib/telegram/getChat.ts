import "server-only";
import { getTelegramBotToken } from "./verifyInitData";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface ChatResult {
  first_name?: string;
  last_name?: string;
  /**
   * Присутнє лише якщо приватність "Bio" в користувача дозволяє ботам його
   * бачити — Telegram НЕ повідомляє причину відсутності (просто немає
   * встановленого біо VS приховано налаштуваннями), тому й ми цього не
   * розрізняємо, лише показуємо однакову підказку в обох випадках.
   */
  bio?: string;
}

export type ChatInfoResult =
  | { ok: true; firstName: string; lastName: string; bio: string }
  | { ok: false };

/**
 * getChat через Bot API — працює лише для telegram_id, що вже хоч раз
 * запускав бота (є профіль у нас = гарантовано мав /start, інакше initData
 * взагалі не могло б підписатись цим ботом). Fail-closed: будь-яка мережева
 * помилка чи ok:false -> { ok: false }, ВИКЛИКАЧ ніколи не повинен
 * трактувати це як "умова виконана".
 */
export async function getTelegramChatInfo(telegramUserId: number): Promise<ChatInfoResult> {
  const token = getTelegramBotToken();
  const url = new URL(`https://api.telegram.org/bot${token}/getChat`);
  url.searchParams.set("chat_id", String(telegramUserId));

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const body = (await res.json()) as TelegramApiResponse<ChatResult>;
    if (!body.ok || !body.result) return { ok: false };

    return {
      ok: true,
      firstName: body.result.first_name ?? "",
      lastName: body.result.last_name ?? "",
      bio: body.result.bio ?? "",
    };
  } catch {
    return { ok: false };
  }
}
