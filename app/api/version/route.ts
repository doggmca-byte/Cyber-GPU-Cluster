import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ідентифікатор деплою, який зараз обслуговує прод. VersionWatcher запам'ятовує
 * його при старті сторінки і порівнює при кожному поверненні з фону: інше
 * значення означає, що гравець досі крутить JS із попереднього деплою.
 *
 * На Vercel це VERCEL_DEPLOYMENT_ID — унікальний для кожного деплою й
 * однаковий для всіх його інстансів. Локально — ідентифікатор збірки з
 * next.config.mjs.
 */
export async function GET() {
  const buildId = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.NEXT_PUBLIC_BUILD_ID ?? null;
  return NextResponse.json({ build_id: buildId }, { headers: { "Cache-Control": "no-store" } });
}
