import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { HarvestResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HarvestRequestBody {
  initData?: string;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<HarvestRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data: harvested, error: harvestError } = await admin.rpc("harvest_user_hash", {
      p_user_id: profile.id,
    });

    if (harvestError) throw rpcErrorToApiError(harvestError);

    const { data: fresh, error: profileError } = await admin
      .from("profiles")
      .select("hash_balance, game_balance, withdrawable_balance")
      .eq("id", profile.id)
      .single();

    if (profileError || !fresh) {
      throw new ApiError(
        500,
        `failed to load updated balances: ${profileError?.message ?? "unknown"}`,
      );
    }

    const response: HarvestResponse = {
      harvested: Number(harvested ?? 0),
      hash_balance: fresh.hash_balance,
      game_balance: fresh.game_balance,
      withdrawable_balance: fresh.withdrawable_balance,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
