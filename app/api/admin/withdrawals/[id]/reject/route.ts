import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAuth } from "@/lib/admin/auth";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { rpcErrorToApiError } from "@/lib/api/rpc";
import type { AdminRejectResponse } from "@/types/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RejectRequestBody {
  reason?: string;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminAuth();

    const { id } = await params;
    const body = await readJsonBody<RejectRequestBody>(request);

    if (!body.reason || body.reason.trim().length === 0) {
      throw new ApiError(400, "reason is required");
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .rpc("reject_withdrawal", { p_transaction_id: id, p_reason: body.reason.trim() })
      .single();

    if (error) throw rpcErrorToApiError(error);
    if (!data) throw new ApiError(500, "reject_withdrawal returned no data");

    const response: AdminRejectResponse = {
      transaction_id: data.transaction_id,
      status: data.status,
      refunded_amount: data.refunded_amount,
      withdrawable_balance: data.withdrawable_balance,
      withdrawal_quota: data.withdrawal_quota,
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
