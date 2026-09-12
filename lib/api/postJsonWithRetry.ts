/**
 * POST-читання з повтором — для екранів, які лише ЗАВАНТАЖУЮТЬ дані
 * (список завдань, статистика друзів, історія виводів тощо).
 *
 * Навіщо: шлюз Supabase зрідка віддає 502/503/504 навіть на найпростіший
 * запит (виміряно 12.09 — 0.43% звернень за добу). Один такий збій робив
 * цілий екран порожнім із написом про помилку, хоча повтор за пів секунди
 * дав би дані. Ці ендпойнти — POST лише тому, що несуть initData в тілі;
 * за суттю це читання, тож повторювати їх безпечно.
 *
 * ВАЖЛИВО: не використовувати для дій, що змінюють стан (купівля, вивід,
 * обмін, клейм) — там 5xx може означати "операція вже пройшла, загубилась
 * лише відповідь", і повтор списав би кошти двічі.
 */
const RETRY_DELAYS_MS = [300, 900];
const ATTEMPT_TIMEOUT_MS = 8000;

/**
 * Відмова по суті (4xx: протухла initData, невалідний запит). Окремий клас
 * потрібен, щоб цикл нижче не проковтнув її як "тимчасовий збій": кинута
 * всередині try, вона потрапляє у власний catch, і без цієї позначки
 * безнадійний запит повторювався б ще двічі, лише сповільнюючи помилку.
 */
class FinalApiError extends Error {}

export async function postJsonWithRetry<T>(url: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const isLastAttempt = attempt >= RETRY_DELAYS_MS.length;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) return (await res.json()) as T;

      const errorBody = (await res.json().catch(() => null)) as { error?: string } | null;
      const message = errorBody?.error ?? `request failed with status ${res.status}`;
      throw res.status < 500 ? new FinalApiError(message) : new Error(message);
    } catch (error) {
      if (error instanceof FinalApiError || isLastAttempt) throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}
