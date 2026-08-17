import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { ClaimReferralResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClaimRequestBody {
  initData?: string;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ClaimRequestBody>(request);
    if (!body.initData) {
      throw new ApiError(400, "initData is required");
    }

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const { data, error } = await admin
      .rpc("claim_referral_rewards", { p_user_id: profile.id })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "claim_referral_rewards returned no data");

    const response: ClaimReferralResponse = {
      claimed_amount: data.claimed_amount,
      withdrawable_balance: data.withdrawable_balance,
      server_time: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
