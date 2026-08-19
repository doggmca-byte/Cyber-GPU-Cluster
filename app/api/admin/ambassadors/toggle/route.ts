import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import type { AdminAmbassadorToggleResponse } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ToggleRequestBody {
  telegram_id?: number;
  is_ambassador?: boolean;
}

/** Призначає/знімає is_ambassador для вже існуючого профілю за telegram_id. */
export async function POST(request: Request) {
  try {
    await requireAdminAuth();

    const body = await readJsonBody<ToggleRequestBody>(request);
    const telegramId = body.telegram_id;
    if (typeof telegramId !== "number" || !Number.isFinite(telegramId) || telegramId <= 0) {
      throw new ApiError(400, "telegram_id must be a positive number");
    }
    if (typeof body.is_ambassador !== "boolean") {
      throw new ApiError(400, "is_ambassador must be a boolean");
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .update({ is_ambassador: body.is_ambassador })
      .eq("telegram_id", telegramId)
      .select("telegram_id, username, first_name, is_ambassador")
      .maybeSingle();

    if (error) {
      throw new ApiError(500, `failed to update profile: ${error.message}`);
    }

    if (!data) {
      throw new ApiError(404, "профіль не знайдено — користувач ще не відкривав застосунок");
    }

    const response: AdminAmbassadorToggleResponse = { profile: data };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
