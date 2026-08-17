import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";

/**
 * Supabase-клієнт для Server Components / Route Handlers / Server Actions.
 * Так само працює під публічним publishable-ключем і підпорядкований RLS.
 *
 * Для привілейованих операцій (виклик RPC buy_gpu / harvest_user_hash /
 * exchange_hash_to_ton, яким EXECUTE дозволено лише ролі service_role) —
 * використовуй окремий admin-клієнт із SUPABASE_SERVICE_ROLE_KEY
 * (додається на етапі бекенд-роутів; ніколи не імпортувати service_role
 * ключ у код, що потрапляє в браузерний бандл).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Викликано з Server Component без можливості писати cookies —
            // безпечно ігнорувати, якщо сесію оновлює middleware.
          }
        },
      },
    },
  );
}
