import "server-only";

/**
 * partner_api_check — реальний pull-формат мережі партнерів (Cookie Wars,
 * Crybble, TheiTerra): task_templates.target_value зберігає JSON, бо на
 * відміну від external_link/telegram_channel тут потрібні відразу кілька
 * значень — куди відкрити (open_url) і де перевірити (check_url), а деякі
 * партнери (TheiTerra) ще й вимагають авторизаційний заголовок і мають
 * ІНШУ форму відповіді за замовчуванням ({"success": true|false} у
 * Cookie Wars/Crybble, {"data": {"registeredAt": ...}} у TheiTerra).
 *
 * header_env_key — це ІМ'Я змінної оточення (напр. "THEITERRA_API_KEY"), а
 * НЕ сам секрет — target_value повністю йде клієнту у відповіді /api/tasks
 * (потрібен для кнопки "Відкрити"), тож справжнє значення заголовка
 * читається лише тут, на сервері, з process.env.
 */
export interface PartnerApiCheckConfig {
  open_url: string;
  /** Включно з "telegram_id=" у кінці — сам telegram_id дописується напряму, без плейсхолдера. */
  check_url: string;
  /** Назва HTTP-заголовка для авторизації (напр. "x-api-key"). Опційно. */
  header_name?: string;
  /** Ім'я змінної оточення, що зберігає ЗНАЧЕННЯ заголовка. Опційно. */
  header_env_key?: string;
  /**
   * Dot-шлях у JSON-відповіді, що має бути НЕ null/undefined для успіху
   * (напр. "data.registeredAt"). Якщо не задано — перевіряємо
   * {"success": true} (формат Cookie Wars/Crybble за замовчуванням).
   */
  success_path?: string;
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
  if (obj.header_name !== undefined && typeof obj.header_name !== "string") {
    throw new Error("target_value.header_name must be a string when present");
  }
  if (obj.header_env_key !== undefined && typeof obj.header_env_key !== "string") {
    throw new Error("target_value.header_env_key must be a string when present");
  }
  if (obj.success_path !== undefined && typeof obj.success_path !== "string") {
    throw new Error("target_value.success_path must be a string when present");
  }

  return {
    open_url: obj.open_url,
    check_url: obj.check_url,
    header_name: obj.header_name as string | undefined,
    header_env_key: obj.header_env_key as string | undefined,
    success_path: obj.success_path as string | undefined,
  };
}

/** Дістає значення за dot-шляхом ("data.registeredAt") з довільного JSON. */
function getByPath(body: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, body);
}

interface PartnerCheckApiResponse {
  success?: boolean;
}

/**
 * Викликає зовнішній check-API партнера: GET {check_url}{telegram_id}.
 * Мережева помилка, таймаут, не-2xx статус чи неочікувана форма відповіді
 * -> false, НІКОЛИ true — той самий принцип, що й isChannelMember
 * (lib/telegram/getChatMember.ts): "не вдалось перевірити" не повинно
 * трактуватись як "виконано". 8-секундний таймаут — партнерський сервер нам
 * не підконтрольний, роут /api/tasks/verify не має зависати через чужу
 * повільну відповідь.
 */
export async function checkPartnerApiTask(config: PartnerApiCheckConfig, telegramId: number): Promise<boolean> {
  const url = `${config.check_url}${telegramId}`;

  const headers: Record<string, string> = {};
  if (config.header_name && config.header_env_key) {
    const secretValue = process.env[config.header_env_key];
    if (!secretValue) {
      throw new Error(`server misconfigured: ${config.header_env_key} is not set`);
    }
    headers[config.header_name] = secretValue;
  }

  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000), headers });
    if (!res.ok) return false;

    const body = (await res.json()) as PartnerCheckApiResponse;

    if (config.success_path) {
      const value = getByPath(body, config.success_path);
      return value !== null && value !== undefined;
    }

    return body.success === true;
  } catch (err) {
    // Помилка server misconfigured (вище) має пробитись наверх як 500, а не
    // тихо стати "не виконано" — інші помилки (мережа/таймаут/парсинг) все
    // ще fail-closed на false.
    if (err instanceof Error && err.message.startsWith("server misconfigured")) throw err;
    return false;
  }
}
