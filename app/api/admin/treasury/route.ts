import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin/auth";
import { handleRouteError } from "@/lib/api/errors";
import { getTreasuryBalanceTon } from "@/lib/ton/treasury";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AdminTreasuryResponse {
  balance_ton: number;
}

export async function GET() {
  try {
    await requireAdminAuth();

    const balance_ton = await getTreasuryBalanceTon();
    const response: AdminTreasuryResponse = { balance_ton };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
