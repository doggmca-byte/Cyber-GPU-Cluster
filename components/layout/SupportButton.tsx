"use client";

import { Headphones } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";

// Публічний — акаунт підтримки, не секрет. Плейсхолдер до продакшн-налаштування
// (див. TODO в .env.example) — доти клік відкриє неіснуючий чат, як і решта
// @..._here плейсхолдерів завдань у task_templates seed.
const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL ?? "";

/**
 * Іконка-кнопка підтримки в правому куті Header — відкриває чат з
 * акаунтом підтримки (людина/чат/бот, байдуже — усі приймають Telegram deep
 * link однаково) через той самий openTelegramLink/window.open fallback, що
 * й реферальне посилання в FriendsScreen.
 *
 * Автопідстановка: дописуємо ?text= із Telegram ID (і @username, якщо є) —
 * Telegram підставляє це в поле вводу чату НЕЗАПОВНЕНИМ до відправки
 * (users і боти приймають однаково), тож підтримка одразу бачить, хто
 * звертається, ще до першого повідомлення користувача.
 */
export function SupportButton() {
  const { state } = useUserData();
  const { t } = useTranslation();

  if (!SUPPORT_URL) return null;

  const profile = state.status === "ready" ? state.data.profile : null;

  // Повідомлення в підтримку навмисно ЗАВЖДИ англійською, незалежно від
  // t.support/мови застосунку (LanguageProvider) — це текст ДЛЯ саппорту,
  // а не UI-копія користувачу, тож не з i18n dictionaries.
  const handleClick = () => {
    const message = profile
      ? `Cyber GPU Cluster — need help.\nTelegram ID: ${profile.telegram_id}${
          profile.username ? ` (@${profile.username})` : ""
        }`
      : "Cyber GPU Cluster — need help.";

    const url = `${SUPPORT_URL}?text=${encodeURIComponent(message)}`;
    const webApp = window.Telegram?.WebApp;

    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(url);
    } else if (webApp?.openLink) {
      webApp.openLink(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t.support.label}
      className="rounded-full border border-white/5 bg-background-card p-1.5 text-slate-500 transition hover:text-neon-cyan"
    >
      <Headphones size={13} />
    </button>
  );
}
