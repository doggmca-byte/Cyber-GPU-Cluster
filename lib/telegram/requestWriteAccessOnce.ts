/**
 * Нативний Telegram-діалог "дозволити боту писати" — без власного тексту й
 * будь-яких додаткових підказок. Питаємо не частіше одного разу за життя
 * вкладки (Telegram сам не повторює діалог, якщо дозвіл уже є, але повторна
 * відмова не має перетворюватись на спам). Статус окремо зберігати не треба:
 * /api/user/sync бере allows_write_to_pm із ПІДПИСАНОГО initData наступного
 * запуску й знімає позначку недосяжності бота (clear_bot_block).
 */
let requested = false;

export function requestWriteAccessOnce(): void {
  if (requested || typeof window === "undefined") return;

  const webApp = window.Telegram?.WebApp;
  if (!webApp?.requestWriteAccess) return; // старий клієнт Telegram — метод недоступний
  if (webApp.initDataUnsafe?.user?.allows_write_to_pm) return; // дозвіл уже є

  requested = true;
  try {
    webApp.requestWriteAccess(() => {
      // Результат нікуди не пишемо — див. коментар на початку файлу.
    });
  } catch {
    // Діалог — суто зручність: збій не повинен ламати сам збір HASH.
  }
}
