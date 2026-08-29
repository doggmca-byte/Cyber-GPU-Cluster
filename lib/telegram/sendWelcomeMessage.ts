import "server-only";
import { getTelegramBotToken } from "./verifyInitData";
import { resolveLanguage } from "@/lib/i18n/resolveLanguage";
import { dictionaries } from "@/lib/i18n/dictionaries";

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
}

/**
 * Привітальне повідомлення на /start (app/api/telegram/webhook) — окремо
 * від sendTelegramMessage.ts (той лише plain text, тут потрібні медіа +
 * inline-кнопки). "Вступити в спільноту"/"Приєднатися до чату" — опційні,
 * рендеряться лише якщо задані TELEGRAM_COMMUNITY_URL/TELEGRAM_CHAT_URL
 * (той самий підхід, що й SupportButton.tsx з NEXT_PUBLIC_SUPPORT_URL —
 * кнопка просто не з'являється, доки лінк не налаштовано).
 *
 * Кнопка запуску гри — url-кнопка на https://t.me/<bot>?startapp=<payload>
 * (не web_app!), той самий формат, що вже реально видає FriendsScreen.tsx
 * для реферальних лінків — так Telegram сам відкриває це як Mini App і
 * коректно прокидає start_param у initData, навіть якщо /start був
 * викликаний з payload (класичний "t.me/bot?start=ref_123" рідше
 * використовується тут, ніж ?startapp=, але якщо хтось таки прийшов цим
 * шляхом — реферальна атрибуція не губиться).
 */
export async function sendWelcomeMessage(chatId: number, languageCode: string | undefined, startPayload: string | null) {
  const token = getTelegramBotToken();
  const lang = resolveLanguage(languageCode);
  const t = dictionaries[lang];

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
  const launchUrl = startPayload ? `https://t.me/${botUsername}?startapp=${startPayload}` : `https://t.me/${botUsername}`;

  const buttons: { text: string; url: string }[][] = [[{ text: t.notifications.welcomeLaunchButton, url: launchUrl }]];

  const communityUrl = process.env.TELEGRAM_COMMUNITY_URL;
  const chatUrl = process.env.TELEGRAM_CHAT_URL;
  const secondRow: { text: string; url: string }[] = [];
  if (communityUrl) secondRow.push({ text: t.notifications.welcomeCommunityButton, url: communityUrl });
  if (chatUrl) secondRow.push({ text: t.notifications.welcomeChatButton, url: chatUrl });
  if (secondRow.length > 0) buttons.push(secondRow);

  const reply_markup = { inline_keyboard: buttons };
  const mediaUrl = process.env.TELEGRAM_WELCOME_MEDIA_URL;
  const caption = `${t.notifications.welcomeTitle}\n\n${t.notifications.welcomeBody}`;

  let method: string;
  let body: Record<string, unknown>;

  if (mediaUrl) {
    const isVideoLike = /\.(gif|mp4)(\?|$)/i.test(mediaUrl);
    method = isVideoLike ? "sendAnimation" : "sendPhoto";
    body = {
      chat_id: chatId,
      [isVideoLike ? "animation" : "photo"]: mediaUrl,
      caption,
      reply_markup,
    };
  } else {
    method = "sendMessage";
    body = { chat_id: chatId, text: caption, reply_markup };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => null)) as TelegramApiResponse | null;
  if (!data?.ok) {
    throw new Error(`telegram ${method} failed: ${data?.description ?? `HTTP ${res.status}`}`);
  }
}
