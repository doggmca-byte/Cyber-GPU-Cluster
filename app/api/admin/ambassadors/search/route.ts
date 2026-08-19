import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import type { AdminAmbassadorProfile } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Пошук користувача за telegram_id перед призначенням/зняттям is_ambassador —
 * адмін бачить поточний статус ще ДО того, як тисне перемикач. Профіль має вже
 * існувати (створюється лише через app/api/user/sync/route.ts при першому
 * відкритті застосунку) — інакше 404 з поясненням, а не мовчазний "не знайдено".
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth();

    const raw = request.nextUrl.searchParams.get("telegram_id");
    const telegramId = Number(raw);
    if (!raw || !Number.isFinite(telegramId) || telegramId <= 0) {
      throw new ApiError(400, "telegram_id must be a positive number");
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("telegram_id, username, first_name, is_ambassador")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (error) {
      throw new ApiError(500, `failed to load profile: ${error.message}`);
    }

    if (!data) {
      throw new ApiError(404, "профіль не знайдено — користувач ще не відкривав застосунок");
    }

    const response: AdminAmbassadorProfile = data;
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
