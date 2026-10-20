import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Скільки реклами AdsGram гравець отримав за поточну добу UTC — кожен
 * постбек AdsGram (rewarded чи Task, зарахований чи відхилений) лишає рядок
 * у ad_verification_attempts, тож це і є лічильник показів, які бачить сам
 * AdsGram. При помилці читання повертає null — вирішує виклик.
 */
export async function countAdsgramToday(admin: SupabaseClient<Database>, userId: string): Promise<number | null> {
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const { count, error } = await admin
    .from("ad_verification_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("provider", "adsgram")
    .gte("created_at", dayStart);
  if (error) return null;
  return count ?? 0;
}
