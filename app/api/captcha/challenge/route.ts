import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInitData, getTelegramBotToken } from "@/lib/telegram/verifyInitData";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";
import { requireProfileByTelegramId } from "@/lib/api/profile";
import {
  CAPTCHA_LOGICAL_HEIGHT,
  CAPTCHA_LOGICAL_WIDTH,
  CAPTCHA_PIECE_SIZE,
  CAPTCHA_START_X,
  renderCaptcha,
} from "@/lib/captcha/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const WINDOW_MS = 10 * 60 * 1000;
// не більше стільки викликів і невдалих спроб за вікно — інакше пауза (429)
const MAX_CHALLENGES_PER_WINDOW = 12;
const MAX_FAILURES_PER_WINDOW = 8;

/** Видає новий пазл. Правильна відповідь зберігається лише в БД і до клієнта не йде. */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ initData?: string }>(request);
    if (!body.initData) throw new ApiError(400, "initData is required");

    const { user } = verifyInitData(body.initData, getTelegramBotToken());
    const admin = createAdminClient();
    const profile = await requireProfileByTelegramId(admin, user.id);

    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data: recent, error: recentError } = await admin
      .from("captcha_challenges")
      .select("used, solved")
      .eq("user_id", profile.id)
      .gte("created_at", since);
    if (recentError) throw new ApiError(500, `captcha lookup failed: ${recentError.message}`);

    const failures = (recent ?? []).filter((r) => r.used && !r.solved).length;
    if ((recent?.length ?? 0) >= MAX_CHALLENGES_PER_WINDOW || failures >= MAX_FAILURES_PER_WINDOW) {
      throw new ApiError(429, "too_many_attempts");
    }

    // Прибираємо старі виклики цього користувача (таблиця не росте).
    await admin
      .from("captcha_challenges")
      .delete()
      .eq("user_id", profile.id)
      .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const rendered = renderCaptcha();
    const { data: row, error: insertError } = await admin
      .from("captcha_challenges")
      .insert({
        user_id: profile.id,
        answer_x: rendered.answerX,
        expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      })
      .select("id")
      .single();
    if (insertError || !row) throw new ApiError(500, `captcha create failed: ${insertError?.message}`);

    return NextResponse.json({
      challenge_id: row.id,
      background: rendered.background,
      piece: rendered.piece,
      width: CAPTCHA_LOGICAL_WIDTH,
      height: CAPTCHA_LOGICAL_HEIGHT,
      piece_size: CAPTCHA_PIECE_SIZE,
      start_x: CAPTCHA_START_X,
      expires_in_ms: CHALLENGE_TTL_MS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
