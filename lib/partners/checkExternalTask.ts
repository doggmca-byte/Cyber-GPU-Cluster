import "server-only";

/**
 * partner_api_check — реальний pull-формат мережі партнерів (Cookie Wars,
 * Crybble): task_templates.target_value зберігає JSON із двома значеннями,
 * бо на відміну від external_link/telegram_channel тут потрібні ОБИДВА —
 * куди відкрити (open_url) і де перевірити (check_url).
 */
export interface PartnerApiCheckConfig {
  open_url: string;
  /** Включно з "telegram_id=" у кінці — сам telegram_id дописується напряму, без плейсхолдера. */
  check_url: string;
}

export function parsePartnerApiCheckConfig(targetValue: string): PartnerApiCheckConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(targetValue);
  } catch {
    throw new Error("target_value is not valid JSON for partner_api_check");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj?.open_url !== "string" || typeof obj?.check_url !== "string") {
    throw new Error("target_value must have string open_url and check_url");
  }

  return { open_url: obj.open_url, check_url: obj.check_url };
}

interface PartnerCheckApiResponse {
  success?: boolean;
}

/**
 * Викликає зовнішній check-API партнера: GET {check_url}{telegram_id} ->
 * {"success": true|false}. Мережева помилка, таймаут чи неочікувана форма
 * відповіді -> false, НІКОЛИ true — той самий принцип, що й
 * isChannelMember (lib/telegram/getChatMember.ts): "не вдалось перевірити"
 * не повинно трактуватись як "виконано". 8-секундний таймаут — партнерський
 * сервер нам не підконтрольний, роут /api/tasks/verify не має зависати
 * через чужу повільну відповідь.
 */
export async function checkPartnerApiTask(config: PartnerApiCheckConfig, telegramId: number): Promise<boolean> {
  const url = `${config.check_url}${telegramId}`;

  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;

    const body = (await res.json()) as PartnerCheckApiResponse;
    return body.success === true;
  } catch {
    return false;
  }
}
