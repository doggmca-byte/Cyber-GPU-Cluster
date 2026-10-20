import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Денний ліміт партнерської реклами — 20. Джерело правди мало б бути в
 * record_partner_ad_watch (20261020120000_partner_ads_limit_20_and_task_rewards.sql),
 * але поки ця міграція не застосована (у БД ще 30), той самий ліміт
 * перевіряємо тут перед кожним викликом RPC. Повертає помилку у формі
 * PostgrestError з кодом P0001 — як сама RPC, — тож усі виклики обробляють
 * її тим самим кодом, що й "ліміт вичерпано" від БД.
 */
export const PARTNER_AD_DAILY_LIMIT = 20;

export async function partnerAdLimitError(
  admin: SupabaseClient<Database>,
  userId: string,
  bypassLimit: boolean,
): Promise<PostgrestError | null> {
  if (bypassLimit) return null;

  const { data, error } = await admin
    .from("profiles")
    .select("partner_ads_watched_today, partner_ads_reset_date")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null; // нехай вирішує сама RPC

  const today = new Date().toISOString().slice(0, 10);
  const watched = data.partner_ads_reset_date === today ? data.partner_ads_watched_today : 0;
  if (watched < PARTNER_AD_DAILY_LIMIT) return null;

  return {
    name: "PostgrestError",
    code: "P0001",
    message: `daily partner ad limit reached (${PARTNER_AD_DAILY_LIMIT}/${PARTNER_AD_DAILY_LIMIT}) — try again tomorrow`,
    details: "",
    hint: "",
  } as PostgrestError;
}
