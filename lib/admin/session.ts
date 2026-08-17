import "server-only";

/**
 * Підпис admin-сесії через Web Crypto API (crypto.subtle) замість Node
 * "crypto" — цей модуль імпортується і з Route Handlers (Node runtime), і з
 * middleware.ts (Edge runtime за замовчуванням), а Web Crypto доступний в
 * обох середовищах однаково.
 *
 * Токен сесії несе telegramId (не лише "хтось залогінився колись"), тому
 * requireAdminAuth() може на КОЖЕН запит звіряти його з живим
 * TELEGRAM_ADMIN_IDS — видалення ID зі списку миттєво анулює вже видані
 * сесії, а не лише блокує новий логін.
 */

export const ADMIN_SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 годин
export const ADMIN_SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

export interface AdminSession {
  telegramId: string;
  expiresAt: number;
}

function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not set");
  }
  return secret;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Порівняння без ранньої зупинки — уникає timing-атак навіть без Node crypto.timingSafeEqual. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bufferToHex(signature);
}

/** `<telegramId>.<expiresAtMs>.<hmac>` — hmac доводить, що значення не підроблене без ADMIN_SESSION_SECRET. */
export async function createAdminSessionValue(telegramId: string): Promise<string> {
  const secret = getSessionSecret();
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  const payload = `${telegramId}.${expiresAt}`;
  const signature = await signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export async function parseAdminSessionValue(
  value: string | undefined | null,
): Promise<AdminSession | null> {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;

  const [telegramId, expiresAtRaw, signature] = parts;
  if (!telegramId || !expiresAtRaw || !signature || !/^\d+$/.test(telegramId)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return null;
  }

  const expectedSignature = await signPayload(`${telegramId}.${expiresAtRaw}`, secret);
  if (!timingSafeEqualHex(signature, expectedSignature)) return null;

  return { telegramId, expiresAt };
}
