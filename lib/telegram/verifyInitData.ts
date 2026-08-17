import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { ApiError } from "@/lib/api/errors";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface VerifiedInitData {
  user: TelegramUser;
  startParam: string | null;
  authDate: number;
}

export class InitDataValidationError extends ApiError {
  constructor(message: string) {
    super(401, message);
    this.name = "InitDataValidationError";
  }
}

// Наскільки старий auth_date ще приймаємо. Telegram оновлює initData щоразу,
// коли Mini App відкривається/повертається на передній план.
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export function getTelegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new ApiError(500, "server misconfigured: TELEGRAM_BOT_TOKEN is not set");
  }
  return token;
}

/**
 * Криптографічна перевірка Telegram WebApp initData за офіційним алгоритмом:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key   = HMAC_SHA256(key="WebAppData", data=bot_token)
 *   computed_hash = HMAC_SHA256(key=secret_key, data=data_check_string)
 *
 * data_check_string — усі поля, крім hash, відсортовані за ключем і з'єднані
 * через "\n" у форматі "key=value" (значення — вже url-decoded).
 */
export function verifyInitData(initData: string, botToken: string): VerifiedInitData {
  if (!initData) {
    throw new InitDataValidationError("initData is empty");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new InitDataValidationError("initData missing hash");
  }
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const providedBuffer = Buffer.from(hash, "hex");
  const computedBuffer = Buffer.from(computedHash, "hex");

  const signatureValid =
    providedBuffer.length === computedBuffer.length &&
    timingSafeEqual(providedBuffer, computedBuffer);

  if (!signatureValid) {
    throw new InitDataValidationError("invalid initData signature");
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate)) {
    throw new InitDataValidationError("initData missing/invalid auth_date");
  }

  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) {
    throw new InitDataValidationError("initData expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    throw new InitDataValidationError("initData missing user field");
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw new InitDataValidationError("initData user field is not valid JSON");
  }

  if (typeof user?.id !== "number") {
    throw new InitDataValidationError("initData user.id is missing/invalid");
  }

  return {
    user,
    startParam: params.get("start_param"),
    authDate,
  };
}
