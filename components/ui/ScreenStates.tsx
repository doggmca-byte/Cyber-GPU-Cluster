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
    <div className="glass-card p-5 text-center">
      <p className="text-sm font-semibold text-white">{t.noTelegram.title}</p>
      <p className="mt-2 text-xs text-slate-400">{t.noTelegram.description}</p>
    </div>
  );
}

export function SyncErrorNotice({ message }: { message: string }) {
  const { t } = useTranslation();

  return (
    <div className="glass-card p-5 text-center">
      <p className="text-sm font-semibold text-red-400">{t.syncError.title}</p>
      <p className="mt-2 text-xs text-slate-400">{message}</p>
    </div>
  );
}
