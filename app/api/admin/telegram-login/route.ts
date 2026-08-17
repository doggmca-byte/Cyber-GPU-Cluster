import { NextResponse } from "next/server";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { isTelegramAdmin } from "@/lib/admin/telegramAdmins";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionValue,
} from "@/lib/admin/session";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TelegramLoginRequestBody {
  initData?: string;
}

/**
 * Сценарій 1: адмінка відкрита всередині Telegram (window.Telegram.WebApp.initData
 * доступний). Криптографічно перевіряємо initData тим самим механізмом, що й
 * звичайні користувацькі роути (lib/telegram/verifyInitData.ts), і додатково
 * звіряємо user.id з TELEGRAM_ADMIN_IDS — жодних паролів.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<TelegramLoginRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const telegramId = String(user.id);

    if (!isTelegramAdmin(telegramId)) {
      throw new ApiError(403, "Your Telegram ID is not authorized");
    }

    const sessionValue = await createAdminSessionValue(telegramId);
    const response = NextResponse.json({ ok: true, telegram_id: telegramId });

    response.cookies.set(ADMIN_SESSION_COOKIE, sessionValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
