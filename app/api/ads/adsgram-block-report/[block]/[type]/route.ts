import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLOCK_RE = /^\d{1,10}$/;
const TYPES = new Set(["int", "task"]);

/**
 * Діагностика: клієнт повідомляє, що AdsGram повернув для блоку тип
 * Interstitial ("int") або Task ("task") замість Reward. Нічого не пишемо в БД —
 * лише один рядок у runtime-логах Vercel (і сам шлях запиту), з якого видно,
 * які id треба внести в NEXT_PUBLIC_ADSGRAM_INACTIVE_BLOCK_IDS. Викликається
 * не частіше разу на пристрій для кожного блоку.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ block: string; type: string }> }) {
  const { block, type } = await params;

  if (BLOCK_RE.test(block) && TYPES.has(type)) {
    console.warn(`[adsgram-block-report] block=${block} type=${type}`);
  }

  return new NextResponse(null, { status: 204 });
}
