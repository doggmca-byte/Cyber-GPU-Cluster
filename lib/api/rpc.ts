import type { PostgrestError } from "@supabase/supabase-js";
import { ApiError } from "./errors";

/**
 * Мапить помилки наших RPC (buy_gpu / harvest_user_hash / exchange_hash_to_ton)
 * на HTTP-статуси за errcode, який ми самі проставляємо в SQL через
 * `USING ERRCODE = ...`:
 *   P0001 — порушення бізнес-правила (недостатньо коштів, ліміт карток,
 *           замала сума обміну тощо) -> 400
 *   P0002 — профіль/шаблон не знайдено -> 404
 *   інше  — непередбачена помилка бази -> 500
 */
export function rpcErrorToApiError(error: PostgrestError): ApiError {
  if (error.code === "P0001") return new ApiError(400, error.message);
  if (error.code === "P0002") return new ApiError(404, error.message);
  return new ApiError(500, `database_error: ${error.message}`);
}
