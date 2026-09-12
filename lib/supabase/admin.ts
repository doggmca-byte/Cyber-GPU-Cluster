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
const RETRY_DELAYS_MS = [150, 400];

/**
 * Власний таймаут читання. Виміряно 12.09: здорова відповідь приходить за
 * 111 мс (p95 — 470 мс), а невдала висить 5.1 с і лише потім віддає 504.
 * Тобто чекати на чужий таймаут — це подарувати 5 секунд нізащо: дешевше
 * обірвати на 2.5 с (у п'ять разів більше за p95) і перепитати, бо повтор
 * майже завжди відповідає за ті самі 111 мс.
 */
const READ_TIMEOUT_MS = 2500;

/**
 * Повторюємо і обриваємо по таймауту ЛИШЕ ідемпотентні читання (GET/HEAD) —
 * це 80% усіх збоїв. RPC і записи йдуть POST/PATCH і не чіпаються взагалі:
 * 504 там означає, що загубилась відповідь, а не що операція не виконалась,
 * тож і повтор, і обрив могли б списати кошти двічі або лишити транзакцію
 * в невизначеному стані.
 */
async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isIdempotentRead = method === "GET" || method === "HEAD";

  if (!isIdempotentRead) return fetch(input, init);

  const callerSignal = init?.signal ?? null;

  for (let attempt = 0; ; attempt += 1) {
    const isLastAttempt = attempt >= RETRY_DELAYS_MS.length;

    // Скасування від викликача і наш таймаут — різні речі: перше означає
    // "результат більше не потрібен" (повторювати нема сенсу), друге —
    // "сервер задумався, спробуймо ще раз".
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), READ_TIMEOUT_MS);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const response = await fetch(input, { ...init, signal });
      if (isLastAttempt || !RETRYABLE_STATUSES.has(response.status)) return response;
      // Вичитуємо тіло, щоб з'єднання повернулось у пул, а не висіло до GC.
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      if (callerSignal?.aborted) throw error;
      if (isLastAttempt) throw error;
    } finally {
      clearTimeout(timeoutId);
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
