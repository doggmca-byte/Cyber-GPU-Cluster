import "server-only";

function getAdminIds(): Set<string> {
  const raw = process.env.TELEGRAM_ADMIN_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

/**
 * Перевіряє, чи telegramId є в списку власників з TELEGRAM_ADMIN_IDS.
 * Порівняння завжди як нормалізований рядок — приймає number/string/bigint,
 * щоб виклик був однаково зручний і з JS number (Telegram user.id), і з
 * рядка (сесійна cookie), і з bigint (про всяк випадок для дуже великих ID).
 */
export function isTelegramAdmin(telegramId: number | string | bigint): boolean {
  const normalized = String(telegramId).trim();
  if (!normalized) return false;
  return getAdminIds().has(normalized);
}
