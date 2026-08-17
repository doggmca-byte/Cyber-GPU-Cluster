"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

/**
 * Supabase-клієнт для браузера (Client Components).
 * Працює під публічним publishable-ключем — RLS без політик запису означає,
 * що звідси можна лише читати те, що дозволено явними SELECT-політиками
 * (наразі публічний лише прайс-лист gpu_templates).
 *
 * Усі баланс-мутуючі дії (buy_gpu, harvest_user_hash, exchange_hash_to_ton)
 * виконуються ТІЛЬКИ на бекенді через service_role-клієнт (Route Handler /
 * Server Action), після перевірки підпису Telegram initData.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
