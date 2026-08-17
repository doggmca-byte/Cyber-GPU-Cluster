import { NextResponse } from "next/server";

/**
 * Уніфікована помилка API-маршруту з явним HTTP-статусом.
 * InitDataValidationError (lib/telegram/verifyInitData.ts) та RPC-помилки
 * (lib/api/rpc.ts) успадковуються від цього класу, тож усі роути можуть
 * ловити помилки одним catch-блоком через handleRouteError.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[api] unexpected error:", error);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
