import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

let cachedClient: SupabaseClient<Database> | null = null;

/**
 * Шлюз Supabase зрідка відповідає 502/503/504 навіть на найпростіший запит
 * (аудит 12.09: 130 з 30 165 звернень за добу = 0.43%, причому таймаутили і
 * "profiles by telegram_id", і "gpu_templates" — тобто це не повільні запити,
 * самі вони йдуть <1 мс, а гикавка інфраструктури).
 *
 * Для гравця це виглядало значно гірше за 0.43%: один вхід у гру робить
 * ~6 звернень до БД, і будь-яке з них, впавши, давало 500 на /api/user/sync
 * і червоний екран "Проблема зі з'єднанням" замість гри.
 */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [150, 500];

/**
 * Повторюємо ЛИШЕ ідемпотентні читання (GET/HEAD). RPC і записи йдуть POST/
 * PATCH: 504 означає, що відповідь не дійшла, а не що операція не виконалась,
 * тож автоматичний повтор міг би, наприклад, списати кошти двічі.
 */
async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isIdempotentRead = method === "GET" || method === "HEAD";

  for (let attempt = 0; ; attempt += 1) {
    const isLastAttempt = attempt >= RETRY_DELAYS_MS.length;

    try {
      const response = await fetch(input, init);
      if (!isIdempotentRead || isLastAttempt || !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }
      // Вичитуємо тіло, щоб з'єднання повернулось у пул, а не висіло до GC.
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      // AbortError — це усвідомлене скасування (таймаут викликача), не збій мережі.
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (!isIdempotentRead || isLastAttempt || isAbort) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

/**
 * Адмін-клієнт Supabase на service_role ключі.
 *
 * Обходить RLS і має EXECUTE на захищені RPC (buy_gpu / harvest_user_hash /
 * exchange_hash_to_ton) — саме тому вони недоступні anon/authenticated ролям
 * (див. supabase/migrations/20260816205809_restrict_rpc_to_service_role.sql).
 *
 * Використовувати ЛИШЕ в серверному коді (Route Handlers / Server Actions).
 * Пакет "server-only" зробить помилку збірки, якщо цей файл випадково
 * потрапить у клієнтський бандл.
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  cachedClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchWithRetry },
  });

  return cachedClient;
}
