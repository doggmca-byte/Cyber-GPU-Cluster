import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type SponsorSource = "adsgram_task" | "tads";

/**
 * Нагорода за спонсорське завдання (AdsGram Task / TADS) — без денного ліміту
 * і без лічильника партнерської реклами (record_sponsor_task_reward,
 * 20261020140000_sponsor_task_reward.sql). AdsGram Task — 0.0005 TON і не більше
 * 8 на годину (20261022090000_...); понад ліміт RPC повертає P0001. Поки міграція не застосована
 * (PGRST202 — функції немає), падаємо на record_partner_ad_watch з обходом
 * ліміту: нагорода та сама, лише лічильник переглядів зросте.
 */
export async function creditSponsorReward(
  admin: SupabaseClient<Database>,
  userId: string,
  source: SponsorSource,
): Promise<{ error: PostgrestError | null }> {
  // Функції ще немає в згенерованих типах — звідси приведення.
  const rpc = admin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: PostgrestError | null }>;
  const { error } = await rpc.call(admin, "record_sponsor_task_reward", { p_user_id: userId, p_source: source });
  if (error?.code !== "PGRST202") return { error };

  const fallback = await admin.rpc("record_partner_ad_watch", { p_user_id: userId, p_bypass_limit: true });
  return { error: fallback.error };
}
