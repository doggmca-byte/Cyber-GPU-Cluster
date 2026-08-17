import "server-only";
import { cookies } from "next/headers";
import { ApiError } from "@/lib/api/errors";
import { ADMIN_SESSION_COOKIE, parseAdminSessionValue } from "./session";
import { isTelegramAdmin } from "./telegramAdmins";

export interface AdminIdentity {
  telegramId: string;
}

/**
 * Основний рубіж захисту для /api/admin/* Route Handlers (крім самого
 * /api/admin/telegram-login) — викликається явно в кожному з них, а не лише
 * покладається на middleware.ts.
 *
 * Перевіряє ЖИВИЙ статус адміна на кожен запит, а не лише на момент логіну:
 * видалення telegramId з TELEGRAM_ADMIN_IDS миттєво анулює вже видані сесії,
 * навіть якщо підпис cookie ще математично валідний.
 */
export async function requireAdminAuth(): Promise<AdminIdentity> {
  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const parsed = await parseAdminSessionValue(session);

  if (!parsed) {
    throw new ApiError(401, "admin authentication required");
  }

  if (!isTelegramAdmin(parsed.telegramId)) {
    throw new ApiError(403, "Your Telegram ID is not authorized");
  }

  return { telegramId: parsed.telegramId };
}
