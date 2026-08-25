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

/**
 * Той самий getChatMember, але триcтатусний — потрібен для штрафу за
 * відписку (apply_channel_unsubscribe_penalty): isChannelMember вище
 * навмисно fail-closed ("не вдалось перевірити" -> не підписаний), бо це
 * правильно для НАГОРОДИ (не нагороджувати за сумнів). Для ШТРАФУ логіка
 * має бути протилежна — мережевий збій чи неоднозначна відповідь Telegram
 * НЕ повинні трактуватись як "відписався", інакше тимчасовий збій Bot API
 * міг би оштрафувати чесного підписника. Тому тут — окремий "unknown"
 * статус, і штраф застосовується лише на явному "not_member".
 */
export async function checkChannelMembershipStatus(
  chatId: string,
  telegramUserId: number,
): Promise<"member" | "not_member" | "unknown"> {
  const token = getTelegramBotToken();
  const url = new URL(`https://api.telegram.org/bot${token}/getChatMember`);
  url.searchParams.set("chat_id", chatId);
  url.searchParams.set("user_id", String(telegramUserId));

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const body = (await res.json()) as TelegramApiResponse<ChatMemberResult>;
    if (!body.ok || !body.result) return "unknown";
    return ACTIVE_MEMBER_STATUSES.has(body.result.status) ? "member" : "not_member";
  } catch {
    return "unknown";
  }
}
