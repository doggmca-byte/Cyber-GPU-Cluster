import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActivateTaskBody {
  title_key?: string;
}

/**
 * Вузько-спеціалізований ендпоінт: активує ОДИН task_templates-рядок за
 * title_key (is_active = true). Створено спеціально для того, щоб не
 * передавати SUPABASE_SERVICE_ROLE_KEY (повний доступ до БД) у промпт
 * хмарної routine (schedule skill) — cloud-агенти не мають доступу до MCP
 * цієї сесії й локальних env, тож для відкладеної активації (напр.
 * "активувати завдання партнера через 5 годин") їм потрібен ЯКИЙСЬ ключ, і
 * TASK_ACTIVATE_SECRET навмисно вузький: навіть якщо він колись витече
 * (лишається в збереженій конфігурації routine), зловживання ним обмежене
 * рівно одним типом дії — увімкнути вже наперед створене завдання, жодного
 * доступу до балансів/виводів/іншого.
 *
 * Навмисно НЕ під /api/admin/ — middleware.ts глобально гейтить увесь той
 * простір Telegram-сесією адмінки (cookie), що конфліктувало б із власною
 * bearer-перевіркою нижче й взагалі не пропустило б запит до цього коду.
 */
export async function POST(request: Request) {
  try {
    const secretHeader = request.headers.get("authorization");
    const expectedSecret = process.env.TASK_ACTIVATE_SECRET;
    if (!expectedSecret) throw new ApiError(500, "server misconfigured: TASK_ACTIVATE_SECRET is not set");
    if (secretHeader !== `Bearer ${expectedSecret}`) throw new ApiError(401, "invalid secret");

    const body = await readJsonBody<ActivateTaskBody>(request);
    if (!body.title_key) throw new ApiError(400, "title_key is required");

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("task_templates")
      .update({ is_active: true })
      .eq("title_key", body.title_key)
      .select("id, title_key, is_active")
      .maybeSingle();

    if (error) throw new ApiError(500, `failed to activate task: ${error.message}`);
    if (!data) throw new ApiError(404, `no task_templates row with title_key=${body.title_key}`);

    return NextResponse.json({ ok: true, task: data });
  } catch (error) {
    return handleRouteError(error);
  }
}
