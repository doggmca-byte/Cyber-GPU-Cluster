import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import type { AdminAmbassadorsListResponse } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Таблиця вже призначених амбасадорів для вкладки "Амбасадори". */
export async function GET() {
  try {
    await requireAdminAuth();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("telegram_id, username, first_name, is_ambassador")
      .eq("is_ambassador", true)
      .order("telegram_id", { ascending: true });

    if (error) {
      throw new ApiError(500, `failed to load ambassadors: ${error.message}`);
    }

    const response: AdminAmbassadorsListResponse = { items: data ?? [] };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
