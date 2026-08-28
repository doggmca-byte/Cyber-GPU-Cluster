import "server-only";
import { getTelegramChatInfo } from "@/lib/telegram/getChat";
import { RETENTION_NAME_TAG, type RetentionTaskType } from "@/lib/constants/retentionTasks";

export type ConditionCheckResult =
  | { met: true }
  | { met: false; reason: "tag_missing" | "bio_hidden_or_missing" | "check_failed" };

/**
 * Точно той самий формат, що генерує FriendsScreen.tsx для копіювання
 * (components/friends/FriendsScreen.tsx: `https://t.me/${BOT_USERNAME}
 * ?startapp=ref_${telegram_id}`) — ЄДИНЕ джерело правди для формату лінка,
 * інакше перевірка тут і те, що юзер реально копіює на екрані Друзі,
 * розійдуться.
 */
export function buildReferralLink(telegramId: number): string {
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
  return `https://t.me/${botUsername}?startapp=ref_${telegramId}`;
}

/**
 * Перевіряє УМОВУ ЗАРАЗ (тег в імені / реферальний лінк в біо) через
 * Telegram Bot API getChat. Fail-closed: мережевий збій чи "не вдалось
 * отримати чат" -> met:false (check_failed), НІКОЛИ met:true за замовчуванням
 * — той самий принцип, що й isChannelMember (lib/telegram/getChatMember.ts).
 */
export async function checkRetentionCondition(
  taskType: RetentionTaskType,
  telegramUserId: number,
): Promise<ConditionCheckResult> {
  const chat = await getTelegramChatInfo(telegramUserId);
  if (!chat.ok) return { met: false, reason: "check_failed" };

  if (taskType === "NAME_TAG") {
    const hasTag = chat.firstName.includes(RETENTION_NAME_TAG) || chat.lastName.includes(RETENTION_NAME_TAG);
    return hasTag ? { met: true } : { met: false, reason: "tag_missing" };
  }

  // BIO_LINK
  const referralLink = buildReferralLink(telegramUserId);
  const hasLink = chat.bio.includes(referralLink);
  return hasLink ? { met: true } : { met: false, reason: "bio_hidden_or_missing" };
}
