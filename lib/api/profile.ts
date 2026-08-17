import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { ApiError } from "./errors";

type AdminClient = SupabaseClient<Database>;
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export async function findProfileByTelegramId(
  admin: AdminClient,
  telegramId: number,
): Promise<Profile | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, `failed to load profile: ${error.message}`);
  }

  return data;
}

/** Для роутів, що вимагають вже існуючого профілю (harvest/buy/exchange). */
export async function requireProfileByTelegramId(
  admin: AdminClient,
  telegramId: number,
): Promise<Profile> {
  const profile = await findProfileByTelegramId(admin, telegramId);
  if (!profile) {
    throw new ApiError(404, "profile not found — call /api/user/sync first");
  }
  return profile;
}
