import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { ApiError } from "@/lib/api/errors";

type GpuTemplate = Database["public"]["Tables"]["gpu_templates"]["Row"];

/**
 * Каталог обладнання читається на КОЖЕН вхід у гру і на кожну покупку, хоча
 * змінюється лише міграцією — тобто раз на тижні. Тримаємо його в пам'яті
 * інстансу: це мінус одне звернення до Supabase на кожен sync (12 із 130
 * добових таймаутів шлюзу припадали саме на gpu_templates) і мінус ~110 мс
 * до входу в гру.
 */
const TTL_MS = 5 * 60 * 1000;

let cache: { templates: GpuTemplate[]; loadedAt: number } | null = null;

export async function loadGpuTemplates(admin: SupabaseClient<Database>): Promise<GpuTemplate[]> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.templates;

  const { data, error } = await admin.from("gpu_templates").select("*").order("level");

  if (error || !data) {
    // Каталог статичний, тож протермінована копія майже напевно актуальна —
    // вона незрівнянно краща за зірваний вхід у гру. Без цього гикавка шлюзу
    // Supabase рівно в момент протермінування кешу знову дала б 500.
    if (cache) {
      console.error("[gpu-templates] refresh failed, serving cached copy:", error?.message);
      return cache.templates;
    }
    throw new ApiError(500, `failed to load gpu_templates: ${error?.message ?? "no data"}`);
  }

  cache = { templates: data, loadedAt: Date.now() };
  return data;
}
