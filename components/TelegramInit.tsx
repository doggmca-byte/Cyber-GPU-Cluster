"use client";

import { useEffect } from "react";
import telegramAnalytics from "@telegram-apps/analytics";

// Telegram Mini App Store ранжує каталог за активністю (запуски, TON Connect
// події), яку збирає цей SDK — токен видає @DataChief_bot / builders.ton.org.
// Без NEXT_PUBLIC_TG_ANALYTICS_TOKEN просто не ініціалізуємось (локальна
// розробка/попередній деплой без токена не повинні падати чи спамити помилками).
let analyticsInitialized = false;

/**
 * Ініціалізація Telegram WebApp SDK. Скрипт підключений у app/layout.tsx
 * через next/script (strategy="beforeInteractive"), тож window.Telegram
 * вже доступний на момент монтування. Глобальний тип — types/telegram-web-app.d.ts.
 */
export function TelegramInit() {
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_TG_ANALYTICS_TOKEN;
    if (token && !analyticsInitialized) {
      analyticsInitialized = true;
      telegramAnalytics.init({
        token,
        appName: process.env.NEXT_PUBLIC_TG_ANALYTICS_APP_NAME || "cyber_gpu_cluster",
      });
    }

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
