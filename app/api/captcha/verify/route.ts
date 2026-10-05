import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import { CAPTCHA_START_X, CAPTCHA_TOLERANCE } from "@/lib/captcha/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// людина не збирає пазл швидше за це
const MIN_SOLVE_MS = 700;
const MIN_DRAG_MS = 250;

interface VerifyBody {
  initData?: string;
  challenge_id?: string;
  x?: number;
  /** Траєкторія перетягування: [x, мс від початку жесту]. */
  path?: Array<[number, number]>;
}

/** Перевірка траєкторії: людський жест має кілька проміжних точок і нерівну швидкість. */
function looksHuman(path: Array<[number, number]> | undefined, finalX: number): boolean {
  if (!Array.isArray(path) || path.length < 6 || path.length > 600) return false;
  for (const p of path) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false;
  }
  const duration = path[path.length - 1][1] - path[0][1];
  if (duration < MIN_DRAG_MS || duration > 60_000) return false;
  // жест починається біля стартової позиції й закінчується там, де заявлено
  if (Math.abs(path[0][0] - CAPTCHA_START_X) > 6) return false;
  if (Math.abs(path[path.length - 1][0] - finalX) > 3) return false;

  const speeds: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const dt = path[i][1] - path[i - 1][1];
    if (dt < 0) return false;
    if (dt > 0) speeds.push(Math.abs(path[i][0] - path[i - 1][0]) / dt);
  }
  if (speeds.length < 4) return false;
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const variance = speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length;
  // ідеально рівна швидкість — ознака скрипта
  return variance > 1e-6;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<VerifyBody>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");
    if (!body.challenge_id || typeof body.challenge_id !== "string") {
      throw new ApiError(400, "challenge_id is required");
    }
    if (typeof body.x !== "number" || !Number.isFinite(body.x)) throw new ApiError(400, "x is required");

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    // Атомарно "спалюємо" виклик: одна спроба на один пазл, незалежно від результату.
    const { data: challenge, error: claimError } = await admin
      .from("captcha_challenges")
      .update({ used: true })
      .eq("id", body.challenge_id)
      .eq("user_id", profile.id)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .select("answer_x, created_at")
      .maybeSingle();
    if (claimError) throw new ApiError(500, `captcha claim failed: ${claimError.message}`);
    if (!challenge) throw new ApiError(400, "captcha_expired");

    const solveMs = Date.now() - Date.parse(challenge.created_at);
    const positionOk = Math.abs(body.x - challenge.answer_x) <= CAPTCHA_TOLERANCE;
    const ok = positionOk && solveMs >= MIN_SOLVE_MS && looksHuman(body.path, body.x);

    if (!ok) throw new ApiError(400, "captcha_failed");

    const verifiedAt = new Date().toISOString();
    const { error: solvedError } = await admin
      .from("captcha_challenges")
      .update({ solved: true })
      .eq("id", body.challenge_id);
    if (solvedError) console.error("[captcha] failed to mark solved:", solvedError.message);

    const { error: profileError } = await admin
      .from("profiles")
      .update({ captcha_verified_at: verifiedAt })
      .eq("id", profile.id);
    if (profileError) throw new ApiError(500, `failed to save verification: ${profileError.message}`);

    return NextResponse.json({ ok: true, verified_at: verifiedAt });
  } catch (error) {
    return handleRouteError(error);
  }
}
