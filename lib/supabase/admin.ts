import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

let cachedClient: SupabaseClient<Database> | null = null;

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
  });

  return cachedClient;
}
