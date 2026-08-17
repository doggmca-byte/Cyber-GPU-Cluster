import "server-only";
import { getTelegramBotToken } from "./verifyInitData";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface ChatMemberResult {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
}

// "left"/"kicked" — користувач НЕ підписаний; усе інше вважаємо активним членством.
const ACTIVE_MEMBER_STATUSES = new Set<ChatMemberResult["status"]>([
  "creator",
  "administrator",
  "member",
  "restricted",
]);

/**
 * Перевіряє підписку користувача на Telegram-канал/чат через Bot API getChatMember.
 * chatId — @username каналу (бот МАЄ бути учасником/адміном каналу, інакше Telegram
 * поверне ok:false, а не помилку HTTP).
 *
 * Повертає false і при негативній відповіді Telegram, і при мережевій помилці —
 * викликач ніколи не повинен трактувати "не вдалось перевірити" як "підписаний".
 */
export async function isChannelMember(chatId: string, telegramUserId: number): Promise<boolean> {
  const token = getTelegramBotToken();
  const url = new URL(`https://api.telegram.org/bot${token}/getChatMember`);
  url.searchParams.set("chat_id", chatId);
  url.searchParams.set("user_id", String(telegramUserId));

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const body = (await res.json()) as TelegramApiResponse<ChatMemberResult>;
    if (!body.ok || !body.result) return false;
    return ACTIVE_MEMBER_STATUSES.has(body.result.status);
  } catch {
    return false;
  }
}
