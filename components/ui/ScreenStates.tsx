"use client";

import { useTranslation } from "@/lib/i18n/LanguageProvider";

/** Спільні loading/no-telegram/error-стани для екранів, підписаних на useUserData(). */

export function ScreenSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="glass-card h-20" />
      <div className="glass-card h-10" />
      <div className="glass-card h-56" />
      <div className="glass-card h-16" />
      <div className="glass-card h-16" />
    </div>
  );
}

export function NoTelegramNotice() {
  const { t } = useTranslation();

  return (
    <div className="glass-card p-6 text-center">
      <p className="font-display text-sm font-bold">{t.noTelegram.title}</p>
      <p className="mt-2 text-sm text-white/50">{t.noTelegram.description}</p>
    </div>
  );
}

export function SyncErrorNotice({ message }: { message: string }) {
  const { t } = useTranslation();

  return (
    <div className="glass-card p-6 text-center">
      <p className="font-display text-sm font-bold text-red-400">{t.syncError.title}</p>
      <p className="mt-2 text-sm text-white/50">{message}</p>
    </div>
  );
}
