"use client";

import { useEffect } from "react";

/**
 * Ініціалізація Telegram WebApp SDK. Скрипт підключений у app/layout.tsx
 * через next/script (strategy="beforeInteractive"), тож window.Telegram
 * вже доступний на момент монтування. Глобальний тип — types/telegram-web-app.d.ts.
 */
export function TelegramInit() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    tg.ready();
    tg.expand();
    tg.setHeaderColor?.("#080b11");
    tg.setBackgroundColor?.("#080b11");
    tg.disableVerticalSwipes?.();
  }, []);

  return null;
}
