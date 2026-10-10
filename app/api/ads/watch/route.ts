import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ВИМКНЕНО. Раніше цей роут просто інкрементував лічильник реклами й квоту
 * виводу за POST з валідним initData — без жодного доказу перегляду, тож
 * ліміт "20 реклам перед виводом" обходився прямим викликом API.
 *
 * Тепер реклама для виводу зараховується лише через S2S-постбек Monetag
 * (/api/ads/monetag/start-attempt -> /api/ads/monetag-postback).
 */
export async function POST() {
  return NextResponse.json({ error: "endpoint_disabled" }, { status: 410 });
}
