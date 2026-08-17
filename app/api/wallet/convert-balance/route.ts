import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { ConvertBalanceResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Withdrawable -> Game, курс 1:1 (convert_withdrawable_to_game у БД).
// Зворотного напрямку (Game -> Withdrawable) немає навмисно: ігровий баланс
// не повинен конвертуватись у виводимий інакше, ніж через видобуток $HASH.
interface ConvertBalanceRequestBody {
  initData?: string;
  amount?: number;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ConvertBalanceRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const amount = body.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new ApiError(400, "amount must be a positive number");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("convert_withdrawable_to_game", { p_user_id: profile.id, p_amount: amount })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "convert_withdrawable_to_game returned no data");

    const response: ConvertBalanceResponse = {
      withdrawable_balance: data.withdrawable_balance,
      game_balance: data.game_balance,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
